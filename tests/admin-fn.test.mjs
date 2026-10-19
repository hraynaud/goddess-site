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

test('a save that races another save is retried on fresh data, not written over it', async () => {
  const { call, live } = setup();
  await call({ action: 'add-letter', letter: { alt: 'X', image: PNG } });
  const added = await call({ action: 'add-letter', letter: { alt: 'Y', image: PNG } });
  const [x, y] = added.body.data.letters;

  // Another request deletes Y right after this one has read the list.
  const store = live();
  const realGet = store.getWithMetadata.bind(store);
  let raced = false;
  store.getWithMetadata = async (key, opts) => {
    const result = await realGet(key, opts);
    if (key === 'data' && !raced) {
      raced = true;
      await store.setJSON('data', { ...result.data, letters: result.data.letters.filter((l) => l.id !== y.id) });
      await store.delete(`img/${y.imgId}`);
    }
    return result;
  };

  const r = await call({ action: 'move', kind: 'letter', id: x.id, direction: 'down' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.data.letters.map((l) => l.alt), ['X']);
  assert.deepEqual((await store.get('data', { type: 'json' })).letters.map((l) => l.alt), ['X']);
});

test('gives up with 409 if the list keeps changing underneath', async () => {
  const { call, live } = setup();
  await call({ action: 'add-video', video: VIDEO });
  const store = live();
  const realGet = store.getWithMetadata.bind(store);
  store.getWithMetadata = async (key, opts) => {
    const result = await realGet(key, opts);
    if (key === 'data') await store.setJSON('data', result.data); // bumps the etag every time
    return result;
  };
  const r = await call({ action: 'add-video', video: VIDEO });
  assert.equal(r.status, 409);
});

test('purge is retried once; a second failure is reported as purged:false', async () => {
  const f = fakeStores();
  let calls = 0;
  const make = (failures) => makeHandler({ getStore: f.getStore, purgeCache: async () => { calls++; if (calls <= failures) throw new Error('5xx'); }, getPassword: () => 'pw', sleep: async () => {} });
  const req = () => new Request('https://goddessttw.com/api/admin', { method: 'POST', headers: { 'x-admin-password': 'pw' }, body: JSON.stringify({ action: 'add-video', video: VIDEO }) });

  let res = await (await make(1)(req())).json();
  assert.equal(res.purged, true);
  assert.equal(calls, 2);

  calls = 0;
  res = await (await make(2)(req())).json();
  assert.equal(res.ok, true);
  assert.equal(res.purged, false);
});

test('saves still work when the store gives no etag (local Blobs emulator)', async () => {
  const { call, live } = setup();
  await call({ action: 'add-video', video: VIDEO });
  const store = live();
  const realGet = store.getWithMetadata.bind(store);
  store.getWithMetadata = async (key, opts) => { const r = await realGet(key, opts); return r && { ...r, etag: undefined }; };
  const r = await call({ action: 'add-video', video: { ...VIDEO, caption: 'Two' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.videos.length, 2);
});
