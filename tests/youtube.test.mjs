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

test('accepts links pasted without https://', () => {
  assert.equal(parseYouTubeId('youtu.be/QSdwNfF6Klg'), 'QSdwNfF6Klg');
  assert.equal(parseYouTubeId('youtube.com/watch?v=QSdwNfF6Klg'), 'QSdwNfF6Klg');
  assert.equal(parseYouTubeId(' www.youtube.com/shorts/QSdwNfF6Klg '), 'QSdwNfF6Klg');
  assert.equal(parseYouTubeId('evil.com/watch?v=QSdwNfF6Klg'), null);
});
