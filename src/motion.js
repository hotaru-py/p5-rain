// Motion field for the 'flow' style.
//
// Block matching on log rain between a frame and the one BASE hours later (at
// 1.5° cells rain moves well under a cell per hour, so a longer baseline gives a
// measurable shift), with parabolic sub-cell refinement and a rain-weighted
// smoothing pass that also fills dry tiles. Result: cells per hour, per cell.

import { COLS, ROWS, N, logR, clamp, lerp } from './util.js';

export const TILE = 6;
export const SEARCH = 4;
export const BASE = 3;
const TX = COLS / TILE, TY = ROWS / TILE;

/**
 * @param {Float32Array} A  rates at hour i
 * @param {Float32Array} B  rates at hour i + span
 * @param {number} span     hours between A and B
 * @returns {{vx: Float32Array, vy: Float32Array}} cells/hour (+x east, +y south)
 */
export function computeMotion(A, B, span) {
  const la = new Float32Array(N), lb = new Float32Array(N);
  for (let c = 0; c < N; c++) { la[c] = logR(A[c]); lb[c] = logR(B[c]); }

  const W = 2 * SEARCH + 1;
  const tvx = new Float32Array(TX * TY), tvy = new Float32Array(TX * TY), tw = new Float32Array(TX * TY);
  const cost = new Float32Array(W * W);
  for (let ty = 0; ty < TY; ty++) {
    for (let tx = 0; tx < TX; tx++) {
      let mass = 0;
      for (let y = ty * TILE; y < ty * TILE + TILE; y++) for (let x = tx * TILE; x < tx * TILE + TILE; x++) mass += la[y * COLS + x];
      if (mass < 3) continue;
      let best = Infinity, bx = 0, by = 0;
      for (let dy = -SEARCH; dy <= SEARCH; dy++) {
        for (let dx = -SEARCH; dx <= SEARCH; dx++) {
          let s = 0;
          for (let y = ty * TILE; y < ty * TILE + TILE; y++) {
            const yy = y + dy;
            if (yy < 0 || yy >= ROWS) { s += 2 * TILE; continue; }
            for (let x = tx * TILE; x < tx * TILE + TILE; x++) {
              s += Math.abs(la[y * COLS + x] - lb[yy * COLS + ((x + dx + COLS) % COLS)]);
            }
          }
          cost[(dy + SEARCH) * W + dx + SEARCH] = s;
          // prefer the smaller shift on ties so still rain stays still
          if (s < best - 1e-9 || (Math.abs(s - best) <= 1e-9 && dx * dx + dy * dy < bx * bx + by * by)) { best = s; bx = dx; by = dy; }
        }
      }
      const at = (dx, dy) => cost[(dy + SEARCH) * W + dx + SEARCH];
      let fx = bx, fy = by;
      if (Math.abs(bx) < SEARCH) { const l = at(bx - 1, by), r = at(bx + 1, by), d = l - 2 * best + r; if (d > 1e-6) fx += clamp((l - r) / (2 * d), -0.5, 0.5); }
      if (Math.abs(by) < SEARCH) { const u = at(bx, by - 1), dn = at(bx, by + 1), d = u - 2 * best + dn; if (d > 1e-6) fy += clamp((u - dn) / (2 * d), -0.5, 0.5); }
      const t = ty * TX + tx;
      tvx[t] = fx / span; tvy[t] = fy / span; tw[t] = mass;
    }
  }

  const svx = new Float32Array(TX * TY), svy = new Float32Array(TX * TY);
  for (let ty = 0; ty < TY; ty++) {
    for (let tx = 0; tx < TX; tx++) {
      let sx = 0, sy = 0, sw = 0;
      for (let oy = -1; oy <= 1; oy++) {
        const yy = ty + oy;
        if (yy < 0 || yy >= TY) continue;
        for (let ox = -1; ox <= 1; ox++) {
          const t = yy * TX + ((tx + ox + TX) % TX), w = tw[t] * (ox || oy ? 0.5 : 1);
          sx += tvx[t] * w; sy += tvy[t] * w; sw += w;
        }
      }
      if (sw > 0) { svx[ty * TX + tx] = sx / sw; svy[ty * TX + tx] = sy / sw; }
    }
  }

  const vx = new Float32Array(N), vy = new Float32Array(N);
  for (let y = 0; y < ROWS; y++) {
    const gy = clamp((y + 0.5) / TILE - 0.5, 0, TY - 1), y0 = Math.floor(gy), y1 = Math.min(TY - 1, y0 + 1), fy = gy - y0;
    for (let x = 0; x < COLS; x++) {
      const gx = (x + 0.5) / TILE - 0.5, x0f = Math.floor(gx), fx = gx - x0f;
      const x0 = (x0f + TX) % TX, x1 = (x0 + 1) % TX;
      const c = y * COLS + x;
      vx[c] = lerp(lerp(svx[y0 * TX + x0], svx[y0 * TX + x1], fx), lerp(svx[y1 * TX + x0], svx[y1 * TX + x1], fx), fy);
      vy[c] = lerp(lerp(svy[y0 * TX + x0], svy[y0 * TX + x1], fx), lerp(svy[y1 * TX + x0], svy[y1 * TX + x1], fx), fy);
    }
  }
  return { vx, vy };
}
