# Initial Prototype Implementation Plan

## Purpose

Create the smallest possible web application prototype for Baque Fácil that validates two core assumptions from `PRD.md`:

1. Tone.js is the right playback and scheduling tool for this use case.
2. A teacher-authored Markdown rhythm file can be parsed into a playable rhythm with timing accurate enough for practice.

This plan intentionally does not define a polished app. Styling, production-level test coverage, CMS features, authentication, editor workflows, and deployment automation are out of scope for the first prototype.

## Prototype Goal

Build a rough static site where one Markdown rhythm file produces:

- A rhythm detail page.
- A parsed rhythm grid.
- Basic generated playback through Tone.js.
- Play, stop, loop, and tempo controls.
- A visible playhead that confirms scheduling alignment.

The prototype should answer:

- Can the notation format be easy enough for a teacher to write?
- Can the parser produce a predictable step sequence from Markdown?
- Can Tone.js schedule the rhythm accurately at common practice tempos?
- Does the visual playhead stay aligned with the audio?
- Are sample-based sounds sufficient for a first learning aid?

## Recommended Tooling

Use the PRD-recommended stack, but keep the implementation minimal:

- Astro: static site framework.
- Astro Content Collections: load Markdown rhythm files.
- TypeScript: parser, validation, rhythm types, sample map, and player logic.
- React island: interactive audio player and controls.
- Tone.js: sample loading, transport, tempo, looping, and step scheduling.
- Zod: frontmatter validation only.
- Plain CSS or minimal Astro component styles.

Do not add tests for this prototype. Manual validation is enough for this phase.

## Implementation Constraints

- Do not build a CMS.
- Do not build a teacher editor.
- Do not build user accounts.
- Do not build MIDI export.
- Do not build formal notation export.
- Do not optimize styling.
- Do not support complex rhythm grammar.
- Do not add aliases in the first pass unless the parser is already working cleanly.
- Do not support swing, humanization, repeats, dynamics, or nested sections.

## Proposed File Structure

```text
package.json
astro.config.mjs
tsconfig.json
src/
  content/
    config.ts
    rhythms/
      baque-example.md
  components/
    RhythmGrid.astro
    RhythmPlayer.tsx
  lib/
    countLabels.ts
    extractRhythmBlock.ts
    parseRhythm.ts
    rhythmTypes.ts
    sampleMap.ts
    validateRhythm.ts
  pages/
    index.astro
    rhythms/
      [slug].astro
public/
  samples/
    alfaia/
      right-accent.wav
      left-ghost.wav
    gongue/
      high-loud.wav
      low-light.wav
```

If real samples are not immediately available, use clearly named placeholder samples for the prototype. The validation target is scheduling and workflow, not sample quality.

## Prototype Data Contract

### Markdown Rhythm File

The initial content file should include frontmatter and one `rhythm` block:

````markdown
---
title: "Baque Example - Alfaia"
slug: "baque-example-alfaia"
tempo: 90
subdivision: 16
difficulty: "beginner"
instruments:
  - "Gongue"
  - "Alfaia"
---

# Baque Example - Alfaia

Short teacher-facing description.

```rhythm
Gongue:
X . . x | . X . . | x . X . | . x . .

Alfaia:
. . L R | . . L R | . . . R | . . . .
```
````

### Parsed Rhythm Model

The parser should output a simple normalized model:

```ts
type Rhythm = {
  title: string;
  slug: string;
  tempo: number;
  subdivision: 16;
  tracks: RhythmTrack[];
};

type RhythmTrack = {
  name: string;
  steps: string[];
};
```

The first prototype does not need the future `RhythmStep` object model.

## Parser Plan

Build a small parser in `src/lib/parseRhythm.ts`.

Required behavior:

- Accept the raw text inside a `rhythm` code block.
- Split input by lines.
- Ignore empty lines.
- Ignore comment lines beginning with `#`.
- Treat lines ending in `:` as track headers.
- Treat subsequent token lines as steps for the active track.
- Split steps by whitespace.
- Ignore `|`.
- Normalize `-` to `.`.
- Preserve playable symbols exactly: `R`, `L`, `X`, `x`.
- Return track names and normalized step arrays.

The first parser should be deliberately small and boring. Avoid a parser generator.

## Rhythm Block Extraction Plan

For the initial prototype, extract the first `rhythm` fenced code block from the Markdown body.

Implementation approach:

- Prefer a simple Markdown-aware utility if Astro exposes the raw body cleanly.
- Otherwise use a narrow regular expression for the prototype: find the first block matching ```` ```rhythm ... ``` ````.

This is acceptable for validation because the code block format is tightly constrained. If the product grows, replace this with a proper Markdown AST pass.

## Validation Plan

Build lightweight validation in `src/lib/validateRhythm.ts`.

Required validations:

- Rhythm block exists.
- At least one track exists.
- Track names are not duplicated.
- Every track has at least one step.
- All tracks have the same number of steps.
- Symbols are known for the instrument.
- Every playable symbol maps to a sample.
- Tempo is a positive number.
- Subdivision is `16`.

Friendly error examples:

```text
Alfaia has 15 steps, but Gongue has 16.
Each track must have the same number of steps.
```

```text
Unknown symbol "Q" in Alfaia.
Allowed symbols for Alfaia are R, L, ., and -.
```

For the prototype, errors may render directly on the rhythm page instead of failing the build.

## Sample Map Plan

Centralize symbol-to-sample mapping in `src/lib/sampleMap.ts`.

Initial mapping:

```text
Alfaia.R -> /samples/alfaia/right-accent.wav
Alfaia.L -> /samples/alfaia/left-ghost.wav
Gongue.X -> /samples/gongue/high-loud.wav
Gongue.x -> /samples/gongue/low-light.wav
```

Rests:

- `.` has no sample.
- `-` is normalized to `.` and has no sample.

The map should be keyed by `TrackName.Symbol` because the same symbol may eventually mean different things for different instruments.

## Playback Plan

Build playback as a React island in `src/components/RhythmPlayer.tsx`.

Input props:

- Parsed rhythm model.
- Sample map entries needed by that rhythm.

Tone.js responsibilities:

- Load samples with `Tone.Player` or `Tone.Players`.
- Start audio context on user interaction.
- Use `Tone.Transport.bpm.value` for tempo.
- Use a repeating sequence to schedule each step.
- Trigger each track's sample at the scheduled Tone.js time.
- Loop over the full step count.

Timing assumptions:

- `subdivision: 16` means every step is a 16th note.
- At 90 BPM, one quarter note is 666.67ms.
- One 16th note is 166.67ms.
- A 16-step rhythm loops every 4 beats.

Recommended scheduling model:

```text
stepDuration = "16n"
loopLength = numberOfSteps * one 16th note
schedule one callback per step
inside each step callback, trigger all track samples that are not rests
```

Do not attempt humanization in the prototype. Mechanical timing is useful for validating the parser-to-playback chain.

## Visual Grid Plan

Build `src/components/RhythmGrid.astro`.

Responsibilities:

- Render a count row.
- Render one row per track.
- Render one cell per step.
- Use simple labels for 16th-note counts: `1 e & a 2 e & a 3 e & a 4 e & a`.
- Highlight the active step when passed from the React player, if convenient.

If cross-framework state sharing between Astro and React adds friction, render the grid inside the React player for the prototype. The important validation is audio-to-visual alignment, not component purity.

## Pages Plan

### `src/pages/index.astro`

Render a bare list of rhythm links from the content collection.

Minimum fields:

- Title.
- Tempo.
- Difficulty.

### `src/pages/rhythms/[slug].astro`

Render:

- Title.
- Tempo.
- Difficulty.
- Markdown content.
- Validation errors, if any.
- Rhythm grid.
- Player controls.

If parsing fails, the page should show the raw error and not mount the player.

## Control Plan

Minimum controls:

- Play.
- Stop.
- Restart.
- Loop on/off.
- Tempo slider.

Useful but optional if easy:

- Mute track.
- Solo track.

Skip count-in and metronome for the first prototype unless Tone.js integration is already straightforward.

## Manual Validation Checklist

Use this checklist to decide whether the prototype validates the idea.

### Tone.js Suitability

- Playback starts reliably after a user click.
- Samples load without awkward delay after the first interaction.
- Tempo changes while stopped work.
- Tempo changes while playing are acceptable or can be restarted cleanly.
- Looping is stable for at least 2 minutes.
- Multiple tracks can trigger on the same step without obvious scheduling drift.
- Stop and restart behave predictably.

### Markdown-to-Sound Timing

- The number of visual steps equals the number of scheduled playback steps.
- Step 1 audio aligns with the playhead on step 1.
- A 16-step rhythm at 90 BPM loops approximately every 2.667 seconds.
- Muting one track, if implemented, does not affect timing of the others.
- Changing a Markdown symbol changes the corresponding audio event.
- Adding or removing a step produces a useful validation error.
- `|` group markers do not affect timing.
- Rests do not trigger audio.

### Teacher Authoring

- A non-developer can understand the rhythm file after seeing one example.
- The rhythm block is easier to read than JSON or arrays.
- Friendly errors point to the track and symbol problem.

## Prototype Acceptance Criteria

The prototype is successful when:

- Running the local dev server shows an index page.
- The index page links to one rhythm page.
- The rhythm page is generated from a Markdown file.
- The rhythm block is parsed into track rows.
- The grid displays the same sequence as the Markdown block.
- The player uses Tone.js to play at least Alfaia and Gongue samples.
- The loop timing is stable enough for practice.
- Tempo can be changed.
- The visual playhead can be used to judge timing alignment.
- A malformed rhythm produces a readable error.

## Suggested Build Sequence

1. Scaffold Astro with TypeScript.
2. Add React integration for the player island.
3. Add Tone.js and Zod.
4. Configure Astro Content Collections for rhythm Markdown files.
5. Add one example rhythm file.
6. Implement rhythm block extraction.
7. Implement parser.
8. Implement validation.
9. Render rhythm index page.
10. Render rhythm detail page and grid.
11. Add sample files and sample map.
12. Build Tone.js player with play, stop, loop, and tempo.
13. Add a visual playhead.
14. Manually validate timing against the checklist.
15. Write notes on whether Tone.js feels like the right tool.

## Decision Record to Capture After Prototype

After building and manually testing, record these decisions:

- Keep Tone.js or replace it?
- Use `Tone.Sequence`, `Tone.Part`, or direct `Transport.scheduleRepeat`?
- Keep one step as exactly one 16th note?
- Is the Markdown rhythm block friendly enough?
- Should validation happen at build time, runtime, or both?
- Are real samples required before this can be evaluated by students?
- Is the playhead accurate enough to teach with?
- Is the static-site workflow acceptable for adding the first 3 to 5 rhythms?

## Explicit Non-Code Status

This document is only a plan. It does not create the application, install dependencies, scaffold Astro, add source files, or add sample audio.
