// Extracts the 11-character video id from a pasted YouTube link, or returns null.
// Shared by the server functions and the admin page (copied to the site by build-site.sh),
// so it must not import anything.
const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const HOSTS = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com',
  'youtube-nocookie.com', 'www.youtube-nocookie.com', 'youtu.be',
]);

export function parseYouTubeId(input) {
  if (typeof input !== 'string') return null;
  let url;
  try { url = new URL(input.trim()); } catch { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase();
  if (!HOSTS.has(host)) return null;

  let id = null;
  if (host === 'youtu.be') id = url.pathname.split('/')[1];
  else if (url.pathname === '/watch') id = url.searchParams.get('v');
  else {
    const m = url.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/);
    if (m) id = m[1];
  }
  return id && ID_RE.test(id) ? id : null;
}
