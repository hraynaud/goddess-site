// In-memory stand-in for @netlify/blobs stores, keyed by store name.
export function fakeStores() {
  const stores = new Map();
  const opts = [];
  const make = () => {
    const entries = new Map();
    let version = 0;
    const put = (key, value, metadata) => { const etag = `"e${++version}"`; entries.set(key, { value, metadata, etag }); return { modified: true, etag }; };
    return {
      entries,
      async get(key, { type } = {}) {
        if (!entries.has(key)) return null;
        const { value } = entries.get(key);
        return type === 'json' ? JSON.parse(value) : value;
      },
      async getWithMetadata(key, { type } = {}) {
        if (!entries.has(key)) return null;
        const { value, metadata, etag } = entries.get(key);
        return { data: type === 'json' ? JSON.parse(value) : value, metadata, etag };
      },
      async set(key, value, { metadata = {} } = {}) { return put(key, value, metadata); },
      // Honors the Blobs conditional-write options.
      async setJSON(key, value, { onlyIfMatch, onlyIfNew } = {}) {
        const current = entries.get(key);
        if (onlyIfNew && current) return { modified: false };
        if (onlyIfMatch && current?.etag !== onlyIfMatch) return { modified: false };
        return put(key, JSON.stringify(value), {});
      },
      async delete(key) { entries.delete(key); },
    };
  };
  return {
    stores,
    opts,
    getStore(o) {
      opts.push(o);
      if (!stores.has(o.name)) stores.set(o.name, make());
      return stores.get(o.name);
    },
  };
}
