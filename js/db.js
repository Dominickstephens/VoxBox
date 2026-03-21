// ── IndexedDB ────────────────────────────────────────────────────
const DB_NAME    = 'voxbox';
const DB_VERSION = 3;
const STORE_SESSIONS = 'sessions';   // transcript history
const STORE_PREFS    = 'prefs';      // api key + lightweight prefs
const STORE_AUDIO    = 'audio';      // raw audio blobs keyed by filename
const STORE_VOCAB    = 'vocab';      // context-bias vocabulary (single record, key='terms')

const MAX_VOCAB = 100; // Mistral context_bias limit

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
        db.createObjectStore(STORE_SESSIONS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_PREFS)) {
        db.createObjectStore(STORE_PREFS);
      }
      if (!db.objectStoreNames.contains(STORE_AUDIO)) {
        db.createObjectStore(STORE_AUDIO);
      }
      if (!db.objectStoreNames.contains(STORE_VOCAB)) {
        db.createObjectStore(STORE_VOCAB);
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

// ── Audio blob helpers ────────────────────────────────────────────
async function dbSaveAudio(filename, blob) {
  try { await dbPut(STORE_AUDIO, blob, filename); } catch (e) { console.warn('Audio save failed:', e); }
}

async function dbLoadAudio(filename) {
  try { return await dbGet(STORE_AUDIO, filename); } catch (_) { return null; }
}

async function dbDeleteAudio(filename) {
  try { await dbDelete(STORE_AUDIO, filename); } catch (_) {}
}

async function dbClearAudio() {
  try { await dbClearStore(STORE_AUDIO); } catch (_) {}
}

// ── Vocabulary / context-bias helpers ────────────────────────────
// Terms are stored as an ordered array, most-recently-added last.
// On overflow the oldest entries are dropped so the list stays ≤ MAX_VOCAB.

async function vocabGetTerms() {
  try { return (await dbGet(STORE_VOCAB, 'terms')) || []; } catch (_) { return []; }
}

async function vocabAddTerms(newTerms) {
  try {
    // Normalise: trim, lowercase for dedup comparison, but store original casing
    const existing = await vocabGetTerms();
    const existingLower = new Set(existing.map(t => t.toLowerCase()));
    const toAdd = newTerms
      .map(t => t.replace(/[.,!?;:'"()\[\]{}]/g, '').trim())
      .filter(t => t.length > 1 && !existingLower.has(t.toLowerCase()));
    if (!toAdd.length) return;
    const merged = [...existing, ...toAdd];
    // Keep only the most recent MAX_VOCAB entries
    const trimmed = merged.slice(-MAX_VOCAB);
    await dbPut(STORE_VOCAB, trimmed, 'terms');
  } catch (e) { console.warn('Vocab save failed:', e); }
}

async function vocabGetBiasString() {
  const terms = await vocabGetTerms();
  return terms.join(',');
}

async function vocabClear() {
  try { await dbDelete(STORE_VOCAB, 'terms'); } catch (_) {}
}

async function dbGet(store, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).get(key);
    req.onsuccess = e => resolve(e.target.result ?? null);
    req.onerror   = e => reject(e.target.error);
  });
}

async function dbPut(store, value, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readwrite');
    const req = key !== undefined
      ? tx.objectStore(store).put(value, key)
      : tx.objectStore(store).put(value);
    tx.oncomplete = resolve;
    tx.onerror    = e => reject(e.target.error);
  });
}

async function dbDelete(store, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = resolve;
    tx.onerror    = e => reject(e.target.error);
  });
}

async function dbGetAll(store) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAll();
    req.onsuccess = e => resolve(e.target.result ?? []);
    req.onerror   = e => reject(e.target.error);
  });
}

async function dbClearStore(store) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).clear();
    tx.oncomplete = resolve;
    tx.onerror    = e => reject(e.target.error);
  });
}