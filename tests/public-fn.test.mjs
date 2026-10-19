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
