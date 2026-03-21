// ── Audio ─────────────────────────────────────────────────────────
// Audio playback controls, waveform visualiser, and the rAF sync loop
// that highlights the active word and updates the progress bar.

// ── Player events ─────────────────────────────────────────────────
audio.addEventListener('loadedmetadata', () => {
  document.getElementById('stat-duration').textContent = formatTime(audio.duration);
  document.getElementById('total-time').textContent    = formatTime(audio.duration);
});
audio.addEventListener('ended', () => {
  document.getElementById('play-icon').innerHTML = '<path d="M4 2l10 6-10 6V2z"/>';
});

function togglePlay() {
  if (!audio.src) return;
  if (audio.paused) {
    audio.play();
    document.getElementById('play-icon').innerHTML =
      '<rect x="3" y="2" width="4" height="12" rx="1"/><rect x="9" y="2" width="4" height="12" rx="1"/>';
  } else {
    audio.pause();
    document.getElementById('play-icon').innerHTML = '<path d="M4 2l10 6-10 6V2z"/>';
  }
}

function toggleAutoScroll() {
  autoScroll = !autoScroll;
  document.getElementById('autoscroll-btn').style.color = autoScroll ? 'var(--accent)' : '';
}

function changeSpeed(v)  { audio.playbackRate = parseFloat(v); }
function seekAudio(e)    {
  if (!audio.duration) return;
  const r = e.currentTarget.getBoundingClientRect();
  audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration;
}

// ── Sync loop (rAF) ───────────────────────────────────────────────
function findActiveWord(t) {
  let lo = 0, hi = wordsData.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, w = wordsData[mid];
    if (t < w.start) hi = mid - 1;
    else if (t > w.end) lo = mid + 1;
    else return w;
  }
  return (hi >= 0 && wordsData[hi].start <= t) ? wordsData[hi] : null;
}

function startSync() {
  if (rafId) cancelAnimationFrame(rafId);
  let lastSeekTime = -1, seekWallTime = -1;
  audio.addEventListener('seeking', () => {
    lastSeekTime = audio.currentTime; seekWallTime = performance.now();
  }, { passive: true });

  function tick() {
    let t = audio.currentTime;
    // Smooth over seek lag: hold the seek position for up to 400 ms
    if (seekWallTime > 0 && performance.now() - seekWallTime < 400 && Math.abs(t - lastSeekTime) < 0.05) {
      t = lastSeekTime;
    }
    const dur = audio.duration || 0;
    if (dur > 0) {
      const pct = (t / dur * 100).toFixed(2);
      document.getElementById('progress-fill').style.width    = pct + '%';
      document.getElementById('progress-thumb').style.left    = pct + '%';
      document.getElementById('waveform-playhead').style.left = pct + '%';
    }
    document.getElementById('current-time').textContent  = formatTime(t);
    document.getElementById('status-right').textContent  = formatTime(t);

    const active = findActiveWord(t);
    if (active) {
      const el = document.querySelector(`.word[data-seg-idx="${active.segIdx}"][data-word-idx="${active.wordIdx}"]`);
      if (el && el !== activeWordEl) {
        if (activeWordEl) activeWordEl.classList.remove('active');
        el.classList.add('active'); activeWordEl = el;
        if (autoScroll) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } else {
      if (activeWordEl) { activeWordEl.classList.remove('active'); activeWordEl = null; }
    }
    rafId = requestAnimationFrame(tick);
  }
  rafId = requestAnimationFrame(tick);
}

// ── Waveform ──────────────────────────────────────────────────────
async function drawWaveform(audioBuffer) {
  const wrap   = document.getElementById('waveform-wrap');
  const canvas = document.getElementById('waveform-canvas');
  wrap.style.display = 'block';
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  const H = 40, W = wrap.clientWidth || (window.innerWidth - 240);
  canvas.width  = Math.round(W * devicePixelRatio);
  canvas.height = Math.round(H * devicePixelRatio);
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';

  const ctx       = canvas.getContext('2d'); ctx.scale(devicePixelRatio, devicePixelRatio);
  const raw       = audioBuffer.getChannelData(0);
  const blockSize = Math.max(1, Math.floor(raw.length / W));
  const rms       = new Float32Array(W);
  for (let i = 0; i < W; i++) {
    let sum = 0;
    const s = i * blockSize, e = Math.min(s + blockSize, raw.length);
    for (let j = s; j < e; j++) sum += raw[j] * raw[j];
    rms[i] = Math.sqrt(sum / (e - s));
  }
  const peak = Math.max(...rms, 0.001);
  ctx.fillStyle = '#1a1a1d'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(249,115,22,0.55)';
  for (let i = 0; i < W; i++) {
    const h = Math.max(1, (rms[i] / peak) * H * 0.88);
    ctx.fillRect(i, (H - h) / 2, 1, h);
  }
}

function waveformSeek(e) {
  if (!audio.duration) return;
  const r = e.currentTarget.getBoundingClientRect();
  audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration;
}