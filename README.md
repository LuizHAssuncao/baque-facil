# Baque Fácil

Baque Fácil is an Astro app for learning, practicing and composing Maracatu
rhythm patterns. It combines Markdown-authored rhythm lessons with interactive
React rhythm grids, audio playback, and an Alfaia composer.

## Features

- Rhythm index with separate practice rhythm and combo sections.
- Generated rhythm pages from Markdown content in `src/content/rhythms/`.
- Editable rhythm player with tempo control, looping, mute controls, restart,
  keyboard support, and iOS audio help.
- Alfaia composer with recording controls, metronome, transcription editing, and
  an embedded preview player.
- Left-handed display preference stored locally without changing the underlying
  rhythm notation.

## Tech Stack

- [Astro](https://astro.build/) for routing, static generation, and content
  collections.
- [React](https://react.dev/) islands for the rhythm player and composer.
- [Tone.js](https://tonejs.github.io/) for player scheduling and sample playback.
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
