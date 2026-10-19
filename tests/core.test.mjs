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
