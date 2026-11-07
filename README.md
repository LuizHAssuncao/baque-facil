# Baque Fácil

A free app for learning, practicing and composing Maracatu rhythms, available in
English and Brazilian Portuguese.

1. Practice rhythms and sequences with adjustable tempo, looping and instrument
   mute controls. View the hand signals alongside the lessons.
2. Listen to shuffled practice mixes in Baque Radio or test your recognition of
   rhythm names and hand signals in the quiz.
3. Create rhythms in the composer, record with Alfaia pads and share editable
   compositions by link.
4. Download MP3s of rhythms, compositions or radio mixes for practice elsewhere.

## Run locally

Use Node.js 22 or newer.

```sh
npm install
npm run dev:local
```

Open <http://127.0.0.1:4323>. To build and preview the production app:

```sh
npm run build
npm run preview
```

## Practice offline

Open the production app while online and let the download finish. Follow a link
or reopen the app, then check that the footer says **Ready for offline use**.
Installing the app on your home screen is optional.

Use **Reload to update** when an update is ready. Save your work and close other
app tabs first. If offline files need repairing, reconnect and choose
**Settings → Refresh offline app**.

Composer drafts stay in the current browser. Edits to a shared composition stay
in that tab; share a new link to keep them. Generated radio mixes disappear on
reload, so download an MP3 to keep one. Keep the composer visible during playback.

## Contribute

Rhythm lessons live in [src/content/rhythms](src/content/rhythms/). See
[AGENTS.md](AGENTS.md) for content rules, development commands, testing and
implementation guidance.
