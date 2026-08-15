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
  for (const k of ['fillRect','beginPath','arc','fill','stroke','moveTo','lineTo',
                   'closePath','save','restore','translate','rotate','scale','setLineDash']) c[k] = noop;
  // Recorded so tests can assert the world-to-screen transform.
  c._transform = null;
  c.setTransform = (...a) => { c._transform = a; };
  c.lineJoin = c.lineCap = c.fillStyle = c.strokeStyle = '';
  c.lineWidth = 1;
  return c;
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
    fireGlobal: (type, ev) => { for (const fn of sandbox._listeners.global[type] || []) fn(ev); },
  };
}

module.exports = { run, makeStorage, extractScript, HTML };
