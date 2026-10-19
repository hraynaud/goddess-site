// In-memory stand-in for @netlify/blobs stores, keyed by store name.
export function fakeStores() {
  const stores = new Map();
  const opts = [];
  const make = () => {
    const entries = new Map();
    return {
      entries,
      async get(key, { type } = {}) {
        if (!entries.has(key)) return null;
        const { value } = entries.get(key);
        return type === 'json' ? JSON.parse(value) : value;
      },
      async getWithMetadata(key) {
        if (!entries.has(key)) return null;
        const { value, metadata } = entries.get(key);
        return { data: value, metadata };
      },
      async set(key, value, { metadata = {} } = {}) { entries.set(key, { value, metadata }); },
      async setJSON(key, value) { entries.set(key, { value: JSON.stringify(value), metadata: {} }); },
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
