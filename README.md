# Baque Fácil

![Baque Fácil hero image](public/alfaia-editorial-hero.png)

Baque Fácil is an Astro app for learning, practicing and composing Maracatu
rhythm patterns. It combines Markdown-authored rhythm lessons with interactive
React rhythm grids, audio playback, and an Alfaia composer.

## Features

- Rhythm index with separate practice rhythm and combo sections.
- Generated rhythm pages from Markdown content in `src/content/rhythms/`.
- A listening quiz at `/quiz/`: match a rhythm name to one of three audio options,
  with unlimited replay and practice, no notation, and no scoring.
- Fixed-note rhythm player with tempo control, looping, mute controls, restart,
  keyboard support, and background media playback. The composer preview remains editable.
- Alfaia composer with recording controls, metronome, transcription editing, and
  an embedded preview player.
- Left-handed display preference stored locally without changing the underlying
  rhythm notation.

## Tech Stack

- [Astro](https://astro.build/) for routing, static generation, and content
  collections.
- [React](https://react.dev/) islands for the rhythm player and composer.
- Offline rendering and native Web Audio buffer looping for rhythm-page playback.
- [Tone.js](https://tonejs.github.io/) for the composer's editable preview.
- Web Audio and HTML audio fallbacks for composer hit input.
- [Playwright](https://playwright.dev/) for layout and interaction checks.

## Getting Started

Install dependencies:

```sh
npm install
```

Start the development server:

```sh
npm run dev
```

For Playwright-compatible local development, run the fixed-host server:

```sh
npm run dev:local
```

That serves the app at `http://127.0.0.1:4323`.

## Scripts

```sh
npm run dev          # Start Astro's development server
npm run dev:local    # Start Astro on http://127.0.0.1:4323
npm run build        # Build the production site
npm run preview      # Preview the production build
npm run check:layout # Run Playwright layout and interaction checks
npm run check:types  # Check TypeScript
```

## Project Structure

```text
src/pages/              Astro routes
src/components/         Shared UI, RhythmPlayer, and RhythmComposer
src/lib/                Rhythm parsing, validation, samples, layout, and helpers
src/content/rhythms/    Markdown rhythm lessons
src/content/config.ts   Rhythm frontmatter schema
src/styles/global.css   Global application styles
public/                 Static images and audio samples
tests/layout.spec.ts    Playwright smoke and interaction tests
```

## Rhythm Content

Rhythms are Markdown files in `src/content/rhythms/`. Each file needs validated
frontmatter:

```yaml
---
title: "1 - Marcação"
tempo: 90
subdivision: 16
difficulty: "beginner"
instruments:
  - "Alfaia"
---
```

The rhythm itself goes in a fenced `rhythm` block:

````text
```rhythm
Gongue:
. X . . | X . X .

Alfaia:
. . L R | . . R .
```
````

Notation rules:

- Track headers end with `:`.
- Tokens are separated by whitespace.
- Bar separators (`|`) are ignored.
- Rests use `.`; `-` is normalized to `.`.
- All tracks in a rhythm must have the same number of steps.
- Playable symbols must exist in `src/lib/sampleMap.ts`.

A few example of sample keys are:

- `Alfaia.L`
- `Alfaia.R`
- `Gongue.X`
- `Gongue.x`

When adding a new instrument or symbol, add the sample under `public/samples/`,
update `src/lib/sampleMap.ts` and verify a rhythm page that uses it.

The quiz pool comes directly from the rhythm collection via `/quiz/rhythms.json`.
Adding a valid, audible rhythm to `src/content/rhythms/` includes it automatically
in the next site build; there is no separate quiz list or opt-in flag. The quiz
fetches the pool again for every round, so open sessions pick up a newly deployed
library. As with the rest of this static Astro site, production content changes
require the normal build and deployment. Invalid or silent patterns are excluded,
and each round needs three distinct sounds. All options use the existing drum
samples at 90 BPM, with anonymous media controls and no automatic playback.

## Verification

Use the production build as the minimum check:

```sh
npm run build
```

Run layout checks for visible UI, player, composer, keyboard or responsive
layout changes:

```sh
npm run check:layout
```

For audio changes, also manually exercise playback, restart, loop, mute/unmute,
tempo changes, composer hit buttons, keyboard shortcuts, transcription parsing,
and the iOS audio help flow when relevant.

## Background rhythm playback

Rhythm pages keep Markdown as their source and render the current tempo and mute
selection into an AudioBuffer on the device. A native AudioBufferSourceNode repeats
one complete cycle, including wrapped sample tails. There is no media-file restart
or JavaScript timer between repetitions. One-shot audio includes the final decay.
Rendered buffers are not uploaded or persisted. Mixes are attenuated if needed to
avoid clipping. Playback requests `navigator.audioSession.type = "playback"` where
supported, using the mechanism tested with the diagnostic on iPhone Safari.

Tempo/mute updates are debounced and rendered serially, retaining the instruments'
original pitch. Playback continues while the new buffer prepares. The new buffer
starts at the next rhythm boundary, with a five-millisecond crossfade scheduled on
the audio clock. A scheduled change completes even if the page becomes hidden;
changes still preparing in the background wait until the page returns. At most two
sources coexist during a transition; the muted old source is released on return.
Obsolete changes and stopped sources are canceled so Stop never restarts playback.

Play resumes an interrupted context from a user gesture. Stop resets the rhythm,
while supported media-session Pause/Play controls preserve its position. Navigation
stops playback, and disposal releases sources, buffers, and the AudioContext. The
composer still uses live audio and requires the page to remain visible.

Playwright covers audio rendering and browser controls, but cannot establish iOS
background playback reliability. Before releasing, test on a physical iPhone:

1. Play a short rhythm, switch apps, and lock the screen for at least 15 minutes.
2. Listen across several rhythm-loop boundaries for gaps or missing hits.
3. Change tempo between 30 and 130 BPM, including rapid changes and a long combo.
4. Lock during a pending change; confirm playback continues through the transition.
5. Exercise mute, Stop, Restart, one-shot playback, and lock-screen play/pause.
6. Test interruption/resume and Bluetooth route changes.

To use an installed Chromium for local tests, set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chromium` when running
`npm run check:layout`.

### Isolated background-audio diagnostic

Open `/diagnostics/background-audio/` to test a native looping Web Audio buffer
without changing the rhythm player. It synthesizes four evenly spaced clicks
(beat one is higher), loops a two-second buffer at 120 BPM, and requests
`navigator.audioSession.type = "playback"` when available. No JavaScript timer,
silent media element, or automatic visibility-resume keeps the sound going.
The test's tempo slider changes the buffer playback rate, including click pitch;
this is a diagnostic, not the production tempo implementation.

On physical iPhone Safari, start the beat, listen while switching apps for at
least one minute, then lock the screen for at least two minutes. Repeat after
changing tempo. Record whether there were gaps or silence, then copy the report.
State changes, visibility events, and wall/audio clock comparisons are logged
locally in session storage so a browser reload is visible. Clock progress is
only supporting evidence, not proof of audible playback. Navigation stops the
test, and returning never automatically resumes it. Desktop automation cannot
verify iOS lock-screen playback.
