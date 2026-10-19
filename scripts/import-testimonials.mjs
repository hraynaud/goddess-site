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
