---
name: generate-hand-pose
description: >-
  Create or revise static hand signal illustrations for Baque Fácil. Use when
  asked to generate a hand pose, illustrate a rhythm's gesture or correct an
  existing static pose asset to match the approved visual concept. Scope is
  individual static hand illustrations.
---

# Generate a hand pose

Create static hand signal artwork for Baque Fácil, a website for learning and
practicing Maracatu rhythms. Use the bundled
[approved visual concept](assets/visual-concept.png) as the visual reference for
every pose.

Resolve bundled asset paths relative to this skill's directory. Supply absolute
paths to tools when required. Read the repository's applicable `AGENTS.md`
instructions before saving artwork.

1. Establish the requested pose from the user's description, attachments or
   existing asset. Collect the rhythm name, number of hands, finger positions,
   thumb placement and viewing direction. Use the input template below when
   useful. Ask only for missing details that affect the gesture. A rhythm name
   alone does not define its hand signal.

2. Inspect `assets/visual-concept.png` with an image viewer before generating.
   Inspect any pose reference or existing image to be revised as well. Use the
   concept to guide the illustration style and the pose reference to establish
   the gesture. Resolve conflicting gesture details with the user.

3. Use an available image generation tool that accepts reference images.
   Include the bundled concept as an image reference in every generation or
   revision, together with any pose reference and existing asset being edited.
   Follow the tool's instructions for attaching local files or conversation
   images. If the required image generation capability is unavailable, state
   that limitation before claiming a completed asset.

4. Generate the requested hand artwork using the visual and output requirements
   below. Preserve the approved reference file. For revisions, keep the existing
   asset's requested composition and change the specified details.

5. Inspect the exported image at full size and at approximately 128 × 128 pixels
   on a cream background such as `#FFFAF2`. Compare the gesture with its reference
   and the rendering with the approved concept. Check finger anatomy,
   orientation, clipping, readability and actual alpha transparency. Correct
   accidental mirroring or unclear finger shapes before delivery.

6. Save the generated PNG to the requested output path. If a location was not
   specified, use `public/hand-signals/<rhythm-slug>.png` relative to the repository
   root. Preserve existing files unless the request authorizes a revision.
   Return the image as an attachment or accessible file link and briefly describe
   the pose shown.

Use these inputs as a request template. Infer details that are clear from a
supplied reference.

```text
Rhythm name: [name]
Output file: [optional path and filename ending in .png]
Number of hands: [one or two]
Pose: [which fingers are extended, bent or touching; thumb position]
Orientation: [left or right hand; palm, back or side facing the viewer]
Pose reference: [optional image path or attachment]
Existing asset: [optional image path for a revision]
```

Apply these visual requirements to the generated artwork:

1. Match the concept's editorial 2D illustration, deep teal contours, gently
   rounded forms, simple shading and subtle printed grain. Keep the hand
   proportions, outline thickness and level of detail consistent with the
   reference illustrations. The deep teal outline is approximately `#073F3D`.

2. Reproduce the requested finger positions and thumb placement precisely.
   Preserve the specified hand orientation and viewpoint. Account for five
   anatomical digits per hand, with natural joints and clear separation wherever
   fingers are visible. Show only the number of hands requested.

3. Focus the composition on the hand or hands and a short section of wrist.
   Place the wrist at the lower edge and keep all fingertips and meaningful
   contact points visible. Use consistent scale and enough surrounding space for
   the gesture to remain clear when displayed as a small thumbnail.

4. Deliver the hand artwork alone on a transparent background. Keep text,
   labels, cards, palette swatches, decorative objects and interface elements
   outside the artwork. Use the full concept board to guide the individual
   illustration.

5. Export a single static PNG at 1024 × 1024 pixels with real alpha transparency.
   Keep each file below 500,000 bytes. Optimize PNG compression and palette as
   needed while preserving transparency, clear outlines and readable fingers.
   Verify the exported dimensions, format, single frame and file size before
   reporting completion.
