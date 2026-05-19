# Repository Guidelines

## Project Overview

Baque Fácil is an Astro 4 app for learning and composing Maracatu rhythm
patterns. Astro owns routing, content loading, and static page generation.
React islands provide the interactive rhythm player and composer. Audio playback
uses Tone.js in the player and Web Audio/HTML audio fallbacks in the composer.

Core user flows:

- `/`: rhythm index, combo grouping, composer link, left-handed display setting.
- `/rhythms/[slug]/`: generated from Markdown rhythm entries and rendered with
  an editable `RhythmPlayer`.
- `/compose/`: `RhythmComposer`, with recording, metronome, transcription
  editing, and an embedded preview player.
- `/help/ios-audio/`: troubleshooting page linked from iOS audio prompts.

## Project Structure

- `src/pages/`: Astro routes. Import `src/styles/global.css` in page files.
- `src/components/`: UI components. The large interactive surfaces are
  `RhythmPlayer.tsx` and `RhythmComposer.tsx`; `Disclaimer.astro` is shared by
  pages.
- `src/lib/`: parser, validator, shared rhythm types, sample map, tempo bounds,
  grid layout helpers, keyboard shortcut helpers, and hand-display preference
  utilities.
- `src/content/rhythms/`: Markdown lesson entries consumed by Astro content
  collections.
- `src/content/config.ts`: frontmatter schema for rhythm content.
- `src/styles/global.css`: all application styling, including responsive player
  and composer layouts.
- `public/`: static images and audio samples. Audio samples are grouped under
  `public/samples/<instrument>/`.
- `tests/layout.spec.ts`: Playwright smoke and interaction tests.

## Commands

- `npm install`: install dependencies from `package-lock.json`.
- `npm run dev`: start Astro's development server.
- `npm run dev:local`: start Astro on `http://127.0.0.1:4323`; Playwright uses
  this command through `playwright.config.ts`.
- `npm run build`: production Astro build; validates content schema and catches
  bundling/compile errors.
- `npm run preview`: serve the built site after `npm run build`.
- `npm run check:layout`: run Playwright tests across desktop, narrow, and
  mobile Chrome projects. Screenshots and traces go under `test-results/layout`
  and `playwright-report`.

There is no committed lint or unit-test script. Use `npm run build` as the
minimum verification step. Run `npm run check:layout` for visible UI,
player/composer, keyboard, or layout changes.

## Coding Style

- Use TypeScript with Astro's strict config.
- Follow the existing formatting: two-space indentation, double quotes,
  semicolons, and explicit imports.
- Prefer named exports for shared utilities in `src/lib/`.
- React components use PascalCase file and export names.
- Reuse existing helpers before adding new abstractions, especially for rhythm
  parsing, grid sizing, tempo clamping, keyboard filtering, and sample lookup.
- Keep broad refactors out of small behavior/content changes. `RhythmPlayer.tsx`
  and `RhythmComposer.tsx` are large and stateful; change them narrowly unless
  the task is explicitly a refactor.

## Rhythm Content

Rhythm Markdown lives in `src/content/rhythms/`. Frontmatter is validated by
`src/content/config.ts` and must include:

- `title`
- `tempo`
- `subdivision` as `8`, `16`, or `32`
- `difficulty`
- `instruments`

Existing files also include a `slug` field, but routes use Astro's entry slug
from the filename. Keep filenames lowercase and hyphenated.

Notation goes in a fenced `rhythm` block:

````text
```rhythm
Gongue:
. X . . | X . X .

Alfaia:
. . L R | . . R .
```
````

Parser and validator behavior:

- Track headers end with `:`.
- Tokens are split on whitespace.
- Bar separators `|` are ignored.
- `-` is normalized to `.` for rests.
- All tracks must have the same number of steps.
- Track and symbol combinations must exist in `src/lib/sampleMap.ts`, except
  rests.
- Current sample keys are `Alfaia.L`, `Alfaia.R`, `Gongue.X`, and `Gongue.x`.
- Rhythm block validation errors are currently shown as error panels on rhythm
  pages; they are not a separate dedicated test suite.

When adding a new instrument or symbol, add the sample file under
`public/samples/`, update `sampleMap`, and verify at least one rhythm page using
the new key.

## Player And Composer Notes

- `RhythmPlayer` dynamically imports Tone.js, schedules steps on
  `Tone.Transport`, scrolls the active playhead into view, supports loop,
  restart, mute buttons, tempo changes, editable cells, keyboard shortcuts, and
  iOS silent-mode help.
- Rhythm pages pass `autoPlay`, but browsers may block audio until user
  interaction. The component handles blocked autoplay silently.
- `RhythmComposer` records only an Alfaia track by default. It syncs a Markdown
  transcription textarea with parsed preview tracks, embeds `RhythmPlayer` for
  preview, and has separate keyboard/pointer/touch paths for low-latency hit
  input.
- Composer keyboard defaults include `F` for left hit, `J` for right hit,
  `R` record, `M` metronome, `Space` preview play/stop, `L` loop, `C` clear,
  arrow keys for selection, and `Backspace` to clear the selected step.
- Use `shouldIgnoreKeyboardShortcut` when adding global shortcuts so typing in
  inputs, textareas, links, and buttons remains accessible.
- Hand-display reversal is a UI preference stored in `localStorage`; do not
  mutate the underlying rhythm symbols for that display-only setting.

## Styling And Layout

All styles live in `src/styles/global.css`. The app relies on horizontal grid
scroll containers for long rhythm patterns, sticky track labels, fixed grid
column helpers from `src/lib/rhythmGridLayout.ts`, and responsive breakpoints
around narrow/mobile layouts.

For visible changes:

- Preserve accessible names and roles used by Playwright tests.
- Check for horizontal body overflow.
- Keep controls usable on mobile and touch devices.
- Prefer lucide-react icons for controls when an icon exists.

## Testing Guidance

`tests/layout.spec.ts` currently covers:

- Home, compose, iOS help, and representative rhythm pages rendering without
  body overflow or console/page errors.
- Editable note cycling/reset behavior on a predefined rhythm page.
- Composer transcription edits, validation errors, preview edits, and reset
  behavior.

Add or update Playwright coverage for changes that affect visible UI,
keyboard behavior, rhythm editing, composer recording/editing, or player
controls. For pure parsing or validation changes, consider adding a focused test
setup if the behavior is non-trivial, because no unit-test runner exists yet.

Manual checks matter for audio changes. Exercise playback, restart, loop,
mute/unmute, tempo changes, iOS help links when relevant, composer hit buttons,
keyboard shortcuts, and transcription parsing.

## Pull Request Notes

The git history uses short imperative commit messages such as `add disclaimer`
and `align tempo slider`. Keep commits focused. PR descriptions should include:

- What changed.
- Verification commands run.
- Manual audio/UI checks performed, if applicable.
- Screenshots or recordings for visible player/composer changes.
