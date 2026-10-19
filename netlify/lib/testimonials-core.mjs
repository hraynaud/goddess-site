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
