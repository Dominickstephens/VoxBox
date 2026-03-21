// ── State ─────────────────────────────────────────────────────────
// Central mutable state shared across all modules.
// Modules mutate these directly; no pub/sub needed at this scale.

let wordsData    = [];   // [{word,start,end,segIdx,wordIdx,edited,originalWord}]
let segments     = [];   // [{speaker,speakerClass,start,words}]
let speakerNames = {};   // {speakerClass -> label}
let autoScroll   = true;
let rafId        = null;
let activeWordEl = null;
let undoStack    = [];
let redoStack    = [];
let findMatches  = [];
let findIndex    = 0;

const MAX_HISTORY = 12;
const audio       = document.getElementById('audio-player');