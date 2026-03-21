// ── API ───────────────────────────────────────────────────────────
// Mistral Voxtral API calls, transcription orchestration, and demo mode.

// ── Drop zone drag events (click/change wired in init.js) ────────
document.addEventListener('DOMContentLoaded', () => {
  const dropZone = document.getElementById('drop-zone');
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const f = e.dataTransfer.files[0];
    if (f && (f.type.startsWith('audio/') || f.type.startsWith('video/') || f.name.match(/\.(mp3|wav|m4a|aac|flac|ogg|mp4|mov)$/i))) {
      handleFileSelect(f);
    } else {
      showError('Please drop an audio file (MP3, WAV, M4A, etc.)');
    }
  });
});

function handleFileSelect(file) {
  if (!file) return;
  const key = document.getElementById('api-key-input').value.trim();
  if (!key) { showError('Please enter your Mistral API key in the sidebar first.'); return; }
  if (key === 'demo') { loadDemoData(file); return; }
  startTranscription(file, key);
}

// ── Raw API call ──────────────────────────────────────────────────
async function apiCall(file, apiKey, params) {
  const fd = new FormData();
  fd.append('file', file, file.name);
  fd.append('model', 'voxtral-mini-latest');
  for (const [k, v] of Object.entries(params)) fd.append(k, v);

  const res = await fetch('https://api.mistral.ai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: fd,
  });

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = (typeof j.message === 'string') ? j.message : (j.error?.message || JSON.stringify(j, null, 2));
    } catch (_) {}
    throw new Error(msg);
  }
  return res.json();
}

// ── Transcription orchestration ───────────────────────────────────
// Two sequential calls: word timestamps first, then speaker diarization.
async function startTranscription(file, apiKey) {
  showScreen('processing');
  document.getElementById('processing-filename').textContent = file.name;
  document.getElementById('processing-label').textContent    = 'Transcribing audio… (1/2)';

  audio.src = URL.createObjectURL(file);
  audio.load();
  file.arrayBuffer()
    .then(buf => new (window.AudioContext || window.webkitAudioContext)().decodeAudioData(buf))
    .then(drawWaveform)
    .catch(() => {});

  // Persist audio blob so it auto-loads when reopened from history
  dbSaveAudio(file.name, file);

  try {
    const wordData = await apiCall(file, apiKey, { timestamp_granularities: 'word' });
    document.getElementById('processing-label').textContent = 'Identifying speakers… (2/2)';

    let diarData = null;
    try {
      diarData = await apiCall(file, apiKey, { timestamp_granularities: 'segment', diarize: 'true' });
    } catch (e) {
      console.warn('Diarization failed:', e.message);
    }

    processTranscription(wordData, diarData, file.name);
  } catch (err) {
    showScreen('upload');
    renderHistory();
    showError('Transcription failed: ' + err.message);
  }
}

// ── Demo mode ─────────────────────────────────────────────────────
function loadDemoData(file) {
  const demo = [
    { spk: '0', sc: 0, w: [
      {word:'Good',start:0.0,end:0.3},{word:'morning',start:0.35,end:0.7},
      {word:'everyone,',start:0.75,end:1.1},{word:"today",start:1.2,end:1.5},
      {word:"we're",start:1.55,end:1.8},{word:'going',start:1.85,end:2.0},
      {word:'to',start:2.05,end:2.15},{word:'talk',start:2.2,end:2.45},
      {word:'about',start:2.5,end:2.75},{word:'Voxtral.',start:2.8,end:3.4},
    ]},
    { spk: '1', sc: 1, w: [
      {word:'That',start:4.0,end:4.2},{word:'sounds',start:4.25,end:4.55},
      {word:'fascinating.',start:4.6,end:5.1},{word:'Tell',start:5.2,end:5.35},
      {word:'me',start:5.4,end:5.5},{word:'more.',start:5.55,end:5.9},
    ]},
    { spk: '0', sc: 0, w: [
      {word:'Every',start:6.5,end:6.75},{word:'word',start:6.8,end:7.0},
      {word:'gets',start:7.05,end:7.25},{word:'its',start:7.3,end:7.45},
      {word:'own',start:7.5,end:7.7},{word:'timestamp.',start:7.75,end:8.3},
    ]},
  ];

  segments = []; wordsData = []; speakerNames = {};
  demo.forEach((seg, si) => {
    const words = seg.w.map((w, wi) => ({
      word: w.word, start: w.start, end: w.end,
      segIdx: si, wordIdx: wi, edited: false, originalWord: w.word,
    }));
    segments.push({ speaker: seg.spk, speakerClass: seg.sc, start: seg.w[0].start, words });
    wordsData.push(...words);
  });

  if (file) {
    audio.src = URL.createObjectURL(file); audio.load();
    file.arrayBuffer()
      .then(buf => new (window.AudioContext || window.webkitAudioContext)().decodeAudioData(buf))
      .then(drawWaveform)
      .catch(() => {});
    dbSaveAudio(file.name, file);
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