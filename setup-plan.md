# Setup & Maintenance Plan — T.O.U.C.H. The World

How the site is hosted, paid through, and (most importantly) how Goddess can
update her own text without touching code.

**The stack:**
- **Netlify** — hosting (free). Site lives here; updated by drag-and-drop.
- **StackEdit** (web) / **Typora** (desktop) — markdown editors for editing text.
- **Stripe** — credit-card payments (already set up). Hosted by Stripe; no code.
- **Google Drive / Dropbox** — the *master copy* of the site folder lives here.

The key idea: **the editable words live in one file, `content.md`.** Goddess
edits that file in a friendly editor, then drags the site folder onto Netlify.
She never touches HTML.

---

## Roles

- **Herby (technical setup):** does the one-time work in Part 1 once.
- **Goddess (ongoing):** follows the simple loop in Part 3 whenever text changes.

---

## Part 1 — One-time technical setup (Herby)

### 1A. Restructure the site for markdown editing
*(Prerequisite — not yet built. This is the next dev task before launch.)*

- Pull the editable text (bio, Energy Healing copy, schedule, price) out of
  `index.html` into a single `content.md`.
- Add a small JavaScript loader that reads `content.md` and renders it into the
  page. No build step, no Git required — works with plain drag-and-drop.
- Booking slot *times* stay in code (`scheduling.js`); the human-readable
  schedule text also gets mirrored into `content.md` so all words live in one
  place.

> Note: because `content.md` loads via JavaScript, changes are previewed on the
> live Netlify URL after upload — not by double-clicking the file locally.

### 1B. Create the Netlify site
1. Go to **https://app.netlify.com** and sign up (free — use Google login for
   simplicity).
2. Use **Netlify Drop**: https://app.netlify.com/drop
3. Drag the entire site folder onto the page. It deploys in seconds and gives a
   temporary URL like `random-name-123.netlify.app`.
4. In **Site settings → Change site name**, rename it to something clean
   (e.g. `touch-the-world`).

### 1C. Connect the custom domain (goddessttw.com)
1. In Netlify: **Domain management → Add a domain** → enter `goddessttw.com`.
2. Netlify shows the DNS records to set. At the domain registrar (wherever
   goddessttw.com was bought), point the domain to Netlify (either change the
   nameservers to Netlify's, or add the records Netlify lists).
3. Netlify auto-issues a free HTTPS certificate. Allow up to a few hours for DNS
   to propagate.

### 1D. Confirm Stripe
- The Stripe **Payment Link** for the $25 session is pasted into
  `scheduling.js` (replacing `YOUR_PAYMENT_LINK`).
- Test one live booking end-to-end and confirm the payment shows in the Stripe
  dashboard.

### 1E. Set up the master copy
- Put the final site folder in **Google Drive** (or Dropbox) in a folder named
  e.g. `TOUCH-Website`. **This is the source of truth**, not Netlify.
- Share it with Goddess so she always has the current version to edit.

---

## Part 2 — One-time setup for Goddess (her tools)

Pick **one** editor. Both just open and save the same `content.md` file.

### Option A — StackEdit (web, free, nothing to install) — recommended to start
1. Go to **https://stackedit.io** and click **Start writing**.
2. That's it — no account required.

### Option B — Typora (desktop, ~$15 one-time, most "like Word")
1. Download from **https://typora.io** (Mac or Windows).
2. Install. It opens markdown files that look like a clean word processor.

---

## Part 3 — The editing loop (Goddess, every time she changes text)

This is the whole job. ~5 steps, no code.

1. **Open the master folder** in Google Drive and download a fresh copy of it
   to the computer (so you're always editing the latest version).
2. **Open `content.md`** in StackEdit (or Typora):
   - *StackEdit:* stackedit.io → folder icon → Import → choose `content.md`.
   - *Typora:* File → Open → choose `content.md`.
3. **Change the words.** Only edit the text between the labeled sections. Don't
   delete the section headings (the lines starting with `#`).
4. **Save the file** back into the site folder, replacing the old `content.md`.
   - *StackEdit:* menu → Export → as Markdown → save as `content.md`.
   - *Typora:* Cmd/Ctrl + S.
5. **Re-upload to Netlify:**
   - Go to **https://app.netlify.com/drop**
   - Drag the **whole site folder** onto the page.
   - Wait a few seconds, then open **goddessttw.com** to see the change live.
6. **Save the updated folder back to Google Drive** so the master copy stays
   current.

---

## What NOT to touch (safety notes for Goddess)

- ✅ **Safe to edit:** the words inside `content.md`.
- ⚠️ **Leave alone:** the `#` headings in `content.md`, and all the other files
  (`index.html`, `styles.css`, `*.js`). Those are the machinery.
- If something looks broken after an upload, just re-upload the last good copy
  from Google Drive — nothing is ever permanently lost.

---

## Costs summary

| Item | Cost |
|---|---|
| Netlify hosting | $0 / mo |
| Domain (goddessttw.com) | ~$12–15 / yr (already owned) |
| StackEdit | Free |
| Typora (optional) | ~$15 one-time |
| Stripe | $0 fixed + 2.9% + 30¢ per $25 session (~$1.03) |
| Formspree (contact form) | Free (50 submissions/mo) |

Effective ongoing cost: **~the domain renewal only.**

---

## Sequence to launch

1. [ ] Build `content.md` + loader (Part 1A) — *next dev task*
2. [ ] Paste live Stripe Payment Link (Part 1D)
3. [ ] Replace QR placeholders with real Venmo/Zelle codes
4. [ ] Deploy to Netlify (Part 1B)
5. [ ] Point goddessttw.com at Netlify (Part 1C)
6. [ ] Put master copy in Google Drive + share with Goddess (Part 1E)
7. [ ] Walk Goddess through one practice edit (Part 3)
