# Automated per-enrollee Zoom links — setup guide

When someone pays **by card**, Stripe notifies our Netlify function, which registers
them on the recurring **group** Zoom meeting. Zoom then emails that person a **unique
join link**. One shared meeting room; each attendee gets their own traceable link.

```
Card payment on Stripe
  → Stripe "checkout.session.completed" webhook
  → Netlify function  netlify/functions/stripe-webhook.js
  → Zoom "Add meeting registrant" (unique join_url per person)
  → Zoom emails that person their unique link
```

The code is done. The steps below are the external accounts/settings only you can do.

---

## A. Zoom (one-time)

### A1. Turn on registration for the recurring group meeting
Zoom → **Meetings** → your recurring session → **Edit**:
- **Registration:** check **Required**.
- Under **Registration → Settings** (edit after saving):
  - **Approval:** *Automatically Approve*.
  - **Registration type:** *Attendees register once and can attend any of the occurrences*.
  - **Email Settings:** turn **ON** *"Send confirmation email to registrants"* — **this is the email that delivers the unique link.**
- Note the numeric **Meeting ID** (the digits in the join URL, e.g. `zoom.us/j/83741087066` → `83741087066`). → `ZOOM_MEETING_ID`

### A2. Create a Server-to-Server OAuth app
[marketplace.zoom.us](https://marketplace.zoom.us) → **Develop → Build App → Server-to-Server OAuth**:
- Copy **Account ID**, **Client ID**, **Client Secret** → `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`.
- **Scopes:** add the meeting-registrant write scope — `meeting:write:registrant:admin`
  (older accounts: `meeting:write:admin`). Also add `meeting:read:meeting:admin`
  (older: `meeting:read:admin`) so the app can see the meeting.
- Fill the required app info and **Activate** the app.

---

## B. Netlify (deploy with the function + secrets)

Functions can't ride the drag-and-drop flow — use the CLI (one-time setup):

```bash
npm install -g netlify-cli
netlify login
netlify link          # connect this folder to your existing Netlify site
```

Set the environment variables (Netlify dashboard → **Site settings → Environment
variables**, or via CLI `netlify env:set NAME value`):

| Variable | Value |
|---|---|
| `STRIPE_WEBHOOK_SECRET` | from step C1 (`whsec_...`) |
| `ZOOM_ACCOUNT_ID` | from A2 |
| `ZOOM_CLIENT_ID` | from A2 |
| `ZOOM_CLIENT_SECRET` | from A2 |
| `ZOOM_MEETING_ID` | from A1 |

Deploy (this replaces the "drag the zip" step):

```bash
./build-site.sh
netlify deploy --prod --dir=site --functions=netlify/functions
```

Your function will be live at:
`https://<your-site>.netlify.app/.netlify/functions/stripe-webhook`

---

## C. Stripe (webhook + post-payment message)

### C1. Add the webhook endpoint
Stripe Dashboard → **Developers → Webhooks → Add endpoint**:
- **URL:** `https://<your-site>.netlify.app/.netlify/functions/stripe-webhook`
- **Events:** `checkout.session.completed`
- Copy the endpoint's **Signing secret** (`whsec_...`) → set as `STRIPE_WEBHOOK_SECRET`
  in Netlify, then redeploy (step B).

### C2. Post-payment message
Edit your **Payment Link** → **After payment → Show a confirmation message**:
> "Thank you! Check your email for your unique Zoom link to join your session."

(The buyer's email, name, and chosen slot already reach the function — email and name
from Stripe's checkout, and the slot via `client_reference_id`, which `scheduling.js`
already sets.)

### C3. Go live
The current link in `scheduling.js` is a **test-mode** Payment Link. Before launch,
create the **live-mode** Payment Link + **live-mode** webhook, and use the live
signing secret.

---

## D. Test end-to-end
1. In Stripe **test mode**, pay with card `4242 4242 4242 4242` (any future date/CVC).
2. Confirm the test email address receives the Zoom **confirmation email with a unique
   join URL**.
3. Check **Netlify → Functions → stripe-webhook** logs — you should see
   `Registered <email> ...`. Errors show there too.

---

## Notes / caveats
- **Manual methods (Venmo / Zelle / PayPal) are not automated** — no reliable "paid"
  signal exists, so they still show the *shared* recurring link on the confirmation
  screen. If you want *every* enrollee to get a unique link, offer **card only**.
- **Retries are safe:** Stripe may deliver a webhook more than once; re-registering the
  same email is harmless.
- **Secrets live only in Netlify's environment**, never in the committed code.
