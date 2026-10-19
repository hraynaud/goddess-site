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
