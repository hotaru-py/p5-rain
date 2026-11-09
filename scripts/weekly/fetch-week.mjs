// Fetches the latest week of NASA IMERG hours from GIBS and writes it as a p5.rain snapshot,
// in plain Node (no browser). The weekly GitHub Actions job runs this and publishes the result.
//
//   node scripts/weekly/fetch-week.mjs [--out public/data] [--name week] [--hours 168] [--concurrency 6]
//
// Writes <out>/<name>.json and <out>/<name>.bin (about 1.9 MB for a week).
import fs from 'node:fs';
import path from 'node:path';
import { decodePNG } from './png.mjs';
import { parseColormap, decodePixels } from '../../src/colormap.js';
import { imergUrl, COLORMAP_URL } from '../../src/gibs.js';
import { encodeSnapshot } from '../../src/snapshot.js';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : dflt; };
const OUT = opt('out', 'public/data');
const NAME = opt('name', 'week');
const HOURS = Math.max(2, Math.min(336, Number(opt('hours', 168))));
const CONCURRENCY = Number(opt('concurrency', 6));
const HOUR = 3600e3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[weekly]', ...a);
const floorHour = (t) => new Date(Math.floor(t.getTime() / HOUR) * HOUR);

const cm = parseColormap(await (await fetch(COLORMAP_URL)).text());
let requests = 0;

async function fetchHour(t) {
  for (let attempt = 0; ; attempt++) {
    try {
      requests++;
      const res = await fetch(imergUrl(t), { headers: { 'user-agent': 'p5rain-weekly (github actions)' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const png = decodePNG(Buffer.from(await res.arrayBuffer()));
      return decodePixels(png.data, png.width, png.height, cm);
    } catch (e) {
      if (attempt >= 2) throw new Error(`${t.toISOString()}: ${e.message}`);
      await sleep(2000 * (attempt + 1));
    }
  }
}

// IMERG Early lags 4-7 h; an unpublished hour comes back as an empty image.
let latest = null, latestFrame = null;
const probe = floorHour(new Date()).getTime() - 2 * HOUR;
for (let k = 0; k < 24 && !latest; k++) {
  const t = new Date(probe - k * HOUR);
  const f = await fetchHour(t);
  if (f.any) { latest = t; latestFrame = f; }
}
if (!latest) throw new Error('no published IMERG hour found in the last 26 hours');
log(`newest NASA hour: ${latest.toISOString()}`);

const times = Array.from({ length: HOURS }, (_, i) => new Date(latest.getTime() - (HOURS - 1 - i) * HOUR));
const frames = new Array(HOURS).fill(null);
frames[HOURS - 1] = latestFrame;

const queue = times.map((t, i) => i).slice(0, -1).reverse(); // newest first
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length) {
    const i = queue.shift();
    try {
      const f = await fetchHour(times[i]);
      if (f.any) frames[i] = f;
    } catch (e) {
      log(`failed ${e.message}`);
    }
  }
}));

// hours NASA couldn't give us: copy the nearest real neighbour, and list them in the metadata
const real = frames.map(Boolean), filled = [];
for (let i = 0; i < HOURS; i++) {
  if (real[i]) continue;
  for (let d = 1; d < HOURS; d++) {
    const j = real[i - d] ? i - d : real[i + d] ? i + d : -1;
    if (j >= 0) { frames[i] = frames[j]; break; }
  }
  filled.push(times[i].toISOString());
}
if (filled.length > HOURS / 4) throw new Error(`${filled.length} of ${HOURS} hours missing; not publishing`);

const week = encodeSnapshot({ frames: frames.map((f) => f.rate), snow: frames.map((f) => f.snow), times }, { name: NAME });
const meta = { ...week.meta, filled }; // readers ignore fields they don't know
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, `${NAME}.json`), JSON.stringify(meta, null, 2));
fs.writeFileSync(path.join(OUT, `${NAME}.bin`), week.bytes);
log(`wrote ${OUT}/${NAME}.json + .bin: ${HOURS} h, ${times[0].toISOString()} .. ${latest.toISOString()}, ` +
  `${(week.bytes.length / 1024).toFixed(0)} KB, ${requests} NASA requests, ${filled.length} filled`);
