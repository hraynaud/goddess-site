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
