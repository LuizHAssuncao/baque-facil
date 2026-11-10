# Repository Guidelines

## Project Overview

Baque Fácil is an Astro 4 app for learning and composing Maracatu rhythm
patterns. Astro owns routing, content loading, and static page generation.
React islands provide the interactive rhythm player and composer. Built-in rhythms
use rendered Web Audio buffers with native looping and a playback audio session.
The editable composer preview uses Tone.js, with Web Audio/HTML audio fallbacks
for composer input.

Core user flows:

- `/`: rhythm index, sequence grouping, composer link, left-handed display setting.
- `/radio/`: browser-generated MP3 mixes played through one native looping audio
  element, with a frame-based timeline for the visible grid and seeking.
- `/quiz/`: listening practice with rhythm names or hand gestures as prompts.
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
- `public/hand-signals/`: the existing hand signal images and animations. Use
  these assets for gesture features; browser URLs start with `/hand-signals/`.
  Each lesson's `gesture.src` and bilingual `gesture.description` frontmatter
  map its rhythm to the correct asset. Check this directory and the lesson
  metadata before asking the user for hand signals. If they are absent from a
  stale checkout, fetch and inspect the latest `origin/main`. Reuse the original
  files, including animated WebP, rather than inventing number-to-gesture mappings
  or generating replacement artwork unless the user requests it.
- `tests/layout.spec.ts`: Playwright smoke and interaction tests.
- `tests/radio*.spec.ts`: radio timeline/mixer, real encoding, controls, and
  generation benchmark. Emulated mobile tests do not verify physical phone locking.
- `src/sw.ts`, `src/lib/offline/`, and `scripts/offline-manifest.mjs`: versioned
  production precaching, integrity checks, cache repair, and footer status.
- `tests/offline/`: production-only browser tests, including persistent storage
  and updates between complete builds on one test origin.

## Repository Skills

For requests to create or revise static hand signal illustrations, use
`generate-hand-pose` at `.agents/skills/generate-hand-pose/SKILL.md`. Its approved
visual concept is bundled in the skill's `assets/` directory.

For moving hand signals, use `generate-hand-animation` at
`.agents/skills/generate-hand-animation/SKILL.md`. It bundles the approved visual
concept and a verifier for animated WebP exports below 500 KB. Put animated WebP
reference examples in that skill's `assets/` directory.

## Commands

Use Node.js 22 or newer. The package also supports Node.js `^20.3.0`.

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

To use an installed Chromium for layout tests, set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chromium`.

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

## Languages

`src/lib/i18n/messages.ts` holds typed English messages and Portuguese
translations. Use `TranslatedText.astro`, `translatedAttributes` and
`useTranslation` for Astro text, attributes and React components respectively.
Keep message keys and parameters for dynamic errors and statuses so they update
with the language. Preserve `Quiz` and `Tempo` in both languages. Lesson prose
translations live together in Markdown with `data-language` and `lang` attributes.

The preference key is `baque-facil-language` in `localStorage`. Synchronize tabs;
allow changes for the current page when storage is unavailable. Escape closes
the first visit dialog without saving a choice. Language changes must preserve
playback, quiz progress and composer edits. Keep identifiers, shortcut keys and
raw diagnostic data stable. Use `rhythmNotation.ts` to display Portuguese Alfaia
hands as `E`/`D` while retaining canonical `L`/`R` data and authored prose.

Keep the inline head initializer, bilingual Astro markup and React server
snapshot consistent to avoid an English flash before Portuguese hydration.
`tests/language.spec.ts` covers language behavior; other interaction tests
explicitly save English in storage.

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
- Current sample keys are `Alfaia.L`, `Alfaia.R`, `Alfaia.B`, `Caixa.X`,
  `Gongue.X`, `Gongue.x` and `Whistle.X`.
- Rhythm block validation errors are currently shown as error panels on rhythm
  pages; they are not a separate dedicated test suite.

When adding a new instrument or symbol, add the sample file under
`public/samples/`, update `sampleMap`, and verify at least one rhythm page using
the new key.

The whistle uses `public/samples/whistle/whistle.wav`. A `Whistle:` track uses
`X` for a hit and `.` for a rest, with the same length as other tracks. The shared
sample map supplies it to players, composer, exports, radio and offline caching.
Lessons and compositions require an explicit whistle track; radio can add exit
cues automatically.

### Hand signals

Optional `gesture` frontmatter replaces the decorative lesson header image:

```yaml
gesture:
  src: "/hand-signals/martelo-break.webp"
  description:
    en-CA: "A closed fist moves up and down."
    pt-BR: "Um punho fechado se move para cima e para baixo."
```

Keep descriptions in both languages. Headers and enlarged previews support
PNG, SVG and WebP with `object-fit: contain`; animated WebP must loop infinitely
and play directly without conversion. Referenced public assets are precached.
The static poses are transparent 1024 × 1024 PNGs below 500 KB. Reuse the lesson
metadata for pose mappings. The original Martelo break animation and a copy in
the animation skill's assets provide the moving reference. Offline tests cover
that animation's playback, previews, layout and caching, plus a static PNG fixture.

## Quiz

`/quiz/rhythms.json` derives its pool from the rhythm collection at build time.
Valid audible entries join automatically; each round requires three distinct
sounds. Fetch the pool each round, using the active worker's saved release in
production and the online library without a worker. Content changes require a
build and deployment.

Options use the existing samples at 90 BPM and anonymous media controls. Play
or Replay runs the complete sequence twice, including final decay, without
autoplay. Correct answers advance after two seconds; incorrect answers identify
the selection and keep the question available for another try. Keep practice
unlimited and free of scoring or notation.

Gesture mode uses the lessons' original `gesture` assets and bilingual
descriptions. Include only entries with gestures and hide rhythm names until
feedback. A failed image load disables answers while leaving skip and name mode
available. Switching modes stops playback and starts a new question.
See `tests/quiz.spec.ts` and `tests/quiz-gestures.spec.ts`.

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
  transcription textarea with parsed tracks. `ComposerGrid` supplies one timeline
  through the `RhythmPlayer` editor slot; built-in players keep their original UI.
  It has separate keyboard/pointer/touch paths for low-latency hit input. Recording
  preserves non-Alfaia tracks. Versioned drafts are validated by `composerDraft.ts`.
- Composer keyboard defaults include `F` for left hit, `J` for right hit, `B` for border hit,
  `R` record, `M` metronome, `Space` preview play/stop, `L` loop, `C` clear,
  arrow keys for selection and `Backspace` to clear the selected step.
  `Ctrl/Cmd+Z` undoes edits; adding `Shift` redoes them.
- Use `shouldIgnoreKeyboardShortcut` when adding global shortcuts so typing in
  inputs, textareas, links, and buttons remains accessible.
- Hand-display reversal is a UI preference stored in `localStorage`; do not
  mutate the underlying rhythm symbols for that display-only setting.
- `Mp3ExportControl` captures the player's pattern, tempo, and mutes. Composer
  validation and recording guards arrive through explicit props. Radio downloads
  always use the full mix descriptor, including while a held pattern plays.
  Download URLs must remain independent of playback URLs.

### Composer state and sharing

The note picker, playback and recording share one grid. Add beat extends every
track; Use an example loads Marcação with its name, notes and tempo. Pad practice
leaves the pattern intact. Recording starts after three counts, converts gaps to
rests and replaces only Alfaia while preserving other tracks and their length.
Canceling the count preserves the composition; Undo can recover a replaced take.

Save drafts, names, tempo, transcription and the latest completed take separately
for each composer route. Report storage failures. Reload restores drafts with
fresh undo history; invalid transcription retains its text and the last valid
grid. Preserve Clear rhythm, Restore last take and Restore original behavior.

`shareRhythm.ts` encodes name, tempo, subdivision and all tracks in versioned
UTF-8 JSON as Base64url at `/compose/#rhythm=…`; step strings use compact notation
such as `L.R.`. Keep the full URL within 2,000 characters while allowing longer
compositions to remain editable. Resolve recording and invalid transcription
before sharing; clipboard failure must leave a selectable link.

Shared snapshots wait for Play and stay isolated from ordinary local drafts.
Edits last in that tab; reopening the original link restores its snapshot.
Links work offline after setup and contain musical data and metadata. Exclude
lesson prose, mutes and display preferences. The payload is readable without a
secret; sharing requires no backend or audio upload. Preserve coverage in
`tests/rhythm-sharing.spec.ts` and `tests/composer-workflows.spec.ts`.

### Rendered playback

Rendered buffers stay on the device. Attenuate mixes to prevent clipping and
include final decay in playback that runs once. Request
`navigator.audioSession.type = "playback"` when supported.

Debounce and serialize tempo/mute rendering while the old buffer plays. Switch
at the next rhythm boundary with a five millisecond crossfade on the audio clock.
Scheduled transitions can complete while hidden; unfinished preparation waits
for foreground return. Allow at most two sources during a transition and release
the muted source on return. Cancel obsolete changes so Stop never restarts audio.

Play resumes interrupted contexts through a user gesture. Stop resets position;
supported media session Pause/Play preserves it. Navigation stops audio and
disposal releases sources, buffers and the AudioContext. The live composer
preview requires the page to remain visible.

## Baque Radio

Defaults are all regular rhythms, 90 BPM, eight repetitions and about 20 minutes.
Optional sequences play once per turn. New sessions and Shuffle again create
complete shuffled rounds; avoid adjacent repeats when multiple rhythms are
selected. Preparation is cancellable and may need another Play tap when ready.
Show estimated duration and size before preparation. Preferences persist locally;
recordings disappear on reload and restored preferences never start playback.

Skip seeks to the next group. Stay on this rhythm creates a short looping
recording; Back to mix returns to the next group. Apply settings commits pending
mix settings. One native audio element owns playback and looping, with transitions
inside the recording. Follow the media clock when returning from the background;
continuous audio must not depend on JavaScript timers or media session callbacks.
Navigation stops playback.

Exit cues live in `src/lib/radio/transitions.ts`. Before a regular rhythm changes
to a different item, add `X . . . | . . . . | X X . X | X . X .` on Whistle in
the final bar of the final repetition. Marcação and Imalê also replace that bar's
Alfaia with `R . . . | . . . . | L R . R | L . R .` and
`R . . . | L . R . | L R . R | L . R .` respectively. Other drum notes stay
intact. Sequences play as written; solo and held playback receive no automatic
cue. Keep the grid, MP3 and recording loop boundary consistent.

Show the next gesture during the final two repetitions, or at 70% completion of
a sequence played once. Use lesson metadata and original assets. Missing gestures
show “Signal unavailable” and the next name, even when names are hidden. Solo and
held rhythms show a repeating state. Refresh signals after skip, loop and return
from the background while the notes and cursor follow the audible rhythm.

Show rhythm names and Show notes apply immediately without regenerating audio.
Both default on and persist separately in `baque-facil-radio-display-v1`.
Hidden names also disappear from lesson shortcuts, announcements and media titles,
except for an active call with an unavailable signal. Rhythm and sequence selection
options always show their names and authored gestures, independently of the practice
view switches. Keep all options visible when deselected; sequences are individually
selectable. Keep gesture descriptions bilingual. See `tests/radio*.spec.ts` and the
[radio plan](specifications/radio-implementation-plan.md).

## MP3 encoding and downloads

Radio and pattern exports share lazy worker encoding through pinned Mediabunny
and its LAME encoder: 44.1 kHz stereo at 128 kbps. Mix in two second PCM chunks
instead of retaining an entire uncompressed recording. Replacement files may
temporarily coexist; release obsolete Blob URLs and workers. Rerun actual
encode/decode timing tests when upgrading the encoder or Xing/LAME adapter.

Pattern downloads offer 1, 4, 8 or 16 repetitions; rhythms default to eight,
sequences and compositions to one. Capture the pattern, tempo and unmuted tracks
at preparation time, starting at the beginning and including final decay.
Exclude metronome, recording count and hand display preferences. Reject invalid
or silent patterns and active recording. Support progress and cancellation;
limit exports to 20 minutes including decay and individual cycles to three minutes.

Radio downloads retain the full prepared mix and shuffle order during held
playback, pending settings or failed/canceled replacements. Saving must preserve
playback. Offer native file sharing when supported. See
`tests/mp3-download.spec.ts` and `tests/mp3-export-engine.spec.ts` for downloads
and decoded file checks.

## Styling And Layout

All styles live in `src/styles/global.css`. The app relies on horizontal grid
scroll containers for long rhythm patterns, track labels that scroll with the
notes, fixed grid column helpers from `src/lib/rhythmGridLayout.ts`, and responsive
breakpoints around narrow/mobile layouts.

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

Physical device checks remain required for background playback, installation,
offline use, MP3 saving and external player compatibility. Emulated mobile tests
cannot establish these. For radio, test at least 30 minutes on iPhone Safari and
Android Chrome, including looping, Stay, screen lock, pause/resume, app switching,
Bluetooth and interruptions. Listen for gaps, missing attacks or clicks and
measure preparation time and memory on a less powerful phone.

For rhythm playback on iPhone, lock for at least 15 minutes across loop boundaries.
Test tempo changes from 30 to 130 BPM, rapid changes, long sequences and locking
during a pending change. Exercise mute, Stop, Restart, playback without looping,
media controls, interruptions and Bluetooth changes.

The isolated `/diagnostics/background-audio/` page loops four synthesized clicks
in a two second buffer at 120 BPM and requests a playback audio session. Its
tempo slider changes playback rate and pitch. Keep it independent of production
tempo rendering, silent media elements, timers and automatic visibility resume.
On iPhone Safari, listen while switching apps for one minute and locking for two,
then repeat at another tempo. Copy the local session storage report of state,
visibility and clock events; clock progress alone cannot prove audible playback.
Navigation stops the test and returning never resumes it automatically.

## Offline behavior and deployment

For offline changes, also run `npm run check:offline`. Keep workers disabled in
development. Background updates must never activate a waiting worker or reload
an open page without the user choosing to update. Show the non-modal Update
available prompt only for a fully downloaded release, without moving focus or
interrupting playback/editing. Later dismisses that release for the current tab,
including across navigation; a newer release can show a new prompt. Keep the
footer action available after dismissal. Check for releases every minute while
visible as well as on open, reconnect, and foreground return.
The prompt's Refresh to update and footer's Reload to update actions may activate
a fully saved waiting worker and reload their own page, including offline, after
checking that it is the only app window. They must reuse the downloaded release
and preserve preferences.
The explicit Settings refresh may activate its fresh worker and reload its own
page after a complete download; it must first require other app windows to close,
check connectivity, and preserve preferences and unrelated caches. Keep the offline
indicator discreet in the shared footer. The quiz uses the active worker's saved
library until the next release activates; development still fetches each round.

Opening the production home page must download the complete app, including all
rhythm and Customize pages, quiz data, lazy code, encoder, samples, images and
help. Read `dist/offline-build.json` for current file count and size. Initial
setup never reloads the page; readiness requires both worker control and a
complete cache. Reconnect to repair evicted files. Installation is optional and
each browser storage context needs its own download.

Reuse unchanged files and verify changed bytes before marking an update ready.
A failed update retains the last complete release. Without an explicit update,
the new worker waits until all windows using the old version close. Keep rhythm,
Customize, radio and quiz content consistent within each release. Settings refresh
must check the server before clearing this app's cache and worker; allow retry
after failure. Preserve local drafts and preferences independently of app files.

To inspect workers manually, build then preview on a separate profile or port
from development. The offline suite checks production audio/exports, browser
restart, range requests, interrupted downloads, storage failures, Settings
refresh and updates across tabs. It simulates Cloudflare Pages analytics
injection and rejects altered HTML; fixtures must not modify committed lessons.

Deploy the complete `dist/` atomically at the origin root over HTTPS. Serve
`/sw.js` with `Cache-Control: no-cache` or equivalent revalidation and a JavaScript
MIME type; hashed `/_astro/` assets can be immutable. The worker removes the known
Cloudflare Pages analytics snippet before checking the original HTML hash.
Disable other transformations of built bytes. Check directory routes and deep
links on the host. Roll back with a complete prior build and worker; deleting
`sw.js` cannot remove installed workers. See the
[offline plan](specifications/offline-implementation-plan.md) for lifecycle and
acceptance criteria.

## Pull Request Notes

The git history uses short imperative commit messages such as `add disclaimer`
and `align tempo slider`. Keep commits focused. PR descriptions should include:

- What changed.
- Verification commands run.
- Manual audio/UI checks performed, if applicable.
- Screenshots or recordings for visible player/composer changes.
