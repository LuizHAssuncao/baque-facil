TODO:

1. play the rhythm automatically if page is open. only apply this to rythms pages. 

2. simplify play control buttons. no need for play/stop. only one button is necessary. if
  it's playing, then change to stop and vice-versa 

3. use standard icon for play, stop, restart. 

4. allow tempo minimum to be 30bpm

--

Change All rythms label to a Back with an icon. make it a bit more visible. also standardize the loop button. similar to play and restart: an icon and a word

----

Fix trovao sound

----

Clean rhythms

----

Move "Mute alfaia" and gongue to a button at right of the intrument. with a mute/unmute icon

-----


- A modal that only appears one time: On iOS and not listening to a sound? Make sure Silent mode is off

also a link on the bottom with a red saying something like "I can't listen to the sound. What should i do?" and redirect to a page explaining step by step what to do. only show this for ios

-----

Refactor code.

---------------

Create unit tests and browser tests

---------------

---------------

- Convert rhythms into JSON. Something like: 
{
  "schemaVersion": 1,
  "type": "baque-facil-collection",
  "id": "maracatu-beginner-pack",
  "name": "Maracatu Beginner Pack",
  "description": "Basic alfaia exercises for beginners",
  "author": "Luiz",
  "createdAt": "2026-05-16",
  "rhythms": [
    {
      "id": "marcacao-basic",
      "name": "Marcação básica",
      "bpm": 90,
      "subdivision": 16,
      "pattern": ". . . . | . . L R | . . L R | . . . R",
      "notes": "Simplified learner version"
    }
  ]
}

- User can create/edit rhythms locally
- User can group rhythms into collections
- User can save collections locally
- User can share collection by link
- User can export collection as .baque.json
- User can import .baque.json

The general UX would be something like:

---

Collection: Maracatu Beginner Pack

[ Play all ]
[ Practice selected ]
[ Save to my library ]
[ Share link ]
[ Export file ]
[ Submit to public library ]

---

When clicking Share link:

Share this collection

Anyone with this link can open the collection in Baque Fácil.

[ Copy link ]

--

When clicking Export file:

Export collection

Download this collection as a .baque.json file.
You can send it to students or import it later.

[ Download ]

---

When opening a shared collection link:

You opened a shared collection:

Maracatu Beginner Pack
8 rhythms

[ Preview ]
[ Save to my library ]
[ Play now ]

---


Player should scroll together with the sound

---------------

Split transcription. Max 16 subdivisions per row. Then break line.

------

if the key hold, don't play several times. only once.

-----

create dark mode

-----

use hand gesture for rhythms

-----

translation to portuguese
