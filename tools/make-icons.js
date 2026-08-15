/* Generates the app icons as PNGs, with no dependencies.
   Node's zlib does the compression; the PNG container and the rasteriser are
   below. Run it when the mark changes; the output is committed so a clone does
   not need to run anything.

     node tools/make-icons.js

   The mark: a black hole — hard event horizon, one accretion arc — with the
   ship falling in. Art is kept inside the middle 60% so the icons survive
   being masked into a circle or squircle on Android and iOS.                */
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

/* ------------------------------- PNG ---------------------------------- */
let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // colour type: RGBA
  ihdr[10] = 0;   // deflate
  ihdr[11] = 0;   // adaptive filtering
  ihdr[12] = 0;   // no interlace

  // one filter byte (0 = None) in front of every scanline
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------------------- the mark -------------------------------- */
// Coverage functions in unit space: (x, y) in [0,1], origin top-left.
// Each returns true if the point is inside white ink.

/* Angles are screen-space radians normalised to [0, 2PI): 0 points right,
   PI/2 down, PI left, 3PI/2 up. Everything is kept inside a centred circle of
   radius 0.40 so a circular or squircle mask cannot clip it. */
const TAU = Math.PI * 2;
const norm = a => ((a % TAU) + TAU) % TAU;

function arc(d, ang, r0, r1, a0, a1) {
  if (d <= r0 || d >= r1) return false;
  return a0 <= a1 ? (ang >= a0 && ang <= a1) : (ang >= a0 || ang <= a1);
}

function ink(x, y) {
  const dx = x - 0.5, dy = y - 0.5;
  const d = Math.hypot(dx, dy);
  const ang = norm(Math.atan2(dy, dx));

  // Event horizon: a hard rim. Inside it stays black, which is the point.
  if (d > 0.170 && d < 0.205) return true;

  // Two accretion arcs, broken and offset so the mark reads as motion rather
  // than as a target. Both stop short of the upper right, leaving the ship
  // clean space to fall through.
  if (arc(d, ang, 0.250, 0.278, 0.55, 3.05)) return true;
  if (arc(d, ang, 0.300, 0.322, 3.40, 5.00)) return true;

  // The ship, upper right, nose swung toward the hole as it falls in.
  if (shipInk(x, y)) return true;

  return false;
}

// Triangle hull drawn as an outline: inside the outer triangle, outside the
// inner one. Same silhouette the game draws.
function shipInk(x, y) {
  const sx = 0.706, sy = 0.294;            // ship centre, ~0.29 out from the middle
  const a = 2.356;                         // heading: down-left, straight at the hole
  const s = 0.098;                         // size; centre + size stays under 0.40
  // rotate the sample point into ship space
  const px = (x - sx) / s, py = (y - sy) / s;
  const ca = Math.cos(-a), sa = Math.sin(-a);
  const rx = px * ca - py * sa, ry = px * sa + py * ca;
  const outer = [[1.0, 0], [-0.70, 0.56], [-0.38, 0], [-0.70, -0.56]];
  const inner = [[0.62, 0], [-0.46, 0.35], [-0.20, 0], [-0.46, -0.35]];
  return inPoly(rx, ry, outer) && !inPoly(rx, ry, inner);
}

function inPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/* ------------------------------ render -------------------------------- */
const SS = 4;   // supersampling factor per axis

function render(size) {
  const buf = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;
          if (ink(x, y)) hits++;
        }
      }
      const a = hits / (SS * SS);
      const v = Math.round(255 * a);
      const o = (py * size + px) * 4;
      buf[o] = v; buf[o + 1] = v; buf[o + 2] = v;   // white ink over black
      buf[o + 3] = 255;                             // opaque: the field is the icon
    }
  }
  return encodePNG(size, size, buf);
}

const out = path.join(__dirname, '..');
for (const size of [32, 180, 192, 512]) {
  const file = path.join(out, 'icon-' + size + '.png');
  fs.writeFileSync(file, render(size));
  console.log('wrote', path.basename(file), fs.statSync(file).size, 'bytes');
}
