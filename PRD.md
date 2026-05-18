# Baque Fácil App PRD

## 1. Summary

The Baque Fácil App is a lightweight web application that helps maracatu teachers and learners document, share, practice, and hear rhythms through a simple text-based notation system.

The core workflow is:

1. A teacher or maintainer writes a rhythm in a Markdown file.
2. The file includes simple rhythm notation inside a fenced code block.
3. The website parses the notation and renders a beginner-friendly grid.
4. The learner can play the rhythm back using simplified instrument samples.
5. The learner can slow down, loop, mute tracks, and follow a visual playhead.

For the MVP, alfaia playback is intentionally simplified to two sounds:

- `R`: right-hand or accented alfaia hit
- `L`: left-hand or ghost-note alfaia hit

Other instruments such as gongue, caixa, mineiro, and agogo can be added through instrument-specific symbol maps.

The app is not intended to be a full digital audio workstation, score editor, or canonical maracatu archive. It is a practical class handout with sound: easy for teachers to author, easy for students to understand, and cheap to host.

## 2. Problem

Maracatu rhythms are often transmitted orally, visually, and physically in class. That works well in person, but it creates problems after class:

- Students forget the exact pattern.
- Audio recordings are hard to navigate.
- Standard music notation is inaccessible to many learners.
- PDFs without audio do not capture the groove.
- Videos are useful but not searchable or easy to edit.
- Teachers need a lightweight way to document rhythms without learning specialist notation tools or code.
- Existing notation tools are often too formal, too Western-notation-oriented, or too technical for this use case.

The result is that rhythm knowledge often lives across WhatsApp messages, Google Drive files, personal notes, voice memos, PDFs, videos, and memory.

## 3. Product Goal

Create a static, Markdown-based rhythm learning website where maracatu teachers can write simple text notation and learners can see, hear, loop, and practice rhythms using real instrument samples.

The product should feel closer to a practical class handout with playback than to formal music notation software.

## 4. Target Users

### 4.1 Teacher or Instructor

Teachers need to:

- Document rhythms quickly.
- Update rhythm files without touching application code.
- Share a link with students.
- Define simple symbols for each instrument.
- Add notes about feel, hand technique, context, and practice guidance.
- Avoid complex notation software.

Key assumption: teachers may be comfortable editing plain text, but should not be expected to write JavaScript, JSON, YAML-heavy data structures, ABC notation, MIDI, MDX, or formal staff notation.

### 4.2 Student or Learner

Learners need to:

- Hear the rhythm.
- See where each sound lands.
- Practice slowly.
- Repeat a loop.
- Understand simple symbols like `R`, `L`, `X`, and `.`.
- Learn without reading staff notation.
- Use the tool on a phone before or after class.

### 4.3 Maintainer or Developer

Maintainers need to:

- Add new rhythm files.
- Add instrument sample packs.
- Validate rhythm files.
- Keep the site static and cheap to host.
- Avoid building a complex CMS too early.

## 5. Non-Goals

The app should not initially attempt to be:

- A full DAW.
- A professional score editor.
- A replacement for GarageBand, Logic, Ableton, MuseScore, or Soundslice.
- A full collaborative platform.
- A social network.
- A MIDI composition tool.
- A marketplace.
- A real-time live-coding environment.
- A complete ethnomusicological archive.
- A source of canonical maracatu truth across all nacoes, groups, teachers, or traditions.

The app should respect that different teachers, groups, and traditions may use different versions of rhythms.

## 6. Core Concept

Each rhythm is represented by a Markdown file with frontmatter metadata and a custom `rhythm` code block.

Example:

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

This is a beginner-friendly rhythm example.

```rhythm
Gongue:
X . . x | . X . . | x . X . | . x . .

Alfaia:
. . L R | . . L R | . . . R | . . . .
```
````

The site parses the `rhythm` block and renders an interactive rhythm card with visual grid, legend, audio controls, and practice notes.

## 7. Authoring Format

### 7.1 Why Custom Notation

Existing notation formats are not ideal for the first version:

- Standard notation is inaccessible for many learners.
- ABC notation is powerful but too formal and unfamiliar.
- MDX and JSX are too technical for teachers.
- JSON and YAML arrays are developer-friendly but not teacher-friendly.
- DAW grids are visual but not easy to version-control or edit as text.

The app should use a tiny custom rhythm notation language designed for non-technical humans.

### 7.2 Basic Rules

A rhythm block contains one or more tracks. Each track starts with a name followed by a colon.

```text
Alfaia:
. . L R | . . L R | . . . R | . . . .
```

Rules:

- Track names end with `:`.
- Sounds are separated by spaces.
- `|` is visual grouping only and is ignored by playback.
- `.` or `-` means rest.
- Lines starting with `#` are comments.
- Empty lines are ignored.
- Every playable track should have the same number of steps.
- The app validates unknown symbols.
- The app returns friendly errors.

Example with comments:

```rhythm
# Basic example
Gongue:
X . . x | . X . . | x . X . | . x . .

# Alfaia foundation
Alfaia:
. . L R | . . L R | . . . R | . . . .
```

### 7.3 Default Symbols

| Symbol | Meaning |
| --- | --- |
| `R` | Right-hand alfaia hit or accent |
| `L` | Left-hand alfaia hit or ghost note |
| `X` | Strong bell or gongue hit |
| `x` | Light bell or gongue hit |
| `.` | Silence |
| `-` | Silence |

### 7.4 Future Alias Support

Aliases should eventually let teachers use natural variations:

```text
R = R
right = R
Right = R
r = R

L = L
left = L
Left = L
l = L

- = .
_ = .
```

Alias support is valuable but should not block the MVP.

## 8. Rendering Requirements

The rhythm block should render as a grid.

Example:

| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Gongue | X | . | . | x | . | X | . | . | x | . | X | . | . | x | . | . |
| Alfaia | . | . | L | R | . | . | L | R | . | . | . | R | . | . | . | . |

The grid must be usable on mobile.

Recommended mobile behavior:

- Horizontal scrolling grid for full detail.
- Beat-grouped columns to make the structure readable.
- Track rows with sticky track names.
- Larger visual treatment for the active step.
- Optional simplified beginner mode later.

## 9. Playback Requirements

### 9.1 Playback Engine

Use Tone.js for playback and scheduling.

The app should not implement a custom audio scheduler in v1.

Recommended split:

- Custom app code handles notation, parsing, validation, rendering, and UI state.
- Tone.js handles sample loading, scheduling, looping, transport, tempo, and playback.

### 9.2 Sample Mapping

Each instrument symbol maps to a sample.

Example:

```ts
export const sampleMap = {
  "Alfaia.R": "/samples/alfaia/right-accent.wav",
  "Alfaia.L": "/samples/alfaia/left-ghost.wav",
  "Gongue.X": "/samples/gongue/high-loud.wav",
  "Gongue.x": "/samples/gongue/low-light.wav",
} as const;
```

### 9.3 Timing Model

For v1:

- Tempo is defined in BPM.
- Subdivision defaults to `16`.
- One step equals one 16th note.
- The rhythm repeats as a loop.
- A 16-step rhythm represents one bar of 4/4 at 16th-note subdivision.

Example:

```text
Tempo: 90 BPM
Subdivision: 16
Steps: 16
Cycle: 1 bar of 4/4
```

### 9.4 Playback Controls

MVP controls:

- Play.
- Stop.
- Restart.
- Loop on/off.
- Tempo slider.

High-value next controls:

- Mute track.
- Solo track.
- Count-in.
- Metronome toggle.
- Original tempo button.
- 50%, 75%, and 100% practice speed buttons.
- Visual playhead.

## 10. Practice Features

The app should support a learning sequence:

1. Listen.
2. Say.
3. See.
4. Play slowly.
5. Loop.
6. Add layers.

Each rhythm page should support:

- Generated playback.
- Real recording, if available.
- Slow version, if available.
- Spoken counting, if available.
- Video reference, if available.

The app should also render a chantable syllable line.

Example:

```text
R - - - - L R - R - - L - - - -
```

This is important for learners who do not read notation and need a vocalizable memory aid.

## 11. Rhythm Page Structure

Each rhythm page should include:

- Title.
- Short description.
- Tempo.
- Difficulty.
- Instruments.
- Audio controls.
- Rhythm grid.
- Syllable line.
- Legend.
- Practice instructions.
- Feel notes.
- Optional video or real recording.
- Optional source, teacher, group, or version notes.

Recommended page outline:

```markdown
# Baque Example - Alfaia

## Listen

Generated playback controls.

## Rhythm

Rendered grid.

## Say It

R - - - - L R - R - - L - - - -

## Practice

Step-by-step instructions.

## Feel

Notes about weight, timing, accents, and body feel.

## Notes

Teacher-specific or group-specific context.
```

## 12. MVP Scope

### 12.1 Must Have

- Static website.
- One Markdown file per rhythm.
- Frontmatter metadata.
- Custom `rhythm` code block.
- Parser for rhythm blocks.
- Friendly validation errors.
- Grid renderer.
- Tone.js sample playback.
- Basic sample map.
- Play, stop, restart, loop, and tempo controls.
- At least one simplified alfaia sample set with `R` and `L` sounds.
- Support for multiple tracks in one rhythm.
- Basic rhythm index page.

### 12.2 Should Have

- Mute and solo tracks.
- Visual playhead.
- Legend rendering.
- Syllable rendering.
- Real recording link.
- Video embed.
- Tags, difficulty, and instrument metadata.
- Print-friendly page.

### 12.3 Could Have

- QR code per rhythm.
- Rhythm playground page.
- Teacher preview before publishing.
- Alias support.
- Multiple sample sets.
- Count-in.
- Metronome toggle.
- Export PDF.
- Export PNG rhythm card.
- Formal notation export.

### 12.4 Not Now

- User accounts.
- Database.
- CMS.
- Social features.
- Comments.
- Payments.
- Real-time collaboration.
- Mobile app.
- Full DAW features.
- Complex rhythm grammar with repeats, dynamics, swing, or humanization.

## 13. Recommended Technical Guidance

### 13.1 Recommended Stack

Use this stack for v1:

- Astro for the static site framework.
- Astro Content Collections for typed Markdown rhythm files.
- TypeScript for parser, validation, and playback code.
- React islands for interactive playback controls where needed.
- Tone.js for audio scheduling, transport, looping, and sample playback.
- Zod for validating frontmatter and parsed rhythm data.
- Vitest for parser and validation unit tests.
- Playwright for a small set of rendering and playback smoke tests.
- ESLint and Prettier for code quality and formatting.
- GitHub Pages, Netlify, Vercel, or Cloudflare Pages for hosting.

Recommendation: use Astro for v1 because the product is primarily a content-driven static site with a few interactive islands. Next.js with MDX is viable, but it adds server/application assumptions that are unnecessary for the first version.

### 13.2 Recommended Libraries

| Need | Recommended Tool | Reason |
| --- | --- | --- |
| Static content site | Astro | Simple static output with interactive islands |
| Markdown content | Astro Content Collections | Typed content and build-time validation |
| Interactivity | React islands | Mature component model for player controls |
| Audio scheduling | Tone.js | Proven browser audio scheduling and samples |
| Schema validation | Zod | Friendly TypeScript validation |
| Unit tests | Vitest | Fast tests for parser and validator |
| Browser smoke tests | Playwright | Confirms pages render and controls mount |
| Styling | CSS modules or scoped Astro styles | Avoid heavy UI framework early |
| Deployment | Cloudflare Pages, Netlify, Vercel, or GitHub Pages | Cheap static hosting |

### 13.3 Tools to Avoid in v1

- A database.
- A CMS.
- User authentication.
- Realtime collaboration.
- Server-side rendering requirements.
- MIDI-first architecture.
- A visual score editor.
- A complex parser generator.
- Heavy design systems or component frameworks unless the UI grows materially.

These tools may become useful later, but they increase surface area before the core learning artifact has been validated.

## 14. Suggested Architecture

### 14.1 High-Level Architecture

```text
Markdown rhythm files
        |
        v
Astro Content Collections
        |
        v
Rhythm block extractor
        |
        v
Parser + validator
        |
        +---------------------+
        |                     |
        v                     v
Static rhythm page       Build/runtime errors
        |
        v
Interactive player island
        |
        v
Tone.js sample playback
```

### 14.2 Recommended File Structure

```text
src/
  content/
    config.ts
    rhythms/
      baque-example.md
      virada-example.md
  components/
    AudioControls.tsx
    Legend.astro
    RhythmGrid.astro
    RhythmPageHeader.astro
    RhythmPlayer.tsx
    SyllableLine.astro
  lib/
    countLabels.ts
    extractRhythmBlocks.ts
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
  recordings/
  videos/
tests/
  parseRhythm.test.ts
  validateRhythm.test.ts
```

### 14.3 Internal Rhythm Model

MVP model:

```ts
export type Rhythm = {
  title: string;
  slug: string;
  tempo: number;
  subdivision: 16;
  difficulty?: "beginner" | "intermediate" | "advanced";
  tracks: RhythmTrack[];
};

export type RhythmTrack = {
  name: string;
  steps: string[];
};
```

Future model:

```ts
export type RhythmStep = {
  symbol: string;
  normalizedSymbol: string;
  sampleKey?: string;
  velocity?: number;
  metadata?: Record<string, unknown>;
};

export type RhythmTrack = {
  name: string;
  steps: RhythmStep[];
  muted?: boolean;
  solo?: boolean;
};
```

### 14.4 Parser Responsibilities

The parser should:

- Read a `rhythm` code block.
- Identify track headers.
- Parse symbols separated by whitespace.
- Ignore `|`.
- Ignore empty lines.
- Ignore comments starting with `#`.
- Normalize rests.
- Validate equal step count.
- Validate known symbols.
- Return line numbers for errors where possible.

Example input:

```rhythm
Alfaia:
R . . . | . L R . | R . . L | . . . .
```

Example output:

```json
{
  "tracks": [
    {
      "name": "Alfaia",
      "steps": ["R", ".", ".", ".", ".", "L", "R", ".", "R", ".", ".", "L", ".", ".", ".", "."]
    }
  ]
}
```

### 14.5 Validation Responsibilities

Validation errors should be written for teachers, not parser authors.

Bad:

```text
ParseError: unexpected token line 12
```

Good:

```text
Alfaia has 15 steps, but Gongue has 16.
Check the Alfaia row near bar 4.
Expected 16 steps for a 4/4 rhythm with 16th-note subdivision.
```

Important validation cases:

- Missing track name.
- Unknown sound symbol.
- Unequal track lengths.
- Empty rhythm block.
- Unsupported subdivision.
- Missing sample for known symbol.
- Invalid tempo.
- Duplicate track names.

### 14.6 Playback Architecture

The playback layer should consume the parsed rhythm model, not the raw Markdown.

Recommended flow:

1. `RhythmPlayer` receives a validated `Rhythm`.
2. It builds Tone.js players from `sampleMap`.
3. It schedules each non-rest step on a repeating sequence.
4. It updates UI state for the visual playhead.
5. It applies tempo, loop, mute, and solo state.

Keep sample mapping centralized so symbol behavior remains consistent across rhythm pages.

### 14.7 Build-Time vs Runtime Validation

Prefer build-time validation for committed rhythm files:

- Broken rhythm files should fail the build or show clear build output.
- The generated site should not silently publish malformed rhythms.

Runtime validation is useful later for the rhythm playground:

- A teacher pastes notation into a textarea.
- The app renders live errors.
- The app previews the grid and playback before the rhythm is committed.

## 15. Sample Requirements

### 15.1 Initial Sample Set

At minimum:

- Alfaia right/accent hit.
- Alfaia left/ghost-note hit.
- Gongue high/strong hit.
- Gongue low/light hit.

Optional later:

- Caixa or tarol.
- Mineiro.
- Agogo.
- Multiple alfaias.
- Room and dry variants.

### 15.2 Sample Quality

Samples should be:

- Short.
- Clean.
- Trimmed tightly.
- Reasonably normalized.
- Free of long silence.
- Consistent in volume.
- Usable in loops without excessive reverb.

Generated playback is not expected to perfectly reproduce a real maracatu ensemble. It is a practice aid.

## 16. Editing Workflow

### 16.1 Initial Workflow

For v1:

1. Teacher or maintainer edits a Markdown file.
2. File is committed to Git.
3. Static site rebuilds.
4. Rhythm page updates.

This is simple, but may still be too technical for some teachers.

### 16.2 Future Workflow

Later:

1. Teacher opens a rhythm playground.
2. Teacher edits notation in a textarea.
3. App shows live preview.
4. App plays the rhythm.
5. Teacher saves or sends the file to the maintainer.

Even later:

- Admin UI.
- GitHub API save.
- Auth.
- Draft and publish workflow.

Do not build this in v1 unless the file-based workflow fails.

## 17. Rhythm Playground

A future rhythm playground should let users paste a rhythm block and immediately render and play it.

Example:

```text
[textarea]

Alfaia:
R . . . | . L R . | R . . L | . . . .

[Render]
[Play]
```

This is valuable because it helps teachers validate notation before committing it.

## 18. Print and QR Code

Each rhythm should eventually have a print-friendly card:

- Title.
- Tempo.
- Legend.
- Grid.
- Practice steps.
- QR code to rhythm page.

Use case: a teacher prints the rhythm card for class. Students scan the QR code to hear the rhythm and practice at home.

## 19. User Stories

### Teacher Stories

- As a teacher, I want to write a rhythm in a simple text format so that I can document class material without using music notation software.
- As a teacher, I want to define rhythms for multiple instruments so that students can practice in context.
- As a teacher, I want the app to tell me if the rhythm file is broken so that I can fix mistakes before students see it.
- As a teacher, I want to add notes about feel and technique so that the rhythm is not reduced to mechanical timing.

### Student Stories

- As a student, I want to hear the rhythm so that I know what it should sound like.
- As a student, I want to see a simple grid so that I understand where each hit lands.
- As a student, I want to slow the rhythm down so that I can practice gradually.
- As a student, I want to loop the rhythm so that I can repeat it without touching the controls.
- As a student, I want to mute or solo instruments so that I can focus on my part.
- As a student, I want to open the rhythm on my phone so that I can practice before class.

### Maintainer Stories

- As a maintainer, I want rhythm files to be version-controlled so that changes are easy to review and revert.
- As a maintainer, I want a reusable parser so that every rhythm uses the same notation rules.
- As a maintainer, I want sample mappings to be centralized so that symbols behave consistently.

## 20. Recommended MVP Build Plan

### Step 1: Prototype Parser

Build a simple parser for rhythm blocks.

Input:

```rhythm
Alfaia:
R . . . | . L R . | R . . L | . . . .
```

Output:

```json
{
  "tracks": [
    {
      "name": "Alfaia",
      "steps": ["R", ".", ".", ".", ".", "L", "R", ".", "R", ".", ".", "L", ".", ".", ".", "."]
    }
  ]
}
```

### Step 2: Render Grid

Display count row and one or more instrument rows.

### Step 3: Add Samples and Tone.js Playback

Map symbols to samples and play the rhythm as a loop.

### Step 4: Add Rhythm Pages

Use Markdown files and generate one route per rhythm.

### Step 5: Add Controls

Add:

- Play.
- Stop.
- Loop.
- Tempo slider.
- Mute and solo.

### Step 6: Add Validation

Add friendly validation errors and unit tests for malformed rhythm files.

### Step 7: Create First Real Rhythm Set

Create 3 to 5 rhythms based on actual class material.

## 21. MVP Acceptance Criteria

The MVP is complete when:

- A developer can add a rhythm as a Markdown file.
- The Markdown file contains a teacher-friendly rhythm block.
- The site renders that rhythm as a grid.
- The site plays the rhythm using Tone.js and samples.
- The user can play, stop, loop, and change tempo.
- The rhythm can include at least two instruments.
- The app shows useful validation errors for malformed rhythm files.
- At least 3 real example rhythms exist.
- The site can be deployed as static assets.
- Rhythm pages are usable on mobile.

## 22. Risks and Mitigations

### 22.1 Overengineering

Risk: building a platform before validating the learning artifact.

Mitigation:

- Start with a tiny static site.
- Build 3 to 5 real rhythms.
- Test with actual learners.
- Add complexity only after repeated pain.

### 22.2 Wrong Abstraction

Risk: if the notation is too technical, teachers will not use it.

Mitigation:

- Let teachers write rhythm-like text, not JSON.
- Keep symbols short and natural.
- Prioritize friendly errors.

### 22.3 Playback Feels Mechanical

Risk: generated playback may sound too stiff and fail to communicate groove.

Mitigation:

- Treat generated playback as a practice aid, not the final musical reference.
- Allow real recording and video references on each rhythm page.
- Consider velocity, timing, and humanization later only after the basic tool works.

### 22.4 Cultural and Contextual Flattening

Risk: the app could accidentally imply that one transcription is the canonical version of a rhythm.

Mitigation:

- Label rhythms by teacher, source, group, and version where appropriate.
- Allow notes about context.
- Avoid naming patterns as universal unless appropriate.

### 22.5 Teacher Editing Friction

Risk: Git and Markdown may still be too technical for some teachers.

Mitigation:

- Start with maintainer-assisted editing.
- Add a playground/editor later.
- Provide copy-paste templates.

## 23. FAQ

- What should the app be called publicly? Baque Fácil
- Should rhythm pages identify teacher, group, date, or version in metadata? Yes
- Should sample packs be recorded specifically for this app?
- Should the first version support Portuguese, English, or both? English, but ready to support both when it's time.

## 24. Product Philosophy

The app should optimize for:

- Learning over formal correctness.
- Sound over notation.
- Teacher editability over technical purity.
- Phone usability over desktop complexity.
- Small files over databases.
- Clear constraints over flexible chaos.
- Real musical context over isolated symbols.

The product should make maracatu rhythms easier to remember, practice, and share without forcing teachers or students into tools that do not fit the way the music is learned.
