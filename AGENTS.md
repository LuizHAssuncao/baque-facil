# Repository Guidelines

## Project Overview

Baque Fácil is an Astro 4 app for learning and composing Maracatu rhythm
patterns. Astro owns routing, content loading, and static page generation.
React islands provide the interactive rhythm player and composer. Built-in rhythms
use rendered Web Audio buffers with native looping and a playback audio session.
The editable composer preview uses Tone.js, with Web Audio/HTML audio fallbacks
for composer input.

Core user flows:

- `/`: rhythm index, combo grouping, composer link, left-handed display setting.
- `/radio/`: browser-generated MP3 mixes played through one native looping audio
  element, with a frame-based timeline for the visible grid and seeking.
- `/rhythms/[slug]/`: generated from Markdown rhythm entries and rendered with
  a read-only `RhythmPlayer` and a Customize link.
- `/compose/`: `RhythmComposer`, with recording, metronome, transcription
  editing, and an embedded preview player.
- `/compose/[slug]/`: the same composer preloaded with an editable copy of a
  built-in rhythm, including its tracks, tempo, subdivision, and transcription.
- `/help/ios-audio/`: troubleshooting page linked from iOS audio prompts.
- `/diagnostics/background-audio/`: isolated looping-buffer test with local reports.

## Project Structure

- `src/pages/`: Astro routes. Import `src/styles/global.css` in page files.
- `src/components/`: UI components. The large interactive surfaces are
  `RhythmPlayer.tsx` and `RhythmComposer.tsx`; `Disclaimer.astro` is shared by
  pages.
- `src/lib/`: parser, validator, shared rhythm types, sample map, tempo bounds,
  grid layout helpers, keyboard shortcut helpers, and hand-display preference
  utilities.
- `src/lib/radio/`: shuffled timelines and native-media playback controller.
- `src/lib/audio/`: rendered rhythm playback, shared bounded PCM mixing, lazy
  MP3 encoding, gapless metadata, and finite pattern exports. Keep the MP3 timing
  round-trip tests passing when upgrading the pinned encoder dependencies.
- `src/content/rhythms/`: Markdown lesson entries consumed by Astro content
  collections.
- `src/content/config.ts`: frontmatter schema for rhythm content.
- `src/styles/global.css`: all application styling, including responsive player
  and composer layouts.
- `public/`: static images and audio samples. Audio samples are grouped under
  `public/samples/<instrument>/`.
- `tests/layout.spec.ts`: Playwright smoke and interaction tests.
- `tests/radio*.spec.ts`: radio timeline/mixer, real encoding, controls, and
  generation benchmark. Emulated mobile tests do not verify physical phone locking.
- `src/sw.ts`, `src/lib/offline/`, and `scripts/offline-manifest.mjs`: versioned
  production precaching, integrity checks, cache repair, and footer status.
- `tests/offline/`: production-only browser tests, including persistent storage
  and updates between complete builds on one test origin.

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
- `npm run check:types`: check TypeScript, including the worker and browser tests.
- `npm run check:offline`: build the production site and run offline tests on
  port 4335. This suite is excluded from the development-server layout run.

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
- Whenever a UI change adds, replaces, or deletes a string, apply the same
  change in every supported language (currently `en-CA` and `pt-BR`). This
  includes visible text, accessibility labels, tooltips, errors, and page metadata.
  Update the relevant translations in the same change, and remove unused
  translation entries when a string is deleted.

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

- Built-in `RhythmPlayer` playback renders one cycle with wrapped sample tails,
  uses a native looping AudioBufferSourceNode, and schedules tempo/mute crossfades
  at rhythm boundaries. Rendering preserves sample pitch. Markdown remains the source.
- The editable `RhythmPlayer` preview dynamically imports Tone.js, schedules steps on
  `Tone.Transport`, scrolls the active playhead into view, supports loop,
  restart, mute buttons, tempo changes, editable cells, keyboard shortcuts, and
  iOS silent-mode help.
- Built-in rhythm playback starts with a user Play tap after rendering finishes.
  The component's live mode handles blocked autoplay silently when requested.
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
- `Mp3ExportControl` captures the player's pattern, tempo, and mutes. Composer
  validation and recording guards arrive through explicit props. Radio downloads
  always use the full mix descriptor, including while a held pattern plays.
  Download URLs must remain independent of playback URLs.

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
- Read-only built-in rhythm playback and customization into an editable copy.
- Customized single-track and multi-track rhythms, note cycling, and reset.
- Composer transcription edits, validation errors, preview edits, and reset
  behavior.

Add or update Playwright coverage for changes that affect visible UI,
keyboard behavior, rhythm editing, composer recording/editing, or player
controls. For pure parsing or validation changes, consider adding a focused test
setup if the behavior is non-trivial, because no unit-test runner exists yet.

Manual checks matter for audio changes. Exercise playback, restart, loop,
mute/unmute, tempo changes, iOS help links when relevant, composer hit buttons,
keyboard shortcuts, and transcription parsing.

For offline changes, also run `npm run check:offline`. Keep workers disabled in
development. Automatic updates must never force waiting-worker activation or
reload open clients: players and unsaved compositions must survive update downloads.
The explicit footer Reload to update action may activate a fully saved waiting
worker and reload its own page, including offline, after checking that it is the
only app window. It must reuse the downloaded release and preserve preferences.
The explicit Settings refresh may activate its fresh worker and reload its own
page after a complete download; it must first require other app windows to close,
check connectivity, and preserve preferences and unrelated caches. Keep the offline
indicator discreet in the shared footer. The quiz uses the active worker's saved
library until the next release activates; development still fetches each round.

## Pull Request Notes

The git history uses short imperative commit messages such as `add disclaimer`
and `align tempo slider`. Keep commits focused. PR descriptions should include:

- What changed.
- Verification commands run.
- Manual audio/UI checks performed, if applicable.
- Screenshots or recordings for visible player/composer changes.
