**Radio signals and practice view**

Radio helps learners follow the mestre by showing the next rhythm's hand signal during the current rhythm's final two repetitions, or at 70% completion for sequences played once. The current notes and playback cursor continue following the audible recording. Independent display controls let learners practise recognising the gestures with rhythm names and notes hidden.

1. **Use the existing musical transitions.**

   The transition patterns, whistle recording and audio generation already exist on `main`. This feature adds the visual call and practice controls around that implementation. The existing transition timing, drum patterns and generated audio remain the source for playback and notation.

2. **Highlight the next rhythm's gesture.**

   Add a separate cue panel above the current playback information. When two repetitions remain, display the upcoming gesture with a highlighted border and a preparation message. Sequences played once begin their call at 70% of the complete sequence. Derive both thresholds from the installed recording's media position. Resolve the upcoming rhythm from its `nextSlug`, so pending selection or tempo changes cannot alter the call prematurely.

   Keep the current rhythm's title secondary and preserve its moving notes cursor. Between calls, reserve the cue panel's space with a quiet waiting message. If names are enabled, retain the existing next rhythm label, including the return target during held playback. Preload the upcoming image before the call window.

3. **Offer independent visibility controls.**

   Add “Show rhythm names” and “Show notes”, both enabled by default. Apply changes immediately without replacing the audio source, moving the playhead or preparing a new mix. Save validated preferences separately from mix settings in `baque-facil-radio-display-v1` and keep the controls usable when storage is unavailable.

   Hide names from the current title, upcoming label, rhythm selection controls, lesson shortcuts, cue announcements and media session titles. During an active call, reveal and announce the next name if its gesture is unavailable, so the learner can still follow the mestre. Use neutral numbered selection labels with the available gesture descriptions. Load display preferences before revealing names to avoid an answer flash after a reload. Omit hidden notes from the rendered interface and accessibility tree. Transport controls remain available.

4. **Reuse the existing gesture content.**

   Pass the optional `gesture` metadata from the Astro rhythm collection into `RadioEntry`. Reuse the images in `public/hand-signals/` and their descriptions in `en-CA` and `pt-BR`. Available mappings cover Marcação, Imalê, Martelo, Baque de Parada, Trovão, Arrasto, Afoxé and the animated Martelo break signal.

   Preserve each authored gesture's orientation. The handedness preference continues to apply to note symbols. Show “Signal unavailable” with the next rhythm's localized name for unmapped or failed images, including when names are hidden. Additional rhythms and sequences can gain coverage through their existing gesture frontmatter.

5. **Follow the playback state.**

   Pausing preserves the current cue. A skip immediately updates the notes and cue from the new media position. A held or solo rhythm shows a repeating state. Releasing a hold resumes the existing mix behaviour and updates the upcoming call.

   The final group calls the first at the native recording loop. Returning from the background refreshes the cue from the media clock. While a replacement recording is preparing, use the active recording's position. Sequences have one complete pass, with their call limited to its final 30%.

6. **Keep the implementation focused.**

   `RadioSignalCue.tsx` renders the cue, localized descriptions and missing image fallback. `RhythmRadio.tsx` connects it to playback and exposes the visibility switches. `displayPreferences.ts` validates and persists those switches. The playback controller applies name visibility to media metadata independently of audio settings.

   Update the Radio route's data projection, the `RadioEntry` type, translations and global styles. Reuse the existing offline handling for PNG and animated WebP assets. The mixer, transition builder and whistle sample stay as implemented on `main`.

7. **Verify recognition practice.**

   Browser coverage checks the final two repetitions and the 70% sequence boundary, upcoming gesture identity, current notes, recording wrap, background return, pending settings, skip, hold and return to mix. Exercise all four visibility combinations, keyboard operation, saved preferences, invalid or unavailable storage, hidden accessible names and media titles. Missing signals must reveal and announce the next name only while the call is active.

   Verify translations during an active call, the animated gesture and missing image fallbacks. Test the production flow offline with cached gestures. Review desktop and narrow screen screenshots and check for body overflow.

   Run `npm run check:types`, `npm run build`, `npm run check:layout` and `npm run check:offline`. Preserve the existing transition, whistle, encoding and download regression coverage.

8. **Implementation verification.**

   Type checking and the production build completed. All 24 new practice checks passed across desktop, narrow and emulated mobile Chromium. All 31 production offline checks passed, including cached gesture loading and both visibility switches. Screenshots were reviewed at all three viewport sizes.

   The broader 423 case development run recorded 414 passes, two intentionally skipped benchmark duplicates and seven failures. Six failures came from the homepage test's outdated sequence list; all six passed after adding the existing Transition sequence to that expectation. The remaining failure was an Astro development toolbar image audit request interrupted during navigation. A later sample retry check also timed out once under the development server. Both affected workflows passed on the production preview across all three viewports, six checks in total.

   The transition builder, mixer, encoder and whistle sample have no changes relative to the fetched `main` branch.

   Before pushing, the feature was rebased onto the newer rhythm, whistle volume and title translation changes on `main`. Type checking and the production build passed again. All 51 focused production browser checks passed: 27 gesture and visibility checks, six Radio language checks and 18 homepage checks. The new coverage verifies translated sequence names in the cue, selector and media metadata when names are shown or hidden.

   The call timing and missing signal update passed type checking, the production build and six timeline boundary checks across tempos, repetition counts and pattern lengths. The 69 production browser checks cover gestures, visibility, translations and existing whistle transitions. All passed after correcting the new sequence test's expected grid label and rerunning that case at all three viewport sizes. Desktop and mobile screenshots were reviewed, including the name fallback with both practice controls off. Audio generation and transition timing remain unchanged.
