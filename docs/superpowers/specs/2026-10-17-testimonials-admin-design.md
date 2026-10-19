# Testimonials Admin — Design

Date: 2026-10-17 · Status: awaiting review

## Goal

Goddess adds, edits, reorders, and removes testimonials on goddessttw.com herself, from her phone or computer, with no code edits and no deploy.

**Success:** she pastes a YouTube link and a caption (or uploads a letter photo), taps Save, and it's on the homepage on the next page load, looking identical to the current testimonials.

## Decisions (agreed in brainstorming)

| Topic | Decision |
|---|---|
| Who uses it | Only her. Visitors don't submit testimonials. |
| Videos | Uploaded to YouTube first. The admin stores only the link plus details. No video files are stored. |
| Scope | Videos (link, caption, optional Spanish link, optional "Read the messages" screenshot, shape) and letter images (image + description). |
| Existing content | All 9 videos and 5 letters are imported once, so she can manage everything. Janet and Andy keep their Spanish toggle. |
| Login | One password in the Netlify env var `ADMIN_PASSWORD`. |
| Video shape | Vertical (default) or Horizontal, chosen by her and previewed in that shape. Horizontal cards span the full grid width in 16:9. |
| Last grid row | Centered. The grid changes from CSS grid to a centered flex row (same 960px max, 28px gap, same 3/2/1-column breakpoints). |
| New items | Added at the end of their list. She can move them with ↑ ↓. |
| Storage | Netlify Blobs on her free Netlify site. |

Mockups: `docs/mockups/admin-mockup.html`, `add-video-mockup.html`, `testimonials-horizontal-mockup.html` (that last one is approved as the homepage look).

## Architecture

```
Homepage (index.html + testimonials.js)
   │  GET /api/testimonials           → JSON list
   │  GET /api/testimonials/img/<id>  → letter / screenshot image
   ▼
testimonials.mjs (public, read-only) ──reads──► Netlify Blobs store (live or staging, by host)
                                                    ├─ key "data"      → JSON (videos[], letters[])
admin.html  ──POST /api/admin (password header)──►  └─ key "img/<id>"  → image bytes + content type
   testimonials-admin.mjs (writes, checks ADMIN_PASSWORD)
```

The three new units each have one job:

1. **`netlify/functions/testimonials.mjs`** (public): `GET /api/testimonials` returns the list as JSON. `GET /api/testimonials/img/<id>` returns that image with its content type. Errors return JSON `{error}` with status 404 or 500.
2. **`netlify/functions/testimonials-admin.mjs`** (protected): `POST` with an action body (`add-video`, `update-video`, `add-letter`, `update-letter`, `delete`, `move`, and `login-check`). Images arrive as base64 in the JSON body, already shrunk in the browser to about 1600px on the long side. After each write it purges the CDN cache tag `testimonials`.
3. **`admin.html` + `admin.js` + `admin.css`**: the admin UI from the mockups.

Both functions use the modern Netlify function format (`export default async (req) => Response` with `config.path`), which the `@netlify/blobs` library needs to configure itself. Shared logic lives in `netlify/lib/` (outside the functions folder, so Netlify doesn't treat it as a function). The YouTube link parser, `netlify/lib/youtube.mjs`, has no Node dependencies and is also copied to the site for `admin.js` to import, so browser and server use the same rule. Stores are opened with `consistency: 'strong'`, so a read straight after a save never sees the old list (by default, Blobs can return stale data for up to a minute). The existing `stripe-webhook.js` is untouched, and all new files are `.mjs` so its CommonJS format keeps working.

### Data shape (`data` key)

```json
{
  "videos": [
    { "id": "v_0123456789ab", "youtubeId": "81-TSDf7Hkw", "caption": "Janet",
      "spanishYoutubeId": "IlA3SaP2M50", "shape": "vertical",
      "screenshotImgId": null }
  ],
  "letters": [
    { "id": "l_0123456789ab", "imgId": "i_0123456789ab", "alt": "Letter from Mannie sharing gratitude for healing" }
  ]
}
```

Order in the arrays is the display order. `shape` is `"vertical"` or `"horizontal"`. Image ids are `i_` plus 12 hex characters, stored under the blob key `img/<imgId>`. `screenshotImgId` is either null or an image id.

### Validation (on the server; the browser repeats it only to give instant feedback)

- **YouTube links:** accept `youtu.be/ID`, `youtube.com/watch?v=ID`, `/shorts/ID`, `/embed/ID`, and the `m.` and `www.` hosts. Store only the 11-character ID, matching `[A-Za-z0-9_-]{11}`. Reject anything else with "That doesn't look like a YouTube link".
- **Caption / description:** required, 1–120 characters, whitespace trimmed.
- **Images:** must be `image/jpeg`, `image/png`, or `image/webp`, and at most 3 MB (keeps the base64 request under Netlify's 6 MB body limit). The browser shrinks images first to at most 1600px wide and 3200px tall (tall phone screenshots stay readable). It keeps PNG unless that's over 2 MB, then falls back to JPEG at 0.85 quality.

### Security

- The password goes in an `x-admin-password` header and is compared in constant time (`crypto.timingSafeEqual` on SHA-256 hashes).
- A wrong password gets a 1-second delay, then a 401.
- If `ADMIN_PASSWORD` isn't set, every admin call fails (no default password).
- The page keeps the password in `sessionStorage` only, so closing the tab logs her out.
- The homepage builds cards with `textContent` and `setAttribute` and never uses `innerHTML` with her text, so a caption can't inject markup.
- `admin.html` gets `<meta name="robots" content="noindex">`.

### Caching and free-tier budget

Each homepage visit would otherwise call the function once for the list plus once per image. Responses use Netlify's CDN cache instead:

- **List:** `Netlify-CDN-Cache-Control: public, durable, s-maxage=31536000`, `Netlify-Cache-Tag: testimonials`, and the browser header `Cache-Control: public, max-age=0, must-revalidate`. Every admin save calls `purgeCache({ tags: ['testimonials'] })`, so changes appear on the next load while most visits never reach the function.
- **Images:** keys are unique and never reused (a replaced image gets a new id), so they're cached as `immutable` for a year, with `Netlify-Cache-Tag: testimonials-img`. Deleting or replacing an image deletes the blob and also purges `testimonials-img`, so a withdrawn letter stops being served right away rather than living on in the CDN.

## Homepage changes

- `index.html`: the video grid and letters deck become empty containers with a loading state. The static markup is removed.
- New `testimonials.js`: on load, fetch the list and build `figure.video-card` elements with exactly today's markup. Bilingual videos get `bilingual-video` plus `data-en`/`data-es` and the toggle. A video with a screenshot gets the `chat-link` button. Horizontal videos get the `video-card--wide` modifier. Letters become `.letter-card` images, with the `--i` fan index capped at 4 so a big deck keeps its look. An empty list hides its block.
- `script.js`: the lang-toggle, chat-link, and letters-deck handlers switch to event delegation on `document`, so they work on cards added after page load without any init ordering. The lightbox code itself doesn't change.
- If the fetch fails: show "Testimonials couldn't load right now — please refresh." in the section.
- `styles.css`: the grid changes to flex, plus `.video-card--wide`, as approved in the mockup.

**Trade-off accepted:** testimonial captions are now rendered by JavaScript, so search engines see less text there. Acceptable for a short caption list.

## One-time import

`scripts/import-testimonials.mjs <base-url>` (run locally with `ADMIN_PASSWORD` set) adds the 9 videos and 5 letters, along with their captions, alt text, Spanish IDs, and the Baby's Rash screenshot, through the admin API in display order. Since the API picks the store by host, the same script fills local, draft (staging), and live. It refuses to run if the target already has any testimonials, so it can't create duplicates. Once the new homepage is live, the static letter images stop being copied by `build-site.sh`.

## Build and deploy

- Add `package.json` (no `"type": "module"`; that would break the CommonJS webhook) with the `@netlify/blobs` and `@netlify/functions` dependencies (for `purgeCache`). Run `npm install` locally before deploying (the CLI bundles from local `node_modules`). Gitignore `node_modules/`.
- `build-site.sh`: also copy `admin.html`, `admin.js`, `admin.css`, `testimonials.js`, and `netlify/lib/youtube.mjs` → `youtube.mjs`.
- Set the `ADMIN_PASSWORD` env var on `touch-the-world` (site `41b83477…`) with her token, then deploy using the existing flow (the `deploy` skill).

## Environments and rollout

**Store selection by host.** Both functions pick the Blobs store from the request's `Host`:
- `goddessttw.com`, `www.goddessttw.com`, and `touch-the-world.netlify.app` → store `testimonials` (live).
- Anything else (draft deploys like `<hash>--touch-the-world.netlify.app`, `localhost`) → store `testimonials-staging`.

Draft deploys share the site-wide Blobs and env vars, so without this rule a draft could edit the live list. The rule lives in `testimonials-core.mjs`, where it's unit-tested.

**Rollout order:**
1. Local: `netlify dev`, the full end-to-end checklist from Testing below.
2. Draft: `netlify deploy` (no `--prod`) to `touch-the-world`. Import into the staging store, then test on desktop and phone at the draft URL.
3. Production deploy A (admin + functions only; homepage unchanged): `netlify deploy --prod`. Run the import against `https://goddessttw.com`, then check `/admin` lists everything. Visitors see no change.
4. Production deploy B (new homepage), after it passes locally and on a draft: compare with the old homepage, then add and delete a test video live.
5. Rollback: the Netlify Deploys tab can publish the previous deploy in one click. The old homepage ignores the store, so rollback is always safe.

## Error handling (admin UI)

All errors show plain words, and her form stays filled in:
- invalid link → error under that field
- missing caption → field highlighted
- non-image file → "Please choose a photo or image file"
- network or server failure → "Couldn't save — please try again"
- 401 partway through → password prompt, with the draft kept

Delete asks for confirmation in the page itself (no browser `confirm()`). If two saves happen at once, the last one wins; no locking.

## Testing

- **Unit tests** (Node's built-in `node:test`, no new framework) for the YouTube ID parser, validation, the list operations (add/update/move/delete), and the password check, all pure functions in `netlify/lib/testimonials-core.mjs` and `netlify/lib/youtube.mjs`.
- **Local end-to-end** with `netlify dev`, which provides a local Blobs store: log in, add vertical and horizontal videos, add a letter, reorder, delete, and confirm the homepage renders each one. Also: a wrong password is rejected, and the homepage shows the error message when the function is down.
- **After deploy:** run the import, compare the live homepage with the current one (same 9 videos, toggles, screenshot, 5 letters), add and remove a test video live, and confirm the change appears without a deploy.

## Out of scope

Visitor submissions, multiple admin accounts, edit history, video file uploads, and automatic shape detection.
