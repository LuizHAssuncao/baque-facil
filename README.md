# Baque Fácil

![Baque Fácil hero image](public/alfaia-editorial-hero.png)

Baque Fácil is an Astro app for learning, practicing and composing Maracatu
rhythm patterns. It combines Markdown-authored rhythm lessons with interactive
React rhythm grids, audio playback, and an Alfaia composer.

## Features

- Rhythm index with separate practice rhythm and combo sections.
- Generated rhythm pages from Markdown content in `src/content/rhythms/`.
- Baque Radio at `/radio/`: a locally generated, shuffled MP3 mix with continuous
  native playback, rhythm selection, tempo, Skip, and Stay on this rhythm.
- A listening quiz at `/quiz/`: match a rhythm name to one of three audio options,
  with unlimited replay and practice, clear answer feedback, no notation, and no
  scoring. Correct answers advance automatically after a two-second confirmation;
  incorrect answers identify the selected rhythm and stay on the same question
  for another try.
- Fixed-note rhythm player with tempo control, looping, mute controls, restart,
  keyboard support, and background media playback. The composer preview remains editable.
- Composer with one editable playback grid, an explicit note picker, Alfaia
  recording pads, undo/redo, local draft recovery, and optional transcription editing.
- MP3 downloads for rhythms, combos, compositions, and the full prepared radio mix.
- Left-handed display preference stored locally without changing the underlying
  rhythm notation.
- English (Canada) and Portuguese (Brazil), with a first-visit language picker,
  controls on every page, and a saved browser preference.
- Offline practice after downloading the complete app, sequences, and samples,
  with a discreet footer status and optional home-screen installation.

## Tech Stack

- [Astro](https://astro.build/) for routing, static generation, and content
  collections.
- [React](https://react.dev/) islands for the rhythm player and composer.
- Offline rendering and native Web Audio buffer looping for rhythm-page playback.
- [Tone.js](https://tonejs.github.io/) for the composer's editable preview.
- [Mediabunny](https://mediabunny.dev/) and its MP3 encoder, powered by
  [LAME](https://lame.sourceforge.io/), for browser recordings and MP3 downloads.
- Web Audio and HTML audio fallbacks for composer hit input.
- [Playwright](https://playwright.dev/) for layout and interaction checks.

## Getting Started

Use Node.js 22 or newer; Node.js 20.3+ is also supported by the build tooling.

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
npm run check:offline # Build and test offline storage, playback, and updates
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

## Languages

The interface supports `en-CA` and `pt-BR`. A bilingual dialog asks new visitors
to choose a language on any page. The header and home-page Settings can change
it at any time. The choice is stored in `localStorage` as `baque-facil-language`
and synchronized across open tabs. It persists when the browser reopens; a new
browser profile or cleared site data prompts again. When storage is unavailable,
the language can still change for the current page. Escape dismisses the prompt
without saving a choice.

`src/lib/i18n/messages.ts` contains typed English source messages and their
Brazilian Portuguese translations. Use `TranslatedText.astro` for Astro text,
`translatedAttributes` for translated attributes, and `useTranslation` inside
React components. Store message keys and parameters for dynamic errors/statuses
so they also update when the language changes. Keep `Quiz` and `Tempo` in both
languages. Lesson prose translations live beside the English text in Markdown,
using `data-language` and `lang` attributes.

Language changes update text in place, preserving playback, quiz progress, and
composer edits. Rhythm names, instrument/sample identifiers, notation, shortcut
keys, user-authored transcriptions, and raw diagnostic report data remain stable.
The inline head initializer and bilingual Astro markup prevent an English text
flash for returning Portuguese visitors. React uses a matching server snapshot
and subscribes to the shared preference after hydration.

Language behavior is covered by `tests/language.spec.ts`. Existing interaction
tests explicitly select English through saved storage.

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
requests the pool for every round. In a production session controlled by the
service worker, those requests use the saved library for that release; a newer
library takes effect after the downloaded update activates between sessions.
Development and browsers without service workers fetch the online library each
round. As with the rest of this static Astro site, production content changes
require the normal build and deployment. Invalid or silent patterns are excluded,
and each round needs three distinct sounds. All options use the existing drum
samples at 90 BPM, with anonymous media controls and no automatic playback. Each
Play or Replay runs the complete sequence twice in succession, then stops after
the final drum decay.

## Offline practice

The production site automatically saves all built-in rhythm and Customize pages,
quiz data, application code (including Tone.js and the radio encoder), drum
samples, images, and help pages. Visiting the home page is enough to start the
download; individual features do not need to be opened first. The build prints
the exact file count and size and writes `dist/offline-build.json`. The initial
implementation saves about 6.88 MB before transfer compression.

A small line in the footer shows download progress, readiness, and waiting
updates. The first visit says “Offline files saved · ready on your next visit”
after the download completes. Follow a normal link or reopen the app to finish
setup; “Ready for offline use” confirms the page is controlled and all files are
present. Automatic setup and updates never reload an open page.
Use Retry in the footer if a download fails. Browser storage can be cleared or
evicted; reconnect to restore missing files.

For a clean download, open **Settings → Refresh offline app** on the home page.
This checks the download server before clearing this app's saved files and
worker, downloads every file again, then reloads this page. It preserves language,
hand-display and radio preferences, along with unrelated browser storage. Close
other Baque Fácil tabs/windows first; the action waits for you to do so rather
than interrupting a player or unsaved composition. If the replacement download
fails, stay online and use the same button to retry. The footer and recovery
messages follow the selected English or Portuguese language.

Once ready, reopen the app in airplane mode to browse and play rhythms, record
and edit a composition, answer quiz rounds, or generate a new radio mix. Audio
still starts through the normal Play controls. The existing preference storage
continues to work. Composer drafts are saved locally on this device, separately
for each composer route. Generated MP3 recordings are not saved across page restarts.

Updates are checked when the app opens, reconnects, or returns to the foreground.
Changed files download with integrity checks, while unchanged samples are reused.
The footer offers **Reload to update** once the complete new version is saved.
Save any composition or recording first, and close other Baque Fácil tabs/windows.
The action activates the saved update and reloads just this page, including while
offline, without clearing preferences or downloading unchanged files again.
Otherwise, the new version waits until all tabs/windows using the old version
have closed; reopening then uses it. A normal browser refresh can still use the
old saved version while an update is waiting. A failed update keeps the last
complete version available. A sequence edit updates the rhythm player, Customize
page, radio, and quiz as one release.

Home-screen installation is optional. Supported browsers offer a small Install
app action in the footer. On iOS, the footer's Add to Home Screen disclosure
explains Safari's Share menu. Installing and completing the offline download are
separate actions; each browser/storage context needs its own saved copy.

Service workers are disabled in `astro dev`. To check them manually, run a fresh
`npm run build` followed by `npm run preview` and use a separate browser profile
or port from development. `npm run check:offline` runs real production builds,
first-use offline audio and MP3 exports, browser restart, range requests,
interrupted downloads, storage failures, Settings refresh, and updates across
multiple tabs. The test origin reproduces Cloudflare Pages' analytics injection,
including verification that changed HTML is rejected. Its temporary build
fixtures do not modify committed rhythm content.

Deploy the complete `dist/` atomically at the origin root over HTTPS. Serve
`/sw.js` with `Cache-Control: no-cache` (or equivalent revalidation) and the proper
JavaScript MIME type; it must not receive an immutable CDN lifetime. Hashed
`/_astro/` assets can remain immutable. The worker removes Cloudflare Pages' known
analytics snippet from downloaded HTML, then verifies the original build hash
before saving it. Other transformations that change built bytes must stay
disabled; HTML from another release and corrupted assets are still rejected.
Confirm directory routes and deep links on the target host. Roll back by
publishing a complete prior app build with its service worker; deleting `sw.js`
does not remove workers already installed on learners' devices.

See the [offline implementation plan](specifications/offline-implementation-plan.md)
for the cache lifecycle and acceptance criteria. Physical iPhone and Android
airplane-mode, installation, and background-audio checks remain required before
claiming verified behavior on those devices.

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

## Baque Radio

Open `/radio/`, choose rhythms and a tempo, then press Play. Preparation runs on
the device and can be cancelled. Keep the page open until the recording is ready;
some browsers require another Play tap after preparation. Defaults are all regular
rhythms, 90 BPM, eight repetitions, and about 20 minutes. Combos are optional and
play once per turn because they already contain longer sequences.

Each new session or Shuffle again builds a fresh sequence in complete shuffled
rounds, avoiding adjacent repeats when multiple rhythms are selected. The estimated
duration and file size are shown before preparation. The finished recording loops
in its existing order. Skip seeks to the next group; Stay on this rhythm prepares
a short looping recording, and Back to mix returns to the next group. Settings
take effect through Apply settings. Preferences persist locally; recordings do
not survive a page reload, and restored preferences never start playback.

No backend is required. Only application code, the encoder, and short drum samples
download; the mix stays local. MP3 at 128 kbps uses about 19.2 MB per 20 minutes.
Mixing uses two-second PCM chunks (about 0.7 MB each), retaining short samples and
compressed output rather than a full uncompressed recording. Replacement files
temporarily coexist; obsolete Blob URLs and encoder workers are released. Encoding
is lazy-loaded and runs in a worker. The pinned encoder versions and small Xing/LAME
metadata adapter are covered by an actual encode/decode timing test; rerun it when
upgrading the encoder.

One native HTML audio element owns playback and looping. Rhythm transitions are
inside the recording, so background playback does not depend on JavaScript timers.
The visible grid follows the media clock on return. Lock-screen title changes and
optional Skip controls depend on browser support; continuous audio does not depend
on these callbacks. Navigating away stops playback.

**Physical locked-phone verification remains pending.** Before release, test at
least 30 minutes on iPhone Safari and Android Chrome, including the file loop,
Stay, lock-screen pause/resume, app switching, Bluetooth, and interruptions. Listen
for missing attacks, gaps, or clicks, and measure preparation time and memory on a
lower-powered phone. Desktop and emulated mobile tests cannot establish this.
See the [implementation and verification plan](specifications/radio-implementation-plan.md).

## Composer

Select a cell to choose a hit or rest. Alfaia supports Left (`L`), Right (`R`),
Border (`B`) and Rest (`.`). The same grid shows editing, playback and recording.
**Use an example** loads Marcação from the rhythm library with its name, notes
and tempo. Add beat extends every track.

Record with pads opens three Alfaia pads. Try them without changing the pattern,
then press Record. Recording starts after three counts; gaps become rests.
Canceling the count preserves the composition. A finished take replaces Alfaia
while keeping the other instruments and their length. Undo recovers the previous
composition. More contains Clear rhythm, Restore last take and, for customized
rhythms, Restore original. Recent edits are reversible within the current session.

Drafts, names, tempo, transcription and the latest completed take are saved on
this device, separately for each composer route. The save indicator reports
storage failures. Drafts survive reloads; undo history starts fresh. An invalid
transcription keeps its text and the last valid grid. Transcription opens the raw
editor, and Export offers copying and MP3 preparation. These features also work
offline after the app is downloaded.

**Share rhythm** copies a link containing the current name, tempo, subdivision
and every track. Notes use compact strings (for example, `L.R.`) in versioned
UTF-8 JSON encoded as Base64url in `/compose/#rhythm=…`. No account, database or
audio upload is needed. The full link is limited to 2,000 characters for sharing
compatibility; longer compositions remain editable. Clipboard failure leaves a
selectable link. Recording and invalid transcriptions must be resolved first.

Opening a link loads an editable snapshot and waits for Play. It never restores
or overwrites the recipient's ordinary local drafts. Changes to a shared snapshot
stay in that tab; share again to keep a new version. Reloading the original link
restores its original snapshot. Shared links also open offline once the app and
samples have been saved. Links include musical data and metadata, not lesson prose,
mute settings or hand-display preferences. They are encoded, not encrypted.

Keyboard editing uses F for Left, J for Right, B for Border, arrows to move and
Backspace to clear a cell. R starts recording, M toggles the recording metronome,
Space plays/stops. Ctrl/Cmd+Z undoes changes (Shift adds redo). Shortcuts do
not interrupt typing or the note picker. Left handed display changes the shown
hand labels while preserving the underlying notation.

## MP3 downloads

Open **Download MP3** in a rhythm or combo player, or **Export** in the composer.
Choose 1, 4, 8 or 16 repetitions, then select **Prepare MP3** and **Save MP3**. Rhythms default
to eight repetitions; combos and compositions default to one complete sequence.
The file captures the current pattern, tempo, and unmuted tracks when preparation
starts. It starts at the beginning and includes the final drum decay. Metronome,
count-in, and left-handed display settings do not affect the file. Invalid or
silent patterns and active composer recording cannot start an export.

Radio's **Download mix MP3** saves the exact full prepared mix, including its
shuffle order, even while Stay on this rhythm is active. Pending settings and
cancelled or failed replacement mixes leave the current download available.
Saving does not change playback. Browsers that support file sharing also offer
**Share MP3** for their native save/share sheet.

Encoding stays on the device and loads only when needed. Pattern exports use
the same 44.1 kHz, stereo, 128 kbps encoder as radio, with bounded PCM chunks,
progress, cancellation, and a 20-minute export limit including decay. Individual
pattern cycles are limited to three minutes. Browser downloads and decoded file
contents are covered by `tests/mp3-download.spec.ts` and
`tests/mp3-export-engine.spec.ts`. Physical iPhone and Android saving and external
player compatibility still require device checks.

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
