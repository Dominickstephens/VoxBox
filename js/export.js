// ── Export ────────────────────────────────────────────────────────
// Copy to clipboard, plain-text download, SRT subtitles, JSON export.

function getTranscriptText() {
  return Array.from(document.getElementById('transcript-body').querySelectorAll('.segment'))
    .map(block => {
      const speaker = block.querySelector('.speaker-badge')?.innerText?.trim() || 'SPEAKER 1';
      const time    = block.querySelector('.seg-time')?.innerText?.trim() || '';
      const text    = block.querySelector('.segment-text')?.innerText?.replace(/\s+/g, ' ').trim() || '';
      return `${speaker}  ${time}\n${text}`;
    })
    .join('\n\n');
}

function copyTranscript() {
  const output = getTranscriptText();
  function flash() {
    const btn  = document.getElementById('copy-btn');
    const orig = btn.innerHTML;
    btn.innerHTML   = `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 8l4 4 8-8"/></svg> Copied!`;
    btn.style.color = 'var(--green)'; btn.style.borderColor = 'var(--green)';
    setTimeout(() => { btn.innerHTML = orig; btn.style.color = ''; btn.style.borderColor = ''; }, 2000);
  }
  navigator.clipboard.writeText(output).then(flash).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = output; ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); flash();
  });
}

function exportTxt() {
  download('transcript.txt', getTranscriptText(), 'text/plain');
  document.getElementById('export-menu').classList.remove('open');
}

function exportSrt() {
  let idx = 1, srt = '';
  segments.forEach(seg => {
    for (let i = 0; i < seg.words.length; i += 10) {
      const chunk = seg.words.slice(i, i + 10);
      srt += `${idx++}\n${toSrtTime(chunk[0].start)} --> ${toSrtTime(chunk[chunk.length - 1].end)}\n${chunk.map(w => w.word).join(' ')}\n\n`;
    }
  });
  download('transcript.srt', srt, 'text/plain');
  document.getElementById('export-menu').classList.remove('open');
}

function exportJson() {
  const data = segments.map(seg => ({
    speaker: seg.speaker,
    start:   seg.start,
    words:   seg.words.map(w => ({ word: w.word, start: w.start, end: w.end, edited: w.edited })),
  }));
  download('transcript.json', JSON.stringify(data, null, 2), 'application/json');
  document.getElementById('export-menu').classList.remove('open');
}