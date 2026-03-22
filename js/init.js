// ── Init ──────────────────────────────────────────────────────────
// Runs last (after all modules are loaded via defer).
// Attaches every DOM event listener so no module depends on inline
// HTML attributes and no "X is not defined" errors can occur.

document.addEventListener('DOMContentLoaded', () => {

  // ── Navigation ─────────────────────────────────────────────────
  document.getElementById('logo-link').addEventListener('click', e => { e.preventDefault(); goBack(); });
  document.getElementById('back-btn').addEventListener('click', goBack);

  // ── API key ────────────────────────────────────────────────────
  document.getElementById('api-key-toggle').addEventListener('click', toggleApiKeyVisibility);

  // ── File input / drop zone ─────────────────────────────────────
  document.getElementById('drop-zone').addEventListener('click', () => document.getElementById('file-input').click());
  document.getElementById('file-input').addEventListener('change', e => handleFileSelect(e.target.files[0]));

  // ── No-audio re-attach ─────────────────────────────────────────
  document.getElementById('no-audio-attach-btn').addEventListener('click', () => document.getElementById('audio-reattach-input').click());
  document.getElementById('audio-reattach-input').addEventListener('change', e => handleReattachAudio(e.target.files[0]));

  // ── Waveform seek ──────────────────────────────────────────────
  document.getElementById('waveform-wrap').addEventListener('click', waveformSeek);

  // ── Player controls ────────────────────────────────────────────
  document.getElementById('play-btn').addEventListener('click', togglePlay);
  document.getElementById('progress-track').addEventListener('click', seekAudio);
  document.getElementById('speed-select').addEventListener('change', e => changeSpeed(e.target.value));

  // ── Export menu ────────────────────────────────────────────────
  document.getElementById('export-btn').addEventListener('click', toggleExportMenu);
  document.getElementById('export-txt').addEventListener('click', exportTxt);
  document.getElementById('export-srt').addEventListener('click', exportSrt);
  document.getElementById('export-json').addEventListener('click', exportJson);

  // ── Transcript toolbar ─────────────────────────────────────────
  document.getElementById('autoscroll-btn').addEventListener('click', toggleAutoScroll);
  document.getElementById('undo-btn').addEventListener('click', undo);
  document.getElementById('redo-btn').addEventListener('click', redo);
  document.getElementById('find-open-btn').addEventListener('click', openFindBar);
  document.getElementById('reset-edits-btn').addEventListener('click', resetEdits);
  document.getElementById('copy-btn').addEventListener('click', copyTranscript);

  // ── Find & replace bar ─────────────────────────────────────────
  document.getElementById('find-input').addEventListener('input', onFindInput);
  document.getElementById('find-input').addEventListener('keydown', onFindKey);
  document.getElementById('replace-input').addEventListener('keydown', onReplaceKey);
  document.getElementById('find-prev').addEventListener('click', () => findNav(-1));
  document.getElementById('find-next').addEventListener('click', () => findNav(1));
  document.getElementById('replace-one-btn').addEventListener('click', replaceOne);
  document.getElementById('replace-all-btn').addEventListener('click', replaceAll);
  document.getElementById('find-close-btn').addEventListener('click', closeFindBar);

  // ── History ────────────────────────────────────────────────────
  document.getElementById('clear-history-btn').addEventListener('click', clearAllHistory);

  // ── Boot ───────────────────────────────────────────────────────
  initVocab();
  showScreen('upload');
});