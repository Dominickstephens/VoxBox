// ── Speakers ──────────────────────────────────────────────────────
// Speaker popover (rename / reassign whole paragraph), text-selection
// context menu (assign selection / split into paragraph), and merge-up
// popover. Also handles the split/merge paragraph operations.

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
  closeMergePopover();
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
    <div class="sel-menu-header">Assign selection to speaker</div>
    <div class="sel-menu-info">${wordCount} word${wordCount > 1 ? 's' : ''} · ${timeRange}</div>
  `;

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

// ── Merge-up popover (single-click on word in non-first paragraph) ─
let mergePopover    = null;
let _mergePendingCtx = null;

function closeMergePopover() {
  if (mergePopover) { mergePopover.remove(); mergePopover = null; }
  _mergePendingCtx = null;
}

function showMergePopover(ev, clickedGlobalIdx, paraFirstWordIdx, paraLastWordIdx, paraIdx) {
  closeMergePopover();
  ev.stopPropagation();

  const wordsToMerge = clickedGlobalIdx - paraFirstWordIdx + 1;
  const totalInPara  = paraLastWordIdx - paraFirstWordIdx + 1;
  const isAll        = wordsToMerge === totalInPara;
  _mergePendingCtx   = { clickedGlobalIdx, paraFirstWordIdx, paraLastWordIdx, wordsToMerge, isAll };

  const pop = document.createElement('div'); pop.className = 'merge-popover';
  pop.onclick = e => e.stopPropagation();

  const label = isAll
    ? `Merge all ${wordsToMerge} word${wordsToMerge > 1 ? 's' : ''} into previous paragraph`
    : `Merge first ${wordsToMerge} word${wordsToMerge > 1 ? 's' : ''} into previous paragraph`;

  pop.innerHTML = `
    <div class="merge-pop-label">
      <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" style="flex-shrink:0;color:var(--green)"><path d="M8 12V4M4 7l4-4 4 4"/></svg>
      <span>${label}</span>
    </div>
    <div class="merge-pop-preview"></div>
  `;

  const preview = pop.querySelector('.merge-pop-preview');
  const movers  = wordsData.slice(paraFirstWordIdx, clickedGlobalIdx + 1).map(w => w.word).join(' ');
  preview.textContent = `"${movers.length > 60 ? movers.slice(0, 57) + '…' : movers}"`;

  const confirmBtn = document.createElement('button'); confirmBtn.className = 'merge-pop-confirm';
  confirmBtn.innerHTML = `<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 8l4 4 8-8"/></svg> Merge ↑`;
  confirmBtn.onclick   = () => { doMergeUp(_mergePendingCtx); closeMergePopover(); };

  const cancelBtn = document.createElement('button'); cancelBtn.className = 'merge-pop-cancel';
  cancelBtn.textContent = 'Cancel'; cancelBtn.onclick = closeMergePopover;

  const actions = document.createElement('div'); actions.className = 'merge-pop-actions';
  actions.appendChild(confirmBtn); actions.appendChild(cancelBtn); pop.appendChild(actions);

  document.body.appendChild(pop); mergePopover = pop;

  const mw = pop.offsetWidth || 260, mh = pop.offsetHeight || 110;
  let left = ev.clientX + 10, top = ev.clientY + 10;
  if (left + mw > window.innerWidth  - 12) left = ev.clientX - mw - 8;
  if (top  + mh > window.innerHeight - 12) top  = ev.clientY - mh - 8;
  pop.style.left = left + 'px'; pop.style.top = top + 'px';
}

document.addEventListener('mousedown', e => {
  if (mergePopover && !mergePopover.contains(e.target)) closeMergePopover();
});

// ── Split / Merge operations ──────────────────────────────────────
function doMergeUp({ clickedGlobalIdx, paraFirstWordIdx, paraLastWordIdx, isAll }) {
  const before = serializeSegments();
  if (isAll) {
    const w = wordsData[paraFirstWordIdx]; w.mergeBefore = true; delete w.splitBefore;
  } else {
    const firstW = wordsData[paraFirstWordIdx]; firstW.mergeBefore = true; delete firstW.splitBefore;
    const tailW  = wordsData[clickedGlobalIdx + 1];
    if (tailW) { tailW.splitBefore = true; delete tailW.mergeBefore; }
  }
  undoStack.push({ type: 'speaker', before, after: serializeSegments() }); redoStack = []; updateUndoButtons();
  renderTranscript(); saveToDB();
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