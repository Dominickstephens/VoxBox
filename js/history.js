// ── History & Persistence ─────────────────────────────────────────
// IndexedDB-backed session history: save, load, delete, autosave edits.

// ── Debounced DB write ────────────────────────────────────────────
let _saveTimer = null;
function saveToDB() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(_flushSaveToDB, 400);
}
async function _flushSaveToDB() {
  if (!wordsData.length) return;
  try {
    const edits    = wordsData.filter(w => w.edited).map(w => ({ segIdx: w.segIdx, wordIdx: w.wordIdx, word: w.word }));
    const filename = document.getElementById('topbar-filename').innerText.trim();
    await updateHistoryEdits(filename, edits, speakerNames);
  } catch (e) {
    console.warn('DB save failed:', e);
  }
}

// ── Autosave restore ──────────────────────────────────────────────
async function applyAutosave(filename) {
  try {
    const hist  = await getHistory();
    const entry = hist.find(h => h.filename === filename);
    if (!entry) return;
    let applied = 0;
    (entry.edits || []).forEach(e => {
      const word = segments[e.segIdx]?.words[e.wordIdx];
      if (word) { word.word = e.word; word.edited = true; applied++; }
    });
    if (entry.speakerNames) speakerNames = { ...speakerNames, ...entry.speakerNames };
    if (applied) {
      renderTranscript(); updateEditCount();
      showUndoToast(`Restored ${applied} saved edit${applied > 1 ? 's' : ''}`);
    }
  } catch (_) {}
}

// ── History CRUD ──────────────────────────────────────────────────
async function getHistory() {
  try {
    const all = await dbGetAll(STORE_SESSIONS);
    return all.sort((a, b) => new Date(b.date) - new Date(a.date));
  } catch (_) { return []; }
}

async function saveToHistory(filename, language, speakerCount) {
  try {
    const hist = await getHistory();
    const old  = hist.find(h => h.filename === filename);
    if (old) await dbDelete(STORE_SESSIONS, old.id);

    const overflow = hist.filter(h => h.filename !== filename).slice(MAX_HISTORY - 1);
    for (const o of overflow) await dbDelete(STORE_SESSIONS, o.id);

    const entry = {
      id: Date.now().toString(),
      filename,
      date: new Date().toISOString(),
      language,
      speakerCount,
      duration:  audio.duration || 0,
      wordCount: wordsData.length,
      speakerNames: { ...speakerNames },
      edits: [],
      segments: segments.map(seg => ({
        speaker:      seg.speaker,
        speakerClass: seg.speakerClass,
        start:        seg.start,
        words: seg.words.map(w => ({
          word: w.word, originalWord: w.originalWord,
          start: w.start, end: w.end, edited: w.edited,
        })),
      })),
    };
    await dbPut(STORE_SESSIONS, entry);
    // Harvest any already-edited words into the context-bias vocab
    _harvestEditsToVocab();
  } catch (e) {
    console.warn('History save failed:', e.message);
  }
}

async function updateHistoryEdits(filename, edits, names) {
  try {
    const hist  = await getHistory();
    const entry = hist.find(h => h.filename === filename);
    if (!entry) return;
    entry.edits        = edits;
    entry.speakerNames = { ...names };
    entry.speakerCount = new Set(segments.map(s => s.speakerClass)).size;
    entry.segments     = segments.map(seg => ({
      speaker:      seg.speaker,
      speakerClass: seg.speakerClass,
      start:        seg.start,
      words: seg.words.map(w => ({
        word: w.word, originalWord: w.originalWord,
        start: w.start, end: w.end, edited: w.edited,
      })),
    }));
    await dbPut(STORE_SESSIONS, entry);
    _harvestEditsToVocab();
  } catch (e) {
    console.warn('updateHistoryEdits failed:', e);
  }
}

// ── Vocab harvesting ──────────────────────────────────────────────
// Collects all currently-edited words (the corrected versions) and
// pushes them into the persistent context-bias vocabulary store.
function _harvestEditsToVocab() {
  const editedWords = wordsData
    .filter(w => w.edited && w.word && w.word !== w.originalWord)
    .map(w => w.word);
  if (editedWords.length) vocabAddTerms(editedWords);
}

async function deleteHistoryEntry(id) {
  try { await dbDelete(STORE_SESSIONS, id); renderHistory(); } catch (_) {}
}

async function clearAllHistory() {
  try { await dbClearStore(STORE_SESSIONS); renderHistory(); } catch (_) {}
}

// ── Load from history ─────────────────────────────────────────────
function loadFromHistory(entry) {
  segments  = [];
  wordsData = [];
  speakerNames = entry.speakerNames || {};

  entry.segments.forEach((seg, si) => {
    const words = seg.words.map((w, wi) => ({
      word: w.word, originalWord: w.originalWord,
      start: w.start, end: w.end,
      edited: w.edited || false, segIdx: si, wordIdx: wi,
    }));
    segments.push({ speaker: seg.speaker, speakerClass: seg.speakerClass, start: seg.start, words });
    wordsData.push(...words);
  });

  document.getElementById('stat-words').textContent    = wordsData.length.toLocaleString();
  document.getElementById('stat-segments').textContent = segments.length;
  document.getElementById('stat-speakers').textContent = entry.speakerCount || '—';
  document.getElementById('stat-language').textContent = entry.language || 'auto';
  document.getElementById('stat-duration').textContent = formatTime(entry.duration);
  document.getElementById('total-time').textContent    = formatTime(entry.duration);
  document.getElementById('topbar-filename').innerHTML = `<span>${escHtml(entry.filename)}</span>`;

  audio.src = '';
  document.getElementById('waveform-wrap').style.display  = 'none';
  document.getElementById('current-time').textContent     = '0:00';
  document.getElementById('progress-fill').style.width    = '0%';
  document.getElementById('progress-thumb').style.left    = '0%';
  showNoAudioBar(entry.filename);

  undoStack = []; redoStack = []; updateUndoButtons();
  renderTranscript(); updateEditCount();
  showScreen('transcript');
  document.getElementById('export-btn').style.display = '';
  startSync();
  showUndoToast('Loaded from history');
}

// ── History list rendering ────────────────────────────────────────
async function renderHistory() {
  const hist    = await getHistory();
  const section = document.getElementById('recent-section');
  const list    = document.getElementById('recent-list');

  if (!hist.length) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  list.innerHTML = '';

  hist.forEach(entry => {
    const item    = document.createElement('div'); item.className = 'recent-item';
    const date    = new Date(entry.date);
    const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    const timeStr = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    const dur     = formatTime(entry.duration);
    const spk     = entry.speakerCount > 1 ? `${entry.speakerCount} speakers` : '1 speaker';
    const wc      = entry.wordCount ? `${entry.wordCount.toLocaleString()} words` : '';
    const editCount = (entry.edits || []).length;
    const editStr   = editCount ? ` · ${editCount} edit${editCount > 1 ? 's' : ''}` : '';

    item.innerHTML = `
      <div class="recent-item-icon">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 4h12M2 8h8M2 12h10"/></svg>
      </div>
      <div class="recent-item-info">
        <div class="recent-item-name" title="${escHtml(entry.filename)}">${escHtml(entry.filename)}</div>
        <div class="recent-item-meta">${dateStr} ${timeStr} · ${dur} · ${spk}${wc ? ' · ' + wc : ''}${editStr}</div>
      </div>
      <button class="recent-item-delete" title="Remove from history" onclick="event.stopPropagation(); deleteHistoryEntry('${entry.id}')">
        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 4h10M6 4V3h4v1M5 4v8a1 1 0 001 1h4a1 1 0 001-1V4"/></svg>
      </button>
    `;
    item.onclick = () => loadFromHistory(entry);
    list.appendChild(item);
  });
}