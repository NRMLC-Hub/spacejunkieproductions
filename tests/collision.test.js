/* COLLISION — headless checks. Same harness, pointed at the other game.
   No browser, no automation; see CLAUDE.md.

     node tests/collision.test.js                                          */
process.env.SJ_HTML = require('path').join(__dirname, '..', 'collision.html');
const { run } = require('./harness');

let pass = 0, fail = 0;
const results = [];
function ok(name, cond, extra) {
  if (cond) { pass++; results.push('  PASS  ' + name); }
  else { fail++; results.push('  FAIL  ' + name + (extra ? '   -> ' + extra : '')); }
}
const section = t => results.push('\n' + t);
const launch = H => H.fireGlobal('keydown', { code: 'Space', key: ' ', preventDefault() {}, repeat: false });

(async () => {

section('loading');
let H;
try { H = run({ audio: true }); ok('script parses and evaluates', true); }
catch (e) { ok('script parses and evaluates', false, e.message); console.log(results.join('\n')); process.exit(1); }
ok('starts on the title screen', H.get('S').mode === 'title');
launch(H);
ok('space takes station', H.get('S').mode === 'playing');
ok('Earth starts intact', H.get('S').integrity === 100);
ok('wave one is under way', H.get('S').wave === 1);

section('the world is bounded, not a torus');
{
  const C = run();
  // The defining difference from SINGULARITY. If any of these appear, someone
  // has copied the wrap machinery across and the centre stops meaning anything.
  const fs = require('fs'), path = require('path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'collision.html'), 'utf8');
  ok('no wrapPos', !/function wrapPos/.test(html));
  ok('no drawWrapped', !/drawWrapped/.test(html));
  ok('distance is plain, not seam-aware',
     /const dist\s*=\s*\(a,b\)\s*=>\s*Math\.hypot/.test(html));
  ok('the arena has a defined edge', typeof C.get('ARENA') === 'number' && C.get('ARENA') > 0);
}

section('the ship is on a rail');
{
  const G = run({ audio: true, W: 1600, H: 900 });
  launch(G);
  const S = G.get('S'), C = G.get('CONFIG'), keys = G.get('keys');
  const step = G.get('step');

  const orbitOf = () => Math.hypot(S.ship.x - G.get('W') / 2, S.ship.y - G.get('H') / 2);
  step();
  const r0 = orbitOf();
  ok('the ship sits on its orbit radius', Math.abs(r0 - S.ship.orbit) < 0.001,
     r0 + ' vs ' + S.ship.orbit);

  const a0 = S.ship.a;
  keys.right = true; for (let i = 0; i < 30; i++) step(); keys.right = false;
  ok('right moves it around the orbit', S.ship.a > a0);
  ok('and it stays on the ring', Math.abs(orbitOf() - S.ship.orbit) < 0.001);

  keys.up = true; for (let i = 0; i < 400; i++) step(); keys.up = false;
  ok('altitude is capped at the top of the band', S.ship.orbit === C.ship.orbitMax);
  keys.down = true; for (let i = 0; i < 800; i++) step(); keys.down = false;
  ok('and at the bottom', S.ship.orbit === C.ship.orbitMin);
  ok('the ship never enters the atmosphere', C.ship.orbitMin > C.earth.r);
}

section('missiles');
{
  const G = run({ audio: true, W: 1600, H: 900 });
  launch(G);
  const S = G.get('S'), C = G.get('CONFIG'), keys = G.get('keys'), step = G.get('step');
  keys.fire = true;
  for (let i = 0; i < 4; i++) step();
  ok('firing launches a missile', S.shots.length === 1);
  for (let i = 0; i < 200; i++) step();
  ok('no more than the cap are ever in flight', S.shots.length <= C.missile.max,
     String(S.shots.length));
  keys.fire = false;

  // Launched outward: it must be moving away from Earth, not toward it.
  const G2 = run({ audio: true, W: 1600, H: 900 });
  launch(G2);
  const S2 = G2.get('S'), k2 = G2.get('keys'), st2 = G2.get('step');
  k2.fire = true; st2(); k2.fire = false;
  const b = S2.shots[0];
  const before = Math.hypot(b.x - 800, b.y - 450);
  for (let i = 0; i < 10; i++) st2();
  const after = Math.hypot(b.x - 800, b.y - 450);
  ok('missiles travel outward from Earth', after > before, before + ' -> ' + after);
}

section('tap to designate an intercept');
{
  const G = run({ audio: true, W: 1600, H: 900 });
  launch(G);
  const S = G.get('S'), C = G.get('CONFIG'), step = G.get('step');
  const fire = G.get('launch');

  // No target: ballistic, straight out along the radius, bent by gravity.
  S.shots.length = 0; S.ship.cool = 0;
  fire(null);
  ok('firing with no target gives a ballistic shot', S.shots[0].tx === undefined);

  // With a target: guided, and it carries the designated point with it.
  S.shots.length = 0; S.ship.cool = 0;
  S.ship.a = -Math.PI / 2;                       // station directly above Earth
  fire({ x: 500, y: 700 });                      // designate down and to the left
  const m = S.shots[0];
  ok('designating carries the point on the missile', m.tx === 500 && m.ty === 700);
  ok('and it launches toward the point, not along the radius',
     m.vx < 0 && m.vy > 0, m.vx.toFixed(2) + ',' + m.vy.toFixed(2));

  // It must actually arrive. A designated intercept that gravity drags off
  // course would make designating meaningless, so guided shots ignore it.
  S.rocks.length = 0; S.queue = 0;
  let ticks = 0;
  while (S.shots.length && ticks < 400) { step(); ticks++; }
  ok('a designated shot reaches its point and detonates', ticks < 400, ticks + ' ticks');

  // Detonating at the point clears what is there, whatever the flight path.
  const G2 = run({ audio: true, W: 1600, H: 900 });
  launch(G2);
  const S2 = G2.get('S'), mk2 = G2.get('makeRock'), st2 = G2.get('step');
  S2.rocks.length = 0; S2.queue = 0; S2.shots.length = 0; S2.ship.cool = 0;
  S2.rocks.push(mk2(1, 1, { x: 1150, y: 450, vx: 0, vy: 0 }));
  G2.get('launch')({ x: 1150, y: 450 });
  for (let i = 0; i < 400 && S2.rocks.length; i++) st2();
  ok('the designated point is where it goes off', S2.rocks.length === 0);

  // Cooldown and the in-flight cap still apply to designated shots.
  const G3 = run({ audio: true, W: 1600, H: 900 });
  launch(G3);
  const S3 = G3.get('S'), C3 = G3.get('CONFIG');
  S3.shots.length = 0; S3.ship.cool = 0;
  ok('the first designation launches', G3.get('launch')({ x: 900, y: 300 }) === true);
  ok('a second one inside the cooldown does not',
     G3.get('launch')({ x: 900, y: 300 }) === false);
  ok('nothing extra was queued', S3.shots.length === 1);
}

section('pointer input');
{
  const G = run({ audio: true, W: 1600, H: 900 });
  const stage = G.el('stage');
  const S = G.get('S');

  // On the title screen a tap takes station rather than firing.
  stage.fire('pointerdown', {
    clientX: 400, clientY: 400,
    target: { closest: () => null }, preventDefault() {},
  });
  ok('a tap on the title screen takes station', S.mode === 'playing');
  ok('and does not launch anything', S.shots.length === 0);

  // In play it designates, converting screen pixels to world units.
  S.ship.cool = 0;
  stage.fire('pointerdown', {
    clientX: 400, clientY: 400,
    target: { closest: () => null }, preventDefault() {},
  });
  ok('a tap in play designates an intercept', S.shots.length === 1);
  ok('at the world point under the finger',
     S.shots[0].tx === 400 && S.shots[0].ty === 400,
     S.shots[0].tx + ',' + S.shots[0].ty);

  // A tap on an orbit control is the control's business, not a launch.
  S.shots.length = 0; S.ship.cool = 0;
  stage.fire('pointerdown', {
    clientX: 40, clientY: 700,
    target: { closest: sel => (sel.includes('.btn') ? {} : null) }, preventDefault() {},
  });
  ok('a tap on a control button does not launch', S.shots.length === 0);

  // Paused, nothing fires.
  S.mode = 'paused'; S.ship.cool = 0;
  stage.fire('pointerdown', {
    clientX: 400, clientY: 400,
    target: { closest: () => null }, preventDefault() {},
  });
  ok('a tap while paused does nothing', S.shots.length === 0);

  const fs2 = require('fs'), path2 = require('path');
  const html = fs2.readFileSync(path2.join(__dirname, '..', 'collision.html'), 'utf8');
  ok('the FIRE button is gone; the field is the trigger',
     !/data-k="fire"/.test(html));
  ok('the orbit and altitude controls remain',
     /data-k="left"/.test(html) && /data-k="up"/.test(html));
}

section('rocks fall toward Earth and can be shot');
{
  const G = run({ audio: true, W: 1600, H: 900 });
  launch(G);
  const S = G.get('S'), C = G.get('CONFIG'), step = G.get('step');
  const mk = G.get('makeRock');

  // Dropped from rest well outside: gravity alone must bring it in.
  S.rocks.length = 0;
  S.rocks.push(mk(3, 1, { x: 800 + 600, y: 450, vx: 0, vy: 0 }));
  const d0 = Math.hypot(S.rocks[0].x - 800, S.rocks[0].y - 450);
  for (let i = 0; i < 120; i++) step();
  ok('Earth pulls rocks in', S.rocks.length && Math.hypot(S.rocks[0].x - 800, S.rocks[0].y - 450) < d0);

  // A blast clears everything inside its radius, not just what it touched.
  const G2 = run({ audio: true, W: 1600, H: 900 });
  launch(G2);
  const S2 = G2.get('S'), mk2 = G2.get('makeRock');
  S2.rocks.length = 0;
  for (const dx of [0, 20, -20, 35]) S2.rocks.push(mk2(1, 1, { x: 800 + dx, y: 200, vx: 0, vy: 0 }));
  G2.get('detonate')(800, 200);
  ok('one blast clears a cluster', S2.rocks.length === 0, String(S2.rocks.length));
  ok('and it scores for every one of them', S2.score >= 4 * G2.get('CONFIG').rock.score[1]);

  // Big rocks split; the smallest vaporise.
  const G3 = run({ audio: true, W: 1600, H: 900 });
  launch(G3);
  const S3 = G3.get('S'), mk3 = G3.get('makeRock');
  S3.rocks.length = 0; S3.rocks.push(mk3(3, 1, { x: 800, y: 100, vx: 0, vy: 1 }));
  G3.get('splitRock')(0);
  ok('a large rock splits in two', S3.rocks.length === 2);
  ok('the children are smaller', S3.rocks.every(r => r.size === 2));
  S3.rocks.length = 0; S3.rocks.push(mk3(1, 1, { x: 800, y: 100, vx: 0, vy: 1 }));
  G3.get('splitRock')(0);
  ok('the smallest just vaporise', S3.rocks.length === 0);
}

section('strays leave promptly, but only when they are really gone');
{
  const G = run({ audio: true, W: 1600, H: 900 });
  launch(G);
  const S = G.get('S'), step = G.get('step'), mk = G.get('makeRock');
  const A = G.get('ARENA'), esc = G.get('escaping');

  /* REGRESSION. Strays used to be culled at 2.6x the arena radius, which a
     rock crosses in about twenty seconds — so the field looked clear and the
     next wave would not start. They travel at roughly 2.8x escape speed, so
     they were never coming back and the wait bought nothing. */
  S.rocks.length = 0; S.queue = 0;
  S.rocks.push(mk(3, 1, { x: 800 + A * 1.1, y: 450, vx: 3, vy: 0 }));   // outbound, fast
  ok('a rock past the edge at speed is counted as gone', esc(S.rocks[0]) === true);
  let ticks = 0;
  while (S.rocks.length && ticks < 120) { step(); ticks++; }
  ok('and it is removed within a couple of seconds', ticks < 120, ticks + ' ticks');

  // But the near-misses gravity curls back must survive.
  const G2 = run({ audio: true, W: 1600, H: 900 });
  launch(G2);
  const S2 = G2.get('S'), esc2 = G2.get('escaping');
  S2.rocks.length = 0; S2.queue = 0;
  const slow = mk(3, 1, { x: 800 + A * 1.1, y: 450, vx: 0.1, vy: 0 });  // outbound, crawling
  S2.rocks.push(slow);
  ok('a rock below escape speed is NOT counted as gone', esc2(slow) === false);
  const back = mk(3, 1, { x: 800 + A * 1.1, y: 450, vx: -3, vy: 0 });   // heading back in
  ok('a rock heading back in is never counted as gone', esc2(back) === false);
  const near = mk(3, 1, { x: 800 + 200, y: 450, vx: 5, vy: 0 });        // fast but on the field
  ok('a rock still on the field is never counted as gone', esc2(near) === false);

  // The whole point: the wave turns over as soon as the field is actually clear.
  const G3 = run({ audio: true, W: 1600, H: 900 });
  launch(G3);
  const S3 = G3.get('S'), st3 = G3.get('step');
  S3.rocks.length = 0; S3.queue = 0;
  S3.rocks.push(G3.get('makeRock')(1, 1, { x: 800 + A * 1.1, y: 450, vx: 4, vy: 0 }));
  let n = 0;
  while (S3.wave === 1 && n < 180) { st3(); n++; }
  ok('the next wave starts within three seconds of the last stray leaving',
     S3.wave === 2, n + ' ticks');
}

section('rapid tapping must never read as a zoom gesture');
{
  // The field is the fire button here, so tapping fast is the normal way to
  // play — and it is exactly the gesture iOS reads as double-tap-to-zoom.
  // iOS ignores user-scalable=no, so the page has to stop it itself.
  const T = run({ audio: true, media: { '(pointer: coarse)': true } });
  let prevented = 0;
  for (const ts of [1000, 1080, 1160]) {
    T.fireGlobal('touchend', {
      timeStamp: ts, target: { closest: () => null },
      preventDefault() { prevented++; },
    });
  }
  ok('every tap on the field suppresses the browser default', prevented === 3);

  let onButton = 0;
  T.fireGlobal('touchend', {
    timeStamp: 2000, target: { closest: sel => (sel.includes('button') ? {} : null) },
    preventDefault() { onButton++; },
  });
  ok('taps on a button are left alone so their clicks still fire', onButton === 0);

  const D = run({ audio: true });          // fine pointer: no guard installed
  let desk = 0;
  for (const ts of [1000, 1080]) {
    D.fireGlobal('touchend', {
      timeStamp: ts, target: { closest: () => null },
      preventDefault() { desk++; },
    });
  }
  ok('the guard is not installed on a desktop pointer', desk === 0);
}

section('Earth takes damage and the run ends');
{
  const G = run({ audio: true, W: 1600, H: 900 });
  launch(G);
  const S = G.get('S'), C = G.get('CONFIG'), step = G.get('step'), mk = G.get('makeRock');
  S.rocks.length = 0; S.queue = 0;
  S.rocks.push(mk(3, 1, { x: 800 + C.earth.r + 5, y: 450, vx: -1, vy: 0 }));
  const before = S.integrity;
  for (let i = 0; i < 20; i++) step();
  ok('a rock reaching Earth costs integrity', S.integrity < before,
     before + ' -> ' + S.integrity);
  ok('damage scales with the size that got through',
     C.rock.damage[3] > C.rock.damage[2] && C.rock.damage[2] > C.rock.damage[1]);

  S.integrity = C.rock.damage[3] - 1;             // one more will finish it
  S.rocks.length = 0;
  S.rocks.push(mk(3, 1, { x: 800 + C.earth.r + 5, y: 450, vx: -1, vy: 0 }));
  for (let i = 0; i < 20; i++) step();
  ok('losing Earth ends the run', S.mode === 'over');
  ok('integrity never reads below zero', S.integrity === 0, String(S.integrity));
}

section('scoring and the personal best');
{
  const G = run({ audio: true, W: 1600, H: 900 });
  const C = G.get('CONFIG');
  ok('score is a clean 3x ramp',
     C.rock.score[2] === C.rock.score[3] * 3 && C.rock.score[1] === C.rock.score[2] * 3);
  ok('score is not the 1979 arcade table',
     !(C.rock.score[3] === 20 && C.rock.score[2] === 50 && C.rock.score[1] === 100));

  launch(G);
  const S = G.get('S');
  S.score = 4321;
  G.get('gameOver')();
  ok('a first run becomes the best', G.localStorage.getItem('cl.best.v1') === '4321');
  ok('the game-over screen says so', G.el('overNote').innerHTML.includes('New personal best'));

  const G2 = run({ audio: true, storage: G.localStorage });
  ok('the best survives a reload', G2.get('S').best === 4321);
  launch(G2);
  G2.get('S').score = 100;
  G2.get('gameOver')();
  ok('a worse run does not lower it', G2.localStorage.getItem('cl.best.v1') === '4321');
  ok('and it is reported rather than celebrated',
     G2.el('overNote').innerHTML.includes('Personal best'));

  // Separate key from SINGULARITY: two games, two boards.
  ok('COLLISION does not write to SINGULARITY storage',
     G2.localStorage.getItem('sj.users.v1') === null);
}

section('waves');
{
  const G = run({ audio: true, W: 1600, H: 900 });
  launch(G);
  const S = G.get('S'), step = G.get('step');
  S.rocks.length = 0; S.queue = 0;
  const hurt = S.integrity = 60;
  step();
  ok('clearing a wave advances to the next', S.wave === 2);
  ok('and repairs Earth a little', S.integrity > hurt, hurt + ' -> ' + S.integrity);

  S.integrity = 100; S.rocks.length = 0; S.queue = 0;
  step();
  ok('repair never exceeds full integrity', S.integrity === 100);

  const brief = G.get('waveBrief');
  let longest = 0;
  for (let n = 2; n <= 60; n++) longest = Math.max(longest, brief(n).split(/\s+/).length);
  ok('wave briefings stay short', longest <= 8, longest + ' words');
  ok('every wave has something to say',
     Array.from({ length: 60 }, (_, i) => brief(i + 1)).every(s => s && s.length > 5));

  // Later waves are harder along every dial, not just one.
  const dials = n => { G.get('waveSetup')(n); return { q: S.queue, sp: S.waveSpeed, gap: S.waveGap }; };
  const w1 = dials(1), w8 = dials(8);
  ok('later waves send more', w8.q > w1.q);
  ok('later waves send them faster', w8.sp > w1.sp);
  ok('later waves send them closer together', w8.gap < w1.gap);
}

section('wave one is survivable, and waves turn over');
{
  const G = run({ audio: true, W: 1600, H: 900 });
  launch(G);
  const S = G.get('S'), C = G.get('CONFIG'), setup = G.get('waveSetup');

  /* REGRESSION. Wave one used to send six size-3 rocks — forty-two objects
     once they split — at an Earth four of them would finish. */
  setup(1);
  const objects = size => size === 3 ? 7 : (size === 2 ? 3 : 1);
  ok('wave one sends only a handful of rocks', S.queue <= 4, String(S.queue));
  ok('and they are mediums, which split once rather than twice', S.waveSize === 2);
  ok('so wave one is under a dozen objects even fully split',
     S.queue * objects(S.waveSize) <= 12, String(S.queue * objects(S.waveSize)));
  setup(2);
  ok('wave two is still mediums', S.waveSize === 2);
  setup(3);
  ok('the big ones arrive at wave three', S.waveSize === 3);

  ok('Earth survives more than a handful of hits',
     Math.ceil(C.earth.integrity / C.rock.damage[3]) >= 5,
     Math.ceil(C.earth.integrity / C.rock.damage[3]) + ' hits');

  setup(1);
  const window1 = 40 + (S.queue - 1) * S.waveGap;
  ok('the wave finishes arriving in about three seconds', window1 / 60 < 4,
     (window1 / 60).toFixed(1) + 's');

  /* The wave must turn over on what is ON THE FIELD, not on stragglers that
     have left it — gravity can capture a rock into an orbit it never escapes,
     which would otherwise stall the wave forever. */
  const G2 = run({ audio: true, W: 1600, H: 900 });
  launch(G2);
  const S2 = G2.get('S'), st2 = G2.get('step'), A = G2.get('ARENA');
  S2.rocks.length = 0; S2.queue = 0;
  // Slow, outbound, below escape speed: it will never be culled, and used to
  // hold the wave open indefinitely.
  S2.rocks.push(G2.get('makeRock')(1, 1, { x: 800 + A * 1.2, y: 450, vx: 0.05, vy: 0 }));
  let n = 0;
  while (S2.wave === 1 && n < 120) { st2(); n++; }
  ok('a straggler off the field does not hold the wave open', S2.wave === 2, n + ' ticks');

  // Anything still on the field does hold it, because you can still shoot it.
  const G3 = run({ audio: true, W: 1600, H: 900 });
  launch(G3);
  const S3 = G3.get('S'), st3 = G3.get('step');
  S3.rocks.length = 0; S3.queue = 0;
  S3.rocks.push(G3.get('makeRock')(1, 1, { x: 950, y: 450, vx: 0, vy: 0 }));
  for (let i = 0; i < 120; i++) st3();
  ok('a rock still on the field keeps the wave open', S3.wave === 1);
}

section('sustained fire is limited by tapping, not by the game');
{
  const G = run({ audio: true, W: 1600, H: 900 });
  launch(G);
  const S = G.get('S'), C = G.get('CONFIG'), step = G.get('step');
  const fire = G.get('launch');

  /* REGRESSION. max is the number IN FLIGHT and a guided shot holds its slot
     for the whole journey, so four slots meant a dead stop after three or
     four taps at anything but point-blank range. */
  S.shots.length = 0; S.ship.cool = 0;
  let fired = 0;
  for (let i = 0; i < 400; i++) {
    if (fire({ x: 1300, y: 450 })) fired++;      // long shots, ~80 ticks each
    step();
  }
  const perSecond = fired / (400 / 60);
  ok('long-range fire sustains several shots a second', perSecond >= 4,
     perSecond.toFixed(1) + ' shots/sec');
  ok('the in-flight cap is generous enough not to be felt', C.missile.max >= 8,
     String(C.missile.max));
  ok('and the reload is well under a fifth of a second', C.missile.cooldown <= 8,
     (C.missile.cooldown / 60).toFixed(2) + 's');
}

section('audio never breaks the game');
{
  const silent = run();                    // no Web Audio at all
  launch(silent);
  for (let i = 0; i < 120; i++) silent.get('step')();
  ok('a full second of play runs with no Web Audio', silent.get('S').mode === 'playing');

  const A = run({ audio: true, W: 1600, H: 900 });
  launch(A);
  const S = A.get('S'), step = A.get('step');
  S.integrity = 20;                        // alarm territory
  step();
  const wailing = A.audioCtx.liveVoices;
  ok('a damaged Earth sounds an alarm', wailing > 0);
  S.mode = 'paused'; step();
  ok('pausing silences it', A.audioCtx.liveVoices < wailing);

  // The explosion lesson from SINGULARITY: a pitched downward sweep is a kick
  // drum. Earth taking a hit must be noise, not a note.
  A.audio.length = 0;
  A.get('SFX').impact();
  ok('the Earth impact uses no pitched oscillator',
     A.audio.filter(x => x === 'osc:start').length === 0, A.audio.join(','));
  ok('and it is layered rather than a single sweep',
     A.audio.filter(x => x === 'src:start').length >= 7);
}

section('mobile and frame rate');
{
  const fs = require('fs'), path = require('path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'collision.html'), 'utf8');
  ok('viewport opts into the safe-area insets', /viewport-fit=cover/.test(html));
  ok('stage height uses dvh with a vh fallback', /height:100vh;height:100dvh/.test(html));
  ok('the root kills double-tap zoom', /html,body\{[^}]*touch-action:manipulation/.test(html));
  ok('the canvas swallows every gesture', /canvas\{[^}]*touch-action:none/.test(html));
  ok('thumb controls clear the home indicator',
     /calc\(26px \+ env\(safe-area-inset-bottom\)\)/.test(html));

  const desk = run({ W: 1600, H: 900 });
  ok('a large screen is one world unit per pixel', desk.get('VIEW') === 1);
  const phone = run({ W: 390, H: 750 });
  ok('a phone zooms the camera out', phone.get('VIEW') < 1);
  ok('the short axis normalises to REF_MIN',
     Math.round(Math.min(phone.get('W'), phone.get('H'))) === 700);
  ok('the orbit band fits on a phone',
     phone.get('CONFIG').ship.orbitMax * 2 < Math.min(phone.get('W'), phone.get('H')),
     phone.get('CONFIG').ship.orbitMax * 2 + ' vs ' + Math.min(phone.get('W'), phone.get('H')));

  for (const hz of [60, 144, 30]) {
    const T = run({ audio: true });
    require('vm').runInContext('var __ticks = 0; step = function(){ __ticks++; };', T.sandbox);
    const dt = 1000 / hz;
    let t = 5000;
    T.get('loop')(t);
    for (let i = 0; i < hz; i++) { t += dt; T.get('loop')(t); }
    const c = require('vm').runInContext('__ticks', T.sandbox);
    ok(hz + 'Hz produces ~60 sim ticks in one second', Math.abs(c - 60) <= 1, 'got ' + c);
  }
}

console.log(results.join('\n'));
console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);

})().catch(e => { console.log(results.join('\n')); console.error('\nHARNESS ERROR:', e); process.exit(1); });
