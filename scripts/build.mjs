// Builds dist/p5.rain.js (browser global `p5rain`), dist/p5.rain.min.js and dist/p5.rain.esm.js.
import * as esbuild from 'esbuild';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url)));
const banner = `/*! p5.rain v${pkg.version} | MIT | NASA IMERG precipitation for p5.js | data: NASA GPM IMERG via GIBS */`;
const common = { entryPoints: ['src/index.js'], bundle: true, target: 'es2020', banner: { js: banner }, logLevel: 'info' };

const builds = [
  { ...common, format: 'iife', globalName: 'p5rain', outfile: 'dist/p5.rain.js' },
  { ...common, format: 'iife', globalName: 'p5rain', outfile: 'dist/p5.rain.min.js', minify: true },
  { ...common, format: 'esm', outfile: 'dist/p5.rain.esm.js' },
];

if (process.argv.includes('--watch')) {
  for (const b of builds) await (await esbuild.context(b)).watch();
  console.log('watching src/ ...');
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
}
