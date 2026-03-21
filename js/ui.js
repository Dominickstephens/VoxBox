// ── UI ────────────────────────────────────────────────────────────
// Screen switching, toast notifications, status helpers, and API key
// persistence. No audio or transcript logic here.

// ── Screens ──────────────────────────────────────────────────────
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

// ── Toasts ────────────────────────────────────────────────────────
function showError(msg) {
  const el = document.getElementById('error-toast');
  el.textContent    = msg;
  el.style.display  = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 6000);
}

let _undoToastTimer;
function showUndoToast(msg) {
  const el = document.getElementById('undo-toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_undoToastTimer);
  _undoToastTimer = setTimeout(() => el.classList.remove('show'), 1500);
}

// ── Sidebar stats ─────────────────────────────────────────────────
function updateSpeakerStat() {
  const uniqueSpeakers = new Set(segments.map(s => s.speakerClass)).size;
  document.getElementById('stat-speakers').textContent = uniqueSpeakers;
  document.getElementById('stat-segments').textContent = segments.length;
  document.getElementById('stat-words').textContent    = wordsData.length.toLocaleString();
}

// ── API key persistence ────────────────────────────────────────────
function toggleApiKeyVisibility() {
  const i = document.getElementById('api-key-input');
  i.type  = i.type === 'password' ? 'text' : 'password';
}

document.getElementById('api-key-input').addEventListener('input', async function () {
  const val = this.value.trim();
  try {
    if (val) await dbPut(STORE_PREFS, val, 'apiKey');
    else     await dbDelete(STORE_PREFS, 'apiKey');
  } catch (_) {}
});

// Load saved API key on startup
(async () => {
  try {
    const saved = await dbGet(STORE_PREFS, 'apiKey');
    if (saved) document.getElementById('api-key-input').value = saved;
  } catch (_) {}
})();

// ── Export menu toggle ────────────────────────────────────────────
function toggleExportMenu() {
  document.getElementById('export-menu').classList.toggle('open');
}
// Close export menu when clicking outside it
document.addEventListener('click', e => {
  if (!e.target.closest('#export-wrap'))
    document.getElementById('export-menu').classList.remove('open');
});

// ── No-audio attach banner ─────────────────────────────────────────
let _expectedAudioFilename = null;

function showNoAudioBar(expectedFilename) {
  _expectedAudioFilename = expectedFilename;
  document.getElementById('no-audio-expected').textContent = expectedFilename;
  document.getElementById('no-audio-wrong').style.display  = 'none';
  document.getElementById('no-audio-bar').classList.add('visible');
  document.getElementById('audio-reattach-input').value = '';
}

function hideNoAudioBar() {
  _expectedAudioFilename = null;
  document.getElementById('no-audio-bar').classList.remove('visible');
  document.getElementById('no-audio-wrong').style.display = 'none';
}

function handleReattachAudio(file) {
  if (!file) return;

  function attachFile(f) {
    document.getElementById('no-audio-wrong').style.display = 'none';
    audio.src = URL.createObjectURL(f);
    audio.load();
    f.arrayBuffer()
      .then(buf => new (window.AudioContext || window.webkitAudioContext)().decodeAudioData(buf))
      .then(decoded => drawWaveform(decoded))
      .catch(() => {});
    // Save to IndexedDB so future history loads don't need re-attach
    dbLoadAudio(f.name).then(existing => {
      if (!existing) dbSaveAudio(f.name, f);
    }).catch(() => dbSaveAudio(f.name, f));
    hideNoAudioBar();
    showUndoToast('Audio attached');
  }

  if (file.name !== _expectedAudioFilename) {
    const wrong = document.getElementById('no-audio-wrong');
    wrong.style.display = 'inline';
    wrong.innerHTML = '';
    const msg = document.createTextNode(
      `⚠ Expected "${_expectedAudioFilename}", got "${file.name}" — `
    );
    const overrideBtn = document.createElement('button');
    overrideBtn.textContent = 'Attach anyway';
    overrideBtn.style.cssText =
      'background:none;border:none;color:var(--accent);cursor:pointer;font-size:inherit;padding:0;text-decoration:underline;';
    overrideBtn.onclick = () => attachFile(file);
    wrong.appendChild(msg);
    wrong.appendChild(overrideBtn);
    document.getElementById('audio-reattach-input').value = '';
    return;
  }

  attachFile(file);
}