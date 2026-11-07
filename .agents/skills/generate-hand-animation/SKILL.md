---
name: generate-hand-animation
description: >-
  Create, revise or optimize animated WebP hand signals for Baque Fácil using a
  movement reference video and the approved visual concept. Use for moving
  gestures, hand signal sequences and animated hand artwork that must loop
  infinitely and remain below 500 KB. Scope is animated WebP assets.
---

# Generate a hand signal animation

Create and export an animated WebP hand signal for Baque Fácil, a website for
learning Maracatu rhythms that supports offline practice. Produce the actual
animated file and verify it before delivery.

Resolve bundled paths relative to this skill's directory. Read the repository's
applicable `AGENTS.md` instructions before saving artwork. Use the available
image generation, media processing and viewing tools to complete the export.
State any missing capability that prevents completing or verifying the file.

Collect these inputs from the request and its attachments:

```text
Signal name: [name]
Movement reference: [video path or attachment]
Output file: [optional path ending in .webp]
Existing illustrated asset: [optional path or attachment]
Additional animated WebP examples: [optional paths or reference folder]
```

Ask only for missing details needed to reproduce the gesture. A signal name
alone does not establish its movement. If an output location is not specified,
use `public/hand-signals/<signal-slug>.webp` relative to the repository root.
Preserve existing files unless the request authorizes a revision.

## References

1. Inspect the bundled [approved visual concept](assets/visual-concept.png).
   Use it as the authoritative reference for illustration style, proportions,
   outlines, shading, texture and background. Supply it as an image reference to
   the image generation tool whenever creating or revising the illustrated art.

2. Study existing animated WebP examples in this skill's `assets/` folder and
   any reference folder provided by the user. Use them to guide composition,
   scale, movement, animation quality and compression. Check that each example
   is actually animated. If examples are absent, proceed using the approved
   concept and movement video. Preserve all reference assets.

3. Study the movement video before creating the animation. Watch it in a viewer
   or inspect a timed sequence of extracted frames. Establish the finger
   positions, wrist movement, direction, speed, rhythm and movement boundaries.
   Distinguish the intended gesture from camera movement and setup motions.

## Animation

Reproduce the reference gesture accurately, including finger positions, wrist
movement, direction, speed and rhythm. Use a duration of approximately three
seconds unless the reference indicates otherwise. Repeat complete gesture
cycles where appropriate and join the loop without a visible jump.

Keep the hand anatomy and illustration consistent across every frame. When
the pose remains fixed, animate a single illustrated asset with translation and
rotation wherever possible. When fingers or viewing direction change, use
consistent poses or a suitable hand model to reproduce those changes. Keep the
movement faithful to the reference throughout.

Create synthetic illustrated artwork using the approved concept. Include enough
forearm to make the movement clear, with the arm entering from the bottom of the
frame. Use the video to establish the gesture and create the finished artwork
from illustrated assets.

## Visual style and composition

Match the approved concept closely:

1. Use deep teal outlines, approximately `#073F3D`, simple brown shading with
   restrained highlights and subtle printed grain.
2. Keep finger shapes and proportions consistent throughout the animation.
3. Use a clean cream background, approximately `#FFFAF2`.
4. Use a square composition with the hand and forearm centered horizontally.
   Make the gesture large and readable on a phone. Minimize unnecessary blank
   space while leaving enough room for the full movement. Keep the entire hand
   visible in every frame.
5. Include only the illustrated gesture and background. Keep text, captions,
   controls, decorations and audio outside the asset.

## Export and compression

Export an animated WebP targeting 480 × 480 pixels and 18 to 24 frames per
second, with infinite looping. Keep the file strictly smaller than 500 KB.
Enforce a conservative limit of **500,000 bytes**, with equality failing the
limit.

Prioritize visual quality within that limit. Optimize compression, frame count
and resolution as necessary while preserving a square frame, clear outlines,
readable finger positions and smooth movement. Reduce unnecessary texture
detail if it significantly increases file size. Recheck the final export after
every optimization. Report its actual dimensions and frame rate if they differ
from the targets.

## Verification and delivery

Run the bundled verifier with Python 3 and Pillow, resolving the script path
from this skill's directory:

```sh
python3 <skill-directory>/scripts/verify_animation.py <exported-file.webp>
```

The verifier requires a readable animated WebP with multiple visually different
decoded frames, positive frame durations, a square canvas, infinite looping and
a file size below 500,000 bytes. It reports the actual dimensions, frame count,
duration, average frame rate and byte count. Correct any failed checks before
delivery. If Pillow is unavailable, perform equivalent checks with available
media tools and report the results.

Also compare the export with the movement reference and approved concept.
Verify the movement, finger positions and rhythm, a seamless loop, a centered
and fully visible hand and consistent anatomy. These visual checks are separate
from the file checks.

Open the exported file in a viewer that supports animated WebP and watch at
least two loops to confirm playback and the loop boundary. A static thumbnail
only verifies a single frame. If the viewer is unavailable, state that playback
verification remains incomplete and provide the actual exported file with the
completed file checks.

Deliver `<signal-slug>.webp` as an attachment or working download link, with an
inline preview when supported. Include the final byte count, dimensions,
duration and average frame rate. If the chat shows only a static thumbnail,
explain that limitation and direct the user to the exported file. A written
description or a still preview does not complete the task.
