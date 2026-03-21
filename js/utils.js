// ── Utils ─────────────────────────────────────────────────────────
// Pure helpers with no side-effects and no dependencies on other modules.

function formatTime(s) {
  if (s == null || isNaN(s)) return '—';
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

function escHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function toSrtTime(s) {
  const h   = Math.floor(s / 3600).toString().padStart(2, '0');
  const m   = Math.floor((s % 3600) / 60).toString().padStart(2, '0');
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  const ms  = Math.round((s % 1) * 1000).toString().padStart(3, '0');
  return `${h}:${m}:${sec},${ms}`;
}

function download(name, content, type) {
  const a = document.createElement('a');
  a.href  = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
}

function getSpeakerDotColor(sc) {
  return ['#f97316', '#22c55e', '#a78bfa', '#38bdf8', '#f472b6'][sc % 5];
}