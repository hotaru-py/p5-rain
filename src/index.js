// p5.rain: NASA IMERG precipitation as a live pixel field for p5.js (1.x and 2.x).
//
//   let rain;
//   function setup() { createCanvas(800, 400); rain = createRain({ style: 'flow' }); }
//   function draw()  { rain.update(); rain.draw(); }

import { RainData, WEEKLY_URL, resolveSource } from './data.js';
import { RainField, DEFAULTS } from './field.js';
import { PALETTES, BACKGROUNDS, addPalette, paletteLUT } from './palettes.js';
import { encodeSnapshot, decodeSnapshot, encodeFrame, decodeFrame, fetchSnapshot, toBase64, fromBase64, SNAPSHOT_FORMAT } from './snapshot.js';
import { parseColormap, decodePixels, lookup } from './colormap.js';
import { computeMotion } from './motion.js';
import { imergUrl, COLORMAP_URL, IMERG_LAYER } from './gibs.js';
import { COLS, ROWS, CELL_DEG, MIN_RATE, MAX_RATE, rateLevel } from './util.js';

export const VERSION = '0.1.0';

/** The p5 addon: adds createRain() and loadRainData() to every sketch. */
export function p5rainAddon(p5, fn, lifecycles) {
  /** Create a rain field bound to this sketch's canvas. */
  fn.createRain = function (options) {
    const field = new RainField(this, options);
    (this._p5rainFields || (this._p5rainFields = [])).push(field);
    return field;
  };
  /** Start (or reuse) a shared data load: 'live', 'weekly' or { snapshot: url }. */
  fn.loadRainData = function (source, options) {
    return RainData.get(source, options);
  };
  const cleanup = function () {
    (this._p5rainFields || []).forEach((f) => f.remove());
    this._p5rainFields = [];
  };
  if (lifecycles) lifecycles.remove = cleanup;
  else if (fn.registerMethod) fn.registerMethod('remove', cleanup);
}

/** Register with a p5 constructor (done automatically when p5 is a global). */
export function install(p5) {
  if (!p5 || p5.__p5rain) return;
  p5.__p5rain = true;
  if (typeof p5.registerAddon === 'function') p5.registerAddon(p5rainAddon); // p5 2.x
  else p5rainAddon(p5, p5.prototype, null); // p5 1.x
}

if (typeof window !== 'undefined' && window.p5) install(window.p5);

export {
  RainData, RainField, DEFAULTS, WEEKLY_URL, resolveSource,
  PALETTES, BACKGROUNDS, addPalette, paletteLUT,
  encodeSnapshot, decodeSnapshot, encodeFrame, decodeFrame, fetchSnapshot, toBase64, fromBase64, SNAPSHOT_FORMAT,
  parseColormap, decodePixels, lookup, computeMotion,
  imergUrl, COLORMAP_URL, IMERG_LAYER,
  COLS, ROWS, CELL_DEG, MIN_RATE, MAX_RATE, rateLevel,
};
