# Repository Guidelines

## Project Structure & Module Organization

This is an Astro 4 project with React used for the interactive rhythm player.
Page routes live in `src/pages/`, including the rhythm detail route at
`src/pages/rhythms/[slug].astro`. Shared parsing and validation code lives in
`src/lib/`, while React UI lives in `src/components/`. Global styles are in
`src/styles/global.css`. Rhythm lessons are Markdown content entries under
`src/content/rhythms/`, validated by `src/content/config.ts`. Audio samples are
served from `public/samples/`, grouped by instrument.

## Build, Test, and Development Commands

- `npm install`: install dependencies from `package-lock.json`.
- `npm run dev`: start the Astro development server.
- `npm run build`: run Astro's production build and type/content checks.
- `npm run preview`: serve the built site locally after `npm run build`.

There is no committed test or lint script yet. Use `npm run build` as the
minimum verification step before opening a pull request.

## Coding Style & Naming Conventions

Use TypeScript with Astro's strict configuration. Keep imports explicit and
prefer named exports for shared utilities in `src/lib/`. Follow the existing
style: two-space indentation, double quotes, semicolons, and concise function
names such as `parseRhythm` or `validateRhythm`. React components use PascalCase
file and export names, for example `RhythmPlayer.tsx`. Content slugs and sample
paths should be lowercase and hyphenated, such as `src/content/rhythms/virada.md`
and `public/samples/alfaia/right-accent.wav`.

## Content & Asset Guidelines

Rhythm Markdown files require frontmatter fields defined in
`src/content/config.ts`: `title`, `tempo`, `subdivision`, `difficulty`, and
`instruments`. Rhythm notation belongs in a fenced `rhythm` code block. Track
headers end with `:`, rests may be written as `.` or `-`, and bar separators
use `|`. When adding symbols, make sure corresponding sample keys exist in
`src/lib/sampleMap.ts`.

## Testing Guidelines

No automated test framework is configured. For logic changes in `src/lib/`,
prefer adding a focused test setup before expanding behavior. Until then, verify
with `npm run build` and manually exercise playback, mute controls, tempo
changes, and representative rhythm pages in the dev server.

## Commit & Pull Request Guidelines

The current Git history is minimal and uses short imperative messages, for
example `create PRD`. Keep commits focused and use direct, present-tense
subjects such as `add rhythm validation`. Pull requests should describe the
change, list verification steps, link related issues or specs when available,
and include screenshots or recordings for visible UI or playback changes.
