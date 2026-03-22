// ── Vocabulary sidebar ────────────────────────────────────────────
// Renders and manages the context-bias vocab list in the sidebar.
// Terms are persisted in IndexedDB (STORE_VOCAB) via db.js helpers.

async function renderVocabTags() {
  const terms    = await vocabGetTerms();
  const container = document.getElementById('vocab-tags');
  container.innerHTML = '';

  if (!terms.length) {
    const empty = document.createElement('div');
    empty.className   = 'vocab-empty';
    empty.textContent = 'No terms yet';
    container.appendChild(empty);
    return;
  }

  terms.forEach(term => {
    const tag = document.createElement('div');
    tag.className = 'vocab-tag';

    const label = document.createElement('span');
    label.textContent = term;

    const removeBtn = document.createElement('button');
    removeBtn.className   = 'vocab-tag-remove';
    removeBtn.title       = 'Remove';
    removeBtn.textContent = '×';
    removeBtn.onclick     = async () => {
      await vocabRemoveTerm(term);
      renderVocabTags();
    };

    tag.appendChild(label);
    tag.appendChild(removeBtn);
    container.appendChild(tag);
  });
}

async function vocabAddFromInput() {
  const input = document.getElementById('vocab-input');
  const raw   = input.value.trim();
  if (!raw) return;

  // Support comma-separated batch entry
  const terms = raw.split(',').map(t => t.trim()).filter(Boolean);
  await vocabAddTerms(terms);
  input.value = '';
  renderVocabTags();
}

// ── Wire up events (called from init.js DOMContentLoaded) ─────────
function initVocab() {
  document.getElementById('vocab-add-btn').addEventListener('click', vocabAddFromInput);

  document.getElementById('vocab-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); vocabAddFromInput(); }
  });

  document.getElementById('vocab-clear-btn').addEventListener('click', async () => {
    await vocabClear();
    renderVocabTags();
  });

  // Initial render
  renderVocabTags();
}