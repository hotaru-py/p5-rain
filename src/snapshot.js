// Snapshots: a recorded run of hourly frames, for hosts that can't reach NASA
// (sandboxed pages, offline demos, tests) or to freeze a particular week.
//
// <name>.json   { format, version, start, hours, cols, rows, encoding, data }
// <name>.bin    per frame, little-endian:
//                 uint32 n, then n x uint16 cell index, then n x uint8 q
//               q & 127 = level 1..127 on a log scale 0.1..53 mm/h, q & 128 = snow
// encoding "base64" stores the same bytes as base64 text (e.g. a .txt file).

import { COLS, ROWS, N, MIN_RATE, clamp } from './util.js';

export const SNAPSHOT_FORMAT = 'p5rain-snapshot';
const TOP = 530; // 0.1 * 530 = 53 mm/h

export const encodeLevel = (rate) => clamp(Math.round(1 + (126 * Math.log(rate / MIN_RATE)) / Math.log(TOP)), 1, 127);
export const decodeLevel = (q) => MIN_RATE * Math.pow(TOP, ((q & 127) - 1) / 126);

/**
 * @param {{frames: Float32Array[], snow: Uint8Array[], times: Date[]}} d
 * @param {{name?: string, encoding?: 'binary'|'base64', source?: string}} [opts]
 * @returns {{meta: object, bytes: Uint8Array, text?: string}}
 */
/** One frame in the snapshot frame format. */
export function encodeFrame(rate, snow) {
  let n = 0;
  for (let c = 0; c < N; c++) if (rate[c] >= MIN_RATE) n++;
  const buf = new Uint8Array(4 + n * 3);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, n, true);
  let k = 0;
  for (let c = 0; c < N; c++) {
    if (rate[c] < MIN_RATE) continue;
    dv.setUint16(4 + k * 2, c, true);
    buf[4 + n * 2 + k] = encodeLevel(rate[c]) | (snow[c] ? 128 : 0);
    k++;
  }
  return buf;
}

/** Decode one frame starting at byte offset `o`. Returns the frame and the offset after it. */
export function decodeFrame(bytes, o = 0) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (o + 4 > bytes.length) throw new Error('p5.rain: snapshot data is truncated');
  const rate = new Float32Array(N), snow = new Uint8Array(N);
  const n = dv.getUint32(o, true);
  const qo = o + 4 + n * 2;
  if (qo + n > bytes.length) throw new Error('p5.rain: snapshot data is truncated');
  for (let k = 0; k < n; k++) {
    const c = dv.getUint16(o + 4 + k * 2, true), q = bytes[qo + k];
    rate[c] = decodeLevel(q);
    snow[c] = q >> 7;
  }
  return { rate, snow, next: qo + n };
}

export function encodeSnapshot(d, opts = {}) {
  const parts = [];
  let size = 0;
  for (let i = 0; i < d.frames.length; i++) {
    const buf = encodeFrame(d.frames[i], d.snow[i]);
    parts.push(buf);
    size += buf.length;
  }
  const bytes = new Uint8Array(size);
  let o = 0;
  for (const p of parts) { bytes.set(p, o); o += p.length; }

  const encoding = opts.encoding || 'binary';
  const name = opts.name || 'rain';
  const meta = {
    format: SNAPSHOT_FORMAT, version: 1,
    start: d.times[0].toISOString(), hours: d.frames.length, cols: COLS, rows: ROWS,
    encoding, data: encoding === 'base64' ? `${name}.b64.txt` : `${name}.bin`,
    source: opts.source || 'NASA GPM IMERG 30-min precipitation via GIBS',
    exported: new Date().toISOString(),
  };
  const out = { meta, bytes };
  if (encoding === 'base64') out.text = toBase64(bytes);
  return out;
}

/** Inverse of encodeSnapshot. */
export function decodeSnapshot(meta, bytes) {
  if (meta.format && meta.format !== SNAPSHOT_FORMAT) throw new Error('p5.rain: not a p5.rain snapshot');
  if ((meta.cols && meta.cols !== COLS) || (meta.rows && meta.rows !== ROWS)) throw new Error('p5.rain: snapshot grid size not supported');
  const start = new Date(meta.start).getTime();
  const frames = [], snow = [], times = [];
  let o = 0;
  for (let i = 0; i < meta.hours; i++) {
    const f = decodeFrame(bytes, o);
    frames.push(f.rate); snow.push(f.snow); times.push(new Date(start + i * 3600e3));
    o = f.next;
  }
  return { frames, snow, times };
}

export function toBase64(bytes) {
  let s = '';
  for (let k = 0; k < bytes.length; k += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(k, k + 0x8000));
  return btoa(s);
}

export function fromBase64(text) {
  const raw = atob(text.trim());
  const bytes = new Uint8Array(raw.length);
  for (let k = 0; k < raw.length; k++) bytes[k] = raw.charCodeAt(k);
  return bytes;
}

/** Fetch a snapshot by its .json URL (data file resolved next to it). */
export async function fetchSnapshot(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`p5.rain: snapshot ${url} not found (${res.status})`);
  const meta = await res.json();
  const dataUrl = new URL(meta.data, new URL(url, location.href)).href;
  const r2 = await fetch(dataUrl);
  if (!r2.ok) throw new Error(`p5.rain: snapshot data ${meta.data} not found (${r2.status})`);
  const bytes = meta.encoding === 'base64' ? fromBase64(await r2.text()) : new Uint8Array(await r2.arrayBuffer());
  return { meta, ...decodeSnapshot(meta, bytes) };
}
