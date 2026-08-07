// Minimal IndexedDB wrapper — the entire persistence layer for this app.
// Everything lives in the browser; there is no server and no network call
// anywhere in this module.

const DB_NAME = 'invoicer-db';
const DB_VERSION = 1;

const STORES = {
  clients: 'id',
  invoices: 'id',
  settings: 'key',
};

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('clients')) {
        const s = db.createObjectStore('clients', { keyPath: 'id' });
        s.createIndex('name', 'name', { unique: false });
      }
      if (!db.objectStoreNames.contains('invoices')) {
        const s = db.createObjectStore('invoices', { keyPath: 'id' });
        s.createIndex('clientId', 'clientId', { unique: false });
        s.createIndex('status', 'status', { unique: false });
        s.createIndex('number', 'number', { unique: false });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode) {
  return openDB().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const db = {
  async getAll(storeName) {
    const store = await tx(storeName, 'readonly');
    return wrap(store.getAll());
  },
  async get(storeName, key) {
    const store = await tx(storeName, 'readonly');
    return wrap(store.get(key));
  },
  async put(storeName, value) {
    const store = await tx(storeName, 'readwrite');
    return wrap(store.put(value));
  },
  async delete(storeName, key) {
    const store = await tx(storeName, 'readwrite');
    return wrap(store.delete(key));
  },
  async clear(storeName) {
    const store = await tx(storeName, 'readwrite');
    return wrap(store.clear());
  },
  STORES,
};
