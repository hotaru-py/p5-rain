![p5.rain](assets/banner.gif)

NASA's IMERG global precipitation data as a live, interactive pixel field for [p5.js](https://p5js.org).

p5.rain pulls the last seven days of [GPM IMERG](https://gpm.nasa.gov/data/imerg) rain and snow from
NASA GIBS, turns every pixel back into a real rate in mm/h, and draws it as a grid of cells that
drift with the weather. Works with p5.js 1.x and 2.x. No API key, no server.

Originally made to be an addon to use for my portfolio website's wallpaper. Might extend this a bit later, who knows.

```js
let rain;

function setup() {
  createCanvas(windowWidth, windowHeight);
  rain = createRain({ style: "flow", palette: "ocean" });
}

function draw() {
  rain.update();
  rain.draw();
}
```

## Install

Load it after p5.js, straight from this repo's GitHub Pages:

```html
<script src="https://cdn.jsdelivr.net/npm/p5@1.11.3/lib/p5.min.js"></script>
<script src="https://hotaru-py.github.io/p5-rain/dist/p5.rain.min.js"></script>
```

Or build it yourself: `npm install` builds `dist/`; copy `dist/p5.rain.min.js` next to your sketch.

Or use it from another project as a Git dependency, which builds on install:

```sh
npm i github:hotaru-py/p5-rain
```

then `import 'p5.rain'` after p5 is on the page (it registers itself), or
`import { install } from 'p5.rain'; install(p5);`.

The script tag also defines one global, `p5rain` (no dot: JavaScript names can't contain one), for
the helpers below such as `p5rain.addPalette()`.

## Looks

| option    | values                           |                                                                                                                                                             |
| --------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `palette` | `'ocean'` · `'moss'` · `'ember'` | blue, yellow-green, red. Each has a dark and a light version.                                                                                               |
| `theme`   | `'dark'` · `'light'` · `'auto'`  | `auto` follows the viewer's system setting.                                                                                                                 |
| `style`   | `'breathe'` · `'flow'`           | **breathe**: cells grow and shrink as rain gets heavier or lighter. **flow**: cells travel with the storms and fade in and out where rain starts and stops. |
| `grid`    | `'free'` · `'snap'`              | **free**: smooth sub-cell movement, and hovering pushes cells aside. **snap**: every square sits exactly on a grid cell.                                    |

Palette and theme changes crossfade. Change anything at any time with `rain.set({ ... })`.

## Options

| option          | default     |                                                                                                                                   |
| --------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `source`        | `'live'`    | `'live'` (NASA GIBS, decoded in the browser), `'weekly'` (this repo's prepared week, one download) or `{ snapshot: 'week.json' }` |
| `hours`         | `168`       | hours of history to load (2 to 336)                                                                                               |
| `poll`          | `10`        | minutes between checks for a newer hour; `false` to stop                                                                          |
| `speed`         | `2`         | data-hours played per second; negative plays backwards                                                                            |
| `start`         | `0`         | hour to start at (0 = oldest), or `'latest'`                                                                                      |
| `band`          | `[90, -90]` | latitudes to show, north first; `[30, -30]` is the tropics                                                                        |
| `fit`           | `'cover'`   | `'cover'` fills the area (cropping), `'contain'` shows the whole band                                                             |
| `cellSize`      | `null`      | fixed cell size in pixels (overrides `fit`)                                                                                       |
| `stain`         | `0.55`      | strength of the faint layer showing total rain over the window, 0 to 1                                                            |
| `intensity`     | `1`         | strength of the rain colours, 0 to 1                                                                                              |
| `lens`          | `true`      | hover/touch magnifier; `false`, or `{ radius: 120, strength: 7 }`                                                                 |
| `background`    | `true`      | paint the theme background; `false` draws rain over your own drawing                                                              |
| `reducedMotion` | `'respect'` | holds still when the viewer asks for reduced motion; `'ignore'` to always play                                                    |

## Methods

|                                                          |                                                                                |
| -------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `rain.update(dt?)`                                       | advance time; `dt` in seconds, defaults to p5's `deltaTime`                    |
| `rain.draw(x?, y?, w?, h?)`                              | draw into the whole canvas, or into a rectangle of it                          |
| `rain.set(options)`                                      | change looks or playback; invalid values throw and change nothing              |
| `rain.pick(x, y)`                                        | what's under a point: `{ lat, lon, rate, snow, trend, total, time }` or `null` |
| `rain.time()`                                            | the `Date` currently shown                                                     |
| `rain.seek(dateOrHour)` · `rain.pause()` · `rain.play()` | playback                                                                       |
| `rain.pointer(x, y)`                                     | drive the lens from code (`null` hands it back to the mouse)                   |
| `rain.ready` · `rain.progress` · `rain.error`            | loading state                                                                  |
| `rain.data`                                              | the shared `RainData` (frames, times, totals)                                  |

`pick()` units: `rate` is mm/h now, `trend` the change in mm/h over the current hour, `total` mm over the window.

## Data and snapshots

`loadRainData(source, { hours, poll })` returns the shared `RainData`. Every field using the
same source shares one download.
`data.on('progress' | 'ready' | 'update' | 'error', fn)` subscribes to it. `'update'` fires when
a new hour arrives and the window moves forward. `data.mode` is `'live'` or `'snapshot'`.

**Live** (`'live'`, the default): the browser fetches 168 hourly images from NASA GIBS and
decodes them itself. Always the newest hours, but the first load takes about 20 seconds; after
that it checks for a new hour every 10 minutes.

**Weekly** (`'weekly'`): the same week, fetched and decoded ahead of time. Every Monday at
06:00 UTC a GitHub Actions job in this repo pulls the last 168 hours from NASA and publishes them
on GitHub Pages, so a sketch loads the whole week in one 1.9 MB download instead of 168 requests to
NASA. The data is up to a week old by the following Monday, and the sketch doesn't poll for new hours.
If the file can't be fetched, it falls back to live NASA (`data.fellBack` says why).

The files are public and load from any site (Pages allows cross-origin requests):

- `https://hotaru-py.github.io/p5-rain/data/week.json`: metadata (start time, hours, any hours
  NASA was missing and that were filled from a neighbour, under `filled`)
- `https://hotaru-py.github.io/p5-rain/data/week.bin`: the frames, in the snapshot format below

A fork publishes its own copy: enable Pages (Settings → Pages → Source: GitHub Actions) and run
the **Weekly data** workflow once from the Actions tab. GitHub pauses scheduled workflows in
public repos after 60 days without activity; re-enable it from the same tab.

A **snapshot** is a recorded window, for pages that can't reach NASA (sandboxes, offline demos)
or to freeze a particular week:

```js
const snap = rain.data.toSnapshot({ name: "week" }); // { meta, bytes }  → week.json + week.bin
createRain({ source: { snapshot: "week.json" } });
createRain({ source: { snapshot: "week.json", fallback: "live" } }); // live NASA if the file is missing
```

From the command line: `node scripts/weekly/fetch-week.mjs --out out/` (plain Node, what the
weekly job runs), or `node scripts/export-snapshot.mjs out/ --name week` (through the built
plugin in Chrome; add `--base64` for hosts that only serve text files). A week is about 1.9 MB.

## Custom palettes

```js
p5rain.addPalette("ink", {
  dark: {
    stain: [30, 30, 40],
    rain: [
      [60, 60, 80],
      [200, 200, 230],
      [255, 255, 255],
    ],
    snow: [
      [80, 70, 120],
      [220, 210, 255],
    ],
  },
  light: {
    stain: [220, 215, 200],
    rain: [
      [170, 170, 190],
      [60, 60, 90],
      [10, 10, 20],
    ],
    snow: [
      [180, 170, 220],
      [70, 60, 140],
    ],
  },
});
createRain({ palette: "ink" });
```

Rain ramps run from light rain (0.1 mm/h) to extreme (50 mm/h) on a log scale.

## About the data

- **Source:** NASA GPM IMERG 30-minute precipitation (Early run), served by NASA GIBS.
  Sampled hourly.
- **Delay:** IMERG Early is published about 4 to 7 hours after observation, so "live" means the
  newest hours available. `rain.data.latest` says which hour that is.
- **Grid:** 1.5° (about 165 km at the equator), 240 × 120 cells. Each cell keeps the heaviest
  rate in its area, so small storms stay visible.
- **Rates:** recovered exactly from GIBS's published colour table. Rain and snow are separate.
- **Accuracy:** made for art and exploration, not analysis. Rates are binned to the colour
  table's steps, each hour is one 30-minute sample, and keeping the heaviest pixel per cell
  makes `total` run high. For research, use the IMERG files from
  [NASA GES DISC](https://disc.gsfc.nasa.gov/).
- **Credit:** show "NASA GPM IMERG via GIBS" wherever you use it. GIBS also asks clients to
  include: _We acknowledge the use of imagery provided by services from NASA's Global Imagery
  Browse Services (GIBS), part of NASA's Earth Science Data and Information System (ESDIS)._
  NASA data are free to use, but don't imply that NASA endorses your work. p5.rain is not
  affiliated with NASA.

## Examples

Online at [hotaru-py.github.io/p5-rain/examples](https://hotaru-py.github.io/p5-rain/examples/),
or locally with `npm run build && npm run examples`:

- `examples/basic/`: the smallest sketch
- `examples/controls/`: every option, plus what's under the cursor
- `examples/overlay/`: transparent rain in a band over your own drawing
- `examples/snapshot/`: play a saved run of hours, export a new one

## Development

```sh
npm install
npm run build            # dist/p5.rain.js, p5.rain.min.js, p5.rain.esm.js
npm test                 # unit tests (Node)
npm run test:browser     # p5 1.11.3 and 2.0.5 in headless Chrome; add -- --live to hit NASA
```

Two workflows run on GitHub: **CI** (tests on every push and pull request) and **Weekly data**
(the Monday NASA fetch and Pages deploy above; also runnable by hand, which is how changes to
`src/` or `examples/` reach Pages).

## License

MIT. Precipitation data courtesy of NASA.
