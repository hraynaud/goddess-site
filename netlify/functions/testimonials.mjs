// Public, read-only: the testimonial list and its images, for the homepage.
// Cached on Netlify's CDN; the admin function purges the cache on every save.
import { getStore } from '@netlify/blobs';
import { storeNameForHost, normalizeData } from '../lib/testimonials-core.mjs';

const IMG_PATH = /^\/api\/testimonials\/img\/(i_[0-9a-f]{12})$/;

const json = (body, status, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

export function makeHandler(deps) {
  return async (req) => {
    if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    const url = new URL(req.url);
    try {
      const store = deps.getStore({ name: storeNameForHost(url.hostname), consistency: 'strong' });

      const img = url.pathname.match(IMG_PATH);
      if (img) {
        const found = await store.getWithMetadata(`img/${img[1]}`, { type: 'arrayBuffer' });
        if (!found) return json({ error: 'Not found' }, 404);
        return new Response(found.data, {
          headers: {
            'Content-Type': found.metadata?.type || 'application/octet-stream',
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'public, max-age=31536000, immutable',
            'Netlify-CDN-Cache-Control': 'public, durable, max-age=31536000, immutable',
            'Netlify-Cache-Tag': 'testimonials-img',
          },
        });
      }

      if (url.pathname !== '/api/testimonials') return json({ error: 'Not found' }, 404);
      const data = normalizeData(await store.get('data', { type: 'json' }));
      return json(data, 200, {
        'Cache-Control': 'public, max-age=0, must-revalidate',
        // Purged on every save; the short lifetime only matters if a purge fails.
        'Netlify-CDN-Cache-Control': 'public, durable, s-maxage=300, stale-while-revalidate=60',
        'Netlify-Cache-Tag': 'testimonials',
      });
    } catch (err) {
      console.error('testimonials read failed', err);
      return json({ error: 'Could not load testimonials' }, 500, { 'Cache-Control': 'no-store' });
    }
  };
}

export default makeHandler({ getStore });
export const config = { path: ['/api/testimonials', '/api/testimonials/img/:id'] };
