# Baque Facil Roadmap

This roadmap is based on the current codebase, `PRD.md`, `TODO.md`, and the
additional requested v1 items.

## Current Baseline

The app already has:

- Astro static pages for the rhythm index, rhythm detail pages, and an Alfaia
  composer.
- Markdown rhythm content with frontmatter and fenced `rhythm` blocks.
- Parser, validator, count labels, tempo clamping, and sample mapping utilities.
- Tone.js playback with a Play/Stop toggle, Restart, Loop, tempo control, mute
  controls, and a visual playhead.
- Rhythm pages that attempt autoplay through the `autoPlay` prop.
- An Alfaia composer that records into a grid, previews playback, and copies
  compatible Markdown.

Known gaps:

- There are no committed unit tests or browser tests.
- `trovao.md` appears to have a step-count/content issue that likely explains
  the current sound problem.
- Some rhythm content still has placeholder notes, stray examples, or metadata
  mismatches.
- Validation is shown at runtime on rhythm pages, but committed rhythm files do
  not currently fail the production build when invalid.
- Mute controls, loop control, and back navigation work but need UI polish.
- The composer supports in-memory editing, but not local saving, JSON
  import/export, collection grouping, or share links.

## V1 Must Have

### Your Items

- Clean committed rhythms so notation, frontmatter instruments, titles, notes,
  and examples are consistent.
- Add iOS-only audio help:
  - One-time Silent Mode modal.
  - Troubleshooting link on the bottom to a step-by-step help page if they can't hear a sound.
- Auto-scroll the rhythm grid with the active playhead.
- Split long transcriptions into rows of max 16 subdivisions.
- Improve Compose editing:
  - Fix key repeat so holding a key triggers only once until keyup.
  - Fix mobile delay when touching hit buttons.
  - Allow note adjustment with arrow-key navigation.
  - When pressing `R`, `L`, or `.`, write that value into the selected slot and
    advance to the next slot.
- Refactor player/composer code enough to support these changes safely.
- Add unit tests and browser tests.

### Suggested Additions

- Add build-time rhythm validation so broken committed rhythm files fail
  `npm run build`.
- Validate frontmatter/content mismatches, especially when notation includes
  instruments not listed in frontmatter.
- Add a small rhythm legend for the current symbols.
- Add clearer audio loading/error states for missing samples, blocked audio, or
  failed sample loading.
- Define v1 acceptance checks covering:
  - `npm run build`.
  - Parser and validator unit tests.
  - Rhythm playback controls.
  - Composer keyboard editing.
  - Mobile hit-button latency.
  - Mute controls.
  - Mobile layout.

## V1 Nice To Have

### Your Items

- Create the first `.baque.json` collection schema.
- Export rhythms or collections as `.baque.json`.
- Import `.baque.json`.
- Save collections locally in the browser.
- Group locally created rhythms into collections.
- Create a quiz page where students practice matching rhythm codes such as `1`,
  `2`, and `3` with the rhythm name and the rhythm sound.
- Add dark mode.
- Add Portuguese translation.

### Suggested Additions

- Keep Markdown as the committed source format and use `.baque.json` for
  import/export/share.
- Add a simple `localStorage` "My Library" without accounts or a backend.
- Add practice speed shortcuts such as 50%, 75%, and 100%.
- Add print-friendly rhythm pages.
- Add source/version metadata fields such as teacher, group, source, and notes.

## Later

### Your Items

- Share collections by link.
- Open shared collection links with preview, save-to-library, and play-now
  actions.
- Add "Play all" and "Practice selected" collection flows.
- Add "Submit to public library".
- Add hand gesture support for rhythms.

### Suggested Additions

- Add backend storage only after local import/export and sharing prove useful.
- Add user accounts only if cross-device sync, private libraries, or public
  submissions require them.
- Add public-library moderation before accepting submitted rhythms.
- Add richer playback later: solo, count-in, player metronome, multiple sample
  packs, velocity, and humanization.
- Add real recordings or video references per rhythm.
- Add QR-code rhythm cards for classes.
- Add a proper syntax-highlighting setup for `rhythm` blocks if the current
  Shiki warning becomes a problem.
