// ── Transcription processing & rendering ──────────────────────────
// Covers: merging API word/diarization data into segments, rendering
// the transcript DOM, inline word editing, undo/redo, and find & replace.

// ── Process ──────────────────────────────────────────────────────
function processTranscription(wordData, diarData, filename) {
  segments = []; wordsData = []; speakerNames = {};
  const diarSegs = diarData?.segments || [];

  function speakerAt(t) {
    let lo = 0, hi = diarSegs.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1, s = diarSegs[mid];
      if (t < s.start) hi = mid - 1;
      else if (t > s.end) lo = mid + 1;
      else return String(s.speaker_id ?? s.speaker ?? 0);
    }
    return hi >= 0 ? String(diarSegs[hi].speaker_id ?? diarSegs[hi].speaker ?? 0) : '0';
  }

  const speakerColors = {}; let speakerCount = 0;
  (wordData.segments || []).forEach((seg, si) => {
    let words;
    const hasWordTs = Array.isArray(seg.words) && seg.words.length > 0 && seg.words[0].start !== undefined;
    if (hasWordTs) {
      words = seg.words.map((w, wi) => ({
        word: w.word, start: w.start, end: w.end,
        segIdx: si, wordIdx: wi, edited: false, originalWord: w.word,
      }));
    } else {
      const raw = (seg.text || '').trim().split(/\s+/).filter(Boolean);
      const s0 = seg.start || 0, s1 = seg.end || s0 + 1, dur = raw.length ? (s1 - s0) / raw.length : 1;
      words = raw.map((w, wi) => ({
        word: w,
        start: parseFloat((s0 + wi * dur).toFixed(3)),
        end:   parseFloat((s0 + (wi + 1) * dur).toFixed(3)),
        segIdx: si, wordIdx: wi, edited: false, originalWord: w,
      }));
    }
    const midT = words.length ? (words[0].start + words[words.length - 1].end) / 2 : (seg.start || 0);
    const spk  = diarSegs.length ? speakerAt(midT) : (seg.speaker !== undefined ? String(seg.speaker) : '0');
    if (!(spk in speakerColors)) speakerColors[spk] = speakerCount++;
    segments.push({ speaker: spk, speakerClass: speakerColors[spk], start: seg.start || 0, words });
    wordsData.push(...words);
  });

  document.getElementById('stat-words').textContent    = wordsData.length.toLocaleString();
  document.getElementById('stat-segments').textContent = segments.length;
  document.getElementById('stat-speakers').textContent = diarSegs.length ? speakerCount : '—';
  document.getElementById('stat-language').textContent = wordData.language || 'auto';
  document.getElementById('topbar-filename').innerHTML  = `<span>${escHtml(filename)}</span>`;

  renderTranscript();
  applyAutosave(filename);
  saveToHistory(filename, wordData.language || 'auto', speakerCount);
  hideNoAudioBar();
  showScreen('transcript');
  document.getElementById('export-btn').style.display = '';
  startSync();
}

// ── Render ────────────────────────────────────────────────────────
function renderTranscript() {
  const body   = document.getElementById('transcript-body');
  body.innerHTML = '';
  const PAUSE  = 1.5;
  const paras  = []; let cur = null;

  wordsData.forEach((w, i) => {
    const prev       = wordsData[i - 1];
    const gap        = prev ? Math.max(0, w.start - prev.end) : 999;
    const spkChange  = prev && segments[w.segIdx].speaker !== segments[prev.segIdx].speaker;
    const forceSplit = w.splitBefore === true;
    const forceMerge = w.mergeBefore === true;
    const autoBreak  = !cur || gap > PAUSE || spkChange;
    const shouldBreak = forceSplit || (!forceMerge && autoBreak);

    if (shouldBreak) {
      const seg = segments[w.segIdx];
      cur = { speaker: seg.speaker, speakerClass: seg.speakerClass, start: w.start, words: [], paraIdx: paras.length };
      paras.push(cur);
    }
    cur.words.push(w);
  });

  paras.forEach((para, pi) => {
    const div       = document.createElement('div');
    div.className   = 'segment';
    div.style.animationDelay = (pi * 0.04) + 's';

    const meta  = document.createElement('div'); meta.className = 'segment-meta';
    const badge = document.createElement('div');
    badge.className     = `speaker-badge speaker-${para.speakerClass % 5}`;
    badge.dataset.speakerClass = para.speakerClass;
    badge.textContent   = speakerNames[para.speakerClass] || `SPEAKER ${para.speakerClass + 1}`;
    const paraFirstWordIdx = wordsData.indexOf(para.words[0]);
    const paraLastWordIdx  = wordsData.indexOf(para.words[para.words.length - 1]);
    badge.onclick = ev => {
      ev.stopPropagation();
      showSpeakerPopover(ev, para.speakerClass, paraFirstWordIdx, paraLastWordIdx);
    };
    const timeEl = document.createElement('div'); timeEl.className = 'seg-time';
    timeEl.textContent = formatTime(para.start);
    timeEl.onclick     = () => { if (audio.src) audio.currentTime = para.start; };
    meta.appendChild(badge); meta.appendChild(timeEl);

    const textDiv = document.createElement('div'); textDiv.className = 'segment-text';
    para.words.forEach((w, idx) => {
      const si = w.segIdx, wi = w.wordIdx;
      const globalIdx = paraFirstWordIdx + idx;
      const span = document.createElement('span');
      span.className        = 'word' + (w.edited ? ' edited' : '');
      span.dataset.segIdx   = si; span.dataset.wordIdx = wi;
      span.dataset.start    = w.start; span.dataset.end = w.end;
      span.textContent      = (idx === 0 ? '' : ' ') + w.word;
      span.onclick = ev => {
        if (ev.detail !== 1) return;
        if (audio.src) audio.currentTime = w.start;
      };
      span.ondblclick  = () => { startEditing(span, si, wi); };
      span.onmouseenter = ev => {
        const tt = document.getElementById('word-tooltip');
        tt.textContent   = `${formatTime(w.start)} → ${formatTime(w.end)}`;
        tt.style.display = 'block';
        tt.style.left    = (ev.clientX + 10) + 'px';
        tt.style.top     = (ev.clientY - 28) + 'px';
      };
      span.onmousemove  = ev => {
        const tt = document.getElementById('word-tooltip');
        tt.style.left = (ev.clientX + 10) + 'px';
        tt.style.top  = (ev.clientY - 28) + 'px';
      };
      span.onmouseleave = () => { document.getElementById('word-tooltip').style.display = 'none'; };
      textDiv.appendChild(span);
    });

    div.appendChild(meta); div.appendChild(textDiv); body.appendChild(div);
  });
}

// ── Inline word editing ───────────────────────────────────────────
function startEditing(span, si, wi) {
  const word     = segments[si].words[wi];
  const hadSpace = span.textContent.startsWith(' ');
  const before   = word.word;
  const input    = document.createElement('input');
  input.className = 'word-edit-input';
  input.value     = word.word;
  input.style.width = Math.max(40, word.word.length * 9) + 'px';
  const wrapper = document.createElement('span'); wrapper.style.display = 'inline';
  if (hadSpace) wrapper.appendChild(document.createTextNode(' '));
  wrapper.appendChild(input);
  span.style.display = 'none';
  span.parentNode.insertBefore(wrapper, span);
  input.focus(); input.select();

  function commit() {
    const newVal = input.value.trim() || before;
    if (newVal !== before) {
      undoStack.push({ type: 'word', segIdx: si, wordIdx: wi, before, after: newVal });
      redoStack = []; updateUndoButtons();
    }
    word.word   = newVal; word.edited = newVal !== word.originalWord;
    span.textContent   = (hadSpace ? ' ' : '') + newVal;
    span.className     = 'word' + (word.edited ? ' edited' : '');
    span.dataset.start = word.start; span.dataset.end = word.end;
    wrapper.remove(); span.style.display = '';
    span.onclick    = ev => { if (audio.src && ev.detail === 1) audio.currentTime = word.start; };
    span.ondblclick = ()  => startEditing(span, si, wi);
    updateEditCount(); saveToDB();
  }
  input.onblur    = commit;
  input.onkeydown = ev => {
    if (ev.key === 'Enter')  { ev.preventDefault(); input.blur(); }
    if (ev.key === 'Escape') { input.value = before; input.blur(); }
  };
}

function updateEditCount() {
  const count = wordsData.filter(w => w.edited).length;
  document.getElementById('stat-edits').textContent = count;
  const el    = document.getElementById('edit-count');
  el.textContent = count + (count === 1 ? ' edit' : ' edits');
  el.className   = 'edit-count' + (count > 0 ? ' has-edits' : '');
}

function resetEdits() {
  segments.forEach(seg => seg.words.forEach(w => { w.word = w.originalWord; w.edited = false; }));
  undoStack = []; redoStack = []; updateUndoButtons(); updateEditCount(); renderTranscript(); saveToDB();
}

// ── Undo / Redo ───────────────────────────────────────────────────
function applyEdit(segIdx, wordIdx, val) {
  const word = segments[segIdx].words[wordIdx];
  word.word   = val; word.edited = val !== word.originalWord;
  const span  = document.querySelector(`.word[data-seg-idx="${segIdx}"][data-word-idx="${wordIdx}"]`);
  if (span) {
    const hs = span.textContent.startsWith(' ');
    span.textContent = (hs ? ' ' : '') + val;
    span.className   = 'word' + (word.edited ? ' edited' : '');
  }
  updateEditCount(); saveToDB();
}

function applySegmentSnapshot(snapshot) {
  segments  = [];
  wordsData = [];
  snapshot.forEach((seg, si) => {
    const words = seg.words.map((w, wi) => ({ ...w, segIdx: si, wordIdx: wi }));
    segments.push({ ...seg, words });
    wordsData.push(...words);
  });
  renderTranscript();
  updateSpeakerStat();
  saveToDB();
}

function serializeSegments() {
  return segments.map(seg => ({
    speaker:      seg.speaker,
    speakerClass: seg.speakerClass,
    start:        seg.start,
    words: seg.words.map(w => {
      const out = { ...w };
      if (!w.splitBefore) delete out.splitBefore;
      if (!w.mergeBefore) delete out.mergeBefore;
      return out;
    }),
  }));
}

function undo() {
  if (!undoStack.length) return;
  const op = undoStack.pop(); redoStack.push(op);
  if (op.type === 'word')    applyEdit(op.segIdx, op.wordIdx, op.before);
  else if (op.type === 'speaker') applySegmentSnapshot(op.before);
  updateUndoButtons(); showUndoToast('Undone');
}
function redo() {
  if (!redoStack.length) return;
  const op = redoStack.pop(); undoStack.push(op);
  if (op.type === 'word')    applyEdit(op.segIdx, op.wordIdx, op.after);
  else if (op.type === 'speaker') applySegmentSnapshot(op.after);
  updateUndoButtons(); showUndoToast('Redone');
}
function updateUndoButtons() {
  document.getElementById('undo-btn').disabled = !undoStack.length;
  document.getElementById('redo-btn').disabled = !redoStack.length;
}

// ── Find & Replace ────────────────────────────────────────────────
function openFindBar()  { document.getElementById('find-bar').classList.add('open'); document.getElementById('find-input').focus(); }
function closeFindBar() {
  document.getElementById('find-bar').classList.remove('open');
  clearFindHighlights(); findMatches = []; findIndex = 0;
  document.getElementById('find-count').textContent = '';
}
function clearFindHighlights() {
  document.querySelectorAll('.word.found,.word.found-current').forEach(el => el.classList.remove('found', 'found-current'));
}

function onFindInput() {
  const q = document.getElementById('find-input').value;
  clearFindHighlights(); findMatches = [];
  if (!q) { document.getElementById('find-count').textContent = ''; return; }
  const lower = q.toLowerCase();
  document.querySelectorAll('.word').forEach(span => {
    if (span.textContent.trim().toLowerCase().includes(lower)) {
      span.classList.add('found'); findMatches.push(span);
    }
  });
  findIndex = 0; updateFindCurrent();
}
function updateFindCurrent() {
  document.querySelectorAll('.word.found-current').forEach(el => el.classList.remove('found-current'));
  if (!findMatches.length) { document.getElementById('find-count').textContent = 'No results'; return; }
  document.getElementById('find-count').textContent = `${findIndex + 1} / ${findMatches.length}`;
  findMatches[findIndex].classList.add('found-current');
  findMatches[findIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function findNav(dir)   { if (!findMatches.length) return; findIndex = (findIndex + dir + findMatches.length) % findMatches.length; updateFindCurrent(); }
function onFindKey(ev)    { if (ev.key === 'Enter') { ev.preventDefault(); findNav(ev.shiftKey ? -1 : 1); } if (ev.key === 'Escape') closeFindBar(); }
function onReplaceKey(ev) { if (ev.key === 'Enter') { ev.preventDefault(); replaceOne(); }             if (ev.key === 'Escape') closeFindBar(); }

function replaceOne() {
  if (!findMatches.length) return;
  const span       = findMatches[findIndex];
  const si         = parseInt(span.dataset.segIdx), wi = parseInt(span.dataset.wordIdx);
  const word       = segments[si].words[wi];
  const replaceVal = document.getElementById('replace-input').value;
  const before     = word.word;
  word.word = replaceVal; word.edited = replaceVal !== word.originalWord;
  undoStack.push({ type: 'word', segIdx: si, wordIdx: wi, before, after: replaceVal }); redoStack = []; updateUndoButtons();
  const hs = span.textContent.startsWith(' ');
  span.textContent = (hs ? ' ' : '') + replaceVal;
  span.className   = 'word' + (word.edited ? ' edited' : '');
  updateEditCount(); saveToDB();
  findMatches.splice(findIndex, 1); span.classList.remove('found', 'found-current');
  if (findMatches.length) findIndex = findIndex % findMatches.length;
  updateFindCurrent();
}
function replaceAll() {
  if (!findMatches.length) return;
  const replaceVal = document.getElementById('replace-input').value;
  [...findMatches].forEach(span => {
    const si = parseInt(span.dataset.segIdx), wi = parseInt(span.dataset.wordIdx), word = segments[si].words[wi], before = word.word;
    word.word = replaceVal; word.edited = replaceVal !== word.originalWord;
    undoStack.push({ type: 'word', segIdx: si, wordIdx: wi, before, after: replaceVal });
    const hs = span.textContent.startsWith(' ');
    span.textContent = (hs ? ' ' : '') + replaceVal;
    span.className   = 'word' + (word.edited ? ' edited' : '');
  });
  redoStack = []; updateUndoButtons(); updateEditCount(); saveToDB();
  clearFindHighlights(); findMatches = [];
  document.getElementById('find-count').textContent = 'Done';
}