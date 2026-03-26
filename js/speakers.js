// ── Speakers ──────────────────────────────────────────────────────
// Speaker popover (rename / reassign whole paragraph), text-selection
// context menu (assign / merge / split / delete), and paragraph operations.

// ── Speaker popover ───────────────────────────────────────────────
let activeSpeakerPopover = null;
function closeSpeakerPopover() {
  if (activeSpeakerPopover) { activeSpeakerPopover.remove(); activeSpeakerPopover = null; }
}
document.addEventListener('click', closeSpeakerPopover);

function showSpeakerPopover(e, speakerClass, paraFirstWordIdx, paraLastWordIdx) {
  closeSpeakerPopover();
  const pop = document.createElement('div');
  pop.className = 'speaker-popover';
  pop.onclick = ev => ev.stopPropagation();
  const currentName = speakerNames[speakerClass] || `SPEAKER ${speakerClass + 1}`;
  pop.innerHTML = `<div class="sp-header">${escHtml(currentName)}</div>`;

  // Rename row
  const renameItem = document.createElement('div'); renameItem.className = 'sp-item';
  renameItem.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="13" height="13"><path d="M11 2l3 3-8 8H3v-3L11 2z"/></svg> Rename`;
  pop.appendChild(renameItem);
  const renameRow = document.createElement('div'); renameRow.className = 'sp-rename-row'; renameRow.style.display = 'none';
  const inp = document.createElement('input'); inp.className = 'sp-rename-input'; inp.value = currentName;
  const saveBtn = document.createElement('button'); saveBtn.className = 'sp-rename-confirm'; saveBtn.textContent = 'Save';
  renameRow.appendChild(inp); renameRow.appendChild(saveBtn); pop.appendChild(renameRow);
  renameItem.onclick = () => { renameItem.style.display = 'none'; renameRow.style.display = 'flex'; inp.focus(); inp.select(); };
  function doRename() {
    const name = inp.value.trim(); if (!name) return;
    speakerNames[speakerClass] = name;
    document.querySelectorAll(`.speaker-badge[data-speaker-class="${speakerClass}"]`).forEach(b => b.textContent = name);
    closeSpeakerPopover(); saveToDB();
  }
  saveBtn.onclick = doRename;
  inp.onkeydown = ev => { if (ev.key === 'Enter') doRename(); if (ev.key === 'Escape') closeSpeakerPopover(); };

  // Reassign section
  const allClasses = [...new Set(segments.map(s => s.speakerClass))].sort();
  const nextClass  = Math.max(...allClasses) + 1;
  const divEl = document.createElement('div'); divEl.className = 'sp-divider'; pop.appendChild(divEl);
  const hdr   = document.createElement('div'); hdr.className = 'sp-header'; hdr.textContent = 'Reassign to'; pop.appendChild(hdr);

  allClasses.filter(sc => sc !== speakerClass).forEach(sc => {
    const item = document.createElement('div'); item.className = 'sp-assign-item';
    const dot  = document.createElement('div'); dot.className = 'sp-dot'; dot.style.background = getSpeakerDotColor(sc);
    const lbl  = document.createElement('span'); lbl.textContent = speakerNames[sc] || `SPEAKER ${sc + 1}`;
    item.appendChild(dot); item.appendChild(lbl);
    item.onclick = () => { reassignSpeaker(speakerClass, sc); closeSpeakerPopover(); };
    pop.appendChild(item);
  });

  const newItem = document.createElement('div'); newItem.className = 'sp-assign-item';
  const newDot  = document.createElement('div'); newDot.className = 'sp-dot';
  newDot.style.cssText = `background:${getSpeakerDotColor(nextClass)};border:1.5px dashed ${getSpeakerDotColor(nextClass)};background:transparent;`;
  const newLbl = document.createElement('span'); newLbl.style.cssText = 'color:var(--text-2);';
  newLbl.textContent = `+ New speaker (${nextClass + 1})`;
  newItem.appendChild(newDot); newItem.appendChild(newLbl);
  newItem.onmouseenter = () => { newLbl.style.color = 'var(--text-0)'; };
  newItem.onmouseleave = () => { newLbl.style.color = 'var(--text-2)'; };
  newItem.onclick = () => { createAndAssignSpeaker(paraFirstWordIdx, paraLastWordIdx, nextClass); closeSpeakerPopover(); };
  pop.appendChild(newItem);

  document.body.appendChild(pop); activeSpeakerPopover = pop;
  _positionPopover(pop, e.target.getBoundingClientRect(), 'below');
}

function reassignSpeaker(fromClass, toClass) {
  const before = serializeSegments();
  segments.forEach(seg => {
    if (seg.speakerClass === fromClass) { seg.speakerClass = toClass; seg.speaker = String(toClass); }
  });
  undoStack.push({ type: 'speaker', before, after: serializeSegments() }); redoStack = []; updateUndoButtons();
  renderTranscript(); updateSpeakerStat(); saveToDB();
}

function createAndAssignSpeaker(paraFirstWordIdx, paraLastWordIdx, newClass) {
  const before      = serializeSegments();
  const paraWords   = wordsData.slice(paraFirstWordIdx, paraLastWordIdx + 1);
  const segIdxsInPara = new Set(paraWords.map(w => w.segIdx));
  segIdxsInPara.forEach(si => { segments[si].speakerClass = newClass; segments[si].speaker = String(newClass); });
  speakerNames[newClass] = `SPEAKER ${newClass + 1}`;
  undoStack.push({ type: 'speaker', before, after: serializeSegments() }); redoStack = []; updateUndoButtons();
  renderTranscript(); updateSpeakerStat(); saveToDB();
}

// ── Text-selection context menu ───────────────────────────────────
let selMenu      = null;
let selWordRange = null;

function closeSelMenu() {
  if (selMenu) { selMenu.remove(); selMenu = null; }
  clearSelHighlights(); selWordRange = null;
}
function clearSelHighlights() {
  document.querySelectorAll('.word.sel-highlight').forEach(el => el.classList.remove('sel-highlight'));
}

document.getElementById('transcript-body').addEventListener('mouseup', e => {
  if (e.target.tagName === 'INPUT') return;
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.toString().trim()) { if (selMenu) closeSelMenu(); return; }

  const allWordSpans   = Array.from(document.querySelectorAll('#transcript-body .word'));
  const selectedSpans  = allWordSpans.filter(span => sel.containsNode(span, true));
  if (selectedSpans.length === 0) return;

  const globalIndices = selectedSpans
    .map(span => {
      const si = parseInt(span.dataset.segIdx), wi = parseInt(span.dataset.wordIdx);
      return wordsData.findIndex(w => w.segIdx === si && w.wordIdx === wi);
    })
    .filter(i => i !== -1)
    .sort((a, b) => a - b);

  if (!globalIndices.length) return;
  const firstGlobalIdx = globalIndices[0];
  const lastGlobalIdx  = globalIndices[globalIndices.length - 1];
  selWordRange = { firstGlobalIdx, lastGlobalIdx };

  clearSelHighlights();
  selectedSpans.forEach(span => span.classList.add('sel-highlight'));
  sel.removeAllRanges();
  showSelMenu(e.clientX, e.clientY, firstGlobalIdx, lastGlobalIdx, selectedSpans.length);
});

document.addEventListener('mousedown', e => {
  if (selMenu && !selMenu.contains(e.target)) closeSelMenu();
});

function showSelMenu(x, y, firstIdx, lastIdx, wordCount) {
  if (selMenu) selMenu.remove();
  const allClasses = [...new Set(segments.map(s => s.speakerClass))].sort();
  const nextClass  = Math.max(...allClasses) + 1;
  const firstWord  = wordsData[firstIdx];
  const lastWord   = wordsData[lastIdx];
  const timeRange  = `${formatTime(firstWord.start)} → ${formatTime(lastWord.end)}`;

  const menu = document.createElement('div'); menu.className = 'sel-menu';
  menu.onclick = ev => ev.stopPropagation();
  menu.innerHTML = `
    <div class="sel-menu-info">${wordCount} word${wordCount > 1 ? 's' : ''} · ${timeRange}</div>
  `;

  // Copy selection to clipboard
  const copyItem = document.createElement('div'); copyItem.className = 'sel-menu-item';
  copyItem.innerHTML = `
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" style="flex-shrink:0;"><rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M11 5V3.5A1.5 1.5 0 009.5 2h-6A1.5 1.5 0 002 3.5v6A1.5 1.5 0 003.5 11H5"/></svg>
    <span id="sel-copy-label">Copy selection</span>
  `;
  copyItem.onclick = () => {
    const text = wordsData.slice(firstIdx, lastIdx + 1).map(w => w.word).join(' ');
    navigator.clipboard.writeText(text).then(() => {
      const lbl = copyItem.querySelector('#sel-copy-label');
      lbl.textContent = 'Copied!';
      setTimeout(() => { lbl.textContent = 'Copy selection'; }, 1500);
    }).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
      const lbl = copyItem.querySelector('#sel-copy-label');
      lbl.textContent = 'Copied!';
      setTimeout(() => { lbl.textContent = 'Copy selection'; }, 1500);
    });
  };
  menu.appendChild(copyItem);

  const copyDiv = document.createElement('div'); copyDiv.className = 'sel-menu-divider'; menu.appendChild(copyDiv);
  const assignHdr = document.createElement('div'); assignHdr.className = 'sel-menu-header'; assignHdr.textContent = 'Assign selection to speaker'; menu.appendChild(assignHdr);

  allClasses.forEach(sc => {
    const item = document.createElement('div'); item.className = 'sel-menu-item';
    const dot  = document.createElement('div');
    dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${getSpeakerDotColor(sc)};flex-shrink:0;`;
    const lbl  = document.createElement('span'); lbl.textContent = speakerNames[sc] || `SPEAKER ${sc + 1}`;
    item.appendChild(dot); item.appendChild(lbl);
    item.onclick = () => { assignSelectionToSpeaker(firstIdx, lastIdx, sc); closeSelMenu(); };
    menu.appendChild(item);
  });

  const div = document.createElement('div'); div.className = 'sel-menu-divider'; menu.appendChild(div);
  const newItem = document.createElement('div'); newItem.className = 'sel-menu-item';
  const newDot  = document.createElement('div');
  newDot.style.cssText = `width:8px;height:8px;border-radius:50%;border:1.5px dashed ${getSpeakerDotColor(nextClass)};flex-shrink:0;`;
  const newLbl  = document.createElement('span'); newLbl.style.color = 'var(--text-2)';
  newLbl.textContent = `+ New speaker (${nextClass + 1})`;
  newItem.onmouseenter = () => { newLbl.style.color = 'var(--text-0)'; };
  newItem.onmouseleave = () => { newLbl.style.color = 'var(--text-2)'; };
  newItem.appendChild(newDot); newItem.appendChild(newLbl);
  newItem.onclick = () => { speakerNames[nextClass] = `SPEAKER ${nextClass + 1}`; assignSelectionToSpeaker(firstIdx, lastIdx, nextClass); closeSelMenu(); };
  menu.appendChild(newItem);

  // Merge into previous paragraph (only when selection doesn't start at the very first word)
  if (firstIdx > 0) {
    const mergeDiv = document.createElement('div'); mergeDiv.className = 'sel-menu-divider'; menu.appendChild(mergeDiv);
    const mergeItem = document.createElement('div'); mergeItem.className = 'sel-menu-item';
    const renderParaStart = _getRenderedParaStart(firstIdx);
    const previewWords = wordsData.slice(renderParaStart, lastIdx + 1).map(w => w.word).join(' ');
    const preview = previewWords.length > 45 ? previewWords.slice(0, 42) + '…' : previewWords;
    mergeItem.innerHTML = `
      <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" style="flex-shrink:0;color:var(--green)"><path d="M8 12V4M4 7l4-4 4 4"/></svg>
      <span>Merge into previous paragraph</span>
    `;
    mergeItem.title = `"${preview}"`;
    mergeItem.onclick = () => { doMergeSelection(firstIdx, lastIdx); closeSelMenu(); };
    menu.appendChild(mergeItem);
  }

  // Split into own paragraph (only when selection is a strict subset)
  if (wordCount >= 1 && lastIdx - firstIdx < wordsData.length - 1) {
    const splitDiv = document.createElement('div'); splitDiv.className = 'sel-menu-divider'; menu.appendChild(splitDiv);
    const splitItem = document.createElement('div'); splitItem.className = 'sel-menu-item';
    splitItem.innerHTML = `
      <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" style="flex-shrink:0;color:var(--accent)"><path d="M8 2v12M3 9l5 5 5-5"/></svg>
      <span>Split into own paragraph</span>
    `;
    splitItem.onclick = () => { doSplitSelection(firstIdx, lastIdx); closeSelMenu(); };
    menu.appendChild(splitItem);
  }

  // Delete selection
  const deleteDiv = document.createElement('div'); deleteDiv.className = 'sel-menu-divider'; menu.appendChild(deleteDiv);
  const deleteItem = document.createElement('div'); deleteItem.className = 'sel-menu-item sel-menu-item-danger';
  deleteItem.innerHTML = `
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" style="flex-shrink:0;"><path d="M3 4h10M6 4V3h4v1M5 4v8a1 1 0 001 1h4a1 1 0 001-1V4"/></svg>
    <span>Delete section</span>
  `;
  deleteItem.onclick = () => { doDeleteSelection(firstIdx, lastIdx); closeSelMenu(); };
  menu.appendChild(deleteItem);

  document.body.appendChild(menu); selMenu = menu;
  const mw = menu.offsetWidth || 220, mh = menu.offsetHeight || 200;
  let left = x + 8, top = y + 8;
  if (left + mw > window.innerWidth  - 12) left = x - mw - 8;
  if (top  + mh > window.innerHeight - 12) top  = y - mh - 8;
  menu.style.left = left + 'px'; menu.style.top = top + 'px';
}

function assignSelectionToSpeaker(firstGlobalIdx, lastGlobalIdx, targetClass) {
  const before         = serializeSegments();
  const selectedWords  = wordsData.slice(firstGlobalIdx, lastGlobalIdx + 1);
  const touchedSegIdxs = [...new Set(selectedWords.map(w => w.segIdx))];

  touchedSegIdxs.forEach(si => {
    const seg      = segments[si];
    const segWords = seg.words;
    const selectedInSeg = segWords.filter(w => {
      const gi = wordsData.findIndex(wd => wd.segIdx === si && wd.wordIdx === w.wordIdx);
      return gi >= firstGlobalIdx && gi <= lastGlobalIdx;
    });

    if (selectedInSeg.length === segWords.length) {
      seg.speakerClass = targetClass; seg.speaker = String(targetClass); return;
    }

    const firstSelWi = selectedInSeg[0].wordIdx;
    const lastSelWi  = selectedInSeg[selectedInSeg.length - 1].wordIdx;
    const beforeW    = segWords.filter(w => w.wordIdx < firstSelWi);
    const selected   = segWords.filter(w => w.wordIdx >= firstSelWi && w.wordIdx <= lastSelWi);
    const afterW     = segWords.filter(w => w.wordIdx > lastSelWi);
    const newSegs    = [];
    if (beforeW.length)  newSegs.push({ ...seg, words: beforeW });
    if (selected.length) newSegs.push({ ...seg, speakerClass: targetClass, speaker: String(targetClass), words: selected });
    if (afterW.length)   newSegs.push({ ...seg, words: afterW });
    segments.splice(si, 1, ...newSegs);
    rebuildWordsDataRefs();
  });

  undoStack.push({ type: 'speaker', before, after: serializeSegments() }); redoStack = []; updateUndoButtons();
  renderTranscript(); updateSpeakerStat(); saveToDB();
}

function rebuildWordsDataRefs() {
  wordsData = [];
  segments.forEach((seg, si) => {
    seg.words.forEach((w, wi) => { w.segIdx = si; w.wordIdx = wi; wordsData.push(w); });
  });
}

// ── Split / Merge operations ──────────────────────────────────────

// Returns the global word index of the first word in the rendered paragraph
// that contains globalIdx. Respects splitBefore/mergeBefore overrides exactly
// as renderTranscript() does.
function _getRenderedParaStart(globalIdx) {
  const PAUSE = 1.5;
  let paraStart = 0;
  for (let i = 0; i <= globalIdx; i++) {
    const w    = wordsData[i];
    const prev = wordsData[i - 1];
    const gap       = prev ? Math.max(0, w.start - prev.end) : 999;
    const spkChange = prev && segments[w.segIdx].speaker !== segments[prev.segIdx].speaker;
    const forceSplit = w.splitBefore === true;
    const forceMerge = w.mergeBefore === true;
    const autoBreak  = !prev || gap > PAUSE || spkChange;
    const shouldBreak = forceSplit || (!forceMerge && (i === 0 || autoBreak));
    if (shouldBreak) paraStart = i;
  }
  return paraStart;
}

// Merge: takes everything from the rendered-paragraph start that contains
// firstIdx, through lastIdx, and folds it all up into the paragraph above.
// Works across multiple paragraphs — every break between paraStart and lastIdx
// is collapsed. Any words after lastIdx that were in the same paragraph stay
// put (forced splitBefore so they remain their own paragraph).
function doMergeSelection(firstIdx, lastIdx) {
  const before    = serializeSegments();
  const paraStart = _getRenderedParaStart(firstIdx);

  if (paraStart === 0) return; // nothing above to merge into

  const PAUSE = 1.5;

  // Walk every word from paraStart through lastIdx.
  // Wherever renderTranscript() would start a new paragraph, mark it mergeBefore
  // so all those breaks collapse into the paragraph above paraStart.
  for (let i = paraStart; i <= lastIdx; i++) {
    const w    = wordsData[i];
    const prev = wordsData[i - 1];
    const gap       = prev ? Math.max(0, w.start - prev.end) : 999;
    const spkChange = prev && segments[w.segIdx].speaker !== segments[prev.segIdx].speaker;
    const wouldBreak = w.splitBefore || (!w.mergeBefore && (i === 0 || gap > PAUSE || spkChange));
    if (wouldBreak) {
      w.mergeBefore = true;
      delete w.splitBefore;
    }
  }

  // If there are words after lastIdx that belonged to the same rendered paragraph
  // as lastIdx, force a split so they stay separate.
  const nextWord = wordsData[lastIdx + 1];
  if (nextWord) {
    const nextParaStart = _getRenderedParaStart(lastIdx + 1);
    if (nextParaStart <= lastIdx) {
      nextWord.splitBefore = true;
      delete nextWord.mergeBefore;
    }
  }

  undoStack.push({ type: 'speaker', before, after: serializeSegments() }); redoStack = []; updateUndoButtons();
  renderTranscript(); saveToDB();
  showUndoToast('Merged ↑');
}

function doSplitSelection(firstGlobalIdx, lastGlobalIdx) {
  const before = serializeSegments();
  wordsData[firstGlobalIdx].splitBefore = true; delete wordsData[firstGlobalIdx].mergeBefore;
  if (lastGlobalIdx + 1 < wordsData.length) {
    const nextW = wordsData[lastGlobalIdx + 1];
    nextW.splitBefore = true; delete nextW.mergeBefore;
  }
  undoStack.push({ type: 'speaker', before, after: serializeSegments() }); redoStack = []; updateUndoButtons();
  renderTranscript(); saveToDB();
}
function doDeleteSelection(firstGlobalIdx, lastGlobalIdx) {
  const before = serializeSegments();

  // Collect which segments are affected and which of their words to remove
  const toDelete = new Set();
  for (let i = firstGlobalIdx; i <= lastGlobalIdx; i++) toDelete.add(i);

  // Remove words from their segments, working backwards so indices stay valid
  for (let si = segments.length - 1; si >= 0; si--) {
    const seg = segments[si];
    seg.words = seg.words.filter(w => {
      const gi = wordsData.findIndex(wd => wd.segIdx === si && wd.wordIdx === w.wordIdx);
      return !toDelete.has(gi);
    });
  }

  // Drop any segments that are now empty
  for (let si = segments.length - 1; si >= 0; si--) {
    if (segments[si].words.length === 0) segments.splice(si, 1);
  }

  rebuildWordsDataRefs();

  undoStack.push({ type: 'speaker', before, after: serializeSegments() });
  redoStack = [];
  updateUndoButtons();
  renderTranscript();
  updateSpeakerStat();
  updateEditCount();
  saveToDB();
  showUndoToast(`Deleted ${lastGlobalIdx - firstGlobalIdx + 1} word${lastGlobalIdx - firstGlobalIdx + 1 > 1 ? 's' : ''}`);
}

// ── Internal helper: position a popover relative to an anchor rect ─
function _positionPopover(pop, anchorRect, side = 'below') {
  const pw = pop.offsetWidth || 200, ph = pop.offsetHeight || 160;
  let left = anchorRect.left, top = anchorRect.bottom + 6;
  if (side === 'below') {
    if (left + pw > window.innerWidth  - 12) left = window.innerWidth - pw - 12;
    if (top  + ph > window.innerHeight - 12) top  = anchorRect.top - ph - 6;
  }
  pop.style.left = left + 'px'; pop.style.top = top + 'px';
}