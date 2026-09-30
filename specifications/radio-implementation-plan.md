# Baque Radio Implementation Plan

## Implementation Brief

Build a static `/radio/` page for Baque Fácil. Generate a fresh shuffled recording
locally for each listening session and for Shuffle again. Use MP3 at 128 kbps,
with a default duration of approximately 20 minutes, ending on the nearest complete
round of the selected rhythms. The recording loops indefinitely through one native HTML audio element.
Its recorded order repeats until a new mix is generated. Returning to an open
tab or unlocking the phone keeps the current recording and playback position.

This is the agreed browser implementation. All mixing and encoding happen on
the device; only application code, the encoder, and drum samples are downloaded.
The expected 20-minute compressed output is about 19 MB. Build PCM in small
chunks and release it after encoding, keeping memory bounded independently of
recording duration. Do not render or decode the entire mix into an AudioBuffer.

Locked-phone playback is critical: rhythm changes are already in the audio file,
so they continue without page timers or JavaScript playlist transitions. A single
file and native looping support this design, but physical iPhone and Android
checks remain required before claiming verified locked playback. Implementation,
automated verification, commit, and push are authorized while those device checks
are pending.

## Behaviour

- Default to all regular rhythms; allow individual selection and optional combos.
- Default to 90 BPM, using existing bounds of 30–130 BPM.
- Repeat each regular rhythm 8 times; offer 4, 8, and 16 repetitions. Combos
  already contain longer sequences and play once per turn.
- Offer shorter recordings for quicker preparation as well as the 20-minute
  default. Show the actual planned duration and approximate file size, then progress
  during preparation, which can be cancelled.
- Shuffle without replacement, preventing adjacent repeats across bags and at
  the completed recording's loop boundary whenever multiple rhythms are chosen.
- Start only following user interaction. If a browser requires a second Play tap
  after preparation, show that clearly.
- Play/Pause preserves position. Skip seeks to the next recorded rhythm group.
- Stay on this rhythm prepares a short native-looping recording of the current
  pattern, so holding also works while locked; releasing returns to the mix.
- Settings apply when the learner requests a new mix. Keep current playback
  available during preparation; cancellation or failure retains the current mix.
- Shuffle again produces a new recording and releases the previous one after
  installation. Pausing while preparation runs must prevent a late auto-start.
- Show the audible rhythm, progress, and read-only grid from audio.currentTime.
  Refresh on return to the page without changing the audio source.
- Store validated preferences locally, with guarded storage access. Store no
  generated audio in localStorage and never autoplay restored preferences.

## Architecture

1. Load and validate Markdown rhythms in the Astro route using existing helpers.
2. Build a pure frame-based timeline containing complete groups, with boundaries
   and cycle lengths for the playhead, seeking, and tests.
3. Decode only the short instrument samples. Mix bounded PCM chunks with sample
   decays carried across chunk, cycle, and rhythm boundaries. Wrap the final
   decays into the first chunk for a continuous recording loop.
4. Encode chunks with a browser MP3 encoder in a worker. Keep one encoder alive
   for the complete recording and include encoder delay/padding metadata.
5. Play the resulting Blob URL through one HTMLAudioElement with native looping.
   Visible animation updates only the UI. Background playback needs no timer.
6. Terminate workers on cancellation, discard stale results, release sample
   buffers, and revoke obsolete Blob URLs. Add optional media-session metadata
   and native play/pause support.
7. Reuse existing grid/count/hand-preference utilities and visual styles. Keep
   changes to the existing large player and composer narrow.

## Verification

Use the existing Playwright runner for pure timeline/mixer checks and browser
coverage. Verify shuffle rules, whole groups, sample timing/tails, bounded chunk
sizes, actual MP3 encoding/playback, seeking, native file looping, held playback,
pause/cancel races, retry after errors, storage failures, keyboard access, and
mobile layout. Verify the production worker bundle as well as the dev server.

Run npm run build, npm run check:types, and npm run check:layout. Run a real
20-minute generation and record its file size and generation time in the tested
environment; these measurements do not establish phone performance.

Before release, test physical iPhone Safari and Android Chrome:

- Start playback and lock for at least 30 minutes, across native file loops.
- Hear rhythm changes while locked; test held playback and native pause/resume.
- Switch apps and return without interruption or an incorrect current rhythm.
- Exercise Bluetooth, interruptions, and resume behaviour.
- Measure preparation time and memory on a lower-powered phone.
- Listen for gaps, clicks, missing hits, and clipped attacks at all boundaries.

Record observed limits honestly. A simulated hidden document or desktop browser
is supplementary evidence and cannot verify an actual locked phone.

## Implementation verification — 2026-09-30

- Implemented `/radio/` and the home-page entry, with the agreed controls,
  preferences, local MP3 generation, and native looping playback.
- `npm run check:types` and `npm run build` passed. The build produces a static
  site with a separately loaded encoder bundle.
- Ran all 153 Playwright cases across desktop, 500-pixel, and emulated mobile
  Chromium. Two duplicate full-length benchmarks were intentionally skipped.
  All 151 applicable cases passed across the full run and targeted rerun. The
  initial run had two failures during a dev-server restart and one sample-retry
  timeout; all three passed when rerun without source/config changes. The sample
  retry test also passed five further consecutive runs.
- The full-length benchmark generated 1,216 seconds of MP3 in 30.227 seconds:
  19,456,834 bytes, 128 kbps, native looping enabled. Settings were Marcação,
  Imalê, and Martelo at 90 BPM, eight repetitions, approximately 20 minutes.
  This is a cloud Chromium measurement, not a phone performance measurement.
- Production preview verification covered the home link, mobile layout, actual
  worker encoding, playback with long combos, Pause, Skip, and Stay while paused.
  No browser errors or horizontal page overflow were observed.
- Physical iPhone and Android locking, audible loop quality, interruptions,
  Bluetooth, and phone memory/preparation measurements remain pending release checks.
