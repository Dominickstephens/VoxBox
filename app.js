// ── State ────────────────────────────────────────────────────────
let wordsData    = [];   // [{word,start,end,segIdx,wordIdx,edited,originalWord}]
let segments     = [];   // [{speaker,speakerClass,start,words}]
let speakerNames = {};   // {speakerClass -> label}
let autoScroll   = true;
let rafId        = null;
let activeWordEl = null;
let undoStack    = [];
let redoStack    = [];
let findMatches  = [];
let findIndex    = 0;
const LS_KEY      = 'voxbox_autosave';
const LS_HIST_KEY = 'voxbox_history';
const MAX_HISTORY = 12;
const LS_API_KEY = 'voxbox_apikey';
const audio      = document.getElementById('audio-player');

// ── File handling ────────────────────────────────────────────────
const dropZone = document.getElementById('drop-zone');
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault(); dropZone.classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (f && (f.type.startsWith('audio/') || f.type.startsWith('video/') || f.name.match(/\.(mp3|wav|m4a|aac|flac|ogg|mp4|mov)$/i))) handleFileSelect(f);
  else showError('Please drop an audio file (MP3, WAV, M4A, etc.)');
});

function handleFileSelect(file) {
  if (!file) return;
  const key = document.getElementById('api-key-input').value.trim();
  if (!key) { showError('Please enter your Mistral API key in the sidebar first.'); return; }
  if (key === 'demo') { loadDemoData(file); return; }
  startTranscription(file, key);
}

// ── API ──────────────────────────────────────────────────────────
async function apiCall(file, apiKey, params) {
  const fd = new FormData();
  fd.append('file', file, file.name);
  fd.append('model', 'voxtral-mini-latest');
  for (const [k, v] of Object.entries(params)) fd.append(k, v);
  const res = await fetch('https://api.mistral.ai/v1/audio/transcriptions', {
    method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}` }, body: fd
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); msg = (typeof j.message === 'string') ? j.message : (j.error?.message || JSON.stringify(j, null, 2)); } catch(_) {}
    throw new Error(msg);
  }
  return res.json();
}

async function startTranscription(file, apiKey) {
  showScreen('processing');
  document.getElementById('processing-filename').textContent = file.name;
  document.getElementById('processing-label').textContent = 'Transcribing audio… (1/2)';
  audio.src = URL.createObjectURL(file);
  audio.load();
  file.arrayBuffer().then(buf => new (window.AudioContext || window.webkitAudioContext)().decodeAudioData(buf)).then(drawWaveform).catch(() => {});
  try {
    const wordData = await apiCall(file, apiKey, { timestamp_granularities: 'word' });
    document.getElementById('processing-label').textContent = 'Identifying speakers… (2/2)';
    let diarData = null;
    try { diarData = await apiCall(file, apiKey, { timestamp_granularities: 'segment', diarize: 'true' }); }
    catch(e) { console.warn('Diarization failed:', e.message); }
    processTranscription(wordData, diarData, file.name);
  } catch(err) { showScreen('upload');
renderHistory(); showError('Transcription failed: ' + err.message); }
}

// ── Process ──────────────────────────────────────────────────────
function processTranscription(wordData, diarData, filename) {
  segments = []; wordsData = []; speakerNames = {};
  const diarSegs = diarData?.segments || [];

  function speakerAt(t) {
    let lo = 0, hi = diarSegs.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1, s = diarSegs[mid];
      if (t < s.start) hi = mid - 1; else if (t > s.end) lo = mid + 1; else return String(s.speaker_id ?? s.speaker ?? 0);
    }
    return hi >= 0 ? String(diarSegs[hi].speaker_id ?? diarSegs[hi].speaker ?? 0) : '0';
  }

  const speakerColors = {}; let speakerCount = 0;
  (wordData.segments || []).forEach((seg, si) => {
    let words;
    const hasWordTs = Array.isArray(seg.words) && seg.words.length > 0 && seg.words[0].start !== undefined;
    if (hasWordTs) {
      words = seg.words.map((w, wi) => ({ word: w.word, start: w.start, end: w.end, segIdx: si, wordIdx: wi, edited: false, originalWord: w.word }));
    } else {
      const raw = (seg.text || '').trim().split(/\s+/).filter(Boolean);
      const s0 = seg.start || 0, s1 = seg.end || s0 + 1, dur = raw.length ? (s1 - s0) / raw.length : 1;
      words = raw.map((w, wi) => ({ word: w, start: parseFloat((s0 + wi * dur).toFixed(3)), end: parseFloat((s0 + (wi+1) * dur).toFixed(3)), segIdx: si, wordIdx: wi, edited: false, originalWord: w }));
    }
    const midT = words.length ? (words[0].start + words[words.length-1].end) / 2 : (seg.start || 0);
    const spk  = diarSegs.length ? speakerAt(midT) : (seg.speaker !== undefined ? String(seg.speaker) : '0');
    if (!(spk in speakerColors)) speakerColors[spk] = speakerCount++;
    segments.push({ speaker: spk, speakerClass: speakerColors[spk], start: seg.start || 0, words });
    wordsData.push(...words);
  });

  document.getElementById('stat-words').textContent    = wordsData.length.toLocaleString();
  document.getElementById('stat-segments').textContent = segments.length;
  document.getElementById('stat-speakers').textContent = diarSegs.length ? speakerCount : '—';
  document.getElementById('stat-language').textContent = wordData.language || 'auto';
  document.getElementById('topbar-filename').innerHTML = `<span>${escHtml(filename)}</span>`;
  renderTranscript();
  applyAutosave(filename);
  saveToHistory(filename, wordData.language || 'auto', speakerCount);
  hideNoAudioBar();
  showScreen('transcript');
  document.getElementById('export-btn').style.display = '';
  startSync();
}

// ── Demo ─────────────────────────────────────────────────────────
function loadDemoData(file) {
  const demo = [
    { spk: '0', sc: 0, w: [{word:'Good',start:0.0,end:0.3},{word:'morning',start:0.35,end:0.7},{word:'everyone,',start:0.75,end:1.1},{word:"today",start:1.2,end:1.5},{word:"we're",start:1.55,end:1.8},{word:'going',start:1.85,end:2.0},{word:'to',start:2.05,end:2.15},{word:'talk',start:2.2,end:2.45},{word:'about',start:2.5,end:2.75},{word:'Voxtral.',start:2.8,end:3.4}] },
    { spk: '1', sc: 1, w: [{word:'That',start:4.0,end:4.2},{word:'sounds',start:4.25,end:4.55},{word:'fascinating.',start:4.6,end:5.1},{word:'Tell',start:5.2,end:5.35},{word:'me',start:5.4,end:5.5},{word:'more.',start:5.55,end:5.9}] },
    { spk: '0', sc: 0, w: [{word:'Every',start:6.5,end:6.75},{word:'word',start:6.8,end:7.0},{word:'gets',start:7.05,end:7.25},{word:'its',start:7.3,end:7.45},{word:'own',start:7.5,end:7.7},{word:'timestamp.',start:7.75,end:8.3}] },
  ];
  segments = []; wordsData = []; speakerNames = {};
  demo.forEach((seg, si) => {
    const words = seg.w.map((w, wi) => ({ word: w.word, start: w.start, end: w.end, segIdx: si, wordIdx: wi, edited: false, originalWord: w.word }));
    segments.push({ speaker: seg.spk, speakerClass: seg.sc, start: seg.w[0].start, words });
    wordsData.push(...words);
  });
  if (file) {
    audio.src = URL.createObjectURL(file); audio.load();
    file.arrayBuffer().then(buf => new (window.AudioContext || window.webkitAudioContext)().decodeAudioData(buf)).then(drawWaveform).catch(() => {});
  }
  document.getElementById('stat-words').textContent    = wordsData.length;
  document.getElementById('stat-segments').textContent = segments.length;
  document.getElementById('stat-speakers').textContent = 2;
  document.getElementById('stat-language').textContent = 'en';
  document.getElementById('topbar-filename').innerHTML  = '<span>demo_audio.mp3</span>';
  renderTranscript();
  showScreen('transcript');
  document.getElementById('export-btn').style.display = '';
  startSync();
}

// ── Speaker popover ──────────────────────────────────────────────
let activeSpeakerPopover = null;
function closeSpeakerPopover() { if (activeSpeakerPopover) { activeSpeakerPopover.remove(); activeSpeakerPopover = null; } }
document.addEventListener('click', closeSpeakerPopover);
function getSpeakerDotColor(sc) { return ['#f97316','#22c55e','#a78bfa','#38bdf8','#f472b6'][sc % 5]; }

function showSpeakerPopover(e, speakerClass, paraFirstWordIdx, paraLastWordIdx) {
  closeSpeakerPopover();
  const pop = document.createElement('div');
  pop.className = 'speaker-popover';
  pop.onclick = ev => ev.stopPropagation();
  const currentName = speakerNames[speakerClass] || `SPEAKER ${speakerClass + 1}`;
  pop.innerHTML = `<div class="sp-header">${escHtml(currentName)}</div>`;

  const renameItem = document.createElement('div');
  renameItem.className = 'sp-item';
  renameItem.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="13" height="13"><path d="M11 2l3 3-8 8H3v-3L11 2z"/></svg> Rename`;
  pop.appendChild(renameItem);

  const renameRow = document.createElement('div');
  renameRow.className = 'sp-rename-row';
  renameRow.style.display = 'none';
  const inp = document.createElement('input'); inp.className = 'sp-rename-input'; inp.value = currentName;
  const saveBtn = document.createElement('button'); saveBtn.className = 'sp-rename-confirm'; saveBtn.textContent = 'Save';
  renameRow.appendChild(inp); renameRow.appendChild(saveBtn);
  pop.appendChild(renameRow);

  renameItem.onclick = () => { renameItem.style.display = 'none'; renameRow.style.display = 'flex'; inp.focus(); inp.select(); };
  function doRename() {
    const name = inp.value.trim(); if (!name) return;
    speakerNames[speakerClass] = name;
    document.querySelectorAll(`.speaker-badge[data-speaker-class="${speakerClass}"]`).forEach(b => b.textContent = name);
    closeSpeakerPopover(); saveToLocalStorage();
  }
  saveBtn.onclick = doRename;
  inp.onkeydown = ev => { if (ev.key === 'Enter') doRename(); if (ev.key === 'Escape') closeSpeakerPopover(); };

  const allClasses = [...new Set(segments.map(s => s.speakerClass))].sort();
  const nextClass  = Math.max(...allClasses) + 1;

  // Always show the reassign/new-speaker section
  const divEl = document.createElement('div'); divEl.className = 'sp-divider'; pop.appendChild(divEl);
  const hdr = document.createElement('div'); hdr.className = 'sp-header'; hdr.textContent = 'Reassign to'; pop.appendChild(hdr);

  // Existing speakers (excluding current)
  allClasses.filter(sc => sc !== speakerClass).forEach(sc => {
    const item = document.createElement('div'); item.className = 'sp-assign-item';
    const dot = document.createElement('div'); dot.className = 'sp-dot'; dot.style.background = getSpeakerDotColor(sc);
    const lbl = document.createElement('span'); lbl.textContent = speakerNames[sc] || `SPEAKER ${sc + 1}`;
    item.appendChild(dot); item.appendChild(lbl);
    item.onclick = () => { reassignSpeaker(speakerClass, sc); closeSpeakerPopover(); };
    pop.appendChild(item);
  });

  // New speaker option
  const newItem = document.createElement('div'); newItem.className = 'sp-assign-item';
  const newDot  = document.createElement('div'); newDot.className = 'sp-dot';
  newDot.style.cssText = `background:${getSpeakerDotColor(nextClass)};border:1.5px dashed ${getSpeakerDotColor(nextClass)};background:transparent;`;
  const newLbl  = document.createElement('span');
  newLbl.style.cssText = 'color:var(--text-2);';
  newLbl.textContent = `+ New speaker (${nextClass + 1})`;
  newItem.appendChild(newDot); newItem.appendChild(newLbl);
  newItem.onmouseenter = () => { newLbl.style.color = 'var(--text-0)'; };
  newItem.onmouseleave = () => { newLbl.style.color = 'var(--text-2)'; };
  newItem.onclick = () => { createAndAssignSpeaker(paraFirstWordIdx, paraLastWordIdx, nextClass); closeSpeakerPopover(); };
  pop.appendChild(newItem);

  document.body.appendChild(pop); activeSpeakerPopover = pop;
  const rect = e.target.getBoundingClientRect();
  const pw = pop.offsetWidth || 200, ph = pop.offsetHeight || 160;
  let left = rect.left, top = rect.bottom + 6;
  if (left + pw > window.innerWidth - 12) left = window.innerWidth - pw - 12;
  if (top + ph > window.innerHeight - 12) top = rect.top - ph - 6;
  pop.style.left = left + 'px'; pop.style.top = top + 'px';
}

function reassignSpeaker(fromClass, toClass) {
  segments.forEach(seg => { if (seg.speakerClass === fromClass) { seg.speakerClass = toClass; seg.speaker = String(toClass); } });
  renderTranscript();
  updateSpeakerStat();
  saveToLocalStorage();
}

function createAndAssignSpeaker(paraFirstWordIdx, paraLastWordIdx, newClass) {
  // Only retarget the underlying segments whose words fall within this paragraph's word range.
  // A segment belongs to this paragraph if any of its words are in [paraFirstWordIdx, paraLastWordIdx].
  const paraWords = wordsData.slice(paraFirstWordIdx, paraLastWordIdx + 1);
  const segIdxsInPara = new Set(paraWords.map(w => w.segIdx));

  segIdxsInPara.forEach(si => {
    segments[si].speakerClass = newClass;
    segments[si].speaker = String(newClass);
  });

  speakerNames[newClass] = `SPEAKER ${newClass + 1}`;
  renderTranscript();
  updateSpeakerStat(); //
  saveToLocalStorage();
}

// ── Render ───────────────────────────────────────────────────────
function renderTranscript() {
  const body = document.getElementById('transcript-body');
  body.innerHTML = '';
  const PAUSE = 1.5, MAX = 60;
  const paras = []; let cur = null;

  wordsData.forEach((w, i) => {
    const prev = wordsData[i - 1];
    const gap  = prev ? Math.max(0, w.start - prev.end) : 999;
    const spkChange = prev && segments[w.segIdx].speaker !== segments[prev.segIdx].speaker;
    if (!cur || gap > PAUSE || spkChange || cur.words.length >= MAX) {
      const seg = segments[w.segIdx];
      cur = { speaker: seg.speaker, speakerClass: seg.speakerClass, start: w.start, words: [] };
      paras.push(cur);
    }
    cur.words.push(w);
  });

  paras.forEach((para, pi) => {
    const div = document.createElement('div');
    div.className = 'segment';
    div.style.animationDelay = (pi * 0.04) + 's';

    const meta = document.createElement('div'); meta.className = 'segment-meta';
    const badge = document.createElement('div');
    badge.className = `speaker-badge speaker-${para.speakerClass % 5}`;
    badge.dataset.speakerClass = para.speakerClass;
    badge.textContent = speakerNames[para.speakerClass] || `SPEAKER ${para.speakerClass + 1}`;
    // Pass the word index range of this paragraph so "New speaker" only affects these words
    const paraFirstWordIdx = wordsData.indexOf(para.words[0]);
    const paraLastWordIdx  = wordsData.indexOf(para.words[para.words.length - 1]);
    badge.onclick = ev => { ev.stopPropagation(); showSpeakerPopover(ev, para.speakerClass, paraFirstWordIdx, paraLastWordIdx); };
    const timeEl = document.createElement('div'); timeEl.className = 'seg-time';
    timeEl.textContent = formatTime(para.start);
    timeEl.onclick = () => { if (audio.src) audio.currentTime = para.start; };
    meta.appendChild(badge); meta.appendChild(timeEl);

    const textDiv = document.createElement('div'); textDiv.className = 'segment-text';
    para.words.forEach((w, idx) => {
      const si = w.segIdx, wi = w.wordIdx;
      const span = document.createElement('span');
      span.className = 'word' + (w.edited ? ' edited' : '');
      span.dataset.segIdx = si; span.dataset.wordIdx = wi;
      span.dataset.start = w.start; span.dataset.end = w.end;
      span.textContent = (idx === 0 ? '' : ' ') + w.word;
      span.onclick    = ev => { if (audio.src && ev.detail === 1) audio.currentTime = w.start; };
      span.ondblclick = ()  => startEditing(span, si, wi);
      span.onmouseenter = ev => {
        const tt = document.getElementById('word-tooltip');
        tt.textContent = `${formatTime(w.start)} → ${formatTime(w.end)}`;
        tt.style.display = 'block'; tt.style.left = (ev.clientX + 10) + 'px'; tt.style.top = (ev.clientY - 28) + 'px';
      };
      span.onmousemove  = ev => { const tt = document.getElementById('word-tooltip'); tt.style.left = (ev.clientX + 10) + 'px'; tt.style.top = (ev.clientY - 28) + 'px'; };
      span.onmouseleave = ()  => { document.getElementById('word-tooltip').style.display = 'none'; };
      textDiv.appendChild(span);
    });

    div.appendChild(meta); div.appendChild(textDiv); body.appendChild(div);
  });
}

// ── Editing ──────────────────────────────────────────────────────
function startEditing(span, si, wi) {
  const word = segments[si].words[wi];
  const hadSpace = span.textContent.startsWith(' ');
  const before   = word.word;
  const input    = document.createElement('input');
  input.className = 'word-edit-input';
  input.value = word.word;
  input.style.width = Math.max(40, word.word.length * 9) + 'px';
  const wrapper = document.createElement('span'); wrapper.style.display = 'inline';
  if (hadSpace) wrapper.appendChild(document.createTextNode(' '));
  wrapper.appendChild(input);
  span.style.display = 'none';
  span.parentNode.insertBefore(wrapper, span);
  input.focus(); input.select();

  function commit() {
    const newVal = input.value.trim() || before;
    if (newVal !== before) { undoStack.push({ segIdx: si, wordIdx: wi, before, after: newVal }); redoStack = []; updateUndoButtons(); }
    word.word = newVal; word.edited = newVal !== word.originalWord;
    span.textContent = (hadSpace ? ' ' : '') + newVal;
    span.className   = 'word' + (word.edited ? ' edited' : '');
    span.dataset.start = word.start; span.dataset.end = word.end;
    wrapper.remove(); span.style.display = '';
    span.onclick    = ev => { if (audio.src && ev.detail === 1) audio.currentTime = word.start; };
    span.ondblclick = ()  => startEditing(span, si, wi);
    updateEditCount(); saveToLocalStorage();
  }
  input.onblur = commit;
  input.onkeydown = ev => {
    if (ev.key === 'Enter')  { ev.preventDefault(); input.blur(); }
    if (ev.key === 'Escape') { input.value = before; input.blur(); }
  };
}

function updateEditCount() {
  const count = wordsData.filter(w => w.edited).length;
  document.getElementById('stat-edits').textContent = count;
  const el = document.getElementById('edit-count');
  el.textContent = count + (count === 1 ? ' edit' : ' edits');
  el.className   = 'edit-count' + (count > 0 ? ' has-edits' : '');
}

function resetEdits() {
  segments.forEach(seg => seg.words.forEach(w => { w.word = w.originalWord; w.edited = false; }));
  undoStack = []; redoStack = []; updateUndoButtons(); updateEditCount(); renderTranscript(); saveToLocalStorage();
}

// ── Undo / Redo ──────────────────────────────────────────────────
function applyEdit(segIdx, wordIdx, val) {
  const word = segments[segIdx].words[wordIdx];
  word.word = val; word.edited = val !== word.originalWord;
  const span = document.querySelector(`.word[data-seg-idx="${segIdx}"][data-word-idx="${wordIdx}"]`);
  if (span) { const hs = span.textContent.startsWith(' '); span.textContent = (hs ? ' ' : '') + val; span.className = 'word' + (word.edited ? ' edited' : ''); }
  updateEditCount(); saveToLocalStorage();
}
function undo() { if (!undoStack.length) return; const op = undoStack.pop(); redoStack.push(op); applyEdit(op.segIdx, op.wordIdx, op.before); updateUndoButtons(); showUndoToast('Undone'); }
function redo() { if (!redoStack.length) return; const op = redoStack.pop(); undoStack.push(op); applyEdit(op.segIdx, op.wordIdx, op.after); updateUndoButtons(); showUndoToast('Redone'); }
function updateUndoButtons() { document.getElementById('undo-btn').disabled = !undoStack.length; document.getElementById('redo-btn').disabled = !redoStack.length; }
let _undoToastTimer;
function showUndoToast(msg) { const el = document.getElementById('undo-toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(_undoToastTimer); _undoToastTimer = setTimeout(() => el.classList.remove('show'), 1500); }

// ── Find & Replace ───────────────────────────────────────────────
function openFindBar()  { document.getElementById('find-bar').classList.add('open'); document.getElementById('find-input').focus(); }
function closeFindBar() { document.getElementById('find-bar').classList.remove('open'); clearFindHighlights(); findMatches = []; findIndex = 0; document.getElementById('find-count').textContent = ''; }
function clearFindHighlights() { document.querySelectorAll('.word.found,.word.found-current').forEach(el => el.classList.remove('found','found-current')); }

function onFindInput() {
  const q = document.getElementById('find-input').value;
  clearFindHighlights(); findMatches = [];
  if (!q) { document.getElementById('find-count').textContent = ''; return; }
  const lower = q.toLowerCase();
  document.querySelectorAll('.word').forEach(span => { if (span.textContent.trim().toLowerCase().includes(lower)) { span.classList.add('found'); findMatches.push(span); } });
  findIndex = 0; updateFindCurrent();
}
function updateFindCurrent() {
  document.querySelectorAll('.word.found-current').forEach(el => el.classList.remove('found-current'));
  if (!findMatches.length) { document.getElementById('find-count').textContent = 'No results'; return; }
  document.getElementById('find-count').textContent = `${findIndex + 1} / ${findMatches.length}`;
  findMatches[findIndex].classList.add('found-current');
  findMatches[findIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function findNav(dir) { if (!findMatches.length) return; findIndex = (findIndex + dir + findMatches.length) % findMatches.length; updateFindCurrent(); }
function onFindKey(ev)    { if (ev.key === 'Enter') { ev.preventDefault(); findNav(ev.shiftKey ? -1 : 1); } if (ev.key === 'Escape') closeFindBar(); }
function onReplaceKey(ev) { if (ev.key === 'Enter') { ev.preventDefault(); replaceOne(); } if (ev.key === 'Escape') closeFindBar(); }

function replaceOne() {
  if (!findMatches.length) return;
  const span = findMatches[findIndex], si = parseInt(span.dataset.segIdx), wi = parseInt(span.dataset.wordIdx);
  const word = segments[si].words[wi], replaceVal = document.getElementById('replace-input').value, before = word.word;
  word.word = replaceVal; word.edited = replaceVal !== word.originalWord;
  undoStack.push({ segIdx: si, wordIdx: wi, before, after: replaceVal }); redoStack = []; updateUndoButtons();
  const hs = span.textContent.startsWith(' '); span.textContent = (hs ? ' ' : '') + replaceVal; span.className = 'word' + (word.edited ? ' edited' : '');
  updateEditCount(); saveToLocalStorage();
  findMatches.splice(findIndex, 1); span.classList.remove('found','found-current');
  if (findMatches.length) findIndex = findIndex % findMatches.length;
  updateFindCurrent();
}
function replaceAll() {
  if (!findMatches.length) return;
  const replaceVal = document.getElementById('replace-input').value;
  [...findMatches].forEach(span => {
    const si = parseInt(span.dataset.segIdx), wi = parseInt(span.dataset.wordIdx), word = segments[si].words[wi], before = word.word;
    word.word = replaceVal; word.edited = replaceVal !== word.originalWord;
    undoStack.push({ segIdx: si, wordIdx: wi, before, after: replaceVal });
    const hs = span.textContent.startsWith(' '); span.textContent = (hs ? ' ' : '') + replaceVal; span.className = 'word' + (word.edited ? ' edited' : '');
  });
  redoStack = []; updateUndoButtons(); updateEditCount(); saveToLocalStorage();
  clearFindHighlights(); findMatches = []; document.getElementById('find-count').textContent = 'Done';
}

// ── Autosave ─────────────────────────────────────────────────────
// ── Autosave (current session edits) ────────────────────────────
function saveToLocalStorage() {
  if (!wordsData.length) return;
  try {
    const edits = wordsData.filter(w => w.edited).map(w => ({ segIdx: w.segIdx, wordIdx: w.wordIdx, word: w.word }));
    const filename = document.getElementById('topbar-filename').innerText.trim();
    localStorage.setItem(LS_KEY, JSON.stringify({ filename, ts: Date.now(), speakerNames, edits }));
    // Also update the edits in the matching history entry
    updateHistoryEdits(filename, edits, speakerNames);
  } catch(_) {}
}

function applyAutosave(filename) {
  try {
    // First check history for a matching entry
    const hist = getHistory();
    const entry = hist.find(h => h.filename === filename);
    if (!entry) return;
    let applied = 0;
    (entry.edits || []).forEach(e => {
      const word = segments[e.segIdx]?.words[e.wordIdx];
      if (word) { word.word = e.word; word.edited = true; applied++; }
    });
    if (entry.speakerNames) speakerNames = { ...speakerNames, ...entry.speakerNames };
    if (applied) { renderTranscript(); updateEditCount(); showUndoToast(`Restored ${applied} saved edit${applied > 1 ? 's' : ''}`); }
  } catch(_) {}
}

// ── History ──────────────────────────────────────────────────────
function getHistory() {
  try { return JSON.parse(localStorage.getItem(LS_HIST_KEY) || '[]'); } catch(_) { return []; }
}

function saveToHistory(filename, language, speakerCount) {
  try {
    const hist = getHistory().filter(h => h.filename !== filename); // remove old entry with same name
    const entry = {
      id: Date.now().toString(),
      filename,
      date: new Date().toISOString(),
      language,
      speakerCount,
      duration: audio.duration || 0,
      wordCount: wordsData.length,
      speakerNames: { ...speakerNames },
      edits: [],
      // Store the full transcript so it can be restored without re-calling the API
      segments: segments.map(seg => ({
        speaker: seg.speaker,
        speakerClass: seg.speakerClass,
        start: seg.start,
        words: seg.words.map(w => ({ word: w.word, originalWord: w.originalWord, start: w.start, end: w.end, edited: w.edited }))
      }))
    };
    hist.unshift(entry);
    // Keep only MAX_HISTORY entries; drop oldest if over limit
    while (hist.length > MAX_HISTORY) hist.pop();
    localStorage.setItem(LS_HIST_KEY, JSON.stringify(hist));
  } catch(e) {
    console.warn('History save failed (storage full?):', e.message);
  }
}

function updateHistoryEdits(filename, edits, names) {
  try {
    const hist = getHistory();
    const entry = hist.find(h => h.filename === filename);
    if (!entry) return;
    entry.edits = edits;
    entry.speakerNames = { ...names };
    entry.speakerCount = new Set(segments.map(s => s.speakerClass)).size; // ← add
    // Update segments snapshot so speaker reassignments survive reload
    entry.segments = segments.map(seg => ({                               // ← add
      speaker: seg.speaker,
      speakerClass: seg.speakerClass,
      start: seg.start,
      words: seg.words.map(w => ({ word: w.word, originalWord: w.originalWord, start: w.start, end: w.end, edited: w.edited }))
    }));
    localStorage.setItem(LS_HIST_KEY, JSON.stringify(hist));
  } catch(_) {}
}

function deleteHistoryEntry(id) {
  try {
    const hist = getHistory().filter(h => h.id !== id);
    localStorage.setItem(LS_HIST_KEY, JSON.stringify(hist));
    renderHistory();
  } catch(_) {}
}

function clearAllHistory() {
  try { localStorage.removeItem(LS_HIST_KEY); renderHistory(); } catch(_) {}
}

function loadFromHistory(entry) {
  // Restore segments and wordsData from stored snapshot
  segments  = [];
  wordsData = [];
  speakerNames = entry.speakerNames || {};

  entry.segments.forEach((seg, si) => {
    const words = seg.words.map((w, wi) => ({
      word: w.word, originalWord: w.originalWord, start: w.start, end: w.end,
      edited: w.edited || false, segIdx: si, wordIdx: wi
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

  // No audio — clear player, hide waveform, show attach banner
  audio.src = '';
  document.getElementById('waveform-wrap').style.display = 'none';
  document.getElementById('current-time').textContent = '0:00';
  document.getElementById('progress-fill').style.width = '0%';
  document.getElementById('progress-thumb').style.left = '0%';
  showNoAudioBar(entry.filename);

  undoStack = []; redoStack = []; updateUndoButtons();
  renderTranscript();
  updateEditCount();
  showScreen('transcript');
  document.getElementById('export-btn').style.display = '';
  startSync();

  showUndoToast('Loaded from history');
}

function renderHistory() {
  const hist = getHistory();
  const section = document.getElementById('recent-section');
  const list    = document.getElementById('recent-list');

  if (!hist.length) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  list.innerHTML = '';

  hist.forEach(entry => {
    const item = document.createElement('div');
    item.className = 'recent-item';

    const date = new Date(entry.date);
    const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    const timeStr = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    const dur  = formatTime(entry.duration);
    const spk  = entry.speakerCount > 1 ? `${entry.speakerCount} speakers` : '1 speaker';
    const wc   = entry.wordCount ? `${entry.wordCount.toLocaleString()} words` : '';
    const editCount = (entry.edits || []).length;
    const editStr = editCount ? ` · ${editCount} edit${editCount > 1 ? 's' : ''}` : '';

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

// ── Audio ────────────────────────────────────────────────────────
audio.addEventListener('loadedmetadata', () => {
  document.getElementById('stat-duration').textContent = formatTime(audio.duration);
  document.getElementById('total-time').textContent    = formatTime(audio.duration);
});
audio.addEventListener('ended', () => { document.getElementById('play-icon').innerHTML = '<path d="M4 2l10 6-10 6V2z"/>'; });

function togglePlay() {
  if (!audio.src) return;
  if (audio.paused) { audio.play(); document.getElementById('play-icon').innerHTML = '<rect x="3" y="2" width="4" height="12" rx="1"/><rect x="9" y="2" width="4" height="12" rx="1"/>'; }
  else              { audio.pause(); document.getElementById('play-icon').innerHTML = '<path d="M4 2l10 6-10 6V2z"/>'; }
}
function toggleAutoScroll() { autoScroll = !autoScroll; document.getElementById('autoscroll-btn').style.color = autoScroll ? 'var(--accent)' : ''; }
function changeSpeed(v)     { audio.playbackRate = parseFloat(v); }
function seekAudio(e)       { if (!audio.duration) return; const r = e.currentTarget.getBoundingClientRect(); audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration; }

// ── Sync loop ────────────────────────────────────────────────────
function findActiveWord(t) {
  let lo = 0, hi = wordsData.length - 1;
  while (lo <= hi) { const mid = (lo + hi) >> 1, w = wordsData[mid]; if (t < w.start) hi = mid-1; else if (t > w.end) lo = mid+1; else return w; }
  return (hi >= 0 && wordsData[hi].start <= t) ? wordsData[hi] : null;
}

function startSync() {
  if (rafId) cancelAnimationFrame(rafId);
  let lastSeekTime = -1, seekWallTime = -1;
  audio.addEventListener('seeking', () => { lastSeekTime = audio.currentTime; seekWallTime = performance.now(); }, { passive: true });
  function tick() {
    let t = audio.currentTime;
    if (seekWallTime > 0 && performance.now() - seekWallTime < 400 && Math.abs(t - lastSeekTime) < 0.05) t = lastSeekTime;
    const dur = audio.duration || 0;
    if (dur > 0) {
      const pct = (t / dur * 100).toFixed(2);
      document.getElementById('progress-fill').style.width  = pct + '%';
      document.getElementById('progress-thumb').style.left  = pct + '%';
      document.getElementById('waveform-playhead').style.left = pct + '%';
    }
    document.getElementById('current-time').textContent = formatTime(t);
    document.getElementById('status-right').textContent = formatTime(t);
    const active = findActiveWord(t);
    if (active) {
      const el = document.querySelector(`.word[data-seg-idx="${active.segIdx}"][data-word-idx="${active.wordIdx}"]`);
      if (el && el !== activeWordEl) {
        if (activeWordEl) activeWordEl.classList.remove('active');
        el.classList.add('active'); activeWordEl = el;
        if (autoScroll) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } else { if (activeWordEl) { activeWordEl.classList.remove('active'); activeWordEl = null; } }
    rafId = requestAnimationFrame(tick);
  }
  rafId = requestAnimationFrame(tick);
}

// ── Waveform ─────────────────────────────────────────────────────
async function drawWaveform(audioBuffer) {
  const wrap = document.getElementById('waveform-wrap'), canvas = document.getElementById('waveform-canvas');
  wrap.style.display = 'block';
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const H = 40, W = wrap.clientWidth || (window.innerWidth - 240);
  canvas.width = Math.round(W * devicePixelRatio); canvas.height = Math.round(H * devicePixelRatio);
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d'); ctx.scale(devicePixelRatio, devicePixelRatio);
  const raw = audioBuffer.getChannelData(0), blockSize = Math.max(1, Math.floor(raw.length / W)), rms = new Float32Array(W);
  for (let i = 0; i < W; i++) { let sum = 0; const s = i * blockSize, e = Math.min(s + blockSize, raw.length); for (let j = s; j < e; j++) sum += raw[j]*raw[j]; rms[i] = Math.sqrt(sum / (e-s)); }
  const peak = Math.max(...rms, 0.001);
  ctx.fillStyle = '#1a1a1d'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(249,115,22,0.55)';
  for (let i = 0; i < W; i++) { const h = Math.max(1, (rms[i]/peak) * H * 0.88); ctx.fillRect(i, (H-h)/2, 1, h); }
}
function waveformSeek(e) { if (!audio.duration) return; const r = e.currentTarget.getBoundingClientRect(); audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration; }

// ── Copy & Export ────────────────────────────────────────────────
function copyTranscript() {
  const parts = Array.from(document.getElementById('transcript-body').querySelectorAll('.segment')).map(block => {
    const speaker = block.querySelector('.speaker-badge')?.innerText?.trim() || 'SPEAKER 1';
    const time    = block.querySelector('.seg-time')?.innerText?.trim() || '';
    const text    = block.querySelector('.segment-text')?.innerText?.replace(/\s+/g, ' ').trim() || '';
    return `${speaker}  ${time}\n${text}`;
  });
  const output = parts.join('\n\n');
  function flash() {
    const btn = document.getElementById('copy-btn'), orig = btn.innerHTML;
    btn.innerHTML = `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 8l4 4 8-8"/></svg> Copied!`;
    btn.style.color = 'var(--green)'; btn.style.borderColor = 'var(--green)';
    setTimeout(() => { btn.innerHTML = orig; btn.style.color = ''; btn.style.borderColor = ''; }, 2000);
  }
  navigator.clipboard.writeText(output).then(flash).catch(() => { const ta = document.createElement('textarea'); ta.value = output; ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); flash(); });
}
function getTranscriptText() {
  return Array.from(document.getElementById('transcript-body').querySelectorAll('.segment')).map(block => {
    const speaker = block.querySelector('.speaker-badge')?.innerText?.trim() || 'SPEAKER 1';
    const time    = block.querySelector('.seg-time')?.innerText?.trim() || '';
    const text    = block.querySelector('.segment-text')?.innerText?.replace(/\s+/g, ' ').trim() || '';
    return `${speaker}  ${time}\n${text}`;
  }).join('\n\n');
}
function toggleExportMenu() { document.getElementById('export-menu').classList.toggle('open'); }
document.addEventListener('click', e => { if (!e.target.closest('#export-wrap')) document.getElementById('export-menu').classList.remove('open'); });
function exportTxt()  { download('transcript.txt', getTranscriptText(), 'text/plain'); document.getElementById('export-menu').classList.remove('open'); }
function exportSrt() {
  let idx = 1, srt = '';
  segments.forEach(seg => {
    for (let i = 0; i < seg.words.length; i += 10) {
      const chunk = seg.words.slice(i, i + 10);
      srt += `${idx++}\n${toSrtTime(chunk[0].start)} --> ${toSrtTime(chunk[chunk.length-1].end)}\n${chunk.map(w=>w.word).join(' ')}\n\n`;
    }
  });
  download('transcript.srt', srt, 'text/plain'); document.getElementById('export-menu').classList.remove('open');
}
function exportJson() {
  download('transcript.json', JSON.stringify(segments.map(seg => ({ speaker: seg.speaker, start: seg.start, words: seg.words.map(w => ({ word: w.word, start: w.start, end: w.end, edited: w.edited })) })), null, 2), 'application/json');
  document.getElementById('export-menu').classList.remove('open');
}
function download(name, content, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([content],{type})); a.download = name; a.click(); }
function toSrtTime(s) { const h=Math.floor(s/3600).toString().padStart(2,'0'),m=Math.floor((s%3600)/60).toString().padStart(2,'0'),sec=Math.floor(s%60).toString().padStart(2,'0'),ms=Math.round((s%1)*1000).toString().padStart(3,'0'); return `${h}:${m}:${sec},${ms}`; }

// ── No-audio attach ─────────────────────────────────────────────
let _expectedAudioFilename = null;

function showNoAudioBar(expectedFilename) {
  _expectedAudioFilename = expectedFilename;
  document.getElementById('no-audio-expected').textContent = expectedFilename;
  document.getElementById('no-audio-wrong').style.display  = 'none';
  document.getElementById('no-audio-bar').classList.add('visible');
  // Reset file input so same file can be re-selected after a wrong attempt
  const inp = document.getElementById('audio-reattach-input');
  inp.value = '';
}

function hideNoAudioBar() {
  _expectedAudioFilename = null;
  document.getElementById('no-audio-bar').classList.remove('visible');
  document.getElementById('no-audio-wrong').style.display = 'none';
}

function handleReattachAudio(file) {
  if (!file) return;

  // Enforce matching filename
  if (file.name !== _expectedAudioFilename) {
    const wrong = document.getElementById('no-audio-wrong');
    wrong.textContent = `✗ Expected "${_expectedAudioFilename}", got "${file.name}"`;
    wrong.style.display = 'inline';
    // Reset so user can try again
    document.getElementById('audio-reattach-input').value = '';
    return;
  }

  // Correct file — wire it up
  document.getElementById('no-audio-wrong').style.display = 'none';
  audio.src = URL.createObjectURL(file);
  audio.load();

  // Decode waveform
  file.arrayBuffer()
    .then(buf => new (window.AudioContext || window.webkitAudioContext)().decodeAudioData(buf))
    .then(decoded => drawWaveform(decoded))
    .catch(() => {});

  hideNoAudioBar();
  showUndoToast('Audio attached');
}

// ── Text selection → assign speaker ─────────────────────────────
let selMenu = null;
let selWordRange = null; // {firstGlobalIdx, lastGlobalIdx}

function closeSelMenu() {
  if (selMenu) { selMenu.remove(); selMenu = null; }
  clearSelHighlights();
  selWordRange = null;
}

function clearSelHighlights() {
  document.querySelectorAll('.word.sel-highlight').forEach(el => el.classList.remove('sel-highlight'));
}

// Listen for mouseup on the transcript body to detect text selections
document.getElementById('transcript-body').addEventListener('mouseup', e => {
  // Ignore if this was a click on an edit input
  if (e.target.tagName === 'INPUT') return;

  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.toString().trim()) {
    // No selection — close menu if open
    if (selMenu) closeSelMenu();
    return;
  }

  // Collect all .word spans that are fully or partially within the selection range
  const allWordSpans = Array.from(document.querySelectorAll('#transcript-body .word'));
  const selectedSpans = allWordSpans.filter(span => {
    const range = document.createRange();
    range.selectNode(span);
    return sel.containsNode(span, true); // true = partial overlap OK
  });

  if (selectedSpans.length === 0) return;

  // Map to global word indices
  const globalIndices = selectedSpans
    .map(span => {
      const si = parseInt(span.dataset.segIdx);
      const wi = parseInt(span.dataset.wordIdx);
      // Find position in wordsData
      return wordsData.findIndex(w => w.segIdx === si && w.wordIdx === wi);
    })
    .filter(i => i !== -1)
    .sort((a, b) => a - b);

  if (!globalIndices.length) return;

  const firstGlobalIdx = globalIndices[0];
  const lastGlobalIdx  = globalIndices[globalIndices.length - 1];
  selWordRange = { firstGlobalIdx, lastGlobalIdx };

  // Highlight selected words
  clearSelHighlights();
  selectedSpans.forEach(span => span.classList.add('sel-highlight'));

  // Clear browser selection so it doesn't interfere with the menu
  sel.removeAllRanges();

  showSelMenu(e.clientX, e.clientY, firstGlobalIdx, lastGlobalIdx, selectedSpans.length);
});

// Close sel menu on click outside transcript
document.addEventListener('mousedown', e => {
  if (selMenu && !selMenu.contains(e.target)) closeSelMenu();
});

function showSelMenu(x, y, firstIdx, lastIdx, wordCount) {
  if (selMenu) selMenu.remove();

  const allClasses   = [...new Set(segments.map(s => s.speakerClass))].sort();
  const nextClass    = Math.max(...allClasses) + 1;
  const firstWord    = wordsData[firstIdx];
  const lastWord     = wordsData[lastIdx];
  const timeRange    = `${formatTime(firstWord.start)} → ${formatTime(lastWord.end)}`;

  const menu = document.createElement('div');
  menu.className = 'sel-menu';
  menu.onclick = ev => ev.stopPropagation();

  menu.innerHTML = `
    <div class="sel-menu-header">Assign selection to speaker</div>
    <div class="sel-menu-info">${wordCount} word${wordCount > 1 ? 's' : ''} · ${timeRange}</div>
  `;

  // Existing speakers
  allClasses.forEach(sc => {
    const item = document.createElement('div');
    item.className = 'sel-menu-item';
    const dot = document.createElement('div');
    dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${getSpeakerDotColor(sc)};flex-shrink:0;`;
    const lbl = document.createElement('span');
    lbl.textContent = speakerNames[sc] || `SPEAKER ${sc + 1}`;
    item.appendChild(dot); item.appendChild(lbl);
    item.onclick = () => { assignSelectionToSpeaker(firstIdx, lastIdx, sc); closeSelMenu(); };
    menu.appendChild(item);
  });

  // Divider + new speaker
  const div = document.createElement('div'); div.className = 'sel-menu-divider'; menu.appendChild(div);
  const newItem = document.createElement('div'); newItem.className = 'sel-menu-item';
  const newDot  = document.createElement('div');
  newDot.style.cssText = `width:8px;height:8px;border-radius:50%;border:1.5px dashed ${getSpeakerDotColor(nextClass)};flex-shrink:0;`;
  const newLbl  = document.createElement('span'); newLbl.style.color = 'var(--text-2)';
  newLbl.textContent = `+ New speaker (${nextClass + 1})`;
  newItem.onmouseenter = () => { newLbl.style.color = 'var(--text-0)'; };
  newItem.onmouseleave = () => { newLbl.style.color = 'var(--text-2)'; };
  newItem.appendChild(newDot); newItem.appendChild(newLbl);
  newItem.onclick = () => {
    speakerNames[nextClass] = `SPEAKER ${nextClass + 1}`;
    assignSelectionToSpeaker(firstIdx, lastIdx, nextClass);
    closeSelMenu();
  };
  menu.appendChild(newItem);

  document.body.appendChild(menu);
  selMenu = menu;

  // Position — keep within viewport
  const mw = menu.offsetWidth || 220, mh = menu.offsetHeight || 200;
  let left = x + 8, top = y + 8;
  if (left + mw > window.innerWidth  - 12) left = x - mw - 8;
  if (top  + mh > window.innerHeight - 12) top  = y - mh - 8;
  menu.style.left = left + 'px';
  menu.style.top  = top  + 'px';
}

function assignSelectionToSpeaker(firstGlobalIdx, lastGlobalIdx, targetClass) {
  // Collect the unique segIdxs touched by the selected words
  const selectedWords = wordsData.slice(firstGlobalIdx, lastGlobalIdx + 1);
  const touchedSegIdxs = [...new Set(selectedWords.map(w => w.segIdx))];

  touchedSegIdxs.forEach(si => {
    const seg = segments[si];
    const segWords = seg.words; // original segment words

    // Find which words in this segment are selected
    const selectedInSeg = segWords.filter(w => {
      const gi = wordsData.findIndex(wd => wd.segIdx === si && wd.wordIdx === w.wordIdx);
      return gi >= firstGlobalIdx && gi <= lastGlobalIdx;
    });

    // If ALL words in this segment are selected — just reassign the whole segment
    if (selectedInSeg.length === segWords.length) {
      seg.speakerClass = targetClass;
      seg.speaker = String(targetClass);
      return;
    }

    // PARTIAL selection — split this segment into up to 3 parts:
    // [before-selection] [selected] [after-selection]
    // We do this by inserting new segment entries and updating wordsData references.

    const firstSelWi = selectedInSeg[0].wordIdx;
    const lastSelWi  = selectedInSeg[selectedInSeg.length - 1].wordIdx;

    const before   = segWords.filter(w => w.wordIdx < firstSelWi);
    const selected = segWords.filter(w => w.wordIdx >= firstSelWi && w.wordIdx <= lastSelWi);
    const after    = segWords.filter(w => w.wordIdx > lastSelWi);

    // Build replacement segments
    const newSegs = [];
    if (before.length)   newSegs.push({ ...seg, words: before });
    if (selected.length) newSegs.push({ ...seg, speakerClass: targetClass, speaker: String(targetClass), words: selected });
    if (after.length)    newSegs.push({ ...seg, words: after });

    // Replace si in segments array with newSegs
    segments.splice(si, 1, ...newSegs);

    // Rebuild all wordsData segIdx/wordIdx references since segment indices shifted
    rebuildWordsDataRefs();
  });

  renderTranscript();
  updateSpeakerStat();
  saveToLocalStorage();
}

function rebuildWordsDataRefs() {
  // After splicing segments, reindex every word's segIdx and wordIdx
  wordsData = [];
  segments.forEach((seg, si) => {
    seg.words.forEach((w, wi) => {
      w.segIdx  = si;
      w.wordIdx = wi;
      wordsData.push(w);
    });
  });
}

// ── Keyboard shortcuts ───────────────────────────────────────────
document.addEventListener('keydown', e => {
  const inInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';
  if (e.ctrlKey || e.metaKey) {
    if (e.key === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (e.key === 'y') { e.preventDefault(); redo(); return; }
    if (e.key === 'f') { e.preventDefault(); openFindBar(); return; }
  }
  if (inInput) return;
  if (e.code === 'Space')     { e.preventDefault(); togglePlay(); }
  if (e.key === 'ArrowLeft')  { e.preventDefault(); audio.currentTime = Math.max(0, audio.currentTime - 3); }
  if (e.key === 'ArrowRight') { e.preventDefault(); audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 3); }
});

// ── Screens & utils ──────────────────────────────────────────────
function showScreen(name) {
  document.getElementById('upload-screen').style.display     = name === 'upload'     ? 'flex' : 'none';
  document.getElementById('processing-screen').style.display = name === 'processing' ? 'flex' : 'none';
  document.getElementById('transcript-screen').style.display = name === 'transcript' ? 'flex' : 'none';
  document.getElementById('back-btn').style.display          = name === 'transcript' ? ''     : 'none';
  if (name === 'upload') renderHistory();
}

function goBack() {
  if (rafId) cancelAnimationFrame(rafId);
  activeWordEl = null;
  showScreen('upload');
}
function formatTime(s) { if (s == null || isNaN(s)) return '—'; return `${Math.floor(s/60)}:${Math.floor(s%60).toString().padStart(2,'0')}`; }
function escHtml(str) { return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function showError(msg) { const el = document.getElementById('error-toast'); el.textContent = msg; el.style.display = 'block'; setTimeout(() => { el.style.display = 'none'; }, 6000); }
function toggleApiKeyVisibility() { const i = document.getElementById('api-key-input'); i.type = i.type === 'password' ? 'text' : 'password'; }
document.getElementById('api-key-input').addEventListener('input', function() {
  if (this.value.trim()) localStorage.setItem(LS_API_KEY, this.value.trim());
  else localStorage.removeItem(LS_API_KEY);
});
const savedKey = localStorage.getItem(LS_API_KEY);
if (savedKey) document.getElementById('api-key-input').value = savedKey;

function updateSpeakerStat() {
  const uniqueSpeakers = new Set(segments.map(s => s.speakerClass)).size;
  document.getElementById('stat-speakers').textContent = uniqueSpeakers;
  document.getElementById('stat-segments').textContent = segments.length;
  document.getElementById('stat-words').textContent    = wordsData.length.toLocaleString();
}

showScreen('upload');