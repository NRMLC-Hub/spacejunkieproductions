/* Headless harness for singularity.html — no browser, no automation.
   Extracts the inline <script> block and runs it in a Node vm context against
   stub DOM objects. This is how this project verifies web code; see CLAUDE.md.

     node tests/accounts.test.js                                            */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const HTML = fs.readFileSync(
  process.env.SJ_HTML || path.join(__dirname, '..', 'singularity.html'), 'utf8');

function extractScript(html) {
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('no <script> block found');
  return m[1];
}

// --- element ids referenced by the page, harvested from the markup so the
// --- stub fails loudly if the script asks for something that does not exist.
function harvestIds(html) {
  const ids = new Set();
  for (const m of html.matchAll(/\sid="([^"]+)"/g)) ids.add(m[1]);
  return ids;
}

function makeCtx() {
  const noop = () => {};
  const c = {};
  for (const k of ['fillRect','beginPath','arc','ellipse','fill','stroke','moveTo','lineTo',
                   'closePath','save','restore','translate','rotate','scale','setLineDash']) c[k] = noop;
  // Recorded so tests can assert the world-to-screen transform.
  c._transform = null;
  c.setTransform = (...a) => { c._transform = a; };
  c.lineJoin = c.lineCap = c.fillStyle = c.strokeStyle = '';
  c.lineWidth = 1;
  return c;
}

/* Minimal Web Audio stub. Records what was created, started and stopped so a
   test can assert that a shot makes a noise and that held voices are released,
   without any audio hardware in the loop. */
function makeAudioContext(log) {
  const param = v => ({
    value: v,
    setValueAtTime(x) { this.value = x; return this; },
    linearRampToValueAtTime(x) { this.value = x; return this; },
    exponentialRampToValueAtTime(x) { this.value = x; return this; },
    setTargetAtTime(x) { this.value = x; return this; },
    cancelScheduledValues() { return this; },
  });
  const base = kind => ({ kind, connect(dest) { return dest; }, disconnect() {} });
  let live = 0;
  const ctx = {
    kind: 'ctx',
    _gains: [],   // _gains[0] is the master node; start() creates it first
    state: 'running',
    currentTime: 0,
    sampleRate: 44100,
    destination: base('destination'),
    get liveVoices() { return live; },
    resume() { ctx.state = 'running'; return Promise.resolve(); },
    createGain() { const n = base('gain'); n.gain = param(1); ctx._gains.push(n); return n; },
    createBiquadFilter() { const n = base('filter'); n.frequency = param(350); n.Q = param(1); return n; },
    createWaveShaper() { const n = base('shaper'); n.curve = null; n.oversample = 'none'; return n; },
    createOscillator() {
      const n = base('osc'); n.frequency = param(440); n.detune = param(0); n.type = 'sine';
      n.start = () => { live++; log.push('osc:start'); };
      n.stop = () => { live--; log.push('osc:stop'); };
      return n;
    },
    createBufferSource() {
      const n = base('src'); n.buffer = null; n.loop = false;
      n.start = () => { live++; log.push('src:start'); };
      n.stop = () => { live--; log.push('src:stop'); };
      return n;
    },
    createBuffer(_ch, len, sr) {
      const data = new Float32Array(len);
      return { length: len, sampleRate: sr, getChannelData: () => data };
    },
  };
  return ctx;
}

/* Speech synthesis stub. speak() fires onstart but NOT onend, so a test can
   observe the ducked state and then end the utterance itself. */
function makeSpeech(log) {
  const voices = [
    { name: 'Amelie', lang: 'fr-FR', localService: true },
    { name: 'Samantha', lang: 'en-US', localService: true },
    // Chrome's Google voices are synthesised on a server and truncate.
    { name: 'Google UK English Male', lang: 'en-GB', localService: false },
    { name: 'Daniel', lang: 'en-GB', localService: true },
  ];
  return {
    last: null,
    speaking: false,
    pending: false,
    onvoiceschanged: null,
    getVoices: () => voices,
    speak(u) {
      log.push('speak:' + u.text); this.last = u; this.speaking = true;
      if (u.onstart) u.onstart();
    },
    cancel() { log.push('cancel'); this.speaking = false; },
    // What the page calls when the utterance really finishes.
    finish() { this.speaking = false; if (this.last && this.last.onend) this.last.onend(); },
  };
}

function makeStorage() {
  const map = new Map();
  return {
    _map: map,
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: k => { map.delete(k); },
    clear: () => map.clear(),
  };
}

function buildSandbox(opts = {}) {
  const ids = harvestIds(HTML);
  const els = new Map();
  const listeners = { global: {}, };

  function makeEl(id) {
    const el = {
      id,
      textContent: '',
      innerHTML: '',
      value: '',
      hidden: false,
      disabled: false,
      dataset: {},
      style: {},
      _classes: new Set(),
      _listeners: {},
      classList: {
        add: c => el._classes.add(c),
        remove: c => el._classes.delete(c),
        contains: c => el._classes.has(c),
        toggle: (c, on) => { if (on) el._classes.add(c); else el._classes.delete(c); return !!on; },
      },
      addEventListener: (type, fn) => { (el._listeners[type] ||= []).push(fn); },
      removeEventListener: noopFn,
      setAttribute: noopFn,
      getAttribute: () => null,
      focus: noopFn,
      insertAdjacentHTML: (_pos, html) => { el.innerHTML += html; },
      querySelectorAll: () => [],
      closest: () => null,
      // Canvas is at the origin in the stub; world = client / VIEW.
      getBoundingClientRect: () => ({ left:0, top:0,
        width: el.clientWidth, height: el.clientHeight,
        right: el.clientWidth, bottom: el.clientHeight, x:0, y:0 }),
      // Cached, so a test can inspect the same context the page drew through.
      getContext: () => (el._ctx || (el._ctx = makeCtx())),
      clientWidth: opts.W || 1000,
      clientHeight: opts.H || 700,
      width: 0, height: 0,
      fire(type, ev = {}) { for (const fn of el._listeners[type] || []) fn(ev); },
    };
    return el;
  }
  function noopFn() {}

  const audioLog = [];
  const audioCtx = makeAudioContext(audioLog);
  const speechLog = [];
  const speech = makeSpeech(speechLog);

  for (const id of ids) els.set(id, makeEl(id));
  // title screen starts shown, per the markup
  els.get('titleScreen')._classes.add('show');

  const document = {
    _els: els,
    getElementById: id => {
      if (!els.has(id)) throw new Error('getElementById("' + id + '") — no such element in the markup');
      return els.get(id);
    },
    querySelectorAll: () => [],
    querySelector: () => makeEl('_query'),
    addEventListener: noopFn,
    activeElement: null,
  };

  const sandbox = {
    document,
    console,
    TextEncoder,
    TextDecoder,
    crypto: require('crypto').webcrypto,
    localStorage: opts.storage || makeStorage(),
    // Default to file://, the case where the service worker must NOT register.
    // Pass opts.location / opts.navigator to exercise the http(s) path.
    navigator: opts.navigator || { clipboard: { writeText: async () => {} } },
    location: opts.location || { protocol: 'file:', href: 'file:///singularity.html' },
    matchMedia: q => ({ matches: !!(opts.media && opts.media[q]) }),
    // Absent by default — the game must run silently with no Web Audio at all.
    ...(opts.audio ? { AudioContext: function () { return audioCtx; } } : {}),
    // Absent by default — the briefing must still appear with no speech engine.
    ...(opts.voice ? {
      speechSynthesis: speech,
      SpeechSynthesisUtterance: function (text) { this.text = text; },
    } : {}),
    Float32Array,
    devicePixelRatio: 1,
    setTimeout: (fn) => { /* focus only; run nothing */ return 0; },
    clearTimeout: noopFn,
    requestAnimationFrame: fn => { sandbox._raf = fn; return 1; },
    addEventListener: (type, fn) => { (listeners.global[type] ||= []).push(fn); },
    removeEventListener: noopFn,
    Math, JSON, Date, Object, Array, String, Number, Boolean, Error,
    Uint8Array, Promise, Set, Map,
    _listeners: listeners,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox._audioLog = audioLog;
  sandbox._audioCtx = audioCtx;
  sandbox._speechLog = speechLog;
  sandbox._speech = speech;
  vm.createContext(sandbox);
  return sandbox;
}

function run(opts = {}) {
  const sandbox = buildSandbox(opts);
  vm.runInContext(extractScript(HTML), sandbox, { filename: 'singularity-inline.js' });
  // The page declares almost everything with const/let, which lives in the
  // context's global LEXICAL scope and never lands on the sandbox object.
  // Reach it by evaluating an expression in the same context.
  const get = expr => vm.runInContext(expr, sandbox);
  return {
    sandbox,
    get,
    document: sandbox.document,
    localStorage: sandbox.localStorage,
    el: id => sandbox.document.getElementById(id),
    audio: sandbox._audioLog,
    audioCtx: sandbox._audioCtx,
    speech: sandbox._speechLog,
    synth: sandbox._speech,
    masterGain: () => sandbox._audioCtx._gains[0],
    fireGlobal: (type, ev) => { for (const fn of sandbox._listeners.global[type] || []) fn(ev); },
  };
}

module.exports = { run, makeStorage, extractScript, HTML };
