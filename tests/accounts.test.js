const { run } = require('./harness');

let pass = 0, fail = 0;
const results = [];
function ok(name, cond, extra) {
  if (cond) { pass++; results.push('  PASS  ' + name); }
  else { fail++; results.push('  FAIL  ' + name + (extra ? '   -> ' + extra : '')); }
}
async function throws(fn, name, wanted) {
  try { await fn(); ok(name, false, 'expected a rejection, got none'); }
  catch (e) {
    ok(name, wanted ? String(e.message).includes(wanted) : true,
       wanted ? 'message was: ' + e.message : '');
  }
}
const section = t => results.push('\n' + t);

(async () => {

section('loading');
let H;
try { H = run(); ok('script parses and evaluates', true); }
catch (e) { ok('script parses and evaluates', false, e.message); console.log(results.join('\n')); process.exit(1); }

const Store = H.get('Store');

ok('ready() reports ok under stub storage + webcrypto', (await Store.ready()).ok);
ok('no pilot at first launch', (await Store.currentUser()) === null);
ok('empty leaderboard at first launch', (await Store.topTen()).length === 0);

section('sign up');
const up = await Store.signUp('martin', 'orbit99');
ok('signUp returns the pilot', up.user && up.user.name === 'martin');
ok('signUp returns a recovery code', /^SNGL-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(up.recoveryCode));
ok('recovery code avoids I O 0 1', !/[IO01]/.test(up.recoveryCode.slice(5)));
ok('signUp signs you in', (await Store.currentUser()).name === 'martin');
ok('new pilot starts at zero', (await Store.currentUser()).best === 0);

section('nothing is stored in the clear');
const raw = JSON.stringify([...H.localStorage._map.entries()]);
ok('password is not in storage', !raw.includes('orbit99'));
ok('recovery code is not in storage', !raw.includes(up.recoveryCode.replace(/-/g, '')));
const rec = JSON.parse(H.localStorage.getItem('sj.users.v1')).martin;
ok('pw hash is 32 bytes of hex', /^[0-9a-f]{64}$/.test(rec.pwHash));
ok('pw salt is 16 bytes of hex', /^[0-9a-f]{32}$/.test(rec.pwSalt));
ok('pw and recovery code use different salts', rec.pwSalt !== rec.codeSalt);
ok('iteration count is recorded per record', rec.rounds === 150000);

section('sign up guards');
await throws(() => Store.signUp('martin', 'another1'), 'duplicate callsign rejected', 'taken');
await throws(() => Store.signUp('MARTIN', 'another1'), 'duplicate is case-insensitive', 'taken');
await throws(() => Store.signUp('a', 'another1'), 'callsign under 2 chars rejected', 'Callsign');
await throws(() => Store.signUp('seventeen-chars-x', 'another1'), 'callsign over 16 chars rejected', 'Callsign');
await throws(() => Store.signUp('bad name', 'another1'), 'callsign with a space rejected', 'Callsign');
await throws(() => Store.signUp('<script>', 'another1'), 'callsign with markup rejected', 'Callsign');
await throws(() => Store.signUp('ok_pilot', 'short'), 'password under 6 chars rejected', 'at least 6');

section('sign in');
await Store.signOut();
ok('signOut clears the session', (await Store.currentUser()) === null);
await throws(() => Store.signIn('martin', 'wrongpw'), 'wrong password rejected');
await throws(() => Store.signIn('nobody', 'orbit99'), 'unknown callsign rejected');
let e1 = '', e2 = '';
try { await Store.signIn('martin', 'wrongpw'); } catch (e) { e1 = e.message; }
try { await Store.signIn('nobody', 'orbit99'); } catch (e) { e2 = e.message; }
ok('wrong password and unknown callsign give the same message', e1 === e2 && e1.length > 0);
ok('signIn works with the right password', (await Store.signIn('martin', 'orbit99')).name === 'martin');
ok('signIn is case-insensitive on the callsign', (await Store.signIn('MaRtIn', 'orbit99')).name === 'martin');
ok('display name keeps its original case', (await Store.currentUser()).name === 'martin');

section('scoring');
let r = await Store.submitScore(4200, 5);
ok('first run becomes the personal best', r.best === 4200 && r.isRecord === true);
r = await Store.submitScore(1500, 3);
ok('a worse run does not lower the best', r.best === 4200 && r.isRecord === false);
r = await Store.submitScore(9100, 8);
ok('a better run raises the best', r.best === 9100 && r.isRecord === true);
ok('best level tracks the best run', r.bestLevel === 8);
ok('play count accumulates across runs', (await Store.currentUser()).plays === 3);
ok('an equal score is not a new record', (await Store.submitScore(9100, 9)).isRecord === false);
await Store.signOut();
ok('guest run returns null rather than recording', (await Store.submitScore(999999, 20)) === null);
ok('guest score never reaches the board', (await Store.topTen())[0].score === 9100);

section('leaderboard');
for (let i = 1; i <= 14; i++) {
  await Store.signUp('pilot' + String(i).padStart(2, '0'), 'password' + i);
  await Store.submitScore(i * 1000, i);
  await Store.signOut();
}
const board = await Store.topTen();
ok('board caps at ten', board.length === 10);
ok('board is sorted high to low', board.every((x, i) => i === 0 || board[i - 1].score >= x.score));
ok('board top is the highest score', board[0].score === 14000);
// 14 new pilots at 1000..14000, plus martin's 9100 already on the board
ok('board is exactly the ten highest scores',
   JSON.stringify(board.map(x => x.score)) ===
   JSON.stringify([14000, 13000, 12000, 11000, 10000, 9100, 9000, 8000, 7000, 6000]),
   board.map(x => x.score).join(','));
ok('the eleventh best score is cut', !board.some(x => x.score === 5000));
ok('a pilot who never scored is left off', !board.some(x => x.name === 'ok_pilot'));
await Store.signUp('tieA', 'password1'); await Store.submitScore(50000, 1); await Store.signOut();
await Store.signUp('tieB', 'password1'); await Store.submitScore(50000, 1); await Store.signOut();
const tied = (await Store.topTen()).filter(x => x.score === 50000).map(x => x.name);
ok('a tie is broken by who got there first', tied[0] === 'tieA' && tied[1] === 'tieB');

section('password recovery');
await throws(() => Store.resetPassword('martin', 'SNGL-XXXX-XXXX', 'newpass1'), 'wrong recovery code rejected');
await throws(() => Store.resetPassword('nobody', up.recoveryCode, 'newpass1'), 'reset on unknown callsign rejected');
await throws(() => Store.resetPassword('martin', up.recoveryCode, 'abc'), 'reset to a short password rejected', 'at least 6');
const back = await Store.resetPassword('martin', up.recoveryCode, 'newpass1');
ok('reset with the right code works', back.name === 'martin');
ok('reset signs you back in', (await Store.currentUser()).name === 'martin');
ok('reset preserves the high score', back.best === 9100);
await Store.signOut();
await throws(() => Store.signIn('martin', 'orbit99'), 'the old password stops working');
ok('the new password works', (await Store.signIn('martin', 'newpass1')).name === 'martin');
ok('recovery code accepted lower-case and without dashes',
   (await Store.resetPassword('martin', up.recoveryCode.toLowerCase().replace(/-/g, ''), 'third123')).name === 'martin');
ok('one pilot cannot reset another with their own code',
   await (async () => { try { await Store.resetPassword('pilot01', up.recoveryCode, 'hijack99'); return false; }
                        catch (e) { return true; } })());

section('survives a reload');
const H2 = run({ storage: H.localStorage });
const Store2 = H2.get('Store');
ok('session is restored', (await Store2.currentUser()).name === 'martin');
ok('high score is restored', (await Store2.currentUser()).best === 9100);
ok('leaderboard is restored', (await Store2.topTen()).length === 10);

section('the form does not fight the game for keys');
const G = run();
ok('game starts on the title screen', G.get('S').mode === 'title');
G.fireGlobal('keydown', { code: 'Space', key: ' ', preventDefault() {}, repeat: false });
ok('space launches from the title screen', G.get('S').mode === 'playing');

const G2 = run();
G2.get('openAuth')('up');
ok('opening the form sets the modal flag', G2.get('S').ui === 'auth');
let prevented = false;
G2.fireGlobal('keydown', { code: 'Space', key: ' ', preventDefault() { prevented = true; }, repeat: false });
ok('space does NOT launch while the form is open', G2.get('S').mode === 'title');
ok('space is NOT swallowed while typing a password', prevented === false);
G2.fireGlobal('keydown', { code: 'KeyP', key: 'p', preventDefault() {}, repeat: false });
ok('P does not pause while the form is open', G2.get('S').mode === 'title');
G2.fireGlobal('keydown', { code: 'Escape', key: 'Escape', preventDefault() {}, repeat: false });
ok('escape closes the form', G2.get('S').ui === null);
G2.fireGlobal('keydown', { code: 'Space', key: ' ', preventDefault() {}, repeat: false });
ok('space launches again once the form is closed', G2.get('S').mode === 'playing');

section('fixed timestep is still intact');
for (const hz of [60, 144, 30]) {
  const T = run();
  T.sandbox.step = null;
  require('vm').runInContext('var __ticks = 0; step = function(){ __ticks++; };', T.sandbox);
  const dt = 1000 / hz;
  // Non-zero base: loop() guards with `if (!lastTime)`, so a 0 timestamp
  // reads as "not primed yet" and the frame after it is discarded too.
  let t = 5000;
  T.get('loop')(t);            // prime lastTime; this frame is worth no time
  for (let i = 0; i < hz; i++) { t += dt; T.get('loop')(t); }
  const c = require('vm').runInContext('__ticks', T.sandbox);
  ok(hz + 'Hz produces ~60 sim ticks in one second', Math.abs(c - 60) <= 1, 'got ' + c);
}

section('rendering is not injectable');
{
  const X = run();
  // NAME_RE blocks markup on the way in, but storage is hand-editable, so the
  // renderer has to escape regardless.
  X.localStorage.setItem('sj.users.v1', JSON.stringify({
    evil: { name: '<img src=x onerror=alert(1)>', best: 100, bestLevel: 1, bestAt: 1, plays: 1 }
  }));
  await X.get('renderBoard')('titleBoard');
  const html = X.el('titleBoard').innerHTML;
  ok('a hostile name is escaped on the board', !html.includes('<img') && html.includes('&lt;img'));
}

section('every element the script reaches for exists in the markup');
{
  const Y = run();
  await Y.get('refreshAll')();
  Y.get('openAuth')('forgot');
  Y.get('openAuth')('up');
  Y.get('openAuth')('in');
  Y.get('closeAuth')();
  ok('refreshAll / openAuth / closeAuth touch only real elements', true);
  const Z = run();
  Z.get('gameOver')();
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  ok('gameOver reaches only real elements', Z.get('S').mode === 'over');
  ok('a guest game-over says so', Z.el('overPilot').innerHTML.includes('guest'));
}

section('progressive web app');
{
  // file:// — service workers are unavailable there, so registration must not
  // even be attempted, let alone throw and take the game down with it.
  let triedOnFile = false;
  run({ navigator: { clipboard: {}, serviceWorker: { register: () => { triedOnFile = true; return Promise.resolve(); } } } })
    .fireGlobal('load', {});
  ok('service worker is NOT registered from file://', triedOnFile === false);

  // https — it should register, and register sw.js relative to the page.
  let registered = null;
  const P = run({
    location: { protocol: 'https:', href: 'https://example.com/singularity.html' },
    navigator: { clipboard: {}, serviceWorker: { register: p => { registered = p; return Promise.resolve(); } } },
  });
  ok('nothing registers before the load event fires', registered === null);
  P.fireGlobal('load', {});
  ok('service worker registers over https', registered === 'sw.js');

  // A browser with no serviceWorker at all must still boot the game.
  const N = run({ location: { protocol: 'https:', href: 'https://example.com/' } });
  N.fireGlobal('load', {});
  ok('a browser without service workers still runs the game', N.get('S').mode === 'title');

  // A refused registration must not surface as an unhandled rejection.
  let unhandled = null;
  const onUnhandled = e => { unhandled = e; };
  process.once('unhandledRejection', onUnhandled);
  run({
    location: { protocol: 'https:', href: 'https://example.com/' },
    navigator: { clipboard: {}, serviceWorker: { register: () => Promise.reject(new Error('blocked')) } },
  }).fireGlobal('load', {});
  await new Promise(r => setImmediate(r));
  process.removeListener('unhandledRejection', onUnhandled);
  ok('a refused registration is swallowed, not thrown', unhandled === null);
}

section('manifest, icons and mobile viewport');
{
  const fs = require('fs'), path = require('path');
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'singularity.html'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const mf = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

  ok('manifest is linked from the game', /<link rel="manifest" href="manifest\.json">/.test(html));
  ok('viewport opts into the safe-area insets', /viewport-fit=cover/.test(html));
  ok('apple touch icon is declared', /rel="apple-touch-icon"/.test(html));
  ok('stage height uses dvh, with a vh fallback before it',
     /height:100vh;height:100dvh/.test(html));
  ok('overlays opt back into vertical dragging', /touch-action:pan-y/.test(html));
  ok('key legend is hidden on a touch device',
     /@media \(pointer: coarse\)\{[\s\S]*?\.keys\{display:none\}/.test(html));
  ok('thumb controls clear the home indicator',
     /bottom:calc\(26px \+ env\(safe-area-inset-bottom\)\)/.test(html));
  ok('form fields are 16px so iOS does not zoom', /font-size:16px;\s*\/\* iOS zooms/.test(html));

  ok('manifest start_url points straight at the game', mf.start_url === './singularity.html');
  ok('manifest asks for fullscreen', mf.display === 'fullscreen');
  ok('manifest offers a maskable icon', mf.icons.some(i => i.purpose === 'maskable'));
  ok('manifest and page agree on the theme colour',
     mf.theme_color === '#000000' && /name="theme-color" content="#000000"/.test(html));

  const listed = mf.icons.map(i => i.src)
    .concat((sw.match(/const ASSETS = \[([\s\S]*?)\];/)[1].match(/'([^']+)'/g) || [])
      .map(s => s.replace(/'/g, '')));
  const missing = [...new Set(listed)]
    .map(p => p.replace(/^\.\//, ''))
    .filter(p => p !== '' && !fs.existsSync(path.join(root, p)));
  ok('every file the manifest and service worker list actually exists',
     missing.length === 0, missing.join(', '));

  for (const px of [32, 180, 192, 512]) {
    const buf = fs.readFileSync(path.join(root, 'icon-' + px + '.png'));
    ok('icon-' + px + '.png is a real PNG at ' + px + 'x' + px,
       buf.slice(0, 8).toString('hex') === '89504e470d0a1a0a' &&
       buf.readUInt32BE(16) === px && buf.readUInt32BE(20) === px);
  }
}

console.log(results.join('\n'));
console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);

})().catch(e => { console.log(results.join('\n')); console.error('\nHARNESS ERROR:', e); process.exit(1); });
