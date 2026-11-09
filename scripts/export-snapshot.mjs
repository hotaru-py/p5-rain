// Records the latest live NASA IMERG window into a p5.rain snapshot, using the
// built plugin in headless Chrome (GIBS needs a browser to decode its PNGs).
//
//   node scripts/export-snapshot.mjs <outDir> [--name rain-7d] [--hours 168] [--base64]
//
// Writes <name>.json plus <name>.bin (or <name>.b64.txt with --base64, for hosts
// that only serve text). Needs: npm run build; Chrome (or set CHROME_PATH).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const outDir = args[0] && !args[0].startsWith('--') ? args[0] : '.';
const name = flag('name', 'rain-7d');
const hours = Number(flag('hours', 168));
const encoding = args.includes('--base64') ? 'base64' : 'binary';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chrome = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].find((p) => fs.existsSync(p));
if (!chrome) throw new Error('Chrome not found: set CHROME_PATH');

const server = http.createServer((req, res) => {
  if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><script src="/dist/p5.rain.js"></script>'); return; }
  const f = path.join(root, decodeURIComponent(req.url));
  if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': 'text/javascript' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: process.env.CI ? ['--no-sandbox'] : [], protocolTimeout: 600000 });
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });

const out = await page.evaluate(async (hours, name, encoding) => {
  const d = p5rain.RainData.get('live', { hours, poll: false });
  await new Promise((ok, fail) => { d.on('ready', ok); d.on('error', fail); });
  const s = d.toSnapshot({ name, encoding });
  return { meta: s.meta, payload: encoding === 'base64' ? s.text : p5rain.toBase64(s.bytes) };
}, hours, name, encoding);

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(out.meta, null, 2));
if (encoding === 'base64') fs.writeFileSync(path.join(outDir, out.meta.data), out.payload);
else fs.writeFileSync(path.join(outDir, out.meta.data), Buffer.from(out.payload, 'base64'));
console.log(`${out.meta.hours} h from ${out.meta.start} -> ${path.join(outDir, out.meta.data)}`);
await browser.close();
server.close();
