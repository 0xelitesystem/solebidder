// A MINIMAL PNG READER, so a screenshot can be reasoned about as pixels rather than as a file.
//
// WHY THIS IS HERE. The accessibility questions in DESIGN 6.8 are about what a reader SEES:
// whether two money series stay distinguishable when the operating system throws every author
// colour away. That is answerable from the computed style only up to a point, because a computed
// fill of url(#hatch45) tells you a pattern was referenced, not that anything was painted. The
// only honest answer counts the colours that actually landed in the rectangle.
//
// Zero dependencies, so the format is decoded here. Scope is exactly what Chromium emits from
// Page.captureScreenshot: 8 bits per channel, colour type 2 or 6, no interlacing. Anything else
// throws rather than being guessed at.

import { inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * @typedef {Object} Raster
 * @property {number} width
 * @property {number} height
 * @property {number} channels 3 for RGB, 4 for RGBA.
 * @property {Buffer} data Row major, `channels` bytes per pixel, no row filter bytes.
 */

/**
 * @param {Buffer} png
 * @returns {Raster}
 */
export function decodePng(png) {
  if (png.length < 8 || !png.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error('decodePng: not a PNG');
  }
  let at = 8;
  let ihdr = null;
  /** @type {Buffer[]} */
  const idat = [];
  while (at + 8 <= png.length) {
    const length = png.readUInt32BE(at);
    const type = png.toString('latin1', at + 4, at + 8);
    const body = png.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      ihdr = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        bitDepth: body[8],
        colorType: body[9],
        interlace: body[12],
      };
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(body));
    } else if (type === 'IEND') {
      break;
    }
    at += 12 + length;
  }
  if (!ihdr) throw new Error('decodePng: no IHDR');
  if (ihdr.bitDepth !== 8) throw new Error('decodePng: only 8 bits per channel, got ' + ihdr.bitDepth);
  if (ihdr.interlace !== 0) throw new Error('decodePng: interlaced PNG is out of scope');
  const channels = ihdr.colorType === 2 ? 3 : ihdr.colorType === 6 ? 4 : 0;
  if (channels === 0) throw new Error('decodePng: colour type ' + ihdr.colorType + ' is out of scope');

  const raw = inflateSync(Buffer.concat(idat));
  const stride = ihdr.width * channels;
  const out = Buffer.alloc(stride * ihdr.height);

  // Un-filter. Each scanline is prefixed with one filter byte, and filters 1 to 4 are defined
  // against the pixel to the left, the pixel above, and the pixel above-left.
  let src = 0;
  for (let y = 0; y < ihdr.height; y += 1) {
    const filter = raw[src];
    src += 1;
    const rowAt = y * stride;
    const prevAt = (y - 1) * stride;
    for (let x = 0; x < stride; x += 1) {
      const byte = raw[src + x];
      const a = x >= channels ? out[rowAt + x - channels] : 0;
      const b = y > 0 ? out[prevAt + x] : 0;
      const c = (x >= channels && y > 0) ? out[prevAt + x - channels] : 0;
      let value;
      if (filter === 0) value = byte;
      else if (filter === 1) value = byte + a;
      else if (filter === 2) value = byte + b;
      else if (filter === 3) value = byte + ((a + b) >> 1);
      else if (filter === 4) value = byte + paeth(a, b, c);
      else throw new Error('decodePng: unknown row filter ' + filter);
      out[rowAt + x] = value & 0xff;
    }
    src += stride;
  }
  return { width: ihdr.width, height: ihdr.height, channels, data: out };
}

/** @param {number} a @param {number} b @param {number} c */
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Cut a rectangle out of a raster, in raster pixels, clamped to its bounds.
 *
 * CROPPING HERE RATHER THAN CLIPPING IN THE BROWSER is deliberate. Page.captureScreenshot takes
 * its clip in page coordinates, which stop agreeing with an element's bounding rectangle the
 * moment anything on the way up has scrolled, and a clip that is quietly off by a scroll offset
 * photographs the wrong rectangle and reports a confident histogram of it. A full viewport
 * capture has exactly one frame of reference, the viewport, and the element's own rectangle is
 * already in it.
 *
 * @param {Raster} raster
 * @param {{x:number, y:number, width:number, height:number}} rect
 * @returns {Raster}
 */
export function cropRaster(raster, rect) {
  const x0 = Math.max(0, Math.min(raster.width, Math.round(rect.x)));
  const y0 = Math.max(0, Math.min(raster.height, Math.round(rect.y)));
  const x1 = Math.max(x0, Math.min(raster.width, Math.round(rect.x + rect.width)));
  const y1 = Math.max(y0, Math.min(raster.height, Math.round(rect.y + rect.height)));
  const width = x1 - x0;
  const height = y1 - y0;
  const { channels } = raster;
  const out = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y += 1) {
    const from = ((y0 + y) * raster.width + x0) * channels;
    raster.data.copy(out, y * width * channels, from, from + width * channels);
  }
  return { width, height, channels, data: out };
}

/**
 * Count how often each opaque colour appears, as "r,g,b" keys, ranked commonest first.
 *
 * Transparent and near transparent pixels are skipped: a screenshot clip can carry the page
 * behind a rounded corner, and a colour nobody can see is not evidence about what a reader sees.
 *
 * @param {Raster} raster
 * @returns {{colour:string, count:number, share:number}[]}
 */
export function colourHistogram(raster) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  let total = 0;
  const { data, channels } = raster;
  for (let i = 0; i < data.length; i += channels) {
    if (channels === 4 && data[i + 3] < 200) continue;
    const key = data[i] + ',' + data[i + 1] + ',' + data[i + 2];
    counts.set(key, (counts.get(key) === undefined ? 0 : counts.get(key)) + 1);
    total += 1;
  }
  return [...counts.entries()]
    .map(([colour, count]) => ({ colour, count, share: total === 0 ? 0 : count / total }))
    .sort((a, b) => b.count - a.count);
}

/**
 * How many colours it takes to cover `coverage` of the opaque pixels. A solid fill needs one. A
 * hatched fill needs at least two, because the lines and the ground between them are different
 * colours by construction.
 *
 * @param {{colour:string, count:number, share:number}[]} histogram
 * @param {number} [coverage]
 * @returns {number}
 */
export function distinctColoursCovering(histogram, coverage = 0.95) {
  let seen = 0;
  let n = 0;
  for (const entry of histogram) {
    seen += entry.share;
    n += 1;
    if (seen >= coverage) break;
  }
  return n;
}
