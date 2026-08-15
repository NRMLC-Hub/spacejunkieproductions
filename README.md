# Spacejunkie Productions

Two monochrome vector arcade games. Both are single self-contained HTML files:
no build step, no server, no dependencies, no package manager. Open either one
and it runs, offline, straight off the disk.

**[Play them](https://nrmlc-hub.github.io/spacejunkieproductions/)**

---

# SINGULARITY

A monochrome vector arcade shooter built around gravity. Every black hole in the
field bends every free body — rocks, ships, aliens, and both kinds of bullets —
through one shared rule. Your own shots curve. So does your ship, while you are
still invulnerable from the last respawn.

It stands in the lineage of late-1970s vector arcade games. The gravity, the
ships, the setting, the sound and every line of code are original.

**[Play it](https://nrmlc-hub.github.io/spacejunkieproductions/)**

## Running it

Open `singularity.html`. That is the whole instruction. No build step, no server,
no dependencies, no package manager. It is one self-contained file and it works
offline, straight off the disk.

| Key | |
| --- | --- |
| `←` `→` / `A` `D` | Rotate |
| `↑` / `W` | Thrust |
| `Space` | Fire |
| `P` | Pause |
| `M` | Sound on/off |
| `V` | Voice on/off |

Touch controls appear automatically on a coarse pointer, and the key legend
hides itself there.

## On a phone

Open the link. Thrust, rotate and fire buttons appear, positioned clear of the
notch and the home indicator.

To install it properly, use your browser's **Add to Home Screen** — Share menu on
iOS Safari, the ⋮ menu on Android Chrome. It then launches full screen with no
browser chrome, has its own icon, and **runs with no network at all.**

HTML is fetched network-first so an online launch always gets the current build;
everything else is served from cache. That means the installed app updates
itself rather than stranding you on an old version, which a cache-first service
worker would.

The icons are generated, not hand-drawn — `node tools/make-icons.js` rasterises
them to PNG with no dependencies (Node's own zlib does the compression). The art
stays inside the middle 60% so a circular or squircle mask cannot clip it.

`node tools/preview-shapes.js` does the same for the ship and alien
silhouettes, so a design change can be looked at without opening a browser. It
parses the coordinates straight out of `singularity.html`, so the preview
cannot drift from what the game draws.

## Sound

Every sound is synthesised at runtime with the Web Audio API. There are no
audio files — one HTML file is the point, and the machine this game descends
from made its noises with oscillators and a noise generator too.

`M` toggles it, or the button on the title screen. The setting is remembered per
browser, not per pilot.

Three of the voices are continuous and driven by state rather than by events,
so a pause or a death can never leave one stuck on: the thruster, the alien
warble, and a low drone whose volume and cutoff track how deep in a gravity
well you are. That last one is the useful one — you can hear a hole closing on
you before the screen makes it obvious.

Underneath it all is the heartbeat: two alternating low tones that quicken as
the sector empties.

Browsers refuse to make noise before a user gesture, so the first key or tap
starts the audio. If Web Audio is missing entirely the game runs silently and
is otherwise unchanged.

## Sector transmissions

Command says something short when you arrive in a sector — "Gravity well
detected", "Interceptors inbound. These ones aim."

It is spoken with the browser's own speech synthesis, so there are still no
audio files and the game is still one page. **The text is the feature and the
voice is an enhancement:** the line always appears on the banner, whether or
not the browser can speak, and the `V` toggle only silences the speech. Speech
support varies wildly across platforms, so none of it is load-bearing.

Each one opens with a squelch click, and the game ducks underneath so the two
are not fighting. The voice itself is *not* processed — browsers do not expose
speech output to Web Audio, so there is no way to band-limit or distort it. `M` silences everything including speech; `V` silences speech alone.

## Pilots and scores

Sign in as a pilot to record a personal best and appear on the top ten. Guests
can play; their runs just are not recorded.

Passwords are stored as PBKDF2-SHA256 at 150,000 iterations under a random
16-byte salt per account — never in plaintext. Signup issues a one-time recovery
code, hashed under its own separate salt, which is the only way back into a
callsign if the password is lost.

**Accounts are local to one browser on one machine.** They live in
`localStorage`. Two people on two computers cannot see each other's runs, and
"TOP TEN" means the top ten of everyone who has played *here*. A leaderboard
shared between players needs a server, and this game does not have one.

The data layer is a single object, `Store`, with eight async methods. Every call
site awaits it even though `localStorage` is synchronous — that is deliberate, so
a hosted backend can be swapped in by writing one more object with the same eight
methods, without changing any call site.

## Tests

```
node tests/accounts.test.js
```

193 assertions, no browser and no automation. The harness extracts the inline
`<script>` block and runs it in a Node `vm` context against stub DOM objects.

It covers signup, sign-in, recovery and scoring; asserts that no password or
recovery code is ever written to storage in the clear; that typing a space in the
password field neither fires a weapon nor launches a game; that a hostile
callsign injected straight into storage is escaped when the leaderboard renders;
and that the fixed-timestep simulation still produces exactly 60 ticks per second
at 60Hz, 144Hz and 30Hz.

It also checks the install path: that the service worker registers over https but
never from `file://`, that a browser without service workers still boots the game,
that a refused registration is swallowed rather than thrown, and that every file
the manifest and service worker promise actually exists and is a real PNG of the
size it claims.

**Not covered:** how any of this behaves on a real phone. There is no device in
the loop and no browser automation. Layout on hardware needs a human to look.

## Architecture

Worth knowing before editing:

- `CONFIG` at the top holds every tuning value. Change behaviour there first.
- **`W` and `H` are world units, not CSS pixels.** `VIEW` is how many pixels one
  world unit occupies; the short axis is normalised to `REF_MIN` so a phone gets
  the same room to travel as a desktop, by zooming the camera out rather than
  shrinking the world. `VIEW` is capped at 1, so large screens are unchanged.
  Lengths given to `stroke()` are CSS pixels and get divided by `VIEW`.
- `S` is the single game-state object. `update()` → `collisions()` → `draw()`.
- The simulation runs on a **fixed 1/60s timestep** with an accumulator in
  `loop()`. Rendering happens once per animation frame; simulation only advances
  in whole ticks, so the game plays identically at 60Hz, 144Hz and 30Hz. **Every
  value in `CONFIG` is measured in ticks.** New time-based values belong in
  ticks, advanced inside `update()` and never in `draw()`.
- `MAX_CATCHUP` caps replay after a stall so a backgrounded tab does not
  fast-forward on return.
- The world is a torus. `wrapPos()` moves things across the seam, `delta()` gives
  the shortest distance across it, `drawWrapped()` draws an object once per
  visible wrap-copy. **Use `delta()`/`dist()` for any distance check** — a raw
  `Math.hypot` on coordinates is wrong near the edges.
- `levelSetup()` holds the four dials controlling the difficulty ramp. It affects
  how the game feels far more than anything else in the file.
- One `applyGravity()` serves every free body. That single shared rule is why the
  holes read as part of the world rather than as decorative hazards. Keep it that
  way when adding features.

---

# COLLISION

Earth is at the centre. You are the only thing in orbit, and nothing gets
through.

Your station rides a ring around the planet — left and right move you around
it, up and down change altitude.

**Tap or click where you want the intercept.** The missile launches from your
station, steers to that point, and detonates there with a blast radius, so
placing one shot in front of a cluster is worth far more than picking rocks
off one at a time. Your orbit position still decides the angle of approach and
how long the flight takes, so taking station never stops mattering.

`Space` fires a plain shot straight out along your radius instead. It is the
keyboard fallback and it is worse on purpose — gravity bends it, and it goes
where you are pointing rather than where you want it.

When something gets past you, the **pulse** is the last resort: a ring that
expands off Earth and clears what is close in, on a seven-second cooldown. Its
reach is a bubble around the planet rather than the whole field, so it saves
you from the one that is about to hit — not from the situation you got into.

Earth's gravity is what makes it a game rather than a shooting gallery. It
pulls every rock inward, so nothing travels in a straight line, and a near miss
does not leave — it swings around and comes back at you from a new angle.

| Key | |
| --- | --- |
| `←` `→` / `A` `D` | Orbit |
| `↑` `↓` / `W` `S` | Altitude |
| Tap / Click | Designate an intercept |
| `Space` | Launch straight out |
| `E` / `Shift` | Pulse |
| `P` | Pause |
| `M` | Sound on/off |

Earth has an integrity bar, and the planet itself shows the damage — its grid
and atmosphere thin out as it takes hits, which is meant to be the primary
readout with the bar as a second opinion. Clearing a wave repairs it a little.
Getting hit by a rock does not end your run; it knocks your station to the far
side of the orbit and out of the fight for a moment.

```
node tests/collision.test.js
```

122 assertions. Alongside the gameplay they pin the things most likely to erode:
that no torus machinery has crept in from SINGULARITY, that the ship never
leaves its rail, that Earth's impact sound uses no pitched oscillator, and that
the fixed timestep still holds at 60/144/30Hz.

**COLLISION is a separate file, not a mode inside SINGULARITY**, and the reason
is in `CLAUDE.md`: that game's world is a torus with no centre and no outside,
which is the exact opposite of what this one needs.

---

Spacejunkie Productions — Martin Bradford Hovsepian Jr.
