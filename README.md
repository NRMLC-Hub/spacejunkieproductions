# SINGULARITY

A monochrome vector arcade shooter. Asteroids, but every black hole bends every
free body in the world — rocks, ships, aliens, and both kinds of bullets — through
one shared gravity rule. Your own shots curve. So does your ship, while you are
still invulnerable from the last respawn.

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

Touch controls appear automatically on a coarse pointer.

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

72 assertions, no browser and no automation. The harness extracts the inline
`<script>` block and runs it in a Node `vm` context against stub DOM objects.

It covers signup, sign-in, recovery and scoring; asserts that no password or
recovery code is ever written to storage in the clear; that typing a space in the
password field neither fires a weapon nor launches a game; that a hostile
callsign injected straight into storage is escaped when the leaderboard renders;
and that the fixed-timestep simulation still produces exactly 60 ticks per second
at 60Hz, 144Hz and 30Hz.

## Architecture

Worth knowing before editing:

- `CONFIG` at the top holds every tuning value. Change behaviour there first.
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

Spacejunkie Productions — Martin Bradford Hovsepian Jr.
