# MP3 Download Implementation Plan

Add MP3 downloads to every rhythm and combo page, the composer, and the radio mix. Generate files in the browser using the existing sample and MP3 infrastructure. The implementation follows this plan, with a Save MP3 button and an optional native Share MP3 action. Physical-device verification remains pending.

## Proposed download behavior

The following defaults were adopted for the implementation.

| Location | Download contents | Proposed default |
| --- | --- | --- |
| Rhythm page | Current rhythm at the selected tempo, respecting muted tracks | 8 complete repetitions |
| Combo page | Entire combo sequence at the selected tempo, respecting muted tracks | 1 complete pass |
| Composer | Current valid edited pattern, including all audible tracks and current tempo | 1 complete pass |
| Radio | Exact full prepared mix, with its existing shuffle order, tempo, repetitions, and duration | Existing MP3, without regeneration |

For rhythms, combos, and the composer, offer 1, 4, 8, or 16 repetitions in a small export panel. One combo repetition means its entire written sequence. Show the resulting duration before preparation and the actual file size when ready. Export from the beginning regardless of the current playhead. The player's Loop toggle does not make the download infinite.

Pattern exports are finite recordings: start with the first written hit, preserve sample decay between repetitions, and include the final natural decay. Do not wrap the last hit into the beginning. Radio downloads preserve the existing mix's loop treatment and gapless metadata exactly; gapless repeat behavior in external players depends on the player.

Exports include the selected drum tracks only. Composer metronome, count-in, and incidental live input are excluded. Left-handed display preferences do not change audio. Disable preparation for invalid transcription, empty or entirely silent audible patterns, and while composer recording or count-in is active. Show the reason next to the action.

## Existing implementation to reuse

- `src/components/RhythmPlayer.tsx` is shared by rhythm pages, combo pages, and composer previews. It owns tempo and mute state, making it the common integration point.
- `src/components/RhythmComposer.tsx` owns transcription validation and recording state. It must pass export availability to the preview so an invalid edit cannot silently export an older valid pattern.
- `src/lib/radio/generateMix.ts` loads samples and lazily imports the encoder. `encodeMix.ts` already produces stereo MP3 at 44.1 kHz and 128 kbps using pinned Mediabunny dependencies, bounded PCM chunks, progress, cancellation, and gapless metadata.
- `src/lib/radio/mixer.ts` currently wraps sample tails around the recording boundary. Finite pattern exports need explicit non-wrapping behavior.
- `src/lib/radio/playback.ts` keeps separate full-mix and held-pattern recordings as object URLs. The radio download must select the full mix, even while “Stay on this rhythm” is active.
- `src/lib/audio/renderRhythm.ts` supplies useful timing and tail-handling reference behavior, but rendering a long repeated export into one AudioBuffer would unnecessarily increase memory use.

## User interface

Add a visible “Download MP3” action beside the player controls. It opens an inline panel with repetitions, tempo summary, duration, and “Prepare MP3.” Preparation shows progress and Cancel; completion shows a “Save MP3” link. Keeping saving as a separate user gesture avoids depending on automatic downloads after asynchronous encoding on mobile browsers. Keep the prepared file available for retrying Save.

Use one shared export component and hook for all pattern players. Allow only one preparation per component. Snapshot tracks, subdivision, tempo, mutes, title, and repetitions when preparation starts. Later edits cannot change the in-flight file. Label the result with the captured settings and identify when the current pattern has changed so users can prepare an updated file.

On radio, use “Download mix MP3” and save the already prepared full mix directly. Before the first mix exists, disable the action with “Prepare a mix first.” Pending settings do not affect the downloadable file. While a replacement mix is preparing, keep the previous completed mix downloadable and identify it as the current prepared mix. A failed or cancelled replacement retains that download.

Use readable, sanitized filenames such as `marcacao-90bpm-8x.mp3`, `combo-entrada-90bpm-1x.mp3`, and `baque-facil-radio-90bpm-2026-09-30.mp3`. Derive names and duration from the captured export or prepared recording, never from unapplied settings. Provide a fallback name for untitled compositions.

All visible text, accessible names, progress messages, and errors must support `en-CA` and `pt-BR`. Controls must work with keyboard and touch, keep focus predictable, announce progress without excessive announcements, and fit narrow screens. Saving must not start, pause, seek, or restart playback.

## Technical implementation

1. Extract the reusable chunk-to-MP3 encoding portion into a shared audio export module. Preserve radio's existing bitrate, sample rate, whole-recording attenuation, cancellation, worker encoding, and gapless metadata behavior. Keep encoder imports lazy and retain the pinned dependencies. Use general export error messages with translations.
2. Add a pure pattern export planner that validates tracks, tempo, subdivision, repetitions, audible hits, and sample mappings. Compute integer frame positions using the same cycle rounding as current playback. Schedule the exact written sequence for each repetition without radio shuffling or combo heuristics. Apply mutes before collecting samples or hits.
3. Extend or extract the bounded mixer with explicit finite and wrapped boundary modes. Preserve wrapped mode for radio. For finite exports, calculate the output length as the later of the musical end or the last sample's end; do not add silent padding beyond that. Reuse `SampleCache` and cancellation-aware sample loading. Keep PCM chunks bounded and release sample references after completion or cancellation.
4. Reuse peak analysis over the full export so one attenuation gain prevents clipping without changing sample pitch or pumping between chunks. Feed PCM into the shared encoder and write gapless metadata using the actual output frame count, including final decay.
5. Add a shared export hook and panel, for example `src/lib/audio/exportMp3.ts`, `src/lib/audio/useMp3Export.ts`, and `src/components/Mp3ExportControl.tsx`. Model idle, preparing, ready, cancelled, and failed states; guard against late completion after cancellation, replacement, or unmount. Keep export errors separate from playback errors.
6. Integrate the control into `RhythmPlayer.tsx`. Pass explicit combo defaults from the rhythm route rather than inferring them from translated display text. Pass composer validation and recording availability through narrow props from `RhythmComposer.tsx`; obtain tempo and mutes from the same player state used by preview.
7. Expose a read-only full-mix download descriptor from `RadioPlayback` through its hook. Include filename inputs, actual duration, size, and a stable recording identity. Retain a Blob reference alongside the existing playback URL if needed to create an independent temporary download URL; this does not require copying the encoded bytes. Do not use the active audio element's `src`, which can refer to a held pattern.
8. Centralize file saving and object-URL cleanup. Never revoke a playback URL from the download helper. Release export URLs on replacement/unmount and download URLs only after a browser-safe handoff. Test saving while a radio replacement completes. Keep only the current prepared pattern export and recordings needed by existing radio behavior.

Proposed limits: retain the existing maximum 180-second pattern cycle, cap pattern exports at 20 minutes including sample decay, and reject oversized requests before encoding. Recheck exact duration after samples are decoded. Radio downloads use the already accepted full recording, whose duration can differ from its requested minutes because radio finishes complete rounds. Compressed MP3 bytes still grow with duration even though PCM memory stays bounded; 20 minutes at 128 kbps is roughly 19.2 MB.

## Implementation order

1. Expose and download the existing radio mix, including held-pattern and pending-settings cases.
2. Extract shared encoding and add finite pattern planning/mixing, preserving radio behavior.
3. Add the shared export panel to rhythm and combo pages.
4. Enable composer export with validation, recording guards, and captured edit state.
5. Complete both languages, responsive styling, lifecycle cleanup, and browser verification.

Each step should leave existing playback functional. No server, storage service, new MP3 dependency, or change to Markdown rhythm content is required. Catalog-card shortcuts, bulk downloads, other audio formats, and embedded ID3 artwork are outside this first version.

## Verification and acceptance criteria

- Test deterministic frame positions, repetition counts, subdivisions, mute filtering, unequal or empty tracks, silent exports, duration limits, and finite sample decay. Verify that finite output has no wrapped hit at the start and radio still wraps correctly.
- Encode and decode a real exported MP3 to verify format, duration within encoder tolerance, audible content, and lack of clipping. Keep the existing radio MP3 timing round-trip test passing.
- Add Playwright download coverage for one rhythm, one combo, a fresh composition, and a customized rhythm. Check filename, MIME type, nonempty bytes, and the captured tempo/mute/edit settings. Confirm representative remaining pages receive the shared control.
- Verify radio download bytes match the prepared MP3 without invoking generation again. Exercise held playback, pending settings, successful replacement, cancellation, and failed replacement.
- Exercise pattern cancellation, failure/retry, edits during preparation, repeated saving, unmount, and stale completion. Invalid composer transcription must block export even if the preview still shows a previous valid pattern.
- Check keyboard access, progress/error announcements, both languages, and mobile layout without body overflow. Confirm downloads leave playback state and position intact.
- Run `npm run build`, `npm run check:types`, and relevant Playwright audio/radio tests plus `npm run check:layout`. Distinguish any existing failures from regressions.
- Manually listen to downloaded rhythm, combo, composer, and radio files. Verify local saving and reopening in desktop Chrome, Firefox, Safari, physical iPhone Safari, and Android Chrome. If mobile browsers open media instead of saving directly, provide a tested explicit save/share fallback. Do not claim physical-device support from emulation alone.

The feature is complete when all four surfaces produce playable MP3 files with the documented contents, progress and recovery work, radio downloads preserve the prepared mix, and existing playback remains unchanged.
