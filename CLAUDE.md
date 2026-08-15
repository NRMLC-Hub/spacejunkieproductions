# spacejunkieproductions — project instructions

Owner: Martin Bradford Hovsepian Jr.

**SINGULARITY** — a self-contained vector arcade shooter. This repo holds the
game and nothing else. It was split out of `E:\spacejunkie` on 2026-08-15 so it
could be published publicly without carrying the NRM research material into a
public git history.

Read `README.md` for the human-facing overview, including the architecture notes.
This file is the working context.

## Ground rules

- **To run it: open `singularity.html`.** No build step, no server, no
  dependencies. Do not introduce a framework, bundler, or package manager unless
  explicitly asked.
- `index.html` is a redirect to `singularity.html`, not a second copy. GitHub
  Pages needs an `index.html` at the root; the game keeps its deliberate name.
  A duplicate `index.html` was deleted once already — do not reintroduce one.
- **Icons are generated, not edited.** `node tools/make-icons.js` writes
  `icon-{32,180,192,512}.png`. Change the mark in that script and re-run it;
  never hand-edit the PNGs. Keep the art inside the middle 60% or a circular
  mask will clip it. The output is committed so a clone needs no build step.
- **The service worker caches the game.** After changing `singularity.html`,
  bump `CACHE_VERSION` in `sw.js` if you touched the asset list. HTML is
  network-first on purpose — cache-first would strand installed players on an
  old build with no way to know. Do not "optimise" that to cache-first.
- **No browser automation.** Never drive a browser to check this. Martin's
  browser holds sensitive financial data and driving that live session risks
  exposing it. To show something works, give him a path or URL and let him open
  it.
- **Verify headlessly instead**: `node tests/accounts.test.js`. The harness in
  `tests/harness.js` extracts the inline `<script>` and runs it in a Node `vm`
  context against stub DOM objects. This catches real bugs — it confirmed the
  fixed-timestep fix, and the accounts and PWA work were both built against it.
  Add to it rather than testing by hand.
- **The harness cannot see a phone.** It checks that the markup, manifest and
  service worker say the right things; it cannot tell you whether the layout
  actually works on hardware. Anything about how it *looks* on a device is
  unverified until Martin opens it. Say so rather than implying otherwise.
- **Correct the record in files, not just in chat.** Findings that only live in
  a conversation are lost when the session ends.

## Keep a deliberate distance from the 1979 arcade original

Game *mechanics* are not copyrightable — "rocks split when shot, the screen
wraps" is an idea and anyone may use it. Specific *expression* is a different
matter, and the file used to carry more of it than anyone intended. Cleaned up
on 2026-08-15; do not let these drift back:

- **The score table is not the original's.** It was 20/50/100 for rocks,
  200 for the large saucer, and an extra ship every 10,000 — matching the 1979
  game exactly, which is transcription, not convergence. It is now a 3x ramp
  (15/45/135), saucers at 300/750, extra hull at 12,000, and `CONFIG` carries
  the reasoning. **Do not "restore" the old numbers.**
- **The ship is a swept flying wing**, not the arcade triangle.
- **The alien is a tall hexagonal probe** with a faceted core and side bars —
  not the wide domed saucer. That silhouette is the most recognisable thing in
  the genre and is not ours. Never add a horizontal line through its middle;
  that plus a wide hull plus a trapezoid dome IS the arcade craft.
  **Tried and reverted on 2026-08-15:** a curved domed saucer at +50% size.
  Martin asked for it, saw it, and asked for it back out — the bigger craft
  crowded the field and the disc lost the probe's identity. Don't re-propose
  it; if the alien needs work, take it somewhere new.
- **Do not define the game as "Asteroids" in the README, the repo description,
  or store copy.** Comparison in conversation is fine; making it the
  definition is what invites a trademark problem. "ASTEROIDS" is a live Atari
  mark.

Practical risk on a free, differently-named game with an original core
mechanic is low, and the closest precedent (*Atari v. Amusement World*, 1981)
went against Atari. But *Tetris Holding v. Xio* (2012) went the other way on
look-and-feel, so keeping the expression clearly our own costs nothing and
settles the question. None of this is legal advice; if the game ever earns
money, ask someone qualified.

New silhouettes were designed by rasterising candidates to PNG and looking at
them — no browser needed. See `tools/make-icons.js` for the same technique.

## Sound

All synthesised at runtime in the `SFX` module. **Never add an audio file** —
there is no asset pipeline and one HTML file is the point.

Two invariants:

- **Nothing in `SFX` may break the game.** Browsers refuse to create an
  AudioContext before a gesture, some environments have no Web Audio, and the
  test harness has none by default. Every entry point returns quietly without a
  context, and there is a test asserting a full second of play runs silently.
- **Continuous voices are driven by state, not events.** Thrust, the alien hum
  and the gravity drone are set every tick from what is true right now, and
  `step()` calls `SFX.silence()` whenever the mode is not `playing`. Do not
  start a held voice from an event handler — that is how a note gets stranded
  through a pause. Tests assert a pause and a death both release everything.

**A downward pitch sweep on a sine is a kick drum, not an explosion.** The ship
death sounded like a drum through two rewrites because its body layer was
exactly that. It is now built entirely from noise pushed through a downward
lowpass sweep — weight without any definite pitch — with debris bursts at
uneven offsets, because a drum decays smoothly and a blast does not. **Do not
add a pitched oscillator to `shipDeath`**; a test fails if anyone does.
`rockBoom` and `alienBoom` still carry a tone on purpose — a sharper, more
percussive crack keeps them distinct from the ship going up.

The heartbeat is paced in ticks like everything else, so it stays frame-rate
independent. Mute lives in `localStorage` under `sj.muted.v1` — it is a device
setting, deliberately not part of a pilot account.

`tests/harness.js` has a Web Audio stub that records `start`/`stop` per voice;
pass `run({ audio: true })` to use it.

## Sector transmissions

`sectorBrief(n)` returns what command says on arrival; `VOICE` speaks it with
the browser's speech synthesis.

- **Keep the lines short.** A test fails past eight words. These are blurps,
  not briefings — anything longer is still being read out while the player is
  already dodging.
- **The text is the feature, the voice is an enhancement.** The line always
  goes on the banner. Speech support is genuinely unreliable across platforms
  (voice list populates asynchronously, quality swings, some browsers ship
  none), so `VOICE` fails soft everywhere and the button hides itself when
  speech is unavailable. Never make anything depend on speech working.
- **Two Chrome bugs are being worked around in `say()`, and both cut lines
  off mid-sentence. Do not "tidy" either away.**
  1. `held = u` keeps a reference to the utterance. Chrome garbage-collects
     an utterance nothing points at, *while it is still speaking*, and the
     line simply stops partway through.
  2. `cancel()` runs only when `speaking || pending`. Chrome truncates or
     swallows an utterance spoken in the same tick as a `cancel()`, and an
     unconditional cancel on the normal path bought nothing.
- **The voice itself cannot be filtered.** Browsers do not expose speech
  output to Web Audio on any platform, so there is no way to band-limit or
  distort the synthesised voice. Do not go looking; there is not one.
  **Tried and removed on 2026-08-15:** a band-limited static bed under the
  voice. It read as noise rather than atmosphere. The squelch click stayed.
- **British voice preferred** — `en-GB` first, then any English, then
  anything. Martin picked that out specifically.
- **`commsBus` is muted but never ducked.** It carries the squelch, which is
  part of the transmission, so ducking it under the transmission is wrong.
  Two buses, two rules, both set by `applyMaster()`.
- **Master gain has two independent inputs** — mute, and ducking under a
  transmission. Both go through `applyMaster()`. Setting `master.gain`
  directly from either one reintroduces the bug where unmuting mid-briefing
  cancels the duck.
- **There is a watchdog, and it is load-bearing.** `speechSynthesis` drops
  `onend` often enough to matter, and a dropped one would leave the static
  bed open for the rest of the run. `VOICE.tick()` is driven from `step()`
  and counted in ticks like every other timed value.
- `M` silences everything, `V` silences speech alone. Mute also cancels any
  transmission in progress; pausing and dying both stop speech.

## World units are not CSS pixels

`W` and `H` are the world in **world units**, and every length in `CONFIG` —
radii, `hole.reach`, speeds — is in the same units. `VIEW` is how many CSS
pixels one world unit occupies, set in `resize()` and capped at 1.

The short axis is normalised to `REF_MIN` (700) world units, so a phone gets
the same room to travel as a desktop by zooming the camera out rather than by
shrinking the world. Before this, the world was the viewport in CSS pixels and
`hole.reach` of 290 spanned nearly a whole phone screen — one black hole and
there was nowhere left to fly. Martin reported exactly that from a phone.

Consequences to respect:

- **Lengths passed to `stroke()` are CSS pixels, not world units** — it divides
  by `VIEW` so vector lines keep their weight at any zoom. Same for star size.
- `draw()` must go through `applyTransform()`, never `ctx.setTransform(DPR,…)`.
- Anything counted per *screen* area rather than per *world* area (the
  starfield) must multiply by `VIEW²`.
- **Do not add a device check.** Cap hazards by what the world can hold, the
  way `levelSetup()` caps holes by the fraction of world area inside a hole's
  pull. That rule correctly catches a portrait tablet too, which a phone check
  would miss.

## The artifact rule

Inherited from the parent project and it applies here too:

> **A document may only claim a result if an artifact exists that produced it,
> and that artifact can be re-run.**

The README says "72 assertions" because `node tests/accounts.test.js` prints 72
and exits non-zero if any fail. Never present illustrative output as a
measurement.

## Accounts — what is and is not true

Accounts are `localStorage`. One browser, one machine. **There is no shared
leaderboard**, and no marketing, README line or commit message should imply
otherwise. "TOP TEN" is the top ten of everyone who has played on that machine.

Passwords are PBKDF2-SHA256, 150k iterations, 16-byte random salt per account,
iteration count stored per record so it can be raised later without locking
anyone out. Recovery codes are hashed under a separate salt. Wrong-password and
unknown-callsign return an identical error so the form cannot be used to
enumerate accounts.

Anything client-side can be cheated — a player can edit `localStorage` or, on a
future server, POST a fabricated score. That is acceptable for a friends
leaderboard and should not be described as anything stronger.

### Adding a shared leaderboard

`Store` is the only thing that touches storage. It has eight async methods:
`ready`, `currentUser`, `signUp`, `signIn`, `signOut`, `resetPassword`,
`submitScore`, `topTen`. Every call site already awaits them even though
`localStorage` is synchronous, precisely so a hosted backend drops in as one more
object with the same eight methods and `Store` is reassigned. **Do not spread
storage calls out of that object.**

If this goes to Supabase: the anon key is designed to live in public client code
and is fine to commit; the **service role key is not, ever**. Protection comes
from row-level security — a signed-in player may insert only their own scores,
everyone may read the top ten.

## Related projects

- `E:\spacejunkie` — the NRM theoretical physics program, and the fictional
  universe this game's setting comes from. Private. Do not merge it in here.
- `E:\ncoin` — its own git repo, its own `CLAUDE.md`. Do not work on it from
  here. If the games ever become NCoin's activity layer, connect them through a
  documented API — two projects, one interface.
