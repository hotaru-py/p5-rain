// Browser tests: serves the repo and runs test/browser/harness.html in headless
// Chrome on p5 1.x and 2.x.
//   npm run build && npm run test:browser            (snapshot fixture only)
//   npm run test:browser -- --live                   (also loads live NASA data)
// Set CHROME_PATH if Chrome isn't in a standard location.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const live = process.argv.includes('--live');
const versions = ['1.11.3', '2.0.5'];

const chrome = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find((p) => fs.existsSync(p));
if (!chrome) { console.error('Chrome not found: set CHROME_PATH'); process.exit(1); }
if (!fs.existsSync(path.join(root, 'dist/p5.rain.js'))) { console.error('dist/p5.rain.js missing: run npm run build'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.bin': 'application/octet-stream', '.xml': 'text/xml' };
const server = http.createServer((req, res) => {
  const f = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: process.env.CI ? ['--no-sandbox'] : [], protocolTimeout: 300000 });
let failed = 0;
for (const v of versions) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/test/browser/harness.html?p5=${v}${live && v === versions[0] ? '&live' : ''}`, { waitUntil: 'load' });
  let res;
  try {
    res = await page.evaluate(() => window.runTests());
  } catch (e) {
    res = { p5: v, checks: [{ name: 'harness ran', ok: false, info: e.message }] };
  }
  if (errors.length) res.checks.push({ name: 'no uncaught page errors', ok: false, info: errors.join(' | ') });
  console.log(`\np5 ${res.p5}`);
  for (const c of res.checks) {
    console.log(`  ${c.ok ? 'ok  ' : 'FAIL'}  ${c.name}${c.info ? `  (${c.info})` : ''}`);
    if (!c.ok) failed++;
  }
  await page.close();
}
await browser.close();
server.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
