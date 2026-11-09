// Shared numeric helpers and the fixed IMERG grid used throughout p5.rain.

/** Grid: 1.5° cells, 240 x 120, row 0 at 90°N, column 0 at 180°W. */
export const COLS = 240;
export const ROWS = 120;
export const N = COLS * ROWS;
export const CELL_DEG = 1.5;

/** Rates below this (mm/h) count as dry. Matches IMERG's own "insignificant" class. */
export const MIN_RATE = 0.1;
/** Top of the colour scale (mm/h). IMERG's own scale tops out at 53+. */
export const MAX_RATE = 50;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const mix = (p, q, t) => [lerp(p[0], q[0], t), lerp(p[1], q[1], t), lerp(p[2], q[2], t)];
export const css = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
export const smoothstep = (t) => t * t * (3 - 2 * t);

/** Log-compressed rain, 0 when dry. Used for motion estimation. */
export const logR = (r) => Math.log1p(r * 10);

/** Position of a rate on the colour scale: 0 at 0.1 mm/h, 1 at 50 mm/h, log-spaced. */
export const rateLevel = (r) => clamp(Math.log(r / MIN_RATE) / Math.log(MAX_RATE / MIN_RATE), 0, 1);

/** Sample a list of RGB stops at t in [0, 1]. */
export function ramp(stops, t) {
  t = clamp(t, 0, 1) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(t));
  return mix(stops[i], stops[i + 1], t - i);
}

export const rowOfLat = (lat) => clamp(Math.round((90 - lat) / CELL_DEG), 0, ROWS);
export const latOfRow = (row) => 90 - (row + 0.5) * CELL_DEG;
export const lonOfCol = (col) => -180 + (col + 0.5) * CELL_DEG;
