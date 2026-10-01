# Offline Mode Implementation Plan

## Implementation brief

Make Baque Fácil usable without an internet connection after one complete
download. Save the application, every built-in rhythm sequence, and the drum
samples on the device. Browsing, rhythm playback, composing, the listening quiz,
and generating new radio mixes must all work offline, including on pages the
learner has never opened before.

Add progressive web app support so learners can optionally put Baque Fácil on
their home screen. Offline use must also work in an ordinary supported browser
tab; installation is optional.

Download updates automatically while connected. Apply a completed update after
the previous app sessions have closed, keeping a playing rhythm or unfinished
composition intact. An offline device continues using its last complete version
until it reconnects and downloads an update.

Status: implemented, with automated verification recorded below. Readiness,
download errors, installation, and update notices appear discreetly in the footer.
Settings also offers an explicit “Refresh offline app” recovery action. All
offline controls and messages support English (Canada) and Portuguese (Brazil).
Physical phone checks and deployment-host verification remain release checks.

## Scope

The first release includes:

- All built-in rhythm and combo pages, their notation, and playback controls.
- The blank composer and every built-in rhythm's Customize page, including hit
  input, recording, metronome, transcription editing, and preview playback.
- Quiz rounds and audio generated from the saved rhythm library.
- New radio mixes, Shuffle again, Skip, Stay, and tempo/settings changes using
  saved application code, sequences, and samples.
- The home page, images, help, and diagnostic pages.
- Download readiness, connection status, recoverable download errors, and a
  notice when an update is waiting for the next session.
- A web app manifest and home-screen icons.

Composer draft autosave, a personal rhythm library, cross-device sync, and
retaining generated radio recordings across restarts are separate features.
Existing local preferences remain in place. Radio recordings can be generated
again offline; an existing recording remains in memory only for its current
page session. Downloading app updates must never reload an open composer.

## Architecture and integration points

| Existing code | Implication for offline support |
| --- | --- |
| [Astro configuration](../astro.config.mjs) and [rhythm routes](../src/pages/rhythms/%5Bslug%5D.astro) | The site is statically generated. The production PWA integration inventories and caches its HTML, data, scripts, styles, and other local assets. |
| [Customize routes](../src/pages/compose/%5B...slug%5D.astro) and [radio route](../src/pages/radio.astro) | Sequences are embedded in generated pages and React props. Updating only a JSON file would leave these pages stale. |
| [Quiz endpoint](../src/pages/quiz/rhythms.json.ts) and [quiz component](../src/components/RhythmQuiz.tsx) | The build emits the quiz library as JSON. Each round requests it with `cache: "no-store"`; controlled sessions receive the service worker's saved version. |
| [Sample map](../src/lib/sampleMap.ts) and [sample loader](../src/lib/audio/sampleCache.ts) | All six drum sounds use local URLs. The existing decoded-buffer cache lives only in memory and does not provide offline storage. |
| [Player](../src/components/RhythmPlayer.tsx) and [radio generation](../src/lib/radio/generateMix.ts) | Tone.js and the MP3 encoder load on demand. Their complete production dependency trees must be saved before reporting offline readiness. |
| [Composer](../src/components/RhythmComposer.tsx) | Both Web Audio fetching and HTML audio fallbacks need access to saved samples. |
| [Playwright configuration](../playwright.config.ts) and [offline configuration](../playwright.offline.config.ts) | The existing suite uses the development server; the separate offline suite serves production builds and exercises real service workers. |

The source contains 12 rhythm entries. The six WAV samples total 1,304,904 bytes.
The implemented production precache contains 68 resources totaling 6,883,604
bytes before transfer compression, including pages, bundles, icons, and images.
The worker itself is delivered separately. The hero image alone is about 3.2 MB;
the build's explicit 8 MiB per-file limit covers it and fails if a required asset
would be omitted. Recompute these figures from a fresh `dist/offline-build.json`
after changing content or dependencies.

## Download and update behavior

### First visit

1. Load the website normally and register its service worker in production. A
   service worker is the browser component that serves saved files when there
   is no connection. HTTPS is required in production; localhost supports tests.
2. Automatically download the complete offline package. Show “Preparing offline
   access…” without blocking normal use or starting audio.
3. Finish only when all required resources are successfully stored. If a file
   fails or storage is unavailable, keep the online app usable, explain that
   offline setup is incomplete, and offer Retry.
4. Allow the new worker to control the next normal navigation or reopening.
   Do not force a reload or claim an already open page. Until then, show “Offline
   files saved · ready on your next visit”; that first uncontrolled page may still need a connection
   for resources it has not loaded. Once a controlled page verifies the complete
   cache, show “Ready for offline use.” Reopening after the download can itself
   happen offline.

This conservative first-install behavior avoids combining a page loaded from one
deployment with a worker downloaded from another. Most learners finish setup by
following a normal link from the home page after the download completes.

### Normal offline use

Serve known pages, sequences, scripts, images, and audio samples from the active
saved version. Playback still requires the existing user interaction. Do not
disable practice just because the browser reports that it is offline.

Show a compact “Offline — using saved rhythms” status. A URL outside the saved
route set gets a useful offline fallback with a link to the saved home page;
it must not silently render the home page as though it were that route.

### Changed rhythms and application updates

1. The author edits the Markdown source and publishes a new production build.
   That rebuild includes every generated representation of the sequence.
2. Check for a worker update on app opening, reconnection, and return to the
   foreground, with throttling to avoid repeated checks. Checks run while the
   app is open; background delivery while it is closed is not guaranteed.
3. Download changed files into revisioned cache entries. Reuse unchanged entries,
   including unchanged drum sounds. Keep the active version available throughout.
4. A complete new worker waits while any tabs or installed windows still use the
   old version. Show “Update downloaded. Close all Baque Fácil windows and reopen
   to use it.” Pausing audio or hiding a tab does not end the session.
5. Let the browser activate the waiting version once those clients have closed.
   The next opening uses the new version, even without a connection. Only then
   remove obsolete cache entries.

Do not call `skipWaiting()` for automatic updates, automatically reload clients, or activate updates
because audio happens to be paused. Closing one tab while another stays open
must preserve the old version. A failed or interrupted update leaves the last
complete version usable and retries on a later connection or explicit Retry.

### Manual recovery from Settings

The home-page Settings disclosure includes **Refresh offline app**. Explain that
it downloads the app, rhythms, and sounds again, needs a connection, and keeps
preferences. Disable it while offline or a download is already running.

Before clearing anything, require other app tabs/windows to close and check the
uncached build report and worker against the download server. Unregister this
app's worker and delete only caches with the `baque-facil-` prefix. Leave language,
hand-display and radio preferences, plus unrelated browser storage, intact.

Register a worker using a unique recovery query on `/sw.js`; browsers may reuse
the old registration when its page is still open, so the different script URL
is necessary to force a fresh install. Precache fetches bypass the HTTP cache.
After every file is saved and verified, an explicit recovery message may call
`skipWaiting()` only if the requesting page is the sole app window. Reload that
page, reopen Settings, and show completion. Normal registrations retain the
recovery worker's URL so they do not create a redundant update.

A failed connection check leaves the saved copy intact. A failure after clearing
files reports incomplete offline access and allows the same button to retry.
Never mark a partial replacement ready or reload other clients.

For example, changing Marcação updates its player, Customize page, radio data,
and quiz data together. An open session keeps the previous sequence; after the
completed update activates, all four surfaces use the changed sequence offline.

## Technical design

### Build integration and resource inventory

Use Workbox through `@vite-pwa/astro`, with an `injectManifest` custom worker and
explicit client registration. Select and lock a version compatible with the
existing Astro 4 and Vite 5 stack. A framework upgrade is not part of this work.
Disable automatic registration and forced update activation in the integration;
keep workers disabled for the development server.

Generate the precache inventory from the completed Astro output, rather than
maintaining a hand-written list of rhythm slugs. Include:

- `/`, `/radio/`, `/quiz/`, `/compose/`, every `/rhythms/<slug>/` and
  `/compose/<slug>/`, help, diagnostics, and the new offline fallback page.
- `/quiz/rhythms.json` with its sequences and sample map.
- Every production JavaScript and CSS dependency, including dynamic imports,
  encoder workers, and any emitted WASM or other encoder assets.
- All sample WAVs, required images, icons, and the web app manifest.

Inspect the actual production encoder output to establish whether its worker
and binary data are embedded or emitted as separate files. Include emitted
dependencies and verify they require no remote service. Exclude source maps,
test artifacts, the service worker itself, and external links such as GitHub.

Use content revisions for stable URLs such as HTML, JSON, images, and WAV files;
use existing hashed URLs for bundled assets. Produce a build report with file
count, total bytes, largest files, and a release identifier derived from the
inventory. This identifier supports diagnostics and update assertions.

Include integrity hashes for fetched resources and validate them during
installation. Revisioned cache keys alone do not prove that the server returned
the expected bytes. If a deployment changes during the download, reject mismatched
files and leave the previous version active.

Configure file-size limits to cover the measured production output. Fail the
offline inventory check if a required asset is omitted, too large, missing, or
outside the allowed local resource set. A successful build must not silently
skip the hero image or encoder bundle. Recompute the inventory on every build,
including builds that change only rhythm content.

### Cache and request handling

Use Workbox's revisioned precache entries in an application-specific namespace.
The active worker reads only its own manifest's revisions. Installing a newer
worker may add new revisions, but it must not overwrite or delete entries used
by the active worker. Cleanup happens after safe activation and targets only
Baque Fácil caches; it must not clear preferences or unrelated origin storage.

For known app resources, use the active precache even while online. A
network-first HTML or quiz response could combine a new sequence with old pages
or missing new samples, so resource freshness comes through complete releases.
Use the browser's normal network behavior for unrelated online requests.

Normalize generated directory routes and supported trailing-slash variants to
their correct cached HTML files. Define query matching deliberately for URLs
whose query does not change content. Do not use a single-page-app catch-all:
Astro generates a separate document for each route. Return the cached offline
fallback only for a failed navigation outside the saved set.

Add explicit handling for sample requests with a `Range` header before the
general precache handler. Return the requested byte range from the complete
saved WAV using Workbox's range-response helper, with correct `206` headers and
`416` handling. Ordinary Web Audio fetches receive the complete file. Never
store a partial response as the full sample. Generated radio `blob:` URLs remain
local and are outside this HTTP caching path.

If saved resources are missing, do not keep claiming full readiness or silently
construct a mixed release from whichever unversioned files are online. Mark
the offline package incomplete. Provide a worker repair operation that downloads
missing entries while connected and verifies their recorded integrity hashes.
`registration.update()` alone will not repair deleted cache entries if the
worker script is unchanged. If the host no longer serves that release's bytes,
retain its remaining entries, download the next complete release, and use the
normal safe activation lifecycle. Only restore readiness after every required
entry is present and verified.

Register the root-scoped `/sw.js` using `updateViaCache: "none"`. Serve it with
revalidation-friendly headers, not an immutable CDN lifetime. Preserve immutable
caching for hashed assets. Verify the production host's route normalization,
headers, and atomic deployment behavior before rollout.

### Quiz behavior

Keep the existing JSON schema and per-round request path. For a controlled
session, the worker returns the active release's cached JSON immediately.
`cache: "no-store"` bypasses the browser's HTTP cache; it does not prevent a
service worker from supplying an explicit Cache Storage response. A new data
backend or duplicate library store is unnecessary.

This deliberately changes the current production promise that an open quiz sees
newly published rhythms on the next round. Under offline support, it uses one
consistent library until the downloaded release activates between sessions.
Update the component comment, README, and relevant tests to describe that rule.
Development and browsers without worker support can retain normal per-round
network fetching. Preserve existing quiz selection, retry, and insufficient-pool
behavior.

### Shared interface and installation

Add small shared Astro components for manifest metadata, registration, and a
compact footer status. Use a small dot, muted text, and inline actions; all
automatic indications belong in the footer, without banners or automatic prompts.
Keep manual refresh feedback beside its Settings button. Include
them on every HTML route without refactoring the
large player/composer components or requiring a new React island solely for
offline state. Keep styling in `src/styles/global.css`.

Treat connection state, verified offline availability, and a pending update as
separate facts: a device can be online but not ready, or offline with everything
saved. Check readiness through the active worker and the expected cache entries,
not a stored boolean or `navigator.onLine` alone. Recheck on opening/foreground
and after resource errors. Use accessible status text and a focused Retry action;
avoid repeated announcements on every quiz round.

Add a manifest with stable identity, name “Baque Fácil,” root scope, `/` start
URL, standalone display, and the existing theme colors. Include suitable 192 px
and 512 px icons, a maskable icon, and an Apple touch icon. Offer browser-supported
installation only when available, with concise iOS Add to Home Screen guidance.
Home-screen installation and offline-download readiness are independent states.

Browser storage can be cleared or evicted, so avoid promises of permanent
availability. If this happens, recover while connected and update the readiness
status. A first-ever visit, or a fully cleared site, cannot load offline before
its files have been downloaded. Private modes and unsupported browsers should
retain the normal online experience with accurate availability messaging.

## Implementation sequence

| Step | Work and expected files | Completion evidence |
| --- | --- | --- |
| 1 | Restore dependencies with `npm ci`, build the current source, and audit generated routes, lazy dependencies, and sizes. Confirm compatible PWA packages. | A current asset inventory includes radio, quiz, and all Customize routes. Record the baseline build/type-check results. |
| 2 | Add pinned PWA dependencies, configure `astro.config.mjs`, and implement `src/sw.ts` plus a production inventory check under `scripts/`. | The build generates `/sw.js` and a complete revisioned precache; content-only changes alter the release. |
| 3 | Add `src/lib/offline/register.ts`, `src/components/PwaHead.astro`, `src/components/OfflineStatus.astro`, and `src/pages/offline.astro`. Wire every HTML page and style the status UI. | First setup, offline navigation, failed downloads, and waiting updates report the correct state without reloading current work. |
| 4 | Add `public/manifest.webmanifest` and icons; finish range handling and quiz documentation/error wording as needed. | Install metadata is valid, saved samples work through both audio paths, and quiz rounds use the active saved library. |
| 5 | Add `playwright.offline.config.ts`, production offline/update tests, and a controlled static-server fixture. Add `npm run check:offline`; exclude this suite from the existing development-server test run. | Real built output passes offline reopening, first-use feature, failure, and two-release update tests. |
| 6 | Update README and repository guidance, record measured download size, run regression checks, and verify target phones and hosting. | The acceptance criteria below have recorded results; any physical-device gaps remain explicit. |

## Verification

Use a dedicated production-build test server on a separate port, with service
workers enabled. The offline suite must be able to keep one origin constant
while switching between two complete builds. Create temporary source/build
fixtures for sequence changes rather than modifying the working tree. Use server
controls for failed downloads and request counts; page-level request mocks can
miss requests made by a service worker.

Start each test with clean site data. Use a temporary persistent browser profile
where restart behavior is tested, and clean up its own workers and caches.
Assert service-worker responses where appropriate so the ordinary HTTP cache
does not mask missing offline support.

### Required automated scenarios

1. **Complete setup:** visit only the home page online. Verify all required
   resources are saved, then establish worker control through normal navigation.
   Check the initial uncontrolled state and ensure readiness is not reported
   before the download and control requirements are satisfied.
2. **Offline reopening:** turn the browser context offline and reopen the site
   from its persistent storage. Directly open a rhythm, a combo, and a Customize
   URL that were never visited online. Check real page content and audio controls.
3. **First use of lazy features:** without first playing anything online, go
   offline and exercise composer recording, hit buttons, metronome, and Tone.js
   preview. Prepare a fresh radio MP3 through the actual encoder, then exercise
   Shuffle, Skip, Stay, and revised settings. Verify playable output and advancing
   media time. Keep the existing encoder timing round-trip test passing.
4. **Quiz:** play all options and advance through several rounds offline.
   Preserve the normal feedback and retry behavior. Cover a missing saved library
   without a misleading connection-only gate on otherwise available content.
5. **Audio requests:** cover normal sample fetches, valid byte ranges, invalid
   ranges, and the HTML audio fallback. Check complete bodies and response headers
   as well as successful playback paths.
6. **Incomplete setup:** fail one required sample, page, or lazy bundle. Never
   show full readiness; Retry completes installation after service recovers.
   Cover quota/storage failures and cache deletion/eviction recovery.
7. **Changed sequence:** save release A, then serve release B with one edited
   rhythm. Confirm an open player and an unfinished composer stay intact while B
   downloads. Keep a second A tab open and verify activation still waits. Close
   all A clients, reopen offline, and check the changed player, Customize, radio,
   and quiz sequence data. Verify actual rendered/encoded timing data or an
   existing audio probe for the changed pattern, not just a changed title.
8. **Changed inventory:** add and remove rhythms, and add/change a sample in B.
   Verify the complete new route/sample set after activation and correct behavior
   for removed routes. Unchanged WAV bodies must not be downloaded again during
   a sequence-only update. Retain old assets while A still has clients.
9. **Failed update:** interrupt B's download. A must reopen and work offline.
   Retry B while connected, activate it safely, and confirm obsolete entries
   are eventually removed without deleting preferences.
10. **Presentation and installation:** cover narrow/mobile layout, accessible
    status announcements, manifest/icon responses, supported URL variants,
    unknown-route fallback, and the online path without service-worker support.

Existing quiz tests can continue to verify per-round fetching in the development
environment. Rename or clarify the live-library test so it is not evidence for
mid-session production updates; the two-build suite establishes the new release
behavior. Avoid repeating the full 20-minute encoding benchmark across every
offline viewport when shorter real mixes exercise the same dependency path.

Run these checks during implementation:

```sh
npm run check:types
npm run build
npm run check:layout
npm run check:offline
```

`check:offline` builds fresh production output before running the separate suite.
Record failures and measured asset sizes rather than relying on an old `dist/`
directory.

### Implementation verification

- Production build and TypeScript checks passed. The generated worker includes
  content integrity, revisioned entries, guarded audio range responses, and cache
  repair. The MP3 encoder's worker and binary are embedded in the cached encoder
  bundle; fresh offline radio generation was exercised through the real encoder.
- All 15 production offline scenarios passed: an actual browser restart, first-use
  offline features and MP3 exports, quota and integrity failures, recovery,
  changed/added/removed rhythms and samples, and waiting for multiple open tabs.
  Settings refresh coverage checks all-file replacement, a waiting update,
  preference preservation, disconnected/unreachable servers, another tab's
  unfinished composition, and failed replacement downloads.
- The interface regression suite exercises desktop, narrow, and emulated mobile
  Chromium, including language controls and MP3 downloads. Two duplicate
  full-length radio benchmarks are intentionally skipped by the existing suite.
- Browser inspection confirmed the small footer indication, normal navigation,
  and absence of page errors. The offline suite also checked footer containment
  and horizontal overflow at 1280, 500, and 390 pixels. Development leaves the
  worker and footer status disabled.
- Physical iPhone/Android airplane-mode reopening, native home-screen installation,
  audible playback while locked, and target-host headers/rollback still require
  the release checks below.

### Physical phones and deployment

On iPhone Safari and Android Chrome, test both a normal browser tab and a
home-screen launch. Complete the download, enable airplane mode, close/reopen
the app, and use previously unvisited rhythms, the composer, quiz, and a fresh
radio mix. Check installation guidance, storage recovery, and the update cycle
with another tab open. Measure the actual initial download and preparation time.

Listen to audio on real devices, including the HTML audio fallback. Keep the
existing background-audio and radio locked-phone checks: PWA installation and
desktop automation do not establish reliable playback while a phone is locked.

Deploy complete artifacts atomically and verify `/sw.js`, the manifest, MIME
types, cache headers, and deep links on the target host. A rollback must publish
a complete previous application build with a working update mechanism; simply
removing `/sw.js` will not remove an already installed worker. Verify rollback
reaches connected clients through the same safe activation lifecycle.

## Acceptance criteria

- One complete download makes all built-in sequences, samples, and core features
  available after reopening offline, including features never used online.
- The interface distinguishes a complete controlled offline session from a
  pending or failed download and from a waiting update.
- Editing a rhythm and publishing a build updates every representation together
  after reconnection, complete download, and safe activation.
- No automatic update interrupts playback, discards an open composition, or
  mixes files from different releases. A failed update preserves the old version.
- Unchanged sounds are reused, and obsolete cache entries are cleaned up safely.
- Browser use and optional home-screen installation pass the production tests,
  with physical phone results and any remaining limits documented.
