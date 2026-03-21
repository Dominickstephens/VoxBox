// ── Keyboard shortcuts ────────────────────────────────────────────
// All global hotkeys in one place so they're easy to audit / extend.

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