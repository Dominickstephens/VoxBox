// ── IndexedDB ────────────────────────────────────────────────────
const DB_NAME    = 'voxbox';
const DB_VERSION = 3;
const STORE_SESSIONS = 'sessions';   // transcript history
const STORE_PREFS    = 'prefs';      // api key + lightweight prefs
const STORE_AUDIO    = 'audio';      // raw audio blobs keyed by filename
const STORE_VOCAB    = 'vocab';      // context-bias vocabulary

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
// We store {blob, mimeType} so we can reconstruct a correctly-typed
// Blob on load — browsers (esp. on GitHub Pages) reject blob: URLs
// whose MIME type was lost during IDB round-trip.
async function dbSaveAudio(filename, file) {
  try {
    const mimeType = file.type || _guessMime(filename);
    await dbPut(STORE_AUDIO, { blob: file, mimeType }, filename);
  } catch (e) { console.warn('Audio save failed:', e); }
}

async function dbLoadAudio(filename) {
  try {
    const rec = await dbGet(STORE_AUDIO, filename);
    if (!rec) return null;
    // Reconstruct with explicit MIME type so the browser accepts it
    const mime = rec.mimeType || _guessMime(filename);
    return new Blob([rec.blob], { type: mime });
  } catch (_) { return null; }
}

async function dbDeleteAudio(filename) {
  try { await dbDelete(STORE_AUDIO, filename); } catch (_) {}
}

async function dbClearAudio() {
  try { await dbClearStore(STORE_AUDIO); } catch (_) {}
}

function _guessMime(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  return ({ mp3:'audio/mpeg', wav:'audio/wav', m4a:'audio/mp4', aac:'audio/aac',
            flac:'audio/flac', ogg:'audio/ogg', mp4:'video/mp4', mov:'video/quicktime' })[ext] || 'audio/mpeg';
}

// ── Vocabulary / context-bias helpers ────────────────────────────
async function vocabGetTerms() {
  try { return (await dbGet(STORE_VOCAB, 'terms')) || []; } catch (_) { return []; }
}

async function vocabAddTerms(newTerms) {
  try {
    const existing = await vocabGetTerms();
    const existingLower = new Set(existing.map(t => t.toLowerCase()));
    const seen = new Set(existingLower);
    const toAdd = newTerms
      .map(t => t.replace(/[.,!?;:'"()\[\]{}]/g, '').trim())
      .filter(t => {
        if (t.length <= 1 || seen.has(t.toLowerCase())) return false;
        seen.add(t.toLowerCase());
        return true;
      });
    if (!toAdd.length) return;
    const trimmed = [...existing, ...toAdd].slice(-MAX_VOCAB);
    await dbPut(STORE_VOCAB, trimmed, 'terms');
  } catch (e) { console.warn('Vocab save failed:', e); }
}

async function vocabRemoveTerm(term) {
  try {
    const existing = await vocabGetTerms();
    const updated  = existing.filter(t => t.toLowerCase() !== term.toLowerCase());
    await dbPut(STORE_VOCAB, updated, 'terms');
  } catch (e) { console.warn('Vocab remove failed:', e); }
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