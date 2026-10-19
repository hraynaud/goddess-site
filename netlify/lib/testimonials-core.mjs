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
