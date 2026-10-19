# Testimonials Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A password-protected `/admin` page lets the client add, edit, reorder, and delete video (YouTube) and letter-image testimonials, and the homepage renders them live with no deploy.

**Architecture:** Testimonial data (a JSON list) and letter/screenshot images live in Netlify Blobs. A public read-only function serves them to the homepage, using CDN caching that's purged on every save. A password-checked admin function handles writes. The store (live vs staging) is chosen from the request host, so drafts and localhost can never touch live data. The homepage's static testimonial markup is replaced by a small renderer that builds the exact same markup.

**Tech Stack:** Plain HTML/CSS/JS (no framework, no bundler for the site), Netlify Functions (modern ESM format, `.mjs`), `@netlify/blobs`, `@netlify/functions` (`purgeCache`), Node's built-in `node:test`, Netlify CLI via `npx netlify`.

**Spec:** `docs/superpowers/specs/2026-10-17-testimonials-admin-design.md`. Read it first.

## Global Constraints

- Live store name `testimonials`; staging store name `testimonials-staging`. Live hosts are exactly: `goddessttw.com`, `www.goddessttw.com`, `touch-the-world.netlify.app`.
- Open every store as `getStore({ name, consistency: 'strong' })`.
- API paths: `GET /api/testimonials`, `GET /api/testimonials/img/:id`, `POST /api/admin`.
- Password header: `x-admin-password`. Env var: `ADMIN_PASSWORD`. Missing env var → 503 on every admin call. Wrong password → 1000 ms delay, then 401.
- Ids: `v_` / `l_` / `i_` + 12 lowercase hex characters. Image blob key: `img/<imgId>`.
- Caption / description: trimmed, internal whitespace collapsed, 1–120 characters.
- Images: `image/jpeg`, `image/png`, or `image/webp`, at most 3 MB decoded. Browser shrinks to at most 1600px wide and 3200px tall.
- Never set `"type": "module"` in `package.json` (it breaks the CommonJS `netlify/functions/stripe-webhook.js`). All new server files are `.mjs`.
- Shared server code lives in `netlify/lib/`, never inside `netlify/functions/`.
- Homepage and admin build DOM with `textContent` / `setAttribute`. Never put user text in `innerHTML`.
- User-facing copy (use exactly): `That doesn't look like a YouTube link.` · `Please add a caption.` · `Please add a short description.` · `Please choose a photo or image file.` · `That image is too large — please choose a smaller one.` · `Couldn’t save — please try again.` · `That password didn’t work.` · `Saved — it’s on the homepage now.` · `Testimonials couldn't load right now — please refresh.`
- Netlify CLI: run as `npx netlify …`. Deploy target is always site `41b83477-dd90-429e-a714-65d17653d1ea` (`touch-the-world`) with her token. Use the project `deploy` skill for every deploy.

## Review Focus

1. **A deleted letter keeps being served from the CDN.** Expect: delete/replace removes the blob and purges the `testimonials-img` tag. Pinned in Task 4 (`delete letter removes image blob and purges image cache`).
2. **Real-world pasted links** (`?si=` share tokens, `&t=30s`, `m.youtube.com`, uppercase host, trailing spaces, Shorts) must parse. Expect: the 11-character ID is extracted. Pinned in Task 1 (`accepts real share links`).
3. **Draft deploy or localhost writing to the live list.** Expect: only the three live hosts map to `testimonials`. `abc123--touch-the-world.netlify.app` and `localhost` map to staging. Pinned in Task 2 (`storeNameForHost`) and Task 4 (`draft host writes to staging store`).
4. **Captions containing markup or quotes** (`<b>Ana</b> & “Joe”`). Expect: stored verbatim, shown literally on the homepage and in the admin. Pinned in Task 1 (`keeps markup characters verbatim`) and the Task 8 E2E checklist.
5. **Big phone photo or oversized payload.** Expect: the browser shrinks it. If a raw payload over 3 MB still arrives, the API answers 400 with the friendly message, not 500. Pinned in Task 1 (`rejects images over 3 MB`) and the Task 5 / Task 8 E2E checklists.

---

## File Structure

| File | Responsibility |
|---|---|
| `netlify/lib/youtube.mjs` | `parseYouTubeId(input)`: the one link-parsing rule, used by server and browser |
| `netlify/lib/testimonials-core.mjs` | Pure logic: validation, image decoding, list operations, store-by-host, password check, ids |
| `netlify/functions/testimonials.mjs` | Public GET: list JSON and images, with cache headers |
| `netlify/functions/testimonials-admin.mjs` | Password-checked POST actions; writes the store; purges the cache |
| `tests/helpers/fake-store.mjs` | In-memory stand-in for a Blobs store |
| `tests/*.test.mjs` | Unit tests |
| `admin.html`, `admin.css`, `admin.js` | Admin UI (`admin.js` is an ES module importing `./youtube.mjs`) |
| `testimonials.js` | Homepage renderer |
| `scripts/import-testimonials.mjs` | One-time import of the existing 9 videos and 5 letters through the API |
| `index.html`, `script.js`, `styles.css`, `build-site.sh`, `.gitignore`, `package.json` | Modified as described per task |

---

### Task 0: Branch and tooling

**Files:**
- Create: `package.json`
- Modify: `.gitignore`

- [ ] **Step 1: Branch.** The uncommitted "Michelle's Healing" change in `index.html` must already be committed on `main` (or deliberately carried). Confirm with the user before branching.

```bash
git checkout -b testimonials-admin
```

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "goddess-site",
  "private": true,
  "scripts": {
    "test": "node --test \"tests/**/*.test.mjs\""
  }
}
```

- [ ] **Step 3: Install dependencies** (this writes the current versions into `package.json`)

```bash
npm install @netlify/blobs @netlify/functions
```

Expected: `package.json` gains a `dependencies` block, and `package-lock.json` is created.

- [ ] **Step 4: Gitignore `node_modules/`.** Append to `.gitignore`:

```
# npm (function dependencies; reinstall with `npm install`)
node_modules/
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .gitignore
git commit -m "Add npm tooling for testimonials functions"
```

---

### Task 1: YouTube parser and input validation

**Files:**
- Create: `netlify/lib/youtube.mjs`, `netlify/lib/testimonials-core.mjs`
- Test: `tests/youtube.test.mjs`, `tests/validation.test.mjs`

**Interfaces:**
- Produces: `parseYouTubeId(input: string): string | null` (youtube.mjs).
- Produces (core): `class ValidationError extends Error { field: string }`, `class NotFoundError extends Error`, `NOT_YOUTUBE: string`, `MAX_TEXT = 120`, `MAX_IMAGE_BYTES = 3*1024*1024`, `IMAGE_TYPES: Set<string>`, `cleanText(value, field): string`, `validateVideoInput(input): { youtubeId, caption, spanishYoutubeId: string|null, shape: 'vertical'|'horizontal' }`, `decodeImage(image: {type, data: base64}, field): { bytes: ArrayBuffer, type }`.

- [ ] **Step 1: Write the failing tests.** `tests/youtube.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseYouTubeId } from '../netlify/lib/youtube.mjs';

test('parses the common link forms', () => {
  for (const url of [
    'https://youtu.be/81-TSDf7Hkw',
    'https://www.youtube.com/watch?v=81-TSDf7Hkw',
    'https://youtube.com/shorts/81-TSDf7Hkw',
    'https://www.youtube.com/embed/81-TSDf7Hkw',
    'https://www.youtube-nocookie.com/embed/81-TSDf7Hkw',
  ]) assert.equal(parseYouTubeId(url), '81-TSDf7Hkw', url);
});

test('accepts real share links', () => {
  assert.equal(parseYouTubeId('https://youtu.be/81-TSDf7Hkw?si=AbCdEf123'), '81-TSDf7Hkw');
  assert.equal(parseYouTubeId('https://www.youtube.com/watch?v=81-TSDf7Hkw&t=30s'), '81-TSDf7Hkw');
  assert.equal(parseYouTubeId('https://m.youtube.com/watch?v=81-TSDf7Hkw'), '81-TSDf7Hkw');
  assert.equal(parseYouTubeId('https://WWW.YOUTUBE.COM/watch?v=81-TSDf7Hkw'), '81-TSDf7Hkw');
  assert.equal(parseYouTubeId('  https://youtu.be/81-TSDf7Hkw  '), '81-TSDf7Hkw');
  assert.equal(parseYouTubeId('https://youtube.com/shorts/81-TSDf7Hkw?feature=share'), '81-TSDf7Hkw');
});

test('rejects non-YouTube and malformed input', () => {
  for (const bad of [
    '', '   ', null, undefined, 42, '81-TSDf7Hkw',
    'https://www.instagram.com/p/xyz',
    'https://evil.com/watch?v=81-TSDf7Hkw',
    'https://youtube.com.evil.com/watch?v=81-TSDf7Hkw',
    'javascript:alert(1)',
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/channel/UC123',
  ]) assert.equal(parseYouTubeId(bad), null, String(bad));
});
```

`tests/validation.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ValidationError, cleanText, validateVideoInput, decodeImage, NOT_YOUTUBE,
} from '../netlify/lib/testimonials-core.mjs';

const fieldOf = (fn) => { try { fn(); } catch (e) { assert.ok(e instanceof ValidationError); return e.field; } assert.fail('expected ValidationError'); };

test('cleanText trims and collapses whitespace', () => {
  assert.equal(cleanText('  Hip   Healing \n', 'caption'), 'Hip Healing');
});

test('cleanText requires text and caps length', () => {
  assert.equal(fieldOf(() => cleanText('   ', 'caption')), 'caption');
  assert.throws(() => cleanText('', 'caption'), /Please add a caption\./);
  assert.throws(() => cleanText('', 'alt'), /Please add a short description\./);
  assert.equal(cleanText('x'.repeat(120), 'caption').length, 120);
  assert.equal(fieldOf(() => cleanText('x'.repeat(121), 'caption')), 'caption');
});

test('keeps markup characters verbatim', () => {
  assert.equal(cleanText('<b>Ana</b> & “Joe”', 'caption'), '<b>Ana</b> & “Joe”');
});

test('validateVideoInput returns normalized fields', () => {
  assert.deepEqual(
    validateVideoInput({ youtubeUrl: 'https://youtu.be/81-TSDf7Hkw', caption: ' Janet ', spanishYoutubeUrl: 'https://youtu.be/IlA3SaP2M50', shape: 'horizontal' }),
    { youtubeId: '81-TSDf7Hkw', caption: 'Janet', spanishYoutubeId: 'IlA3SaP2M50', shape: 'horizontal' },
  );
  assert.deepEqual(
    validateVideoInput({ youtubeUrl: 'https://youtu.be/81-TSDf7Hkw', caption: 'Janet', spanishYoutubeUrl: '  ' }),
    { youtubeId: '81-TSDf7Hkw', caption: 'Janet', spanishYoutubeId: null, shape: 'vertical' },
  );
});

test('validateVideoInput names the bad field', () => {
  assert.equal(fieldOf(() => validateVideoInput({ youtubeUrl: 'https://vimeo.com/1', caption: 'x' })), 'youtubeUrl');
  assert.throws(() => validateVideoInput({ youtubeUrl: 'nope', caption: 'x' }), { message: NOT_YOUTUBE });
  assert.equal(fieldOf(() => validateVideoInput({ youtubeUrl: 'https://youtu.be/81-TSDf7Hkw', caption: '' })), 'caption');
  assert.equal(fieldOf(() => validateVideoInput({ youtubeUrl: 'https://youtu.be/81-TSDf7Hkw', caption: 'x', spanishYoutubeUrl: 'https://instagram.com/p/1' })), 'spanishYoutubeUrl');
  assert.equal(fieldOf(() => validateVideoInput({ youtubeUrl: 'https://youtu.be/81-TSDf7Hkw', caption: 'x', shape: 'square' })), 'shape');
  assert.equal(fieldOf(() => validateVideoInput(undefined)), 'youtubeUrl');
});

test('decodeImage accepts allowed types', () => {
  const out = decodeImage({ type: 'image/png', data: Buffer.from('hello').toString('base64') }, 'image');
  assert.equal(out.type, 'image/png');
  assert.ok(out.bytes instanceof ArrayBuffer);
  assert.equal(Buffer.from(out.bytes).toString(), 'hello');
});

test('decodeImage rejects bad input', () => {
  assert.equal(fieldOf(() => decodeImage(undefined, 'image')), 'image');
  assert.throws(() => decodeImage({ type: 'text/html', data: 'aGk=' }, 'image'), /Please choose a photo or image file\./);
  assert.equal(fieldOf(() => decodeImage({ type: 'image/png', data: '' }, 'screenshot')), 'screenshot');
});

test('rejects images over 3 MB', () => {
  const big = Buffer.alloc(3 * 1024 * 1024 + 1).toString('base64');
  assert.throws(() => decodeImage({ type: 'image/jpeg', data: big }, 'image'), /That image is too large — please choose a smaller one\./);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL, `Cannot find module '…/netlify/lib/youtube.mjs'`.

- [ ] **Step 3: Implement `netlify/lib/youtube.mjs`**

```js
// Extracts the 11-character video id from a pasted YouTube link, or returns null.
// Shared by the server functions and the admin page (copied to the site by build-site.sh),
// so it must not import anything.
const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const HOSTS = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com',
  'youtube-nocookie.com', 'www.youtube-nocookie.com', 'youtu.be',
]);

export function parseYouTubeId(input) {
  if (typeof input !== 'string') return null;
  let url;
  try { url = new URL(input.trim()); } catch { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase();
  if (!HOSTS.has(host)) return null;

  let id = null;
  if (host === 'youtu.be') id = url.pathname.split('/')[1];
  else if (url.pathname === '/watch') id = url.searchParams.get('v');
  else {
    const m = url.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/);
    if (m) id = m[1];
  }
  return id && ID_RE.test(id) ? id : null;
}
```

- [ ] **Step 4: Implement the validation half of `netlify/lib/testimonials-core.mjs`**

```js
// Pure testimonial logic shared by the functions. No I/O here.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { parseYouTubeId } from './youtube.mjs';

export const MAX_TEXT = 120;
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
export const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
export const NOT_YOUTUBE = "That doesn't look like a YouTube link.";
const NOT_IMAGE = 'Please choose a photo or image file.';

export class ValidationError extends Error {
  constructor(field, message) { super(message); this.field = field; }
}
export class NotFoundError extends Error {
  constructor() { super('That testimonial no longer exists — refresh the page.'); }
}

export function cleanText(value, field) {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!text) {
    throw new ValidationError(field, field === 'caption' ? 'Please add a caption.' : 'Please add a short description.');
  }
  if (text.length > MAX_TEXT) throw new ValidationError(field, `Please keep this under ${MAX_TEXT} characters.`);
  return text;
}

export function validateVideoInput(input) {
  const v = input || {};
  const youtubeId = parseYouTubeId(v.youtubeUrl);
  if (!youtubeId) throw new ValidationError('youtubeUrl', NOT_YOUTUBE);
  const caption = cleanText(v.caption, 'caption');

  let spanishYoutubeId = null;
  if (typeof v.spanishYoutubeUrl === 'string' && v.spanishYoutubeUrl.trim()) {
    spanishYoutubeId = parseYouTubeId(v.spanishYoutubeUrl);
    if (!spanishYoutubeId) throw new ValidationError('spanishYoutubeUrl', NOT_YOUTUBE);
  }

  const shape = v.shape ?? 'vertical';
  if (shape !== 'vertical' && shape !== 'horizontal') throw new ValidationError('shape', 'Please choose a video shape.');
  return { youtubeId, caption, spanishYoutubeId, shape };
}

export function decodeImage(image, field) {
  if (!image || typeof image.data !== 'string' || !IMAGE_TYPES.has(image.type)) {
    throw new ValidationError(field, NOT_IMAGE);
  }
  const buf = Buffer.from(image.data, 'base64');
  if (buf.length === 0) throw new ValidationError(field, NOT_IMAGE);
  if (buf.length > MAX_IMAGE_BYTES) throw new ValidationError(field, 'That image is too large — please choose a smaller one.');
  return { bytes: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), type: image.type };
}
```

(`createHash`, `randomBytes`, and `timingSafeEqual` are used in Task 2. Leave the import in.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, all tests in both files.

- [ ] **Step 6: Commit**

```bash
git add netlify/lib tests/youtube.test.mjs tests/validation.test.mjs
git commit -m "Add YouTube link parser and testimonial input validation"
```

---

### Task 2: List operations, store-by-host, password check

**Files:**
- Modify: `netlify/lib/testimonials-core.mjs` (append)
- Test: `tests/core.test.mjs`

**Interfaces:**
- Consumes: `ValidationError`, `NotFoundError` from Task 1.
- Produces: `LIVE_STORE = 'testimonials'`, `STAGING_STORE = 'testimonials-staging'`, `storeNameForHost(hostname): string`, `passwordMatches(given, expected): boolean`, `newId(prefix: 'v'|'l'|'i'): string`, `normalizeData(raw): {videos, letters}`, `findItem(data, kind, id)`, `addItem(data, kind, item)`, `updateItem(data, kind, id, changes)`, `removeItem(data, kind, id): { data, removed }`, `moveItem(data, kind, id, direction: 'up'|'down')`. `kind` is `'video' | 'letter'`. All list functions return new objects and never mutate their input.

- [ ] **Step 1: Write the failing tests.** `tests/core.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  storeNameForHost, passwordMatches, newId, normalizeData,
  findItem, addItem, updateItem, removeItem, moveItem,
  ValidationError, NotFoundError,
} from '../netlify/lib/testimonials-core.mjs';

test('storeNameForHost: only the three live hosts use the live store', () => {
  for (const h of ['goddessttw.com', 'www.goddessttw.com', 'touch-the-world.netlify.app', 'GODDESSTTW.COM']) {
    assert.equal(storeNameForHost(h), 'testimonials', h);
  }
  for (const h of ['abc123--touch-the-world.netlify.app', 'localhost', '127.0.0.1', 'goddess-ttw.netlify.app', 'goddessttw.com.evil.com', '', undefined]) {
    assert.equal(storeNameForHost(h), 'testimonials-staging', String(h));
  }
});

test('passwordMatches', () => {
  assert.equal(passwordMatches('s3cret', 's3cret'), true);
  assert.equal(passwordMatches('wrong', 's3cret'), false);
  assert.equal(passwordMatches('', 's3cret'), false);
  assert.equal(passwordMatches(null, 's3cret'), false);
  assert.equal(passwordMatches('anything', ''), false);
  assert.equal(passwordMatches('anything', undefined), false);
});

test('newId format', () => {
  assert.match(newId('v'), /^v_[0-9a-f]{12}$/);
  assert.notEqual(newId('i'), newId('i'));
});

test('normalizeData tolerates missing or junk data', () => {
  assert.deepEqual(normalizeData(null), { videos: [], letters: [] });
  assert.deepEqual(normalizeData({ videos: 'x' }), { videos: [], letters: [] });
});

const base = () => ({ videos: [{ id: 'v_a' }, { id: 'v_b' }, { id: 'v_c' }], letters: [{ id: 'l_a', alt: 'A' }] });
const ids = (d, k = 'videos') => d[k].map((x) => x.id);

test('addItem appends without mutating', () => {
  const d = base();
  const next = addItem(d, 'video', { id: 'v_d' });
  assert.deepEqual(ids(next), ['v_a', 'v_b', 'v_c', 'v_d']);
  assert.deepEqual(ids(d), ['v_a', 'v_b', 'v_c']);
});

test('updateItem merges and keeps id', () => {
  const next = updateItem(base(), 'letter', 'l_a', { alt: 'B', id: 'l_hacked' });
  assert.deepEqual(next.letters, [{ id: 'l_a', alt: 'B' }]);
  assert.throws(() => updateItem(base(), 'letter', 'l_missing', {}), NotFoundError);
});

test('removeItem returns the removed item', () => {
  const { data, removed } = removeItem(base(), 'video', 'v_b');
  assert.deepEqual(ids(data), ['v_a', 'v_c']);
  assert.deepEqual(removed, { id: 'v_b' });
  assert.throws(() => removeItem(base(), 'video', 'nope'), NotFoundError);
});

test('moveItem swaps neighbours and is a no-op at the ends', () => {
  assert.deepEqual(ids(moveItem(base(), 'video', 'v_b', 'up')), ['v_b', 'v_a', 'v_c']);
  assert.deepEqual(ids(moveItem(base(), 'video', 'v_b', 'down')), ['v_a', 'v_c', 'v_b']);
  assert.deepEqual(ids(moveItem(base(), 'video', 'v_a', 'up')), ['v_a', 'v_b', 'v_c']);
  assert.deepEqual(ids(moveItem(base(), 'video', 'v_c', 'down')), ['v_a', 'v_b', 'v_c']);
  assert.throws(() => moveItem(base(), 'video', 'v_a', 'sideways'), ValidationError);
});

test('unknown kind is a ValidationError', () => {
  assert.throws(() => addItem(base(), 'podcast', {}), ValidationError);
  assert.throws(() => findItem(base(), undefined, 'v_a'), ValidationError);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL, `storeNameForHost` (and the others) not exported.

- [ ] **Step 3: Append the implementation to `netlify/lib/testimonials-core.mjs`**

```js
// ---------- Which store: live vs staging ----------
export const LIVE_STORE = 'testimonials';
export const STAGING_STORE = 'testimonials-staging';
const LIVE_HOSTS = new Set(['goddessttw.com', 'www.goddessttw.com', 'touch-the-world.netlify.app']);

// Draft deploys and localhost share env vars and Blobs with the live site,
// so anything that isn't a known live host gets the staging store.
export function storeNameForHost(hostname) {
  return LIVE_HOSTS.has(String(hostname ?? '').toLowerCase()) ? LIVE_STORE : STAGING_STORE;
}

// ---------- Password ----------
const sha256 = (s) => createHash('sha256').update(String(s)).digest();

export function passwordMatches(given, expected) {
  if (!expected || typeof given !== 'string' || !given) return false;
  return timingSafeEqual(sha256(given), sha256(expected));
}

// ---------- Ids and data ----------
export const newId = (prefix) => `${prefix}_${randomBytes(6).toString('hex')}`;

export function normalizeData(raw) {
  return {
    videos: Array.isArray(raw?.videos) ? raw.videos : [],
    letters: Array.isArray(raw?.letters) ? raw.letters : [],
  };
}

function listKey(kind) {
  if (kind === 'video') return 'videos';
  if (kind === 'letter') return 'letters';
  throw new ValidationError('kind', 'Unknown testimonial type.');
}

function indexOf(data, kind, id) {
  const key = listKey(kind);
  const i = data[key].findIndex((x) => x.id === id);
  if (i < 0) throw new NotFoundError();
  return { key, i };
}

export function findItem(data, kind, id) {
  const { key, i } = indexOf(data, kind, id);
  return data[key][i];
}

export function addItem(data, kind, item) {
  const key = listKey(kind);
  return { ...data, [key]: [...data[key], item] };
}

export function updateItem(data, kind, id, changes) {
  const { key, i } = indexOf(data, kind, id);
  const list = [...data[key]];
  list[i] = { ...list[i], ...changes, id };
  return { ...data, [key]: list };
}

export function removeItem(data, kind, id) {
  const { key, i } = indexOf(data, kind, id);
  const list = [...data[key]];
  const [removed] = list.splice(i, 1);
  return { data: { ...data, [key]: list }, removed };
}

export function moveItem(data, kind, id, direction) {
  if (direction !== 'up' && direction !== 'down') throw new ValidationError('direction', 'Unknown direction.');
  const { key, i } = indexOf(data, kind, id);
  const j = direction === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= data[key].length) return data;
  const list = [...data[key]];
  [list[i], list[j]] = [list[j], list[i]];
  return { ...data, [key]: list };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add netlify/lib/testimonials-core.mjs tests/core.test.mjs
git commit -m "Add testimonial list operations, store selection, password check"
```

---

### Task 3: Public read function

**Files:**
- Create: `netlify/functions/testimonials.mjs`, `tests/helpers/fake-store.mjs`
- Test: `tests/public-fn.test.mjs`

**Interfaces:**
- Consumes: `storeNameForHost`, `normalizeData`.
- Produces: `makeHandler({ getStore }) → (req: Request) => Promise<Response>`, plus `fakeStores()` test helper → `{ getStore(opts), stores: Map<name, store>, opts: [] }`, where each store has `get(key, {type})`, `getWithMetadata(key, {type})`, `set(key, value, {metadata})`, `setJSON(key, value)`, `delete(key)`, and `entries: Map`.

- [ ] **Step 1: Write the fake store.** `tests/helpers/fake-store.mjs`:

```js
// In-memory stand-in for @netlify/blobs stores, keyed by store name.
export function fakeStores() {
  const stores = new Map();
  const opts = [];
  const make = () => {
    const entries = new Map();
    return {
      entries,
      async get(key, { type } = {}) {
        if (!entries.has(key)) return null;
        const { value } = entries.get(key);
        return type === 'json' ? JSON.parse(value) : value;
      },
      async getWithMetadata(key) {
        if (!entries.has(key)) return null;
        const { value, metadata } = entries.get(key);
        return { data: value, metadata };
      },
      async set(key, value, { metadata = {} } = {}) { entries.set(key, { value, metadata }); },
      async setJSON(key, value) { entries.set(key, { value: JSON.stringify(value), metadata: {} }); },
      async delete(key) { entries.delete(key); },
    };
  };
  return {
    stores,
    opts,
    getStore(o) {
      opts.push(o);
      if (!stores.has(o.name)) stores.set(o.name, make());
      return stores.get(o.name);
    },
  };
}
```

- [ ] **Step 2: Write the failing tests.** `tests/public-fn.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeHandler } from '../netlify/functions/testimonials.mjs';
import { fakeStores } from './helpers/fake-store.mjs';

const get = (url) => new Request(url);

test('returns an empty list when nothing is stored', async () => {
  const f = fakeStores();
  const res = await makeHandler(f)(get('https://goddessttw.com/api/testimonials'));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { videos: [], letters: [] });
  assert.equal(res.headers.get('Netlify-Cache-Tag'), 'testimonials');
  assert.match(res.headers.get('Netlify-CDN-Cache-Control'), /durable/);
  assert.match(res.headers.get('Cache-Control'), /max-age=0/);
  assert.deepEqual(f.opts[0], { name: 'testimonials', consistency: 'strong' });
});

test('reads the staging store on a draft host', async () => {
  const f = fakeStores();
  await f.getStore({ name: 'testimonials-staging' }).setJSON('data', { videos: [{ id: 'v_1' }], letters: [] });
  const res = await makeHandler(f)(get('https://abc--touch-the-world.netlify.app/api/testimonials'));
  assert.deepEqual((await res.json()).videos, [{ id: 'v_1' }]);
});

test('serves an image with its type and immutable caching', async () => {
  const f = fakeStores();
  const bytes = new TextEncoder().encode('png-bytes').buffer;
  await f.getStore({ name: 'testimonials' }).set('img/i_0123456789ab', bytes, { metadata: { type: 'image/png' } });
  const res = await makeHandler(f)(get('https://goddessttw.com/api/testimonials/img/i_0123456789ab'));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Content-Type'), 'image/png');
  assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(res.headers.get('Netlify-Cache-Tag'), 'testimonials-img');
  assert.match(res.headers.get('Cache-Control'), /immutable/);
  assert.equal(await res.text(), 'png-bytes');
});

test('404 for a missing or malformed image id', async () => {
  const f = fakeStores();
  assert.equal((await makeHandler(f)(get('https://goddessttw.com/api/testimonials/img/i_0123456789ab'))).status, 404);
  assert.equal((await makeHandler(f)(get('https://goddessttw.com/api/testimonials/img/..%2Fdata'))).status, 404);
});

test('rejects non-GET', async () => {
  const res = await makeHandler(fakeStores())(new Request('https://goddessttw.com/api/testimonials', { method: 'POST' }));
  assert.equal(res.status, 405);
});

test('500 with JSON error when the store throws', async () => {
  const broken = { getStore: () => ({ get: async () => { throw new Error('boom'); } }) };
  const res = await makeHandler(broken)(get('https://goddessttw.com/api/testimonials'));
  assert.equal(res.status, 500);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.ok((await res.json()).error);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL, cannot find `netlify/functions/testimonials.mjs`.

- [ ] **Step 4: Implement `netlify/functions/testimonials.mjs`**

```js
// Public, read-only: the testimonial list and its images, for the homepage.
// Cached on Netlify's CDN; the admin function purges the cache on every save.
import { getStore } from '@netlify/blobs';
import { storeNameForHost, normalizeData } from '../lib/testimonials-core.mjs';

const IMG_PATH = /^\/api\/testimonials\/img\/(i_[0-9a-f]{12})$/;

const json = (body, status, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

export function makeHandler(deps) {
  return async (req) => {
    if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    const url = new URL(req.url);
    try {
      const store = deps.getStore({ name: storeNameForHost(url.hostname), consistency: 'strong' });

      const img = url.pathname.match(IMG_PATH);
      if (img) {
        const found = await store.getWithMetadata(`img/${img[1]}`, { type: 'arrayBuffer' });
        if (!found) return json({ error: 'Not found' }, 404);
        return new Response(found.data, {
          headers: {
            'Content-Type': found.metadata?.type || 'application/octet-stream',
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'public, max-age=31536000, immutable',
            'Netlify-CDN-Cache-Control': 'public, durable, max-age=31536000, immutable',
            'Netlify-Cache-Tag': 'testimonials-img',
          },
        });
      }

      if (url.pathname !== '/api/testimonials') return json({ error: 'Not found' }, 404);
      const data = normalizeData(await store.get('data', { type: 'json' }));
      return json(data, 200, {
        'Cache-Control': 'public, max-age=0, must-revalidate',
        'Netlify-CDN-Cache-Control': 'public, durable, s-maxage=31536000',
        'Netlify-Cache-Tag': 'testimonials',
      });
    } catch (err) {
      console.error('testimonials read failed', err);
      return json({ error: 'Could not load testimonials' }, 500, { 'Cache-Control': 'no-store' });
    }
  };
}

export default makeHandler({ getStore });
export const config = { path: ['/api/testimonials', '/api/testimonials/img/:id'] };
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/testimonials.mjs tests/helpers/fake-store.mjs tests/public-fn.test.mjs
git commit -m "Add public testimonials read function"
```

---

### Task 4: Admin write function

**Files:**
- Create: `netlify/functions/testimonials-admin.mjs`
- Test: `tests/admin-fn.test.mjs`

**Interfaces:**
- Consumes: everything in `testimonials-core.mjs`, plus `fakeStores()`.
- Produces: `makeHandler({ getStore, purgeCache, getPassword, sleep }) → (req) => Promise<Response>`. Request body is `{ action, ... }`:
  - `login-check`
  - `add-video { video: { youtubeUrl, caption, spanishYoutubeUrl?, shape?, screenshot?: {type, data} } }`
  - `update-video { id, video: {…same…, screenshot?: undefined (keep) | null (remove) | {type, data} (replace)} }`
  - `add-letter { letter: { alt, image: {type, data} } }`
  - `update-letter { id, letter: { alt, image? } }`
  - `delete { kind, id }`
  - `move { kind, id, direction }`

  Success: `200 { ok: true, data: {videos, letters} }`. Errors: `400 { error, field }`, `401`, `404`, `500`, `503`, each `{ error }`.

- [ ] **Step 1: Write the failing tests.** `tests/admin-fn.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeHandler } from '../netlify/functions/testimonials-admin.mjs';
import { fakeStores } from './helpers/fake-store.mjs';

const PNG = { type: 'image/png', data: Buffer.from('img').toString('base64') };
const VIDEO = { youtubeUrl: 'https://youtu.be/81-TSDf7Hkw', caption: 'Janet' };

function setup({ password = 'pw' } = {}) {
  const f = fakeStores();
  const purges = [];
  const slept = [];
  const handler = makeHandler({
    getStore: f.getStore,
    purgeCache: async (o) => { purges.push(o.tags); },
    getPassword: () => password,
    sleep: async (ms) => { slept.push(ms); },
  });
  const call = async (body, { host = 'goddessttw.com', pw = 'pw' } = {}) => {
    const res = await handler(new Request(`https://${host}/api/admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': pw },
      body: JSON.stringify(body),
    }));
    return { status: res.status, body: await res.json() };
  };
  const live = () => f.getStore({ name: 'testimonials' });
  return { f, purges, slept, call, live };
}

test('503 when ADMIN_PASSWORD is not set', async () => {
  const { call } = setup({ password: '' });
  assert.equal((await call({ action: 'login-check' })).status, 503);
});

test('wrong password waits then 401s', async () => {
  const { call, slept } = setup();
  const r = await call({ action: 'login-check' }, { pw: 'nope' });
  assert.equal(r.status, 401);
  assert.equal(r.body.error, 'That password didn’t work.');
  assert.deepEqual(slept, [1000]);
});

test('login-check returns data without writing or purging', async () => {
  const { call, purges, live } = setup();
  const r = await call({ action: 'login-check' });
  assert.deepEqual(r.body, { ok: true, data: { videos: [], letters: [] } });
  assert.deepEqual(purges, []);
  assert.equal(live().entries.size, 0);
});

test('add-video stores the normalized video and purges the list cache', async () => {
  const { call, purges } = setup();
  const r = await call({ action: 'add-video', video: { ...VIDEO, shape: 'horizontal' } });
  assert.equal(r.status, 200);
  const [v] = r.body.data.videos;
  assert.match(v.id, /^v_[0-9a-f]{12}$/);
  assert.deepEqual({ ...v, id: undefined }, { id: undefined, youtubeId: '81-TSDf7Hkw', caption: 'Janet', spanishYoutubeId: null, shape: 'horizontal', screenshotImgId: null });
  assert.deepEqual(purges, [['testimonials']]);
});

test('invalid link is a 400 naming the field, and nothing is written', async () => {
  const { call, live } = setup();
  const r = await call({ action: 'add-video', video: { ...VIDEO, youtubeUrl: 'https://vimeo.com/1' } });
  assert.equal(r.status, 400);
  assert.equal(r.body.field, 'youtubeUrl');
  assert.equal(live().entries.size, 0);
});

test('add-video with screenshot stores the image blob with its type', async () => {
  const { call, live } = setup();
  const r = await call({ action: 'add-video', video: { ...VIDEO, screenshot: PNG } });
  const imgId = r.body.data.videos[0].screenshotImgId;
  assert.match(imgId, /^i_[0-9a-f]{12}$/);
  assert.equal(live().entries.get(`img/${imgId}`).metadata.type, 'image/png');
});

test('update-video: screenshot omitted keeps it, null removes blob and purges images', async () => {
  const { call, live, purges } = setup();
  const added = await call({ action: 'add-video', video: { ...VIDEO, screenshot: PNG } });
  const { id, screenshotImgId } = added.body.data.videos[0];

  const kept = await call({ action: 'update-video', id, video: { ...VIDEO, caption: 'Janet B' } });
  assert.equal(kept.body.data.videos[0].screenshotImgId, screenshotImgId);
  assert.equal(kept.body.data.videos[0].caption, 'Janet B');

  purges.length = 0;
  const removed = await call({ action: 'update-video', id, video: { ...VIDEO, screenshot: null } });
  assert.equal(removed.body.data.videos[0].screenshotImgId, null);
  assert.equal(live().entries.has(`img/${screenshotImgId}`), false);
  assert.deepEqual(purges, [['testimonials', 'testimonials-img']]);
});

test('add-letter requires an image and a description', async () => {
  const { call } = setup();
  assert.equal((await call({ action: 'add-letter', letter: { alt: 'From Mannie' } })).body.field, 'image');
  assert.equal((await call({ action: 'add-letter', letter: { alt: ' ', image: PNG } })).body.field, 'alt');
  const ok = await call({ action: 'add-letter', letter: { alt: 'From Mannie', image: PNG } });
  assert.equal(ok.body.data.letters[0].alt, 'From Mannie');
  assert.match(ok.body.data.letters[0].imgId, /^i_/);
});

test('update-letter with a new image replaces and deletes the old blob', async () => {
  const { call, live } = setup();
  const added = await call({ action: 'add-letter', letter: { alt: 'A', image: PNG } });
  const { id, imgId: oldImg } = added.body.data.letters[0];
  const r = await call({ action: 'update-letter', id, letter: { alt: 'A', image: PNG } });
  const newImg = r.body.data.letters[0].imgId;
  assert.notEqual(newImg, oldImg);
  assert.equal(live().entries.has(`img/${oldImg}`), false);
  assert.equal(live().entries.has(`img/${newImg}`), true);
});

test('delete letter removes image blob and purges image cache', async () => {
  const { call, live, purges } = setup();
  const added = await call({ action: 'add-letter', letter: { alt: 'A', image: PNG } });
  const { id, imgId } = added.body.data.letters[0];
  purges.length = 0;
  const r = await call({ action: 'delete', kind: 'letter', id });
  assert.deepEqual(r.body.data.letters, []);
  assert.equal(live().entries.has(`img/${imgId}`), false);
  assert.deepEqual(purges, [['testimonials', 'testimonials-img']]);
});

test('move reorders', async () => {
  const { call } = setup();
  await call({ action: 'add-video', video: { ...VIDEO, caption: 'One' } });
  const two = await call({ action: 'add-video', video: { ...VIDEO, caption: 'Two' } });
  const id = two.body.data.videos[1].id;
  const r = await call({ action: 'move', kind: 'video', id, direction: 'up' });
  assert.deepEqual(r.body.data.videos.map((v) => v.caption), ['Two', 'One']);
});

test('unknown id is 404, unknown action is 400, bad JSON is 400', async () => {
  const { call, f } = setup();
  assert.equal((await call({ action: 'delete', kind: 'video', id: 'v_nope' })).status, 404);
  assert.equal((await call({ action: 'explode' })).status, 400);
  const handler = makeHandler({ getStore: f.getStore, purgeCache: async () => {}, getPassword: () => 'pw', sleep: async () => {} });
  const res = await handler(new Request('https://goddessttw.com/api/admin', { method: 'POST', headers: { 'x-admin-password': 'pw' }, body: '{nope' }));
  assert.equal(res.status, 400);
});

test('draft host writes to staging store', async () => {
  const { call, f } = setup();
  await call({ action: 'add-video', video: VIDEO }, { host: 'abc123--touch-the-world.netlify.app' });
  assert.equal(f.stores.get('testimonials-staging').entries.has('data'), true);
  assert.equal(f.stores.has('testimonials'), false);
});

test('a failing purge does not fail the save', async () => {
  const f = fakeStores();
  const handler = makeHandler({ getStore: f.getStore, purgeCache: async () => { throw new Error('no token'); }, getPassword: () => 'pw', sleep: async () => {} });
  const res = await handler(new Request('https://goddessttw.com/api/admin', { method: 'POST', headers: { 'x-admin-password': 'pw' }, body: JSON.stringify({ action: 'add-video', video: VIDEO }) }));
  assert.equal(res.status, 200);
});

test('rejects non-POST', async () => {
  const { f } = setup();
  const handler = makeHandler({ getStore: f.getStore, purgeCache: async () => {}, getPassword: () => 'pw', sleep: async () => {} });
  assert.equal((await handler(new Request('https://goddessttw.com/api/admin'))).status, 405);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL, cannot find `netlify/functions/testimonials-admin.mjs`.

- [ ] **Step 3: Implement `netlify/functions/testimonials-admin.mjs`**

```js
// Password-protected writes for the testimonials admin page.
import { getStore } from '@netlify/blobs';
import { purgeCache } from '@netlify/functions';
import * as core from '../lib/testimonials-core.mjs';

const WRONG_PASSWORD_DELAY_MS = 1000;
const SAVE_ERROR = 'Couldn’t save — please try again.';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

async function loadData(store) {
  return core.normalizeData(await store.get('data', { type: 'json' }));
}

async function saveImage(store, image) {
  const id = core.newId('i');
  await store.set(`img/${id}`, image.bytes, { metadata: { type: image.type } });
  return id;
}

async function commit(store, data) {
  await store.setJSON('data', data);
  return { data, changed: true, purgeImages: false };
}

// Delete replaced/removed images only after the list no longer points at them.
async function dropImages(store, result, imgIds) {
  const gone = imgIds.filter(Boolean);
  for (const id of gone) await store.delete(`img/${id}`);
  return { ...result, purgeImages: gone.length > 0 };
}

export async function runAction(store, body) {
  const data = await loadData(store);
  switch (body?.action) {
    case 'login-check':
      return { data, changed: false };

    case 'add-video': {
      const fields = core.validateVideoInput(body.video);
      const shot = body.video.screenshot ? core.decodeImage(body.video.screenshot, 'screenshot') : null;
      const item = { id: core.newId('v'), ...fields, screenshotImgId: shot ? await saveImage(store, shot) : null };
      return commit(store, core.addItem(data, 'video', item));
    }

    case 'update-video': {
      const existing = core.findItem(data, 'video', body.id);
      const fields = core.validateVideoInput(body.video);
      let screenshotImgId = existing.screenshotImgId ?? null;
      let oldImg = null;
      if (body.video.screenshot === null) {
        oldImg = screenshotImgId;
        screenshotImgId = null;
      } else if (body.video.screenshot) {
        const shot = core.decodeImage(body.video.screenshot, 'screenshot');
        oldImg = screenshotImgId;
        screenshotImgId = await saveImage(store, shot);
      }
      const result = await commit(store, core.updateItem(data, 'video', body.id, { ...fields, screenshotImgId }));
      return dropImages(store, result, [oldImg]);
    }

    case 'add-letter': {
      const alt = core.cleanText(body.letter?.alt, 'alt');
      const image = core.decodeImage(body.letter?.image, 'image');
      const item = { id: core.newId('l'), imgId: await saveImage(store, image), alt };
      return commit(store, core.addItem(data, 'letter', item));
    }

    case 'update-letter': {
      const existing = core.findItem(data, 'letter', body.id);
      const alt = core.cleanText(body.letter?.alt, 'alt');
      let imgId = existing.imgId;
      let oldImg = null;
      if (body.letter?.image) {
        const image = core.decodeImage(body.letter.image, 'image');
        oldImg = imgId;
        imgId = await saveImage(store, image);
      }
      const result = await commit(store, core.updateItem(data, 'letter', body.id, { alt, imgId }));
      return dropImages(store, result, [oldImg]);
    }

    case 'delete': {
      const { data: next, removed } = core.removeItem(data, body.kind, body.id);
      const result = await commit(store, next);
      return dropImages(store, result, [removed.imgId, removed.screenshotImgId]);
    }

    case 'move':
      return commit(store, core.moveItem(data, body.kind, body.id, body.direction));

    default:
      throw new core.ValidationError('action', 'Unknown action.');
  }
}

export function makeHandler(deps) {
  return async (req) => {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const expected = deps.getPassword();
    if (!expected) return json({ error: 'The admin page is not set up yet.' }, 503);
    if (!core.passwordMatches(req.headers.get('x-admin-password'), expected)) {
      await deps.sleep(WRONG_PASSWORD_DELAY_MS);
      return json({ error: 'That password didn’t work.' }, 401);
    }

    let body;
    try { body = await req.json(); } catch { return json({ error: 'Bad request' }, 400); }

    const store = deps.getStore({ name: core.storeNameForHost(new URL(req.url).hostname), consistency: 'strong' });
    try {
      const result = await runAction(store, body);
      if (result.changed) {
        const tags = result.purgeImages ? ['testimonials', 'testimonials-img'] : ['testimonials'];
        try { await deps.purgeCache({ tags }); } catch (err) { console.error('purgeCache failed', err); }
      }
      return json({ ok: true, data: result.data });
    } catch (err) {
      if (err instanceof core.ValidationError) return json({ error: err.message, field: err.field }, 400);
      if (err instanceof core.NotFoundError) return json({ error: err.message }, 404);
      console.error('testimonials admin failed', err);
      return json({ error: SAVE_ERROR }, 500);
    }
  };
}

export default makeHandler({
  getStore,
  purgeCache,
  getPassword: () => process.env.ADMIN_PASSWORD,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});
export const config = { path: '/api/admin' };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS (all files).

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/testimonials-admin.mjs tests/admin-fn.test.mjs
git commit -m "Add password-protected testimonials admin function"
```

---

### Task 5: Admin page

**Files:**
- Create: `admin.html`, `admin.css`, `admin.js`
- Modify: `build-site.sh`, `.env` (local only, gitignored)

**Interfaces:**
- Consumes: `POST /api/admin` contract (Task 4), `GET /api/testimonials/img/:id` (Task 3), `parseYouTubeId` from `./youtube.mjs` (copied by `build-site.sh`).
- Produces: the `/admin` page. Visual reference: `docs/mockups/admin-mockup.html` and `docs/mockups/add-video-mockup.html`.

- [ ] **Step 1: Create `admin.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title>Testimonials Admin</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600;700&family=Montserrat:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="admin.css">
</head>
<body>
  <section class="login" id="loginView" hidden>
    <form class="login__card" id="loginForm">
      <h1>Testimonials Admin</h1>
      <label for="password">Password</label>
      <input id="password" type="password" autocomplete="current-password" required>
      <p class="field-err" id="loginError" role="alert" hidden></p>
      <button class="btn" type="submit" id="loginBtn">Log in</button>
    </form>
  </section>

  <div id="appView" hidden>
    <header class="top">
      <h1>Testimonials Admin</h1>
      <nav>
        <a href="/#testimonials" target="_blank" rel="noopener">View site ↗</a>
        <button type="button" class="link" id="logout">Log out</button>
      </nav>
    </header>
    <div class="toast" id="toast" role="status" hidden></div>

    <main class="layout">
      <section class="lists">
        <div class="tabs" role="tablist">
          <button type="button" class="tab is-on" role="tab" aria-selected="true" data-tab="videos">Videos (<span id="videoCount">0</span>)</button>
          <button type="button" class="tab" role="tab" aria-selected="false" data-tab="letters">Letters (<span id="letterCount">0</span>)</button>
        </div>

        <div data-panel="videos">
          <div class="bar"><h2>Videos</h2><button type="button" class="btn" id="addVideo">+ Add video</button></div>
          <p class="note">Shown on the homepage in this order.</p>
          <ul class="list" id="videoList"></ul>
        </div>

        <div data-panel="letters" hidden>
          <div class="bar"><h2>Letters</h2><button type="button" class="btn" id="addLetter">+ Add letter</button></div>
          <p class="note">Shown in the “Notes of gratitude” deck in this order.</p>
          <ul class="list" id="letterList"></ul>
        </div>
      </section>

      <aside class="panel" id="videoPanel" hidden>
        <form id="videoForm" novalidate>
          <div class="panel__top"><button type="button" class="link" data-close>← Back</button><h2 id="videoFormTitle">Add a video</h2></div>

          <label for="vUrl">YouTube link</label>
          <input id="vUrl" name="youtubeUrl" type="url" inputmode="url" autocomplete="off" placeholder="Paste the link from YouTube">
          <p class="hint">In YouTube, tap Share → Copy link.</p>
          <p class="field-err" data-err="youtubeUrl" hidden></p>

          <fieldset class="seg">
            <legend>Video shape</legend>
            <label><input type="radio" name="shape" value="vertical" checked> ▯ Vertical (phone)</label>
            <label><input type="radio" name="shape" value="horizontal"> ▭ Horizontal</label>
          </fieldset>
          <div class="player" id="vPlayer"></div>
          <p class="hint center">If you see black bars, try the other shape.</p>

          <label for="vCaption">Caption</label>
          <input id="vCaption" name="caption" type="text" maxlength="120" placeholder="e.g. Hip Healing">
          <p class="hint">Shown under the video on the homepage.</p>
          <p class="field-err" data-err="caption" hidden></p>

          <label for="vSpanish">Spanish version <small>(optional)</small></label>
          <input id="vSpanish" name="spanishYoutubeUrl" type="url" inputmode="url" autocomplete="off" placeholder="Paste the Spanish YouTube link">
          <p class="hint">Adds an English / Español switch to this video.</p>
          <p class="field-err" data-err="spanishYoutubeUrl" hidden></p>

          <label for="vShot">“Read the messages” screenshot <small>(optional)</small></label>
          <div class="shot" id="vShotCurrent" hidden>
            <img alt="">
            <span>Screenshot attached</span>
            <button type="button" class="link" id="vShotRemove">✕ Remove</button>
          </div>
          <input id="vShot" type="file" accept="image/*">
          <p class="field-err" data-err="screenshot" hidden></p>

          <div class="form-acts">
            <button type="button" class="btn btn--ghost" data-close>Cancel</button>
            <button type="submit" class="btn" id="vSave" disabled>Save video</button>
          </div>
        </form>
      </aside>

      <aside class="panel" id="letterPanel" hidden>
        <form id="letterForm" novalidate>
          <div class="panel__top"><button type="button" class="link" data-close>← Back</button><h2 id="letterFormTitle">Add a letter</h2></div>

          <label for="lImage">Letter image</label>
          <img class="letter-preview" id="lPreview" alt="" hidden>
          <input id="lImage" type="file" accept="image/*">
          <p class="hint">A photo or screenshot of the letter, email, or message.</p>
          <p class="field-err" data-err="image" hidden></p>

          <label for="lAlt">Short description</label>
          <input id="lAlt" name="alt" type="text" maxlength="120" placeholder="e.g. Letter from Mannie about back pain">
          <p class="hint">Who it’s from and what it’s about. Read aloud by screen readers.</p>
          <p class="field-err" data-err="alt" hidden></p>

          <div class="form-acts">
            <button type="button" class="btn btn--ghost" data-close>Cancel</button>
            <button type="submit" class="btn" id="lSave" disabled>Save letter</button>
          </div>
        </form>
      </aside>
    </main>
  </div>

  <script type="module" src="admin.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `admin.css`**

```css
:root {
  --bg-dark: #0d0d2b; --bg: #141430; --card: #1c1c40;
  --gold: #d4af37; --gold-light: #f0d68a; --purple-light: #a78bca;
  --text: #f5f0e8; --border: rgba(212, 175, 55, 0.18);
  --danger: #e98a8a; --ok: #8fd6a4;
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; background: var(--bg-dark); color: var(--text); font: 15px/1.45 Montserrat, sans-serif; }
h1, h2 { font-family: 'Cormorant Garamond', serif; margin: 0; }
button { font: inherit; cursor: pointer; }
button:disabled { cursor: not-allowed; opacity: .4; }

.btn { background: var(--gold); color: var(--bg-dark); border: 0; border-radius: 10px; padding: 11px 16px; font-weight: 600; }
.btn--ghost { background: transparent; color: var(--text); border: 1px solid var(--border); }
.btn--danger { background: var(--danger); }
.link { background: none; border: 0; color: var(--text); opacity: .8; padding: 4px; }

/* Login */
.login { min-height: 100vh; display: grid; place-items: center; padding: 16px; }
.login__card { width: 100%; max-width: 360px; background: var(--bg); border: 1px solid var(--gold); border-radius: 16px; padding: 28px; display: grid; gap: 10px; }
.login__card h1 { color: var(--gold); font-size: 28px; margin-bottom: 8px; }

/* Header */
.top { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 16px 20px; border-bottom: 1px solid var(--border); }
.top h1 { color: var(--gold); font-size: 26px; }
.top nav { display: flex; gap: 14px; align-items: center; font-size: 13px; }
.top a { color: var(--text); opacity: .8; text-decoration: none; }

.toast { margin: 16px auto 0; max-width: 1180px; padding: 12px 14px; border-radius: 10px; display: flex; gap: 12px; align-items: center; font-size: 14px; width: calc(100% - 32px); }
.toast--ok { background: rgba(143, 214, 164, .12); border: 1px solid var(--ok); color: var(--ok); }
.toast--error { background: rgba(233, 138, 138, .12); border: 1px solid var(--danger); color: var(--danger); }
.toast a { color: var(--gold-light); margin-left: auto; }

/* Layout */
.layout { max-width: 1180px; margin: 0 auto; padding: 20px 16px 60px; display: grid; grid-template-columns: 1fr 400px; gap: 24px; align-items: start; }
@media (max-width: 900px) { .layout { grid-template-columns: 1fr; } }

.tabs { display: flex; gap: 8px; margin-bottom: 16px; }
.tab { padding: 9px 18px; border-radius: 999px; border: 1px solid var(--border); background: transparent; color: var(--text); font-weight: 500; }
.tab.is-on { background: var(--gold); color: var(--bg-dark); border-color: var(--gold); }
.bar { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.bar h2 { font-size: 24px; }
.note { font-size: 12px; opacity: .65; margin: 6px 0 14px; }

/* Rows */
.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.row { display: flex; align-items: center; gap: 12px; background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 10px; }
.row--confirm { border-color: var(--danger); }
.thumb { width: 96px; height: 60px; object-fit: cover; border-radius: 6px; flex: none; background: #000; }
.info { flex: 1; min-width: 0; }
.cap { font-weight: 600; overflow-wrap: anywhere; }
.tags { margin-top: 4px; display: flex; gap: 6px; flex-wrap: wrap; }
.tag { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: rgba(167, 139, 202, .18); color: var(--purple-light); }
.acts { display: flex; gap: 6px; flex: none; }
.ic { width: 36px; height: 36px; border-radius: 8px; border: 1px solid var(--border); background: transparent; color: var(--text); }
.ic--danger { color: var(--danger); }
.confirm { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13px; }
.confirm .btn { padding: 8px 12px; }
.empty { opacity: .6; padding: 16px; text-align: center; border: 1px dashed var(--border); border-radius: 12px; }
@media (max-width: 520px) {
  .row { flex-wrap: wrap; }
  .acts, .confirm { width: 100%; justify-content: flex-end; }
}

/* Form panel */
.panel { background: var(--bg); border: 1px solid var(--gold); border-radius: 14px; padding: 20px; position: sticky; top: 16px; max-height: calc(100vh - 32px); overflow: auto; }
@media (max-width: 900px) {
  .panel { position: fixed; inset: 0; max-height: none; border-radius: 0; border: 0; z-index: 20; }
  body.panel-open { overflow: hidden; }
}
.panel__top { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.panel__top h2 { color: var(--gold); font-size: 24px; }
.panel label, .seg legend { display: block; font-size: 13px; font-weight: 600; margin: 16px 0 6px; }
.panel label small { font-weight: 400; opacity: .7; }
.panel input[type=text], .panel input[type=url], .login input {
  width: 100%; padding: 12px; min-height: 46px; border-radius: 10px;
  border: 1px solid var(--border); background: var(--bg-dark); color: var(--text); font: inherit;
}
.panel input.is-good { border-color: var(--ok); }
.panel input.is-err { border-color: var(--danger); }
.panel input[type=file] { width: 100%; font-size: 13px; }
.hint { font-size: 12px; opacity: .65; margin: 4px 0 0; }
.center { text-align: center; }
.field-err { color: var(--danger); font-size: 12px; margin: 5px 0 0; }

.seg { border: 0; padding: 0; margin: 0; }
.seg { display: flex; flex-wrap: wrap; }
.seg legend { width: 100%; }
.seg label { flex: 1; margin: 0; text-align: center; padding: 10px 4px; border: 1px solid var(--border); font-weight: 500; }
.seg label:first-of-type { border-radius: 10px 0 0 10px; }
.seg label:last-of-type { border-radius: 0 10px 10px 0; }
.seg input { position: absolute; opacity: 0; }
.seg label:has(input:checked) { background: var(--gold); color: var(--bg-dark); border-color: var(--gold); font-weight: 600; }
.seg label:has(input:focus-visible) { outline: 2px solid var(--gold-light); outline-offset: 2px; }

/* Same shapes as the homepage cards */
.player { margin: 10px auto 0; width: 62%; aspect-ratio: 9 / 16; border-radius: 10px; overflow: hidden; background: #000; border: 1px dashed var(--border); display: grid; place-items: center; }
.player--wide { width: 100%; aspect-ratio: 16 / 9; }
.player iframe { width: 100%; height: 100%; border: 0; display: block; }
.player__empty { font-size: 13px; opacity: .55; text-align: center; padding: 16px; margin: 0; }

.shot { display: flex; align-items: center; gap: 10px; background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 8px; font-size: 13px; margin-bottom: 8px; }
.shot img { width: 44px; height: 60px; object-fit: cover; object-position: top; border-radius: 4px; background: #fff; }
.shot .link { margin-left: auto; }
.letter-preview { display: block; width: 100%; max-height: 320px; object-fit: contain; background: #fff; border-radius: 10px; margin-bottom: 8px; }

.form-acts { display: flex; gap: 10px; margin-top: 24px; }
.form-acts .btn { flex: 1; }
```

- [ ] **Step 3: Create `admin.js`**

```js
// Testimonials admin page. Talks to POST /api/admin (see netlify/functions/testimonials-admin.mjs).
import { parseYouTubeId } from './youtube.mjs';

const $ = (sel) => document.querySelector(sel);
const EMBED = 'https://www.youtube-nocookie.com/embed/';
const thumbUrl = (id) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
const imgUrl = (id) => `/api/testimonials/img/${encodeURIComponent(id)}`;
const NOT_YOUTUBE = "That doesn't look like a YouTube link.";
const NOT_IMAGE = 'Please choose a photo or image file.';
const SAVE_ERROR = 'Couldn’t save — please try again.';

let password = '';
let data = { videos: [], letters: [] };

// ---------- helpers ----------
function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text != null) node.textContent = text;
  return node;
}

const session = {
  get() { try { return sessionStorage.getItem('adminPw') || ''; } catch { return ''; } },
  set(v) { try { sessionStorage.setItem('adminPw', v); } catch { /* private mode: stay logged in for this page only */ } },
  clear() { try { sessionStorage.removeItem('adminPw'); } catch { /* ignore */ } },
};

class UserError extends Error {}

function setFieldError(form, field, message) {
  const p = form.querySelector(`[data-err="${field}"]`);
  if (p) { p.textContent = message || ''; p.hidden = !message; }
  const input = form.elements[field];
  if (input && input.classList) input.classList.toggle('is-err', !!message);
}

function clearErrors(form) {
  form.querySelectorAll('[data-err]').forEach((p) => { p.hidden = true; p.textContent = ''; });
  form.querySelectorAll('.is-err, .is-good').forEach((i) => i.classList.remove('is-err', 'is-good'));
}

let toastTimer;
function showToast(message, kind = 'ok', withLink = false) {
  const t = $('#toast');
  t.replaceChildren(el('span', {}, (kind === 'ok' ? '✓ ' : '') + message));
  if (withLink) t.append(el('a', { href: '/#testimonials', target: '_blank', rel: 'noopener' }, 'View ↗'));
  t.className = `toast toast--${kind}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 6000);
}

// ---------- images ----------
const toBase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1]);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

// Shrink to ≤1600 wide / ≤3200 tall. Keep PNG (crisp screenshots) unless it's over 2 MB.
async function shrinkImage(file) {
  if (!file.type.startsWith('image/')) throw new UserError(NOT_IMAGE);
  let bitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new UserError(NOT_IMAGE); }
  const scale = Math.min(1, 1600 / bitmap.width, 3200 / bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  const encode = (type) => new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new UserError(NOT_IMAGE))), type, 0.85));

  let blob = null;
  if (file.type === 'image/png') {
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    blob = await encode('image/png');
  }
  if (!blob || blob.size > 2_000_000) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    blob = await encode('image/jpeg');
  }
  bitmap.close?.();
  if (blob.size > 2_900_000) throw new UserError('That image is too large — please choose a smaller one.');
  return { type: blob.type, data: await toBase64(blob), previewUrl: URL.createObjectURL(blob) };
}

// ---------- API ----------
async function api(action, payload = {}) {
  let res;
  try {
    res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': password },
      body: JSON.stringify({ action, ...payload }),
    });
  } catch {
    throw Object.assign(new Error(SAVE_ERROR), { status: 0 });
  }
  let body = {};
  try { body = await res.json(); } catch { /* non-JSON error page */ }
  if (!res.ok) throw Object.assign(new Error(body.error || SAVE_ERROR), { status: res.status, field: body.field });
  return body.data;
}

// Runs a write; on success re-renders. Returns true/false. Keeps forms intact on failure.
async function run(action, payload, form) {
  try {
    data = await api(action, payload);
    renderLists();
    return true;
  } catch (err) {
    if (err.status === 401) { authLost(); return false; }
    if (err.field && form && form.querySelector(`[data-err="${err.field}"]`)) setFieldError(form, err.field, err.message);
    else showToast(err.message, 'error');
    return false;
  }
}

// ---------- login ----------
function showLogin(message = '') {
  $('#appView').hidden = true;
  $('#loginView').hidden = false;
  $('#loginError').textContent = message;
  $('#loginError').hidden = !message;
  $('#password').value = '';
  $('#password').focus();
}

function showApp() {
  $('#loginView').hidden = true;
  $('#appView').hidden = false;
}

function authLost() {
  password = '';
  session.clear();
  showLogin('Please log in again — your changes are still here.');
}

async function login(pw, { silent = false } = {}) {
  password = pw;
  $('#loginBtn').disabled = true;
  try {
    data = await api('login-check');
    session.set(pw);
    showApp();
    renderLists();
  } catch (err) {
    password = '';
    session.clear();
    if (silent) showLogin();
    else if (err.status === 0) showLogin('Couldn’t reach the server — please try again.');
    else showLogin(err.message);
  } finally {
    $('#loginBtn').disabled = false;
  }
}

// ---------- lists ----------
function renderLists() {
  $('#videoCount').textContent = data.videos.length;
  $('#letterCount').textContent = data.letters.length;
  renderList($('#videoList'), data.videos, 'video');
  renderList($('#letterList'), data.letters, 'letter');
}

function renderList(ul, items, kind) {
  if (!items.length) {
    ul.replaceChildren(el('li', { class: 'empty' }, kind === 'video' ? 'No videos yet.' : 'No letters yet.'));
    return;
  }
  ul.replaceChildren(...items.map((item, i) => row(item, kind, i, items.length)));
}

function row(item, kind, i, count) {
  const label = kind === 'video' ? item.caption : item.alt;
  const li = el('li', { class: 'row' });
  const thumb = el('img', { class: 'thumb', alt: '', loading: 'lazy', src: kind === 'video' ? thumbUrl(item.youtubeId) : imgUrl(item.imgId) });

  const info = el('div', { class: 'info' });
  info.append(el('div', { class: 'cap' }, label));
  if (kind === 'video') {
    const tags = el('div', { class: 'tags' });
    if (item.shape === 'horizontal') tags.append(el('span', { class: 'tag' }, 'Horizontal'));
    if (item.spanishYoutubeId) tags.append(el('span', { class: 'tag' }, 'Español'));
    if (item.screenshotImgId) tags.append(el('span', { class: 'tag' }, '📱 Messages'));
    if (tags.childElementCount) info.append(tags);
  }

  const acts = el('div', { class: 'acts' });
  const button = (text, aria, onClick, cls = 'ic') => {
    const b = el('button', { type: 'button', class: cls, 'aria-label': `${aria}: ${label}` }, text);
    b.addEventListener('click', onClick);
    return b;
  };
  const up = button('↑', 'Move up', () => run('move', { kind, id: item.id, direction: 'up' }));
  const down = button('↓', 'Move down', () => run('move', { kind, id: item.id, direction: 'down' }));
  up.disabled = i === 0;
  down.disabled = i === count - 1;
  acts.append(
    up, down,
    button('✎', 'Edit', () => (kind === 'video' ? openVideoForm(item) : openLetterForm(item))),
    button('🗑', 'Delete', () => confirmDelete(li, acts, kind, item), 'ic ic--danger'),
  );

  li.append(thumb, info, acts);
  return li;
}

function confirmDelete(li, acts, kind, item) {
  li.classList.add('row--confirm');
  const bar = el('div', { class: 'confirm' });
  const yes = el('button', { type: 'button', class: 'btn btn--danger' }, 'Delete');
  const no = el('button', { type: 'button', class: 'btn btn--ghost' }, 'Cancel');
  bar.append(el('span', {}, 'Delete this testimonial?'), yes, no);
  yes.addEventListener('click', async () => {
    yes.disabled = true;
    if (await run('delete', { kind, id: item.id })) showToast('Deleted.');
    else yes.disabled = false;
  });
  no.addEventListener('click', () => { bar.replaceWith(acts); li.classList.remove('row--confirm'); });
  acts.replaceWith(bar);
  no.focus();
}

// ---------- panels ----------
function closePanels() {
  $('#videoPanel').hidden = true;
  $('#letterPanel').hidden = true;
  $('#vPlayer').replaceChildren(); // stops any playing preview
  document.body.classList.remove('panel-open');
}

function openPanel(panel) {
  panel.hidden = false;
  document.body.classList.add('panel-open');
  panel.scrollIntoView({ block: 'nearest' });
  panel.querySelector('input').focus();
}

document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closePanels));

// ---------- video form ----------
const vForm = $('#videoForm');
let editingVideo = null;
let vShot = { mode: 'keep' }; // keep | remove | replace (with .image)

function videoFormValid() {
  const es = vForm.elements.spanishYoutubeUrl.value.trim();
  return !!parseYouTubeId(vForm.elements.youtubeUrl.value)
    && vForm.elements.caption.value.trim() !== ''
    && (!es || !!parseYouTubeId(es));
}

function updatePlayer() {
  const id = parseYouTubeId(vForm.elements.youtubeUrl.value);
  const player = $('#vPlayer');
  player.classList.toggle('player--wide', vForm.elements.shape.value === 'horizontal');
  const frame = player.querySelector('iframe');
  if (!id) {
    if (!player.querySelector('.player__empty')) {
      player.replaceChildren(el('p', { class: 'player__empty' }, 'The video will preview here, exactly as visitors see it'));
    }
  } else if (!frame || frame.dataset.id !== id) {
    const f = el('iframe', {
      src: EMBED + id, title: 'Video preview', allowfullscreen: '',
      allow: 'encrypted-media; picture-in-picture', referrerpolicy: 'strict-origin-when-cross-origin',
    });
    f.dataset.id = id;
    player.replaceChildren(f);
  }
}

function liveCheckVideo() {
  updatePlayer();
  const url = vForm.elements.youtubeUrl.value.trim();
  const es = vForm.elements.spanishYoutubeUrl.value.trim();
  setFieldError(vForm, 'youtubeUrl', url && !parseYouTubeId(url) ? NOT_YOUTUBE : '');
  vForm.elements.youtubeUrl.classList.toggle('is-good', !!parseYouTubeId(url));
  setFieldError(vForm, 'spanishYoutubeUrl', es && !parseYouTubeId(es) ? NOT_YOUTUBE : '');
  if (vForm.elements.caption.value.trim()) setFieldError(vForm, 'caption', '');
  $('#vSave').disabled = !videoFormValid();
}

function showShot(src) {
  $('#vShotCurrent').hidden = false;
  $('#vShotCurrent img').src = src;
  $('#vShot').hidden = true;
}

function hideShot() {
  $('#vShotCurrent').hidden = true;
  $('#vShot').hidden = false;
  $('#vShot').value = '';
}

vForm.addEventListener('input', liveCheckVideo);
vForm.addEventListener('change', liveCheckVideo);
vForm.elements.caption.addEventListener('blur', () => {
  if (!vForm.elements.caption.value.trim()) setFieldError(vForm, 'caption', 'Please add a caption.');
});

$('#vShot').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  setFieldError(vForm, 'screenshot', '');
  try {
    const image = await shrinkImage(file);
    vShot = { mode: 'replace', image };
    showShot(image.previewUrl);
  } catch (err) {
    e.target.value = '';
    setFieldError(vForm, 'screenshot', err instanceof UserError ? err.message : NOT_IMAGE);
  }
});

$('#vShotRemove').addEventListener('click', () => {
  vShot = editingVideo?.screenshotImgId ? { mode: 'remove' } : { mode: 'keep' };
  hideShot();
});

function openVideoForm(item = null) {
  closePanels();
  editingVideo = item;
  vShot = { mode: 'keep' };
  vForm.reset();
  clearErrors(vForm);
  $('#videoFormTitle').textContent = item ? 'Edit video' : 'Add a video';
  if (item) {
    vForm.elements.youtubeUrl.value = `https://youtu.be/${item.youtubeId}`;
    vForm.elements.caption.value = item.caption;
    vForm.elements.spanishYoutubeUrl.value = item.spanishYoutubeId ? `https://youtu.be/${item.spanishYoutubeId}` : '';
    vForm.elements.shape.value = item.shape;
  }
  if (item?.screenshotImgId) showShot(imgUrl(item.screenshotImgId)); else hideShot();
  liveCheckVideo();
  openPanel($('#videoPanel'));
}

vForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!videoFormValid()) {
    liveCheckVideo();
    if (!vForm.elements.caption.value.trim()) setFieldError(vForm, 'caption', 'Please add a caption.');
    return;
  }
  const video = {
    youtubeUrl: vForm.elements.youtubeUrl.value,
    caption: vForm.elements.caption.value,
    spanishYoutubeUrl: vForm.elements.spanishYoutubeUrl.value,
    shape: vForm.elements.shape.value,
  };
  if (vShot.mode === 'replace') video.screenshot = { type: vShot.image.type, data: vShot.image.data };
  if (vShot.mode === 'remove') video.screenshot = null;

  const save = $('#vSave');
  save.disabled = true;
  save.textContent = 'Saving…';
  const ok = editingVideo
    ? await run('update-video', { id: editingVideo.id, video }, vForm)
    : await run('add-video', { video }, vForm);
  save.textContent = 'Save video';
  save.disabled = !videoFormValid();
  if (ok) { closePanels(); showToast('Saved — it’s on the homepage now.', 'ok', true); }
});

// ---------- letter form ----------
const lForm = $('#letterForm');
let editingLetter = null;
let lImage = null;

const letterFormValid = () => lForm.elements.alt.value.trim() !== '' && !!(editingLetter || lImage);

lForm.addEventListener('input', () => {
  if (lForm.elements.alt.value.trim()) setFieldError(lForm, 'alt', '');
  $('#lSave').disabled = !letterFormValid();
});
lForm.elements.alt.addEventListener('blur', () => {
  if (!lForm.elements.alt.value.trim()) setFieldError(lForm, 'alt', 'Please add a short description.');
});

$('#lImage').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  setFieldError(lForm, 'image', '');
  try {
    lImage = await shrinkImage(file);
    $('#lPreview').src = lImage.previewUrl;
    $('#lPreview').hidden = false;
  } catch (err) {
    e.target.value = '';
    setFieldError(lForm, 'image', err instanceof UserError ? err.message : NOT_IMAGE);
  }
  $('#lSave').disabled = !letterFormValid();
});

function openLetterForm(item = null) {
  closePanels();
  editingLetter = item;
  lImage = null;
  lForm.reset();
  clearErrors(lForm);
  $('#letterFormTitle').textContent = item ? 'Edit letter' : 'Add a letter';
  $('#lPreview').hidden = !item;
  if (item) {
    $('#lPreview').src = imgUrl(item.imgId);
    lForm.elements.alt.value = item.alt;
  }
  $('#lSave').disabled = !letterFormValid();
  openPanel($('#letterPanel'));
}

lForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!letterFormValid()) {
    if (!lForm.elements.alt.value.trim()) setFieldError(lForm, 'alt', 'Please add a short description.');
    if (!editingLetter && !lImage) setFieldError(lForm, 'image', NOT_IMAGE);
    return;
  }
  const letter = { alt: lForm.elements.alt.value };
  if (lImage) letter.image = { type: lImage.type, data: lImage.data };

  const save = $('#lSave');
  save.disabled = true;
  save.textContent = 'Saving…';
  const ok = editingLetter
    ? await run('update-letter', { id: editingLetter.id, letter }, lForm)
    : await run('add-letter', { letter }, lForm);
  save.textContent = 'Save letter';
  save.disabled = !letterFormValid();
  if (ok) { closePanels(); showToast('Saved — it’s on the homepage now.', 'ok', true); }
});

// ---------- tabs, header, boot ----------
document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((t) => {
    const on = t === tab;
    t.classList.toggle('is-on', on);
    t.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  document.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== tab.dataset.tab; });
}));

$('#addVideo').addEventListener('click', () => openVideoForm());
$('#addLetter').addEventListener('click', () => openLetterForm());
$('#logout').addEventListener('click', () => { password = ''; session.clear(); closePanels(); showLogin(); });
$('#loginForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const pw = $('#password').value;
  if (pw) login(pw);
});

const saved = session.get();
if (saved) login(saved, { silent: true }); else showLogin();
```

- [ ] **Step 4: Ship the admin files in the build.** In `build-site.sh`, after the `# --- Core pages / code / styles ---` line's `cp`, add:

```bash
# --- Testimonials admin page (data lives in Netlify Blobs; see netlify/functions) ---
cp admin.html admin.css admin.js "$OUT/"
cp netlify/lib/youtube.mjs "$OUT/youtube.mjs"
```

Also change the last line, `echo "Deploy: drag the '$OUT' folder onto https://app.netlify.com/drop"`, to:

```bash
echo "Deploy: use the project 'deploy' skill (Netlify CLI, site touch-the-world)"
```

- [ ] **Step 5: Run it locally.** Add a local test password to the gitignored `.env`:

```bash
grep -q '^ADMIN_PASSWORD=' .env || echo 'ADMIN_PASSWORD=local-test-password' >> .env
bash build-site.sh && npx netlify dev --offline
```

Expected: the server starts on `http://localhost:8888`, and the functions list includes `testimonials`, `testimonials-admin`, and `stripe-webhook`. (If `--offline` breaks Blobs, rerun without `--offline`, with `NETLIFY_AUTH_TOKEN` set from her token in `.env`. localhost still uses the staging store.)

- [ ] **Step 6: Manual check at `http://localhost:8888/admin`** (desktop and a phone-width window, about 390px). Each line must pass:
  - A wrong password shows "That password didn’t work." after about 1 second. The right password shows empty lists.
  - Add video `https://youtu.be/81-TSDf7Hkw?si=abc` with caption `<b>Ana</b> & “Joe”`:
    - the preview is a 9:16 player, and switching to Horizontal makes it 16:9
    - Save is disabled until there's a caption
    - after saving, the toast appears, and the row shows the caption as literal text (no bold)
  - Typing `https://instagram.com/p/1` in Spanish shows "That doesn't look like a YouTube link." and keeps Save disabled.
  - Attach a screenshot, save, then edit and remove it. The 📱 tag disappears.
  - Add a letter with a large phone photo (over 4 MB). It saves, and the row thumbnail loads from `/api/testimonials/img/…`.
  - ↑/↓ reorder works, ↑ is disabled on the first row, and Delete → Cancel restores the buttons. Delete → Delete removes the row.
  - Stop `netlify dev` mid-edit and press Save: "Couldn’t save — please try again." appears and the form stays filled in.
  - On phone width, the form opens full-screen and ← Back closes it.

- [ ] **Step 7: Commit**

```bash
git add admin.html admin.css admin.js build-site.sh
git commit -m "Add testimonials admin page"
```

---

### Task 6: Import script

**Files:**
- Create: `scripts/import-testimonials.mjs`

**Interfaces:**
- Consumes: `GET /api/testimonials`, `POST /api/admin` (`add-video`, `add-letter`).
- Produces: CLI `ADMIN_PASSWORD=… node scripts/import-testimonials.mjs <base-url>`.

- [ ] **Step 1: Create `scripts/import-testimonials.mjs`**

```js
#!/usr/bin/env node
// One-time import of the testimonials that were hard-coded in index.html.
// Usage: ADMIN_PASSWORD=… node scripts/import-testimonials.mjs <base-url>
//   e.g. http://localhost:8888  (staging store)
//        https://<hash>--touch-the-world.netlify.app  (staging store)
//        https://goddessttw.com  (LIVE store)
// Refuses to run if the target already has testimonials, so it can't duplicate.
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

const VIDEOS = [
  { youtubeId: 'QSdwNfF6Klg', caption: 'Hip Healing' },
  { youtubeId: 'InJeLhX9bsc', caption: 'A Baby’s Rash', screenshot: 'testimonials/baby-rash-chat.png' },
  { youtubeId: 'dokFscbLtQI', caption: 'A Neighbor’s Story' },
  { youtubeId: 'kWsm3VR1BkY', caption: 'Multiple Healings with Mari' },
  { youtubeId: 'taas9tyKrhI', caption: 'Maria’s Toe' },
  { youtubeId: '81-TSDf7Hkw', caption: 'Janet', spanish: 'IlA3SaP2M50' },
  { youtubeId: 'UteLo90dJp4', caption: 'Andy', spanish: 'i75OAU3NfSk' },
  { youtubeId: 'Ff7bHdkLALk', caption: 'Max Feels It' },
  { youtubeId: '3_R41WpsVxA', caption: 'Michelle’s Healing' },
];

const LETTERS = [
  { file: 'testimonials/text/82947.jpg', alt: 'Letter from Rebecca Marino confirming a herniated disc healed remotely' },
  { file: 'testimonials/text/brook-letter.png', alt: 'Email from Brook describing relief from chronic elbow pain' },
  { file: 'testimonials/text/cousin.png', alt: "Testimonial from Goddess's cousin describing pain relief after a fall" },
  { file: 'testimonials/text/marcia-wade.png', alt: 'Letter from Marcia Wade recounting how chronic ear pain healed' },
  { file: 'testimonials/text/mannie.png', alt: 'Letter from Mannie sharing gratitude for healing' },
];

const TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

const base = process.argv[2]?.replace(/\/$/, '');
const password = process.env.ADMIN_PASSWORD;
if (!base || !password) {
  console.error('Usage: ADMIN_PASSWORD=… node scripts/import-testimonials.mjs <base-url>');
  process.exit(1);
}

async function image(file) {
  const type = TYPES[extname(file).toLowerCase()];
  if (!type) throw new Error(`Unknown image type: ${file}`);
  return { type, data: (await readFile(file)).toString('base64') };
}

async function admin(body) {
  const res = await fetch(`${base}/api/admin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-password': password },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${body.action} failed (${res.status}): ${json.error || 'no details'}`);
  return json.data;
}

const current = await admin({ action: 'login-check' });
if (current.videos.length || current.letters.length) {
  console.error(`${base} already has ${current.videos.length} videos and ${current.letters.length} letters. Not importing.`);
  process.exit(1);
}

for (const v of VIDEOS) {
  const video = { youtubeUrl: `https://youtu.be/${v.youtubeId}`, caption: v.caption, shape: 'vertical' };
  if (v.spanish) video.spanishYoutubeUrl = `https://youtu.be/${v.spanish}`;
  if (v.screenshot) video.screenshot = await image(v.screenshot);
  await admin({ action: 'add-video', video });
  console.log(`video  ✓ ${v.caption}`);
}
for (const l of LETTERS) {
  await admin({ action: 'add-letter', letter: { alt: l.alt, image: await image(l.file) } });
  console.log(`letter ✓ ${l.file}`);
}

const final = await admin({ action: 'login-check' });
console.log(`Done: ${final.videos.length} videos, ${final.letters.length} letters at ${base}`);
```

- [ ] **Step 2: Run it against local `netlify dev`** (start it as in Task 5 Step 5 and delete any test items in `/admin` first)

```bash
ADMIN_PASSWORD=local-test-password node scripts/import-testimonials.mjs http://localhost:8888
```

Expected: 9 `video ✓` lines and 5 `letter ✓` lines, then `Done: 9 videos, 5 letters at http://localhost:8888`. Running it a second time should exit 1 with "already has 9 videos and 5 letters. Not importing."

- [ ] **Step 3: Check `/admin`.** It lists the 9 videos in homepage order, with Janet and Andy tagged Español, Baby’s Rash tagged 📱 Messages, and all 5 letter thumbnails.

- [ ] **Step 4: Commit**

```bash
git add scripts/import-testimonials.mjs
git commit -m "Add one-time testimonials import script"
```

---

### Task 7: Stage A deploy (admin live, homepage unchanged)

No code. Uses the project `deploy` skill. **Get the client's real admin password from the user before this task.** Never print it in logs or commit it.

- [ ] **Step 1: Run all tests:** `npm test`. Expected: PASS.
- [ ] **Step 2: Set the env var on `touch-the-world`** (her token, site `41b83477-dd90-429e-a714-65d17653d1ea`), following the deploy skill's auth pattern:

```bash
npx netlify env:set ADMIN_PASSWORD '<password from user>' --site 41b83477-dd90-429e-a714-65d17653d1ea
```

If the permission classifier blocks a command that reads her token, give the user the command to run with `!`.

- [ ] **Step 3: Draft deploy:** `npx netlify deploy --build --site 41b83477-dd90-429e-a714-65d17653d1ea` (no `--prod`). Note the draft URL.
- [ ] **Step 4: Import into staging through the draft:** `ADMIN_PASSWORD='<pw>' node scripts/import-testimonials.mjs https://<draft-url>`. Expected: `Done: 9 videos, 5 letters`.
- [ ] **Step 5: On the draft's `/admin`, from a phone**, add a test video, reorder it, delete it. Then confirm `https://goddessttw.com/api/testimonials` still returns 404 (no live function yet), which proves the draft didn't touch live.
- [ ] **Step 6: Production deploy A:** `npx netlify deploy --build --prod --site 41b83477-dd90-429e-a714-65d17653d1ea`. Expected: the deploy output lists the `stripe-webhook`, `testimonials`, and `testimonials-admin` functions.
- [ ] **Step 7: Seed live:** `ADMIN_PASSWORD='<pw>' node scripts/import-testimonials.mjs https://goddessttw.com`. Expected: `Done: 9 videos, 5 letters at https://goddessttw.com`.
- [ ] **Step 8: Verify:**
  - `https://goddessttw.com/admin` lists everything.
  - The homepage looks exactly as before (it doesn't read the store yet).
  - `curl -s -o /dev/null -w "%{http_code}" https://touch-the-world.netlify.app/.netlify/functions/stripe-webhook` returns a non-404 (the webhook is still deployed).

---

### Task 8: Homepage renders from the store

**Files:**
- Create: `testimonials.js`
- Modify: `index.html` (video grid and letters deck in the Testimonials section; add a script tag), `script.js:52-80` (lang toggle) and `script.js:176-191` (chat link and letters deck), `styles.css:991-1023` (grid), `build-site.sh`

**Interfaces:**
- Consumes: `GET /api/testimonials` → `{ videos: [{ id, youtubeId, caption, spanishYoutubeId, shape, screenshotImgId }], letters: [{ id, imgId, alt }] }`, and `/api/testimonials/img/:id`.
- Produces: the same DOM the static page had (`figure.video-card`, `.bilingual-video[data-en][data-es]`, `.lang-toggle`, `.chat-link[data-chat-src]`, `.letter-card` inside `#lettersDeck`), plus `.video-card--wide` and `[data-chat-alt]`.

- [ ] **Step 1: Replace the static markup in `index.html`.** Run this from the repo root (it removes everything inside `<div class="video-grid">` and the five letter `<img>` tags):

```bash
python3 - <<'EOF'
import re
p = 'index.html'
s = open(p).read()
start = s.index('      <div class="video-grid">')
end = s.index('      <!-- Letters sub-section')
s = s[:start] + '''      <p class="testimonials-status" id="testimonialsStatus" role="status">Loading testimonials…</p>
      <div class="video-grid" id="videoGrid"></div>

''' + s[end:]
s = s.replace('<div class="letters-block">', '<div class="letters-block" id="lettersBlock">', 1)
s, n = re.subn(r'\n\s*<img class="letter-card"[^>]*>', '', s)
assert n == 5, n
s = s.replace('  <script src="script.js"></script>', '  <script src="script.js"></script>\n  <script src="testimonials.js"></script>', 1)
open(p, 'w').write(s)
EOF
grep -c 'video-card' index.html; grep -n 'testimonials.js\|videoGrid\|lettersBlock' index.html
```

Expected: `0` video-card matches, plus the three lines found.

- [ ] **Step 2: Create `testimonials.js`**

```js
// Renders the Testimonials section from /api/testimonials (managed at /admin).
// Builds exactly the markup the page used to hard-code; script.js handles clicks.
(function () {
  const grid = document.getElementById('videoGrid');
  const deck = document.getElementById('lettersDeck');
  const status = document.getElementById('testimonialsStatus');
  if (!grid || !deck) return;

  const EMBED = 'https://www.youtube-nocookie.com/embed/';
  const ALLOW = 'accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
  const imgUrl = (id) => `/api/testimonials/img/${encodeURIComponent(id)}`;

  function el(tag, attrs = {}, text) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (text != null) node.textContent = text;
    return node;
  }

  function videoCard(v) {
    const fig = el('figure', { class: v.shape === 'horizontal' ? 'video-card video-card--wide' : 'video-card' });
    const frame = el('iframe', {
      class: v.spanishYoutubeId ? 'video-card__frame bilingual-video' : 'video-card__frame',
      src: EMBED + v.youtubeId, title: v.caption, loading: 'lazy',
      referrerpolicy: 'strict-origin-when-cross-origin', allow: ALLOW, allowfullscreen: '',
    });
    fig.append(frame);

    if (v.spanishYoutubeId) {
      frame.dataset.en = EMBED + v.youtubeId;
      frame.dataset.es = EMBED + v.spanishYoutubeId;
      const toggle = el('div', { class: 'lang-toggle', role: 'group', 'aria-label': 'Choose video language' });
      toggle.append(
        el('span', { class: 'lang-toggle__slider', 'aria-hidden': 'true' }),
        el('button', { type: 'button', class: 'lang-toggle__btn is-active', 'data-lang': 'en', 'aria-pressed': 'true' }, 'English'),
        el('button', { type: 'button', class: 'lang-toggle__btn', 'data-lang': 'es', 'aria-pressed': 'false' }, 'Español'),
      );
      fig.append(toggle);
    }

    fig.append(el('figcaption', {}, v.caption));

    if (v.screenshotImgId) {
      const btn = el('button', {
        type: 'button', class: 'chat-link', 'aria-haspopup': 'dialog',
        'data-chat-src': imgUrl(v.screenshotImgId), 'data-chat-alt': `Messages for “${v.caption}”`,
      });
      btn.append(el('span', { 'aria-hidden': 'true' }, '📱'), document.createTextNode(' Read the messages'));
      fig.append(btn);
    }
    return fig;
  }

  function render({ videos, letters }) {
    grid.replaceChildren(...videos.map(videoCard));
    grid.hidden = videos.length === 0;

    const hint = deck.querySelector('.letters-deck__hint');
    deck.querySelectorAll('.letter-card').forEach((n) => n.remove());
    letters.forEach((l, i) => {
      // The deck fans by --i; cap it so a long list keeps the same look.
      deck.insertBefore(el('img', { class: 'letter-card', style: `--i:${Math.min(i, 4)}`, src: imgUrl(l.imgId), alt: l.alt, loading: 'lazy' }), hint);
    });
    const block = document.getElementById('lettersBlock');
    if (block) block.hidden = letters.length === 0;
  }

  fetch('/api/testimonials')
    .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
    .then((data) => {
      render({ videos: data.videos || [], letters: data.letters || [] });
      status.hidden = true;
    })
    .catch((err) => {
      console.error('Testimonials failed to load', err);
      status.textContent = "Testimonials couldn't load right now — please refresh.";
    });
})();
```

- [ ] **Step 3: Switch `script.js` to event delegation.** Replace the whole lang-toggle block (from `document.querySelectorAll('.lang-toggle').forEach(toggle => {` through its closing `});`, just before `// Contact form handling`) with:

```js
// Cards are rendered after load by testimonials.js, so listen on the document.
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.lang-toggle__btn');
  if (!btn) return;
  const toggle = btn.closest('.lang-toggle');
  const frame = toggle.parentElement.querySelector('.bilingual-video');
  if (!frame) return;

  const nextSrc = frame.dataset[btn.dataset.lang];
  if (!nextSrc) return;
  const currentBase = (frame.getAttribute('src') || '').split('?')[0];
  if (currentBase === nextSrc) return;

  // Update button states (and the sliding highlight via .is-active)
  toggle.querySelectorAll('.lang-toggle__btn').forEach(b => {
    const active = b === btn;
    b.classList.toggle('is-active', active);
    b.setAttribute('aria-pressed', active ? 'true' : 'false');
  });

  frame.setAttribute('src', nextSrc + '?autoplay=1&rel=0');
});
```

Then, inside the lightbox block, replace everything from `// Single-image chat screenshots` through the end of the `if (deck) { … }` block with:

```js
  // Chat screenshots and the letters deck are rendered after load by
  // testimonials.js, so listen on the document instead of on each element.
  const openDeck = (deckEl) => {
    const letters = [...deckEl.querySelectorAll('.letter-card')]
      .map(img => ({ src: img.getAttribute('src'), alt: img.alt }));
    if (letters.length) openLightbox(letters, 0);
  };
  document.addEventListener('click', (e) => {
    const link = e.target.closest('.chat-link');
    if (link) {
      openLightbox([{ src: link.dataset.chatSrc, alt: link.dataset.chatAlt || 'Message screenshot' }]);
      return;
    }
    const deckEl = e.target.closest('#lettersDeck');
    if (deckEl) openDeck(deckEl);
  });
  document.addEventListener('keydown', (e) => {
    const deckEl = e.target.closest && e.target.closest('#lettersDeck');
    if (deckEl && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDeck(deckEl); }
  });
```

- [ ] **Step 4: Update `styles.css`.** Replace the `.video-grid { … }` rule (lines 991–997) with:

```css
.video-grid {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;   /* a short last row sits centered */
  gap: 28px;
  max-width: 960px;
  margin: 40px auto 0;
  container-type: inline-size;
}

/* Same columns the old auto-fit grid gave (260px minimum card, 28px gap). */
.video-grid > .video-card { flex: 0 0 100%; }
@container (min-width: 548px) { .video-grid > .video-card { flex-basis: calc((100% - 28px) / 2); } }
@container (min-width: 836px) { .video-grid > .video-card { flex-basis: calc((100% - 56px) / 3); } }

/* Horizontal (16:9) videos span the full grid width. */
.video-grid > .video-card--wide { flex-basis: 100%; }
.video-card.video-card--wide iframe { aspect-ratio: 16 / 9; }

.testimonials-status { text-align: center; margin: 32px 0 0; }
```

Note: `.video-grid > .video-card--wide` comes after the `@container` rules and has the same specificity, so it wins at every width. The iframe rule uses `.video-card.video-card--wide` because the existing `.video-card iframe { aspect-ratio: 9 / 16 }` (line ~1017) comes *later* in the file and would otherwise win.

- [ ] **Step 5: Update `build-site.sh`.** Add `testimonials.js` to the admin `cp` line (`cp admin.html admin.css admin.js testimonials.js "$OUT/"`). Then delete the now-unused static image copies, i.e. the whole `# --- Testimonial chat screenshot ---` block, the `# --- Letter images …` block, and `mkdir -p "$OUT/testimonials"` (keep the source files in the repo; the import script reads them). Then run `bash build-site.sh` and confirm `site/testimonials/` no longer exists.

- [ ] **Step 6: Local check.** Run `bash build-site.sh && npx netlify dev --offline` (the local staging store still has the Task 6 import). At `http://localhost:8888/#testimonials`:
  - **Compare with the live site side by side:** 9 videos in the same order, Janet and Andy toggles switch language, Baby’s Rash "Read the messages" opens the screenshot, and the letters deck fans on hover and opens a 5-letter carousel with ←/→/Esc.
  - At browser widths of 1200, 700, and 390 px the grid shows 3, 2, and 1 columns.
  - In `/admin`, add a video marked Horizontal and reload the homepage: it spans the full grid width in 16:9. Add one more vertical video: the last row is centered.
  - Change a caption to `<b>Ana</b> & “Joe”` in `/admin` and reload: it shows as literal text.
  - Delete all letters in `/admin` and reload: the letters block is gone, with no empty deck.
  - Stop `netlify dev`, open `site/index.html` from a static server (`python3 -m http.server -d site 8766`), and confirm the section shows "Testimonials couldn't load right now — please refresh."
  - The DevTools console has no errors.
  - Restore local data afterwards if needed (delete items in `/admin`, then rerun the import).

- [ ] **Step 7: Run all tests:** `npm test`. Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add index.html script.js styles.css testimonials.js build-site.sh
git commit -m "Render homepage testimonials from the admin-managed store"
```

---

### Task 9: Stage B deploy (new homepage)

Uses the project `deploy` skill. Same site and token as Task 7.

- [ ] **Step 1: Draft deploy:** `npx netlify deploy --build --site 41b83477-dd90-429e-a714-65d17653d1ea`. On the draft URL (staging data from Task 7), repeat the Task 8 Step 6 comparison on desktop and on a real phone.
- [ ] **Step 2: Production deploy B:** `npx netlify deploy --build --prod --site 41b83477-dd90-429e-a714-65d17653d1ea`.
- [ ] **Step 3: Verify live.**
  - `https://goddessttw.com/#testimonials` matches the pre-launch site (9 videos, toggles, screenshot, 5 letters).
  - In `https://goddessttw.com/admin`, add a test video. Reload the homepage and it appears with no deploy. Delete it, reload, and it's gone.
  - `curl -sI https://goddessttw.com/api/testimonials` shows `netlify-cache-tag` / `cache-status` headers.
- [ ] **Step 4: If anything is wrong:** in the Netlify Deploys tab, publish the Stage A deploy (one click). The old homepage ignores the store, so this is always safe.
- [ ] **Step 5: Hand-off.** Tell the user the admin URL, that the password is the one they chose, and the one-paragraph how-to for the client: YouTube Share → Copy link → paste → caption → shape → Save.
