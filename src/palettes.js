// Palettes: a rain ramp (light rain -> extreme), a snow ramp and the 7-day
// "stain" colour, each for a dark and a light background. Ramps are sampled
// along rateLevel (0.1..50 mm/h, log-spaced).

import { mix, ramp, css } from './util.js';

/** Page backgrounds the palettes were tuned against. */
export const BACKGROUNDS = { dark: [7, 9, 14], light: [244, 240, 231] };

export const PALETTES = {
  ocean: {
    dark: {
      stain: [24, 58, 104],
      rain: [[30, 80, 140], [42, 127, 212], [53, 182, 232], [127, 227, 240], [214, 251, 255], [255, 255, 255], [255, 95, 162]],
      snow: [[110, 92, 200], [185, 168, 255], [242, 236, 255]],
    },
    light: {
      stain: [176, 196, 220],
      rain: [[158, 194, 230], [92, 148, 210], [47, 109, 184], [29, 74, 143], [19, 40, 94], [10, 20, 51], [226, 71, 95]],
      snow: [[176, 166, 232], [130, 112, 210], [72, 54, 156]],
    },
  },
  moss: {
    dark: {
      stain: [36, 62, 30],
      rain: [[40, 78, 34], [62, 120, 42], [112, 168, 46], [176, 212, 58], [228, 238, 112], [252, 252, 214], [255, 150, 60]],
      snow: [[56, 110, 112], [120, 190, 182], [214, 244, 238]],
    },
    light: {
      stain: [208, 214, 172],
      rain: [[200, 214, 150], [156, 188, 92], [108, 152, 50], [72, 114, 32], [46, 80, 22], [28, 50, 14], [212, 98, 28]],
      snow: [[160, 206, 200], [88, 156, 150], [32, 96, 96]],
    },
  },
  ember: {
    dark: {
      stain: [74, 24, 28],
      rain: [[96, 22, 30], [148, 30, 34], [204, 50, 38], [240, 98, 52], [255, 168, 104], [255, 232, 200], [255, 255, 255]],
      snow: [[86, 92, 138], [154, 160, 212], [228, 232, 255]],
    },
    light: {
      stain: [230, 200, 190],
      rain: [[238, 186, 174], [222, 128, 112], [198, 70, 58], [160, 36, 36], [114, 18, 26], [66, 8, 16], [24, 4, 10]],
      snow: [[176, 182, 216], [118, 126, 184], [58, 66, 128]],
    },
  },
};

const isRGB = (c) => Array.isArray(c) && c.length >= 3 && c.every((v) => typeof v === 'number');
function checkSide(side, where) {
  if (!side || !isRGB(side.stain)) throw new Error(`p5.rain: palette ${where}.stain must be [r, g, b]`);
  for (const k of ['rain', 'snow']) {
    if (!Array.isArray(side[k]) || side[k].length < 2 || !side[k].every(isRGB)) {
      throw new Error(`p5.rain: palette ${where}.${k} must be a list of at least two [r, g, b] stops`);
    }
  }
}

/**
 * Register a palette by name. Give `dark` and `light` sides, or one side used for both.
 * @param {string} name
 * @param {{dark?: object, light?: object, stain?: number[], rain?: number[][], snow?: number[][]}} def
 */
export function addPalette(name, def) {
  const dark = def.dark || def.light || def;
  const light = def.light || def.dark || def;
  checkSide(dark, name + '.dark');
  checkSide(light, name + '.light');
  PALETTES[name] = { dark, light };
  lutCache.clear();
  return PALETTES[name];
}

const lutCache = new Map();

/**
 * Colour lookup tables for one moment of a theme/palette crossfade.
 * @param {number} mode       0 = dark .. 1 = light
 * @param {string} from, to   palette names being crossfaded
 * @param {number} pm         0 = from .. 1 = to
 * @param {number} stainAmt   0..1 strength of the 7-day stain
 * @param {number} rainAmt    0..1 strength of rain colours against the background
 */
export function paletteLUT(mode, from, to, pm, stainAmt, rainAmt) {
  const mq = Math.round(mode * 60), pq = Math.round(pm * 30);
  const key = `${mq}|${pq}|${from}|${to}|${stainAmt}|${rainAmt}`;
  let T = lutCache.get(key);
  if (T) return T;
  if (lutCache.size > 600) lutCache.clear();
  const t = mq / 60, p = pq / 30;
  const A = PALETTES[from] || PALETTES.ocean, B = PALETTES[to] || PALETTES.ocean;
  const bg = mix(BACKGROUNDS.dark, BACKGROUNDS.light, t);
  const side = (P, key, u) => mix(
    key === 'stain' ? P.dark.stain : ramp(P.dark[key], u),
    key === 'stain' ? P.light.stain : ramp(P.light[key], u), t);
  const pick = (key, u) => mix(side(A, key, u), side(B, key, u), p);

  T = { bg: css(bg), bgRGB: bg, rain: [], snow: [], rainRaw: [], snowRaw: [], stain: [], stainRaw: '' };
  for (let i = 0; i < 64; i++) {
    const u = i / 63, r = pick('rain', u), s = pick('snow', u);
    T.rainRaw.push(css(r)); T.snowRaw.push(css(s));
    T.rain.push(css(mix(bg, r, rainAmt))); T.snow.push(css(mix(bg, s, rainAmt)));
  }
  const stain = pick('stain', 0);
  T.stainRaw = css(stain);
  for (let i = 0; i < 32; i++) T.stain.push(css(mix(bg, stain, (i / 31) * stainAmt)));
  lutCache.set(key, T);
  return T;
}
