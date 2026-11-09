// RainField: draws a RainData window into a p5 2D canvas as a pixel field.
//
//   style 'breathe'  cells sit on the grid and swell or shrink with the
//                    hour-to-hour change in rain
//   style 'flow'     every wet cell is a square that travels along the estimated
//                    rain motion and fades on its own schedule (no shared beat)
//   grid  'snap'     squares always sit exactly on grid cells
//   grid  'free'     sub-cell drift, and the hover lens pushes cells outward
//
// Underneath sits a faint "stain": total rain per cell over the whole window.

import { COLS, ROWS, N, MIN_RATE, clamp, lerp, logR, rateLevel, rowOfLat, latOfRow, lonOfCol } from './util.js';
import { RainData } from './data.js';
import { PALETTES, paletteLUT } from './palettes.js';

const STYLES = ['breathe', 'flow'];
const GRIDS = ['snap', 'free'];
const THEMES = ['dark', 'light', 'auto'];
const FITS = ['cover', 'contain'];

export const DEFAULTS = Object.freeze({
  source: 'live',      // 'live' (NASA GIBS) | 'weekly' (the repo's published week) | { snapshot: url, fallback? }
  hours: 168,          // window length when loading (7 days)
  poll: 10,            // minutes between checks for a new hour (live); false = never
  palette: 'ocean',    // 'ocean' | 'moss' | 'ember' | any name registered with addPalette()
  theme: 'dark',       // 'dark' | 'light' | 'auto' (follows prefers-color-scheme)
  style: 'breathe',    // 'breathe' | 'flow'
  grid: 'free',        // 'snap' | 'free'
  speed: 2,            // data-hours per second
  band: [90, -90],     // [north, south] latitudes to show
  fit: 'cover',        // 'cover' crops to fill the rect, 'contain' shows the whole band
  cellSize: null,      // fixed cell size in px (overrides fit)
  stain: 0.55,         // strength of the window-total stain, 0..1
  intensity: 1,        // strength of the rain colours, 0..1
  lens: true,          // hover/touch bulge; true | false | { radius, strength }
  background: true,    // paint the theme background; false = transparent
  reducedMotion: 'respect', // 'respect' (speed 0 when the viewer asks) | 'ignore'
  start: 0,            // hour index to start at (0 = oldest); 'latest' = newest
});

const prefersLight = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches;
const prefersReduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// One pointer tracker per canvas, in p5 (CSS pixel) coordinates.
const trackers = new WeakMap();
function trackPointer(p) {
  const canvas = p.canvas;
  let t = trackers.get(canvas);
  if (t) return t;
  t = { x: NaN, y: NaN, inside: false };
  const at = (e) => {
    const r = canvas.getBoundingClientRect();
    t.x = (e.clientX - r.left) * (p.width / r.width);
    t.y = (e.clientY - r.top) * (p.height / r.height);
    t.inside = true;
  };
  const leave = () => { t.inside = false; };
  canvas.addEventListener('pointermove', at, { passive: true });
  canvas.addEventListener('pointerdown', at, { passive: true });
  canvas.addEventListener('pointerleave', leave);
  canvas.addEventListener('pointercancel', leave);
  canvas.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') leave(); });
  trackers.set(canvas, t);
  return t;
}

export class RainField {
  /**
   * @param {object} p        p5 instance (needs a 2D canvas)
   * @param {object} [options] see DEFAULTS; `data` may pass a RainData to share
   */
  constructor(p, options = {}) {
    if (!p || !p.canvas || !p.drawingContext) throw new Error('p5.rain: call createRain() after createCanvas()');
    if (typeof p.drawingContext.fillRect !== 'function') {
      throw new Error('p5.rain: draws into a 2D canvas. Use createCanvas(w, h) without WEBGL, or draw into a createGraphics(w, h) buffer');
    }
    this.p = p;
    this.o = { ...DEFAULTS };
    this._apply(options);

    this.data = options.data instanceof RainData
      ? options.data
      : RainData.get(this.o.source, { hours: this.o.hours, poll: this.o.poll });

    const mode = this._themeTarget();
    this.st = { f: 0, i: 0, fr: 0, started: false, paused: false, mode, palFrom: this.o.palette, palTo: this.o.palette, pm: 1 };
    this.rate = new Float32Array(N); this.snowNow = new Uint8Array(N);
    this.dl = new Float32Array(N); this.lm = new Float32Array(N);
    this.flowX = new Float32Array(N); this.flowY = new Float32Array(N);
    this.dispX = new Float32Array(N); this.dispY = new Float32Array(N); this.boost = new Float32Array(N);
    this._cachedI = -1; this._cachedV = -1;
    this._g = null; this._rect = null; this._manual = null;
    this._tracker = typeof document !== 'undefined' ? trackPointer(p) : null;

    // particles for 'flow'
    this.MAXP = 20000;
    this.px = new Float32Array(this.MAXP); this.py = new Float32Array(this.MAXP);
    this.pa = new Float32Array(this.MAXP); this.plv = new Float32Array(this.MAXP);
    this.psn = new Uint8Array(this.MAXP); this.occ = new Uint32Array(N);
    this.pn = 0; this.stamp = 0;

    this._off = this.data.on('update', (e) => {
      if (e.shifted) this.st.f = Math.max(0, this.st.f - e.shifted);
      this._cachedI = -1;
    });
  }

  // ---------------------------------------------------------------------------
  // options
  // ---------------------------------------------------------------------------

  // Validate on a copy and commit only if every option is valid, so a rejected
  // set() leaves the field exactly as it was.
  _apply(opts) {
    const o = { ...this.o };
    for (const [k, v] of Object.entries(opts || {})) {
      if (k === 'data') continue;
      if (!(k in DEFAULTS)) throw new Error(`p5.rain: unknown option "${k}"`);
      o[k] = v;
    }
    const oneOf = (k, list) => { if (!list.includes(o[k])) throw new Error(`p5.rain: ${k} must be one of ${list.map((s) => `'${s}'`).join(', ')}`); };
    oneOf('style', STYLES); oneOf('grid', GRIDS); oneOf('theme', THEMES); oneOf('fit', FITS);
    if (!PALETTES[o.palette]) throw new Error(`p5.rain: unknown palette "${o.palette}". Built in: ${Object.keys(PALETTES).join(', ')}`);
    if (!Array.isArray(o.band) || o.band.length !== 2 || !(o.band[0] > o.band[1])) throw new Error('p5.rain: band must be [north, south] latitudes, north first');
    o.speed = Number(o.speed) || 0;
    o.stain = clamp(Number(o.stain) || 0, 0, 1);
    o.intensity = clamp(o.intensity == null ? 1 : Number(o.intensity), 0, 1);
    this.o = o;
    if (this._g) this._layout(this._g.w, this._g.h);
  }

  /** Change options after creation (palette and theme crossfade). Returns this. */
  set(options) {
    if (options && ('source' in options || 'hours' in options || 'poll' in options)) {
      throw new Error('p5.rain: source, hours and poll are fixed at creation; create a new field instead');
    }
    this._apply(options);
    return this;
  }

  /** Current options (a copy). */
  get options() { return { ...this.o }; }
  get ready() { return this.data.ready; }
  get progress() { return this.data.progress; }
  get error() { return this.data.error; }
  get paused() { return this.st.paused; }

  pause() { this.st.paused = true; return this; }
  play() { this.st.paused = false; return this; }

  /** Jump to a Date, or to an hour index within the window. */
  seek(t) {
    if (!this.data.ready) return this;
    const span = this.data.frames.length - 1.001;
    const f = t instanceof Date ? (t.getTime() - this.data.earliest.getTime()) / 3600e3 : Number(t);
    this.st.f = clamp(f || 0, 0, span);
    this.st.started = true;
    return this;
  }

  /** Time currently shown (Date), or null before data arrives. */
  time() {
    return this.data.ready ? new Date(this.data.earliest.getTime() + this.st.f * 3600e3) : null;
  }

  /** Drive the lens from code: pointer(x, y) in canvas pixels; pointer(null) returns to the mouse. */
  pointer(x, y) {
    this._manual = x == null ? null : { x, y };
    return this;
  }

  /** Stop listening for data updates. */
  remove() { if (this._off) this._off(); this._off = null; this._stainCache = null; }

  // ---------------------------------------------------------------------------
  // simulation
  // ---------------------------------------------------------------------------

  _themeTarget() {
    if (this.o.theme === 'auto') return prefersLight() ? 1 : 0;
    return this.o.theme === 'light' ? 1 : 0;
  }

  _layout(w, h) {
    const r0 = rowOfLat(this.o.band[0]), r1 = Math.max(r0 + 1, rowOfLat(this.o.band[1]));
    const rows = Math.min(ROWS - r0, r1 - r0);
    let cell;
    if (this.o.cellSize) cell = Math.max(1, Math.round(this.o.cellSize));
    else if (this.o.fit === 'contain') cell = Math.max(1, Math.floor(Math.min(w / COLS, h / rows)));
    else cell = Math.max(2, Math.ceil(Math.max(w / COLS, h / rows)));
    this._g = { w, h, cell, ox: Math.floor((w - COLS * cell) / 2), oy: Math.floor((h - rows * cell) / 2), r0, rows };
  }

  /**
   * Advance time. Call once per frame before draw().
   * @param {number} [dt] seconds; defaults to p5's deltaTime
   */
  update(dt) {
    if (dt == null) dt = (this.p.deltaTime || 16.7) / 1000;
    dt = clamp(dt, 0, 0.1);
    const st = this.st, o = this.o, d = this.data;

    const target = this._themeTarget();
    st.mode += (target - st.mode) * Math.min(1, dt * 4);
    if (Math.abs(target - st.mode) < 0.004) st.mode = target;
    if (o.palette !== st.palTo) {
      st.palFrom = st.pm < 0.5 ? st.palFrom : st.palTo;
      st.palTo = o.palette;
      st.pm = 0;
    }
    st.pm = Math.min(1, st.pm + dt * 3);

    if (!d.ready) return this;
    if (!this._g) this._layout(this.p.width, this.p.height);
    const span = d.frames.length - 1.001;
    if (!st.started) {
      st.started = true;
      st.f = o.start === 'latest' ? span : clamp(Number(o.start) || 0, 0, span);
    }
    const still = st.paused || (o.reducedMotion === 'respect' && prefersReduced());
    const dh = still ? 0 : o.speed * dt;
    st.f = (((st.f + dh) % span) + span) % span;

    this._updateField(dt);
    this._applyLens();
    if (o.style === 'flow') this._stepParticles(dh);
    else this.pn = 0;
    return this;
  }

  _updateField(dt) {
    const d = this.data, st = this.st, g = this._g;
    const i = Math.min(d.frames.length - 2, Math.floor(st.f)), fr = st.f - i;
    st.i = i; st.fr = fr;
    const A = d.frames[i], B = d.frames[i + 1];
    if (i !== this._cachedI || d.version !== this._cachedV) {
      this._cachedI = i; this._cachedV = d.version;
      for (let c = 0; c < N; c++) {
        const la = logR(A[c]), lb = logR(B[c]);
        this.dl[c] = lb - la;
        this.lm[c] = (la + lb) * 0.5;
      }
    }
    const SA = d.snow[i], SB = d.snow[i + 1], dl = this.dl, lm = this.lm;
    const k = Math.min(1, dt * 1.5), dir = this.o.speed < 0 ? -1 : 1;
    const y0 = Math.max(0, g.r0 - 1), y1 = Math.min(ROWS, g.r0 + g.rows + 1);
    for (let y = y0; y < y1; y++) {
      const row = y * COLS;
      for (let x = 0; x < COLS; x++) {
        const c = row + x;
        this.rate[c] = A[c] + (B[c] - A[c]) * fr;
        this.snowNow[c] = fr < 0.5 ? SA[c] : SB[c];
        // normal flow from brightness constancy, for breathe's sub-cell drift
        const gx = (lm[row + ((x + 1) % COLS)] - lm[row + ((x + COLS - 1) % COLS)]) * 0.5;
        const gy = (lm[y < ROWS - 1 ? c + COLS : c] - lm[y > 0 ? c - COLS : c]) * 0.5;
        const g2 = gx * gx + gy * gy;
        let vx = 0, vy = 0;
        if (g2 > 0.01 && dl[c] !== 0) {
          const s = (-dl[c] * 0.6 * dir) / (g2 + 0.3);
          vx = s * gx; vy = s * gy;
          const m = Math.hypot(vx, vy);
          if (m > 0.8) { vx *= 0.8 / m; vy *= 0.8 / m; }
        }
        this.flowX[c] += (vx - this.flowX[c]) * k;
        this.flowY[c] += (vy - this.flowY[c]) * k;
      }
    }
  }

  _applyLens() {
    const { dispX, dispY, boost } = this;
    dispX.fill(0); dispY.fill(0); boost.fill(0);
    this._lensBox = null;
    const lens = this.o.lens;
    if (!lens) return;
    const R = (lens && lens.radius) || 120, S = (lens && lens.strength != null ? lens.strength : 7);
    const ptr = this._manual || (this._tracker && this._tracker.inside ? this._tracker : null);
    if (!ptr) return;
    const rect = this._rect || { x: 0, y: 0 };
    const g = this._g, cell = g.cell;
    const px = ptr.x - rect.x, py = ptr.y - rect.y;
    if (px < -R || py < -R || px > g.w + R || py > g.h + R) return;
    const push = this.o.grid !== 'snap';
    const c0 = Math.max(0, Math.floor((px - g.ox - R) / cell)), c1 = Math.min(COLS - 1, Math.floor((px - g.ox + R) / cell));
    const r0 = Math.max(0, Math.floor((py - g.oy - R) / cell)), r1 = Math.min(g.rows - 1, Math.floor((py - g.oy + R) / cell));
    // cells the lens can push: the cached stain layer is redrawn live inside this box
    if (push && c0 <= c1 && r0 <= r1) this._lensBox = { c0, c1, r0, r1 };
    for (let yy = r0; yy <= r1; yy++) {
      for (let x = c0; x <= c1; x++) {
        const dx = g.ox + x * cell + cell / 2 - px, dy = g.oy + yy * cell + cell / 2 - py;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist >= R) continue;
        const q = (1 - dist / R) ** 2;
        const c = (g.r0 + yy) * COLS + x;
        if (push && dist > 0.01) { dispX[c] = (dx / dist) * q * S; dispY[c] = (dy / dist) * q * S; }
        boost[c] = q * 0.5;
      }
    }
  }

  _stepParticles(dh) {
    const FADE_IN = 1.2, FADE_OUT = 0.9, EASE = 1.6; // per data-hour
    const d = this.data, st = this.st, g = this._g;
    const { px, py, pa, plv, psn, occ, rate, snowNow } = this;
    const fresh = this.pn === 0;
    const m0 = d.motion(st.i), m1 = d.motion(Math.min(d.frames.length - 2, st.i + 1));
    const yLo = g.r0 - 1, yHi = g.r0 + g.rows + 1, fr = st.fr;
    const stamp = ++this.stamp;
    let w = 0;
    for (let k = 0; k < this.pn; k++) {
      let x = px[k], y = py[k];
      const ci = Math.round(y) * COLS + ((Math.round(x) % COLS) + COLS) % COLS;
      if (ci >= 0 && ci < N) {
        x += lerp(m0.vx[ci], m1.vx[ci], fr) * dh;
        y += lerp(m0.vy[ci], m1.vy[ci], fr) * dh;
      }
      x = ((x % COLS) + COLS) % COLS;
      if (y < yLo || y > yHi) continue;
      const cr = Math.round(y), cc = Math.round(x) % COLS;
      if (cr < 0 || cr >= ROWS) continue;
      const c = cr * COLS + cc;
      const claimed = occ[c] === stamp;
      occ[c] = stamp;
      const r = rate[c];
      const alive = r >= MIN_RATE && !claimed;
      let a = pa[k] + (alive ? FADE_IN : -FADE_OUT) * Math.abs(dh);
      if (a <= 0) continue;
      if (a > 1) a = 1;
      let lv = plv[k];
      if (alive) lv += (rateLevel(r) - lv) * Math.min(1, Math.abs(dh) * EASE);
      px[w] = x; py[w] = y; pa[w] = a; plv[w] = lv;
      psn[w] = alive ? snowNow[c] : psn[k];
      w++;
    }
    this.pn = w;
    for (let y = Math.max(0, g.r0); y < Math.min(ROWS, g.r0 + g.rows); y++) {
      for (let x = 0; x < COLS; x++) {
        const c = y * COLS + x;
        if (occ[c] === stamp || rate[c] < MIN_RATE || this.pn >= this.MAXP) continue;
        occ[c] = stamp;
        const n = this.pn++;
        px[n] = x; py[n] = y; pa[n] = fresh ? 1 : 0;
        plv[n] = rateLevel(rate[c]); psn[n] = snowNow[c];
      }
    }
  }

  // ---------------------------------------------------------------------------
  // drawing
  // ---------------------------------------------------------------------------

  /**
   * Draw into a rectangle of the canvas (default: the whole canvas).
   */
  draw(x = 0, y = 0, w = this.p.width, h = this.p.height) {
    if (!this._g || this._g.w !== w || this._g.h !== h) this._layout(w, h);
    this._rect = { x, y, w, h };
    const ctx = this.p.drawingContext, o = this.o, st = this.st, g = this._g;
    const T = paletteLUT(st.mode, st.palFrom, st.palTo, st.pm, o.stain, o.intensity);
    const solid = o.background;

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.translate(x, y);
    if (solid) { ctx.fillStyle = T.bg; ctx.fillRect(0, 0, w, h); }

    if (this.data.ready) {
      const cell = g.cell;
      const xa = Math.max(0, Math.floor(-g.ox / cell)), xb = Math.min(COLS, Math.ceil((w - g.ox) / cell));
      const ya = Math.max(0, Math.floor(-g.oy / cell)), yb = Math.min(g.rows, Math.ceil((h - g.oy) / cell));
      this._drawStain(ctx, T, solid, xa, xb, ya, yb);
      if (o.style === 'flow') this._drawFlow(ctx, T, solid);
      else this._drawBreathe(ctx, T, solid, xa, xb, ya, yb);
    }
    ctx.restore();
    return this;
  }

  // The stain (total over the window) only changes with the data, layout or colours, so it
  // is drawn once into an offscreen canvas and copied each frame: redrawing ~28 800 cells
  // was over half the frame. Inside the lens box cells move, so that patch is drawn live.
  _drawStain(ctx, T, solid, xa, xb, ya, yb) {
    if (this.o.stain <= 0) return;
    const g = this._g, cell = g.cell, w = g.w, h = g.h;
    const m = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null;
    if (!m || typeof document === 'undefined') { this._stainCells(ctx, T, solid, xa, xb, ya, yb, true); return; }
    const sx = Math.hypot(m.a, m.b), sy = Math.hypot(m.c, m.d);
    const key = `${this.data.version}|${w}|${h}|${cell}|${g.ox}|${g.oy}|${g.r0}|${solid}|${this.o.stain}|${sx}|${sy}`;
    let S = this._stainCache;
    if (!S || S.key !== key || S.T !== T) {
      if (!S) S = this._stainCache = { cv: document.createElement('canvas') };
      const cw = Math.max(1, Math.ceil(w * sx)), ch = Math.max(1, Math.ceil(h * sy));
      if (S.cv.width !== cw || S.cv.height !== ch) { S.cv.width = cw; S.cv.height = ch; }
      // CPU-backed on purpose: costs nothing extra on a GPU canvas (the upload is reused while
      // unchanged), and avoids a GPU readback every frame when the sketch reads pixels (get()).
      const sc = S.cv.getContext('2d', { willReadFrequently: true });
      sc.setTransform(1, 0, 0, 1, 0, 0);
      sc.clearRect(0, 0, cw, ch);
      sc.setTransform(sx, 0, 0, sy, 0, 0);
      this._stainCells(sc, T, solid, xa, xb, ya, yb, false);
      S.key = key; S.T = T;
    }
    const box = this._lensBox;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    if (box) {
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      ctx.rect(g.ox + box.c0 * cell, g.oy + box.r0 * cell, (box.c1 - box.c0 + 1) * cell, (box.r1 - box.r0 + 1) * cell);
      ctx.clip('evenodd');
    }
    ctx.drawImage(S.cv, 0, 0, w, h);
    ctx.restore();
    if (box) {
      this._stainCells(ctx, T, solid, Math.max(xa, box.c0), Math.min(xb, box.c1 + 1), Math.max(ya, box.r0), Math.min(yb, box.r1 + 1), true);
    }
  }

  _stainCells(ctx, T, solid, xa, xb, ya, yb, displace) {
    const g = this._g, cell = g.cell, inner = Math.max(1, cell - 1), d = this.data;
    const { dispX, dispY } = this;
    if (!solid) ctx.fillStyle = T.stainRaw;
    for (let yy = ya; yy < yb; yy++) {
      const y = g.r0 + yy;
      for (let x = xa; x < xb; x++) {
        const c = y * COLS + x, tot = d.total[c];
        if (tot < 2) continue;
        const lvl = Math.min(31, (Math.sqrt(tot / d.totalMax) * 31) | 0);
        if (solid) ctx.fillStyle = T.stain[lvl];
        else ctx.globalAlpha = (lvl / 31) * this.o.stain;
        if (displace) ctx.fillRect(g.ox + x * cell + Math.round(dispX[c]), g.oy + yy * cell + Math.round(dispY[c]), inner, inner);
        else ctx.fillRect(g.ox + x * cell, g.oy + yy * cell, inner, inner);
      }
    }
    ctx.globalAlpha = 1;
  }

  _drawBreathe(ctx, T, solid, xa, xb, ya, yb) {
    const g = this._g, cell = g.cell, inner = Math.max(1, cell - 1);
    const { rate, snowNow, dl, flowX, flowY, dispX, dispY, boost } = this;
    const rain = solid ? T.rain : T.rainRaw, snow = solid ? T.snow : T.snowRaw;
    const drift = this.o.grid === 'snap' ? 0 : cell;
    if (!solid) ctx.globalAlpha = this.o.intensity;
    for (let yy = ya; yy < yb; yy++) {
      const y = g.r0 + yy;
      for (let x = xa; x < xb; x++) {
        const c = y * COLS + x, r = rate[c];
        if (r < MIN_RATE) continue;
        const lv = clamp(rateLevel(r) + boost[c] * 0.4, 0, 1);
        const pulse = 1 + clamp(dl[c] * 0.12, -0.15, 0.2);
        const s = clamp(Math.round((0.3 + 0.7 * Math.sqrt(lv)) * inner * pulse * (1 + boost[c])), 1, cell + 3);
        const cx = g.ox + x * cell + Math.round(dispX[c]) + inner / 2 + flowX[c] * drift;
        const cy = g.oy + yy * cell + Math.round(dispY[c]) + inner / 2 + flowY[c] * drift;
        ctx.fillStyle = (snowNow[c] ? snow : rain)[(lv * 63) | 0];
        ctx.fillRect(Math.round(cx - s / 2), Math.round(cy - s / 2), s, s);
      }
    }
    ctx.globalAlpha = 1;
  }

  _drawFlow(ctx, T, solid) {
    const g = this._g, cell = g.cell, inner = Math.max(1, cell - 1), snap = this.o.grid === 'snap';
    const { px, py, pa, plv, psn, dispX, dispY, boost } = this;
    const rain = solid ? T.rain : T.rainRaw, snow = solid ? T.snow : T.snowRaw;
    const scale = solid ? 1 : this.o.intensity;
    let lastA = -1;
    for (let k = 0; k < this.pn; k++) {
      const gx = snap ? Math.round(px[k]) % COLS : px[k], gy = snap ? Math.round(py[k]) : py[k];
      const sx = g.ox + gx * cell, sy = g.oy + (gy - g.r0) * cell;
      if (sx < -cell || sy < -cell || sx > g.w || sy > g.h) continue;
      const c = Math.round(py[k]) * COLS + (Math.round(px[k]) % COLS);
      const b = c >= 0 && c < N ? boost[c] : 0;
      const a = Math.round(pa[k] * scale * 20) / 20;
      if (a !== lastA) { ctx.globalAlpha = a; lastA = a; }
      ctx.fillStyle = (psn[k] ? snow : rain)[(clamp(plv[k] + b * 0.4, 0, 1) * 63) | 0];
      ctx.fillRect(sx + (b ? dispX[c] : 0), sy + (b ? dispY[c] : 0), inner, inner);
    }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------------------
  // reading values
  // ---------------------------------------------------------------------------

  /**
   * What is under a canvas point (as last drawn).
   * @returns {{lat, lon, col, row, rate, snow, trend, total, time} | null}
   *   rate mm/h now, trend mm/h change per hour, total mm over the window
   */
  pick(x, y) {
    const g = this._g, rect = this._rect, d = this.data;
    if (!g || !rect || !d.ready) return null;
    const lx = x - rect.x - g.ox, ly = y - rect.y - g.oy;
    if (x < rect.x || y < rect.y || x >= rect.x + rect.w || y >= rect.y + rect.h) return null;
    const col = Math.floor(lx / g.cell), row = g.r0 + Math.floor(ly / g.cell);
    if (col < 0 || col >= COLS || row < g.r0 || row >= g.r0 + g.rows) return null;
    const c = row * COLS + col, i = this.st.i;
    const rate = d.rateAt(this.st.f, c);
    return {
      lat: latOfRow(row), lon: lonOfCol(col), col, row,
      rate, snow: rate > 0 && !!this.snowNow[c],
      trend: d.frames[i + 1][c] - d.frames[i][c],
      total: d.total[c],
      time: this.time(),
    };
  }
}
