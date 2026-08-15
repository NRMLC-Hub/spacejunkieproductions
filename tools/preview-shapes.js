/* Renders the ship and alien silhouettes to PNG so they can be looked at
   without opening a browser. This is how the current shapes were designed —
   see CLAUDE.md on why browser automation is not used here.

     node tools/preview-shapes.js        # writes preview-*.png in the repo root

   The coordinates are PARSED OUT of singularity.html rather than duplicated,
   so this cannot drift away from what the game actually draws. Subpaths whose
   coordinates are computed at runtime (the thruster flames, which jitter) are
   skipped — only literal geometry can be previewed.

   PNG encoding is the same no-dependency approach as tools/make-icons.js. */
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

/* ------------------------------- PNG ---------------------------------- */
let CRC = null;
function crc32(buf) {
  if (!CRC) {
    CRC = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function png(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------------- pull the geometry out of the game -------------- */
const HTML = fs.readFileSync(path.join(__dirname, '..', 'singularity.html'), 'utf8');

function fnBody(name) {
  const i = HTML.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('no function ' + name + ' in singularity.html');
  // Brace-match from the first { after the signature.
  let depth = 0, start = HTML.indexOf('{', i);
  for (let j = start; j < HTML.length; j++) {
    if (HTML[j] === '{') depth++;
    else if (HTML[j] === '}' && --depth === 0) return HTML.slice(start, j + 1);
  }
  throw new Error('unbalanced braces in ' + name);
}

function paths(name, width) {
  const body = fnBody(name);
  const out = [];
  for (const sub of body.split('ctx.beginPath()').slice(1)) {
    if (/rand\(/.test(sub)) continue;                    // runtime jitter, not previewable
    const seg = sub.split('ctx.stroke()')[0];
    const closed = /closePath/.test(seg);
    // A moveTo begins a NEW polyline — it does not continue the previous one.
    // Treating it as a continuation draws phantom lines between disjoint
    // strokes, e.g. straight through the alien's core between its two bars.
    let run = [];
    const re = /ctx\.(moveTo|lineTo)\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/g;
    let m;
    while ((m = re.exec(seg))) {
      if (m[1] === 'moveTo' && run.length >= 2){ out.push({ pts:run, close:closed, w:width }); run = []; }
      run.push([parseFloat(m[2]), parseFloat(m[3])]);
    }
    if (run.length >= 2) out.push({ pts: run, close: closed, w: width });
  }
  if (!out.length) throw new Error('no literal geometry found in ' + name);
  return out;
}

/* ------------------------------ render -------------------------------- */
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function render(paths, size, scale, file) {
  const SS = 3, buf = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const x = ((px + (sx + 0.5) / SS) - size / 2) / scale;
        const y = ((py + (sy + 0.5) / SS) - size / 2) / scale;
        let ink = false;
        for (const p of paths) {
          const n = p.pts.length, lim = p.close ? n : n - 1;
          for (let i = 0; i < lim && !ink; i++) {
            const a = p.pts[i], b = p.pts[(i + 1) % n];
            if (segDist(x, y, a[0], a[1], b[0], b[1]) < p.w / 2) ink = true;
          }
          if (ink) break;
        }
        if (ink) hits++;
      }
      const v = Math.round(255 * hits / (SS * SS)), o = (py * size + px) * 4;
      buf[o] = v; buf[o + 1] = v; buf[o + 2] = v; buf[o + 3] = 255;
    }
  }
  fs.writeFileSync(file, png(size, size, buf));
  console.log('wrote', path.basename(file), '(' + size + 'px)');
}

const root = path.join(__dirname, '..');
const ship  = paths('drawShip', 1.6);
const alien = paths('drawAlien', 1.5);
render(ship,  260, 8,   path.join(root, 'preview-ship.png'));
render(ship,  48,  1.5, path.join(root, 'preview-ship-small.png'));
render(alien, 260, 8,   path.join(root, 'preview-alien.png'));
render(alien, 48,  1.5, path.join(root, 'preview-alien-small.png'));
