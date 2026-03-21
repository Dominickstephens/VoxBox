# VoxBox
Vibed together quickly as was just a quick tool to replace Otter.ai's three uploads per life but has some cool features and very usable.
Uses Mistral Voxtral so ty to them.

[Go To Page](https://dominickstephens.github.io/VoxBox/app.html)

## Features

- **Synchronized playback** — transcript highlights word by word as the audio plays, click any word to seek there
- **Speaker diarization** — automatically identifies and colour codes different speakers across the transcript
- **Speaker management** — rename speakers, reassign whole paragraphs, or highlight a selection of text and assign it to a different speaker (handy when two people talk over each other and only one gets picked up)
- **Inline editing** — double-click any word to correct it, edits are underlined so you can see what's changed
- **Find & replace** — Ctrl+F to search across the full transcript, replace one or all instances
- **Undo / redo** — Ctrl+Z / Ctrl+Y, full edit history per session
- **Waveform visualiser** — see the audio waveform above the player, seekable by clicking
- **Session history** — transcriptions are saved locally, reload any past session from the home screen without hitting the API again
- **Audio re-attach** — load a transcript from history then drop the original audio back in to re-enable playback
- **Export** — copy to clipboard, download as plain text, .srt subtitles, or JSON with full timestamps
- **Keyboard shortcuts** — Space play/pause, ←→ seek ±3s, Ctrl+Z/Y undo/redo, Ctrl+F find
- **iOS support** — works from Safari on iPhone and iPad, picks up Voice Memos and other audio formats

## Stack

- Vanilla HTML/CSS/JS, single file, no build step
- [Mistral Voxtral](https://docs.mistral.ai/capabilities/audio_transcription/) for transcription and diarization
- localStorage for session history and autosave
- Web Audio API for waveform rendering

## Usage

1. Get a [Mistral API key](https://console.mistral.ai)
2. Open the page, paste your key in the sidebar
3. Drop an audio file or pick one from your device
4. Wait for transcription (two API calls — one for word timestamps, one for speaker diarization)
5. Edit, export, done

## Notes

- Word-level timestamps and diarization can't run in the same API call (Mistral limitation), so it does two sequential requests — first pass gets the timestamps, second gets the speakers, then they're merged
- Transcripts are stored in your browser's localStorage only, nothing is sent anywhere except to the Mistral API
- Free Mistral tier should cover casual use, heavier use will need a paid key

<img width="1598" height="1044" alt="image" src="https://github.com/user-attachments/assets/6c202424-bddc-46a8-b464-445fb6348eec" />
