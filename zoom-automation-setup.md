# Automated per-session Zoom links — setup & handoff guide

When someone pays **by card**, Stripe notifies our Netlify function, which registers
that buyer for the **exact session they booked** (not every session). Zoom then emails
them a **unique, occurrence-scoped join link**. Each attendee gets their own traceable
link that only opens their one session.

```
Card payment on Stripe (buyer picked a slot, e.g. "Saturday-August-1-11-00-AM")
  → Stripe "checkout.session.completed" webhook  (slot rides in client_reference_id)
  → Netlify function  netlify/functions/stripe-webhook.js
       • time  (11:00 AM) → picks the recurring meeting
       • date  (August 1) → picks that meeting's occurrence
  → Zoom "Add meeting registrant" for that occurrence (unique join_url)
  → Zoom emails that person their unique link  (us06web.zoom.us/w/<id>?tk=…)
```

The code is done and **verified working end-to-end**. The steps below are the external
accounts/settings — all on the **client's** Zoom, Stripe, and Netlify.

---

## A. Zoom (client's LICENSED account — one-time)

The practice runs **three recurring weekly meetings**, one per session time. Each
meeting's weekly occurrences are the actual sessions:

| Session time | Days | Env var for its numeric Meeting ID |
|---|---|---|
| 1:00 PM  | Wed / Thu / Fri | `ZOOM_MEETING_ID_1PM` |
| 7:00 PM  | Wed / Thu / Fri | `ZOOM_MEETING_ID_7PM` |
| 11:00 AM | Sat             | `ZOOM_MEETING_ID_11AM` |

> ⚠️ **Must be a Licensed (paid) Zoom user.** Meeting registration + the registrant API
> are not available on Basic/free accounts, and No-Fixed-Time meetings can't have
> registration — so use **fixed Weekly recurrences**.

### A1. For EACH of the three recurring meetings, turn on per-occurrence registration
Zoom → **Meetings** → the recurring meeting → **Edit**:
- **Registration:** check **Required**.
- After saving, under **Registration → Settings** → **Edit**:
  - **Approval:** *Automatically Approve*.
  - **Registration type:** **_Attendees need to register for each occurrence to attend_**
    ← this is what limits a buyer's link to only their one session.
  - **Email Settings:** turn **ON** *"Send confirmation email to registrants"* —
    **this is the email that delivers the unique link.**
- Note the numeric **Meeting ID** (digits in the join URL, e.g. `zoom.us/j/82777865112`
  → `82777865112`) → the matching `ZOOM_MEETING_ID_*` var above.

### A2. Create a Server-to-Server OAuth app (once, on the client's account)
[marketplace.zoom.us](https://marketplace.zoom.us) → **Develop → Build App → Server-to-Server OAuth**:
- Copy **Account ID**, **Client ID**, **Client Secret** →
  `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`.
- **Scopes:** add `meeting:write:registrant:admin` (older accounts: `meeting:write:admin`)
  and `meeting:read:meeting:admin` (older: `meeting:read:admin`).
- Fill required app info and **Activate** the app.

> 🔐 If the Client Secret was ever exposed (e.g. pasted into a chat/transcript),
> **Regenerate** it here before launch and use the fresh value in step B.

---

## B. Netlify (client-owned FREE account, deployed via CLI + Personal Access Token)

The client owns a free Netlify account (Google SSO). Herby deploys as her using a
**Netlify Personal Access Token** — no shared login, no paid team, no GitHub collaborator.

### B1. She generates a token (once)
Netlify → **User settings → Applications → Personal access tokens → New access token**
→ copy it, send it privately. Revocable anytime from that page.

### B2. Herby deploys with that token
```bash
export NETLIFY_AUTH_TOKEN=<her-token>
netlify sites:create        # first time only (or: netlify link to an existing site)
./build-site.sh
netlify deploy --build --prod
```
> Deploys are **manual CLI** (run the command to ship) — the repo is source control only,
> not connected to Netlify. Fine since Herby drives every change.

### B3. Set the environment variables (6 needed by the function)
```bash
netlify env:set ZOOM_ACCOUNT_ID       '<from A2>'
netlify env:set ZOOM_CLIENT_ID        '<from A2>'
netlify env:set ZOOM_CLIENT_SECRET    '<from A2 — use the regenerated value>'
netlify env:set ZOOM_MEETING_ID_1PM   '<from A1>'
netlify env:set ZOOM_MEETING_ID_7PM   '<from A1>'
netlify env:set ZOOM_MEETING_ID_11AM  '<from A1>'
netlify env:set STRIPE_WEBHOOK_SECRET '<from C1, whsec_…>'
```
> `ZOOM_SECRET_TOKEN` is **not** used by this function (it's Zoom's inbound-webhook
> validation token) — no need to set it. **Env changes require a redeploy** (rerun B2).

The function will be live at:
`https://<her-site>.netlify.app/.netlify/functions/stripe-webhook`  ← the **webhook URL**

> Use this raw **`netlify.app` subdomain** for the Stripe webhook (below), even if the
> public site uses a vanity domain. The webhook is backend/invisible, and the subdomain
> isolates the payment→Zoom path from any DNS/domain risk.

---

## C. Stripe (client's own account — live)

### C1. Add the webhook endpoint
Stripe (client's account) → **Workbench → Webhooks → Add endpoint / Add destination**:
- **Scope:** *Your account*.
- **URL:** the function URL from step B (the `netlify.app` one).
- **Events:** `checkout.session.completed` (only).
- Copy the endpoint's **Signing secret** (`whsec_…`) → set as `STRIPE_WEBHOOK_SECRET`
  (step B3), then redeploy.

### C2. Payment Link + post-payment message
- Create **one** Payment Link for the session in the client's account. Give its base URL
  to update `scheduling.js` (the `STRIPE_PAYMENT_LINK` constant). The site appends
  `?client_reference_id=<slot>` automatically — that's how the function knows the session.
- Edit the Payment Link → **After payment → Show a confirmation message**:
  > "Thank you! Check your email for your unique Zoom link to join your session."
- **Remove any static Zoom link** from the confirmation message — the real, per-person
  link is emailed by Zoom; a shared static link there is misleading and bypasses
  registration.

### C3. Test vs. live
`scheduling.js` currently points at a **test-mode** Payment Link. For launch, use the
client's **live** Payment Link + a **live** webhook endpoint, and set the live signing
secret. Test-mode and live-mode webhooks have **different** `whsec_…` secrets.

---

## D. Test end-to-end
1. Book a slot on the deployed site → **Credit Card** → in test mode use card
   `4242 4242 4242 4242` (any future date/CVC). (For launch, do one **real** live charge
   and refund it.)
2. Confirm the buyer's email receives the Zoom **confirmation email with a unique
   `…/w/<id>?tk=…` join URL** scoped to the booked date/time.
3. Check the function logs:
   ```bash
   netlify logs --source functions --function stripe-webhook --since 30m
   ```
   You should see `Registered <email> for <slot> (meeting …, occurrence …) — join_url
   issued: yes`. Errors show here too.

---

## Notes / caveats
- **Only card is automated.** Venmo / Zelle / PayPal have no reliable "paid" signal, so
  they stay manual — those buyers don't get an auto-issued unique link.
- **Retries are safe:** Stripe may deliver a webhook more than once; re-registering the
  same email for the same occurrence is harmless.
- **Secrets live only in Netlify's environment** and a local gitignored `.env` (for
  `test-zoom.js` / `test-webhook-local.js`), never in committed code.
- **Session ops (client runbook):** start the room ~10–15 min early (join-before-host
  OFF), then at start time click **Security → Lock Meeting** to block latecomers.
  Passcode ON (embedded in links), Waiting Room OFF.
