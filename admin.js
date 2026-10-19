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
let busy = false;        // one write at a time, so quick taps can't race each other
let lastPurged = true;   // false if the homepage cache couldn't be cleared on the last save

const savedMessage = () => (lastPurged
  ? 'Saved — it’s on the homepage now.'
  : 'Saved — the homepage will update within a few minutes.');

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
  return body;
}

// Runs a write; on success re-renders. Returns true/false. Keeps forms intact on failure.
async function run(action, payload, form) {
  if (busy) return false;
  busy = true;
  document.body.classList.add('is-busy');
  try {
    const body = await api(action, payload);
    data = body.data;
    lastPurged = body.purged !== false;
    renderLists();
    return true;
  } catch (err) {
    if (err.status === 401) { authLost(); return false; }
    if (err.field && form && form.querySelector(`[data-err="${err.field}"]`)) setFieldError(form, err.field, err.message);
    else showToast(err.message, 'error');
    return false;
  } finally {
    busy = false;
    document.body.classList.remove('is-busy');
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
    data = (await api('login-check')).data;
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
  if (ok) { closePanels(); showToast(savedMessage(), 'ok', true); }
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
  if (ok) { closePanels(); showToast(savedMessage(), 'ok', true); }
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
