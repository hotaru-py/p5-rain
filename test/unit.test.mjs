// Unit tests for the parts of p5.rain that don't need a browser.  Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { parseColormap, lookup, decodePixels } from '../src/colormap.js';
import { encodeSnapshot, decodeSnapshot, toBase64, fromBase64, encodeLevel, decodeLevel } from '../src/snapshot.js';
import { computeMotion } from '../src/motion.js';
import { addPalette, paletteLUT, PALETTES } from '../src/palettes.js';
import { COLS, ROWS, N, rateLevel, rowOfLat, latOfRow, lonOfCol } from '../src/util.js';

const xml = fs.readFileSync(new URL('./fixtures/GPM_Precipitation_Rate.xml', import.meta.url), 'utf8');

test('parses NASA GPM colour map into rain and snow entries', () => {
  const cm = parseColormap(xml);
  const rain = cm.entries.filter((e) => !e.v.snow), snow = cm.entries.filter((e) => e.v.snow);
  assert.ok(rain.length >= 100, `rain entries: ${rain.length}`);
  assert.ok(snow.length >= 100, `snow entries: ${snow.length}`);
  // first rain class in the published file: rgb 0,118,78 = [0.1, 0.1059) mm/h
  const v = lookup(cm, 0, 118, 78);
  assert.equal(v.snow, false);
  assert.ok(v.rate > 0.1 && v.rate < 0.1059, `rate ${v.rate}`);
  // rates rise monotonically within the rain ramp
  for (let i = 1; i < rain.length; i++) assert.ok(rain[i].v.rate > rain[i - 1].v.rate);
  assert.ok(rain[rain.length - 1].v.rate > 50);
});

test('unknown colours snap to the nearest colour-map entry', () => {
  const cm = parseColormap(xml);
  const exact = lookup(cm, 0, 118, 78);
  assert.equal(lookup(cm, 1, 118, 78), exact);
});

test('decodes pixels onto the 240 x 120 grid, keeping the heaviest rate per cell', () => {
  const cm = parseColormap(xml);
  const [light, heavy] = [cm.entries[0], cm.entries[60]];
  const W = COLS * 2, H = ROWS * 2, px = new Uint8ClampedArray(W * H * 4);
  const put = (x, y, e) => { const i = (y * W + x) * 4; px[i] = e.r; px[i + 1] = e.g; px[i + 2] = e.b; px[i + 3] = 255; };
  put(20, 10, light); put(21, 10, heavy); // same cell (10, 5)
  const out = decodePixels(px, W, H, cm);
  assert.equal(out.any, true);
  assert.equal(out.rate[5 * COLS + 10], Math.fround(heavy.v.rate)); // grid stores float32
  assert.equal(out.rate[0], 0);
  assert.equal(decodePixels(new Uint8ClampedArray(W * H * 4), W, H, cm).any, false);
});

test('snapshot round-trips rates within the 127-level quantisation', () => {
  const frames = [], snow = [], times = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 6; i++) {
    const f = new Float32Array(N), s = new Uint8Array(N);
    for (let k = 0; k < 900; k++) { const c = (rnd() * N) | 0; f[c] = 0.1 + rnd() * 60; s[c] = rnd() < 0.2 ? 1 : 0; }
    frames.push(f); snow.push(s); times.push(new Date(Date.UTC(2026, 10, 2, i)));
  }
  for (const encoding of ['binary', 'base64']) {
    const snap = encodeSnapshot({ frames, snow, times }, { encoding, name: 'week' });
    const bytes = encoding === 'base64' ? fromBase64(snap.text) : snap.bytes;
    assert.equal(snap.meta.data, encoding === 'base64' ? 'week.b64.txt' : 'week.bin');
    const back = decodeSnapshot(snap.meta, bytes);
    assert.equal(back.frames.length, 6);
    assert.equal(back.times[5].toISOString(), times[5].toISOString());
    for (let i = 0; i < 6; i++) {
      for (let c = 0; c < N; c++) {
        const a = frames[i][c], b = back.frames[i][c];
        if (a < 0.1) { assert.equal(b, 0); continue; }
        const expected = Math.min(a, 53);
        assert.ok(Math.abs(b - expected) / expected < 0.03, `frame ${i} cell ${c}: ${a} -> ${b}`);
        assert.equal(back.snow[i][c], snow[i][c]);
      }
    }
  }
});

test('snapshot level encoding covers 0.1 to 53 mm/h', () => {
  assert.equal(encodeLevel(0.1), 1);
  assert.equal(encodeLevel(1000), 127);
  assert.ok(Math.abs(decodeLevel(127) - 53) < 0.01);
  assert.deepEqual(fromBase64(toBase64(new Uint8Array([0, 1, 254, 255]))), new Uint8Array([0, 1, 254, 255]));
});

test('rejects truncated or foreign snapshots', () => {
  assert.throws(() => decodeSnapshot({ format: 'other' }, new Uint8Array(0)), /not a p5.rain snapshot/);
  assert.throws(() => decodeSnapshot({ format: 'p5rain-snapshot', start: '2026-11-01T00:00:00Z', hours: 2 }, new Uint8Array(2)), /truncated/);
});

function blob(cx, cy) {
  const f = new Float32Array(N);
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const d2 = (x - cx) ** 2 + (y - cy) ** 2;
    if (d2 < 64) f[y * COLS + x] = 8 * Math.exp(-d2 / 18);
  }
  return f;
}

test('motion field recovers a known storm displacement', () => {
  // storm moves +3 columns (east) and +1 row (south) over 3 hours
  const m = computeMotion(blob(100, 60), blob(103, 61), 3);
  const c = 60 * COLS + 100;
  assert.ok(Math.abs(m.vx[c] - 1) < 0.2, `vx ${m.vx[c]}`);
  assert.ok(Math.abs(m.vy[c] - 1 / 3) < 0.2, `vy ${m.vy[c]}`);
});

test('motion field is still for still rain and wraps across the date line', () => {
  const still = computeMotion(blob(50, 40), blob(50, 40), 3);
  assert.ok(Math.abs(still.vx[40 * COLS + 50]) < 0.05 && Math.abs(still.vy[40 * COLS + 50]) < 0.05);
  const wrap = computeMotion(blob(238, 60), blob(1, 60), 3); // crosses 180°
  assert.ok(Math.abs(wrap.vx[60 * COLS + 238] - 1) < 0.25, `vx ${wrap.vx[60 * COLS + 238]}`);
});

test('rate level is log-spaced from 0.1 to 50 mm/h', () => {
  assert.equal(rateLevel(0.1), 0);
  assert.equal(rateLevel(50), 1);
  assert.equal(rateLevel(500), 1);
  assert.ok(Math.abs(rateLevel(Math.sqrt(0.1 * 50)) - 0.5) < 1e-9);
});

test('grid coordinates', () => {
  assert.equal(rowOfLat(90), 0);
  assert.equal(rowOfLat(-90), ROWS);
  assert.equal(rowOfLat(30), 40);
  assert.equal(latOfRow(0), 89.25);
  assert.equal(lonOfCol(0), -179.25);
});

test('palettes: built-ins, lookup tables and validation', () => {
  for (const name of ['ocean', 'moss', 'ember']) assert.ok(PALETTES[name]);
  const T = paletteLUT(0, 'ocean', 'moss', 0.5, 0.5, 1);
  assert.equal(T.rain.length, 64);
  assert.equal(T.stain.length, 32);
  assert.match(T.rain[63], /^rgb\(\d+,\d+,\d+\)$/);
  assert.throws(() => addPalette('bad', { stain: [0, 0, 0], rain: [[0, 0, 0]], snow: [] }), /rain must be a list/);
  addPalette('mono', { stain: [40, 40, 40], rain: [[60, 60, 60], [255, 255, 255]], snow: [[90, 90, 120], [220, 220, 255]] });
  assert.ok(PALETTES.mono.dark && PALETTES.mono.light);
  delete PALETTES.mono;
});

// ---------------------------------------------------------------- single frames
import { encodeFrame, decodeFrame } from '../src/snapshot.js';

test('single frames round-trip through the frame format', () => {
  const rate = new Float32Array(N), snow = new Uint8Array(N);
  rate[0] = 0.1; rate[500] = 12.5; snow[500] = 1; rate[N - 1] = 70;
  const f = decodeFrame(encodeFrame(rate, snow));
  assert.ok(Math.abs(f.rate[500] - 12.5) / 12.5 < 0.03);
  assert.equal(f.snow[500], 1);
  assert.ok(Math.abs(f.rate[N - 1] - 53) < 0.01);
  assert.equal(f.rate[1], 0);
  assert.throws(() => decodeFrame(new Uint8Array([5, 0, 0, 0])), /truncated/);
});
