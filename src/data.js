// RainData: a rolling window of hourly IMERG frames on the 240 x 120 grid.
// One instance per source is shared by every field that uses it.

import { N, MIN_RATE } from './util.js';
import { fetchColormap, fetchFrame } from './gibs.js';
import { fetchSnapshot, encodeSnapshot } from './snapshot.js';
import { computeMotion, BASE } from './motion.js';

const cache = new Map();
const HOUR = 3600e3;

export class RainData {
  /**
   * Get (or start loading) shared data.
   * @param {'live'|{snapshot: string}} [source='live']
   * @param {{hours?: number, poll?: number|false, concurrency?: number}} [opts]
   *        hours: window length (2..336, default 168 = 7 days)
   *        poll: minutes between checks for a new hour (live only; default 10; false = never)
   */
  static get(source = 'live', opts = {}) {
    const key = JSON.stringify([source, opts.hours || 168]);
    let d = cache.get(key);
    if (!d) {
      d = new RainData(source, opts);
      cache.set(key, d);
      d._start();
    }
    return d;
  }

  constructor(source, opts = {}) {
    this.source = source;
    this.hours = Math.max(2, Math.min(336, Math.round(opts.hours || 168)));
    this.poll = opts.poll === undefined ? 10 : opts.poll;
    this.concurrency = opts.concurrency || 8;
    this.frames = []; this.snow = []; this.times = [];
    this.total = new Float32Array(N); this.totalMax = 1;
    this.loaded = 0; this.ready = false; this.error = null;
    this.version = 0; this.snapshot = null;
    this.mode = null; // 'live' | 'snapshot'
    this._listeners = {}; this._motion = new Map(); this._cm = null; this._timer = null;
  }

  /** Subscribe to 'progress', 'ready', 'update' (new hour arrived) or 'error'. Returns an unsubscribe function. */
  on(type, fn) {
    (this._listeners[type] ||= new Set()).add(fn);
    if (type === 'ready' && this.ready) fn(this);
    if (type === 'error' && this.error) fn(this.error);
    return () => this._listeners[type].delete(fn);
  }
  _emit(type, detail) { (this._listeners[type] || []).forEach((fn) => { try { fn(detail); } catch (e) { console.error(e); } }); }

  /** Fraction loaded, 0..1. */
  get progress() { return this.ready ? 1 : this.loaded / this.hours; }
  /** Time of the newest frame. */
  get latest() { return this.times[this.times.length - 1] || null; }
  /** Time of the oldest frame. */
  get earliest() { return this.times[0] || null; }

  async _start() {
    try {
      await this._load(this.source);
      this._finish();
      this.ready = true;
      this._emit('progress', this);
      this._emit('ready', this);
      if (this.poll && this.mode === 'live') {
        this._timer = setInterval(() => this._pollNewHour(), this.poll * 60e3);
      }
    } catch (e) {
      this.error = e;
      console.error(e);
      this._emit('error', e);
    }
  }

  async _load(src) {
    if (src === 'live') { this.mode = 'live'; return this._loadLive(); }
    if (src && typeof src === 'object' && src.snapshot) { this.mode = 'snapshot'; return this._loadSnapshot(src.snapshot); }
    throw new Error('p5.rain: source must be "live" or { snapshot: "file.json" }');
  }

  async _loadSnapshot(url) {
    const s = await fetchSnapshot(url);
    const keep = Math.min(this.hours, s.frames.length);
    const from = s.frames.length - keep;
    this.frames = s.frames.slice(from); this.snow = s.snow.slice(from); this.times = s.times.slice(from);
    this.hours = keep;
    this.snapshot = s.meta;
    this.loaded = keep;
  }

  async _loadLive() {
    this._cm = await fetchColormap();
    // IMERG Early runs ~4-7 h behind real time; walk back to the newest published hour
    const t = new Date();
    t.setUTCMinutes(0, 0, 0);
    t.setUTCHours(t.getUTCHours() - 3);
    let latest = null;
    for (let k = 0; k < 18 && !latest; k++) {
      const f = await fetchFrame(t, this._cm);
      if (f.any) latest = { t: new Date(t), f };
      else t.setUTCHours(t.getUTCHours() - 1);
    }
    if (!latest) throw new Error('p5.rain: no recent IMERG frame found on NASA GIBS');

    const H = this.hours;
    this.times = Array.from({ length: H }, (_, i) => new Date(latest.t.getTime() - (H - 1 - i) * HOUR));
    this.frames = new Array(H).fill(null); this.snow = new Array(H).fill(null);
    this.frames[H - 1] = latest.f.rate; this.snow[H - 1] = latest.f.snow;
    this.loaded = 1;
    this._emit('progress', this);

    const queue = [];
    for (let i = H - 2; i >= 0; i--) queue.push(i); // newest first
    const worker = async () => {
      while (queue.length) {
        const i = queue.shift();
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const f = await fetchFrame(this.times[i], this._cm);
            this.frames[i] = f.rate; this.snow[i] = f.snow;
            break;
          } catch (e) { /* retry once, then leave the gap */ }
        }
        this.loaded++;
        if (this.loaded % 8 === 0) this._emit('progress', this);
      }
    };
    await Promise.all(Array.from({ length: this.concurrency }, worker));

    // fill any frame that failed twice from its nearest neighbour
    for (let i = 0; i < H; i++) {
      if (this.frames[i]) continue;
      for (let d = 1; d < H; d++) {
        const j = this.frames[i - d] ? i - d : this.frames[i + d] ? i + d : -1;
        if (j >= 0) { this.frames[i] = this.frames[j]; this.snow[i] = this.snow[j]; break; }
      }
    }
  }

  async _pollNewHour() {
    if (this._polling || !this.ready) return;
    this._polling = true;
    try {
      const next = new Date(this.latest.getTime() + HOUR);
      const f = await fetchFrame(next, this._cm);
      if (!f.any) return;
      this.frames.push(f.rate); this.snow.push(f.snow); this.times.push(next);
      let shifted = 0;
      while (this.frames.length > this.hours) { this.frames.shift(); this.snow.shift(); this.times.shift(); shifted++; }
      this._finish();
      this._emit('update', { data: this, added: 1, shifted });
    } catch (e) {
      /* try again next interval */
    } finally {
      this._polling = false;
    }
  }

  _finish() {
    const nz = [];
    for (let c = 0; c < N; c++) {
      let s = 0;
      for (let i = 0; i < this.frames.length; i++) s += this.frames[i][c];
      this.total[c] = s; // mm over the window (hourly samples of mm/h)
      if (s > 0) nz.push(s);
    }
    nz.sort((a, b) => a - b);
    this.totalMax = nz.length ? nz[Math.floor(nz.length * 0.98)] : 1;
    this.version++;
    this._motion.clear();
  }

  /** Motion field (cells/hour) for hour i, cached. */
  motion(i) {
    let m = this._motion.get(i);
    if (m) return m;
    const j = Math.min(this.frames.length - 1, i + BASE);
    m = computeMotion(this.frames[i], this.frames[j], Math.max(1, j - i));
    this._motion.set(i, m);
    if (this._motion.size > 16) this._motion.delete(this._motion.keys().next().value);
    return m;
  }

  /** Rain rate (mm/h) at hour index i (fractional = linear blend) for a cell. */
  rateAt(i, c) {
    const a = Math.max(0, Math.min(this.frames.length - 1, Math.floor(i)));
    const b = Math.min(this.frames.length - 1, a + 1), fr = i - a;
    const r = this.frames[a][c] + (this.frames[b][c] - this.frames[a][c]) * fr;
    return r < MIN_RATE ? 0 : r;
  }

  /** Export the current window as a snapshot ({ meta, bytes, text? }). */
  toSnapshot(opts) {
    if (!this.ready) throw new Error('p5.rain: data is not loaded yet');
    return encodeSnapshot(this, opts);
  }

  /** Stop polling for new hours. */
  stop() { clearInterval(this._timer); this._timer = null; }
}
