// GIBS serves IMERG as colour-mapped PNGs. Its published colour map lists every
// colour with the rain-rate interval it stands for, separately for rain and snow,
// so each pixel can be turned back into mm/h exactly.

import { COLS, ROWS, N } from './util.js';

const attr = (s, name) => {
  const m = s.match(new RegExp('\\b' + name + '="([^"]*)"'));
  return m ? m[1] : null;
};

/**
 * Parse a GIBS colour-map XML document (works without a DOM).
 * @returns {{table: Map<number, {rate:number, snow:boolean}>, entries: Array}}
 */
export function parseColormap(xml) {
  const table = new Map();
  const entries = [];
  const mapRe = /<ColorMap\b([^>]*)>([\s\S]*?)<\/ColorMap>/g;
  let m;
  while ((m = mapRe.exec(xml))) {
    const title = attr(m[1], 'title') || '';
    if (/classif/i.test(title)) continue; // "No Data" / "Insignificant"
    const snow = /snow/i.test(title);
    const entryRe = /<ColorMapEntry\b([^>]*?)\/?>/g;
    let e;
    while ((e = entryRe.exec(m[2]))) {
      const a = e[1];
      if (attr(a, 'transparent') === 'true') continue;
      const rgb = attr(a, 'rgb'), value = attr(a, 'value');
      if (!rgb || !value) continue;
      const range = value.match(/[[(]([^,]+),([^)\]]+)/);
      if (!range) continue;
      let lo = parseFloat(range[1]), hi = parseFloat(range[2]);
      if (!isFinite(lo)) lo = hi;
      if (!isFinite(hi)) hi = lo * 1.06;
      const [r, g, b] = rgb.split(',').map(Number);
      const v = { rate: Math.sqrt(lo * hi), snow };
      table.set((r << 16) | (g << 8) | b, v);
      entries.push({ r, g, b, v });
    }
  }
  if (!entries.length) throw new Error('p5.rain: the colour map has no rain entries');
  return { table, entries };
}

/** Rain value for an RGB colour; unknown colours snap to the nearest entry (cached). */
export function lookup(cm, r, g, b) {
  const key = (r << 16) | (g << 8) | b;
  let v = cm.table.get(key);
  if (v !== undefined) return v;
  let best = Infinity;
  for (const e of cm.entries) {
    const d = (e.r - r) ** 2 + (e.g - g) ** 2 + (e.b - b) ** 2;
    if (d < best) { best = d; v = e.v; }
  }
  cm.table.set(key, v);
  return v;
}

/**
 * Turn RGBA pixels of a global IMERG image (any size) into the 240 x 120 grid.
 * Each cell keeps the heaviest rate among its source pixels, so small cells of
 * rain survive the downscale.
 * @returns {{rate: Float32Array, snow: Uint8Array, any: boolean}}
 */
export function decodePixels(px, width, height, cm) {
  const rate = new Float32Array(N), snow = new Uint8Array(N);
  let any = false;
  for (let y = 0; y < height; y++) {
    const row = Math.floor((y * ROWS) / height) * COLS;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (px[i + 3] < 128) continue;
      const v = lookup(cm, px[i], px[i + 1], px[i + 2]);
      if (!v) continue;
      any = true;
      const c = row + Math.floor((x * COLS) / width);
      if (v.rate > rate[c]) { rate[c] = v.rate; snow[c] = v.snow ? 1 : 0; }
    }
  }
  return { rate, snow, any };
}
