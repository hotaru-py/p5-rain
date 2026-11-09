// Fetching IMERG frames from NASA GIBS (browser only: needs Image + canvas).
// GIBS answers with Access-Control-Allow-Origin: *, so pixels are readable.

import { COLS, ROWS } from './util.js';
import { parseColormap, decodePixels } from './colormap.js';

export const GIBS_WMS = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi';
export const COLORMAP_URL = 'https://gibs.earthdata.nasa.gov/colormaps/v1.3/GPM_Precipitation_Rate.xml';
export const IMERG_LAYER = 'IMERG_Precipitation_Rate_30min';

const SRC_W = COLS * 2, SRC_H = ROWS * 2;

export const isoTime = (d) => d.toISOString().slice(0, 19) + 'Z';

export function imergUrl(time, width = SRC_W, height = SRC_H) {
  const p = {
    SERVICE: 'WMS', REQUEST: 'GetMap', VERSION: '1.3.0', CRS: 'EPSG:4326',
    BBOX: '-90,-180,90,180', WIDTH: width, HEIGHT: height, FORMAT: 'image/png',
    TRANSPARENT: 'TRUE', LAYERS: IMERG_LAYER, TIME: isoTime(time),
  };
  return GIBS_WMS + '?' + Object.entries(p).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('p5.rain: could not load ' + url));
    img.src = url;
  });
}

let scratch = null, sctx = null;
function imagePixels(img) {
  if (!scratch) {
    scratch = document.createElement('canvas');
    scratch.width = SRC_W; scratch.height = SRC_H;
    sctx = scratch.getContext('2d', { willReadFrequently: true });
  }
  sctx.clearRect(0, 0, SRC_W, SRC_H);
  sctx.imageSmoothingEnabled = false;
  sctx.drawImage(img, 0, 0, SRC_W, SRC_H);
  return sctx.getImageData(0, 0, SRC_W, SRC_H).data;
}

let colormapPromise = null;
export function fetchColormap(url = COLORMAP_URL) {
  if (!colormapPromise) {
    colormapPromise = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`p5.rain: colour map request failed (${r.status})`);
        return r.text();
      })
      .then(parseColormap)
      .catch((e) => { colormapPromise = null; throw e; });
  }
  return colormapPromise;
}

/** One hourly frame. `any` is false when GIBS has not published that time yet. */
export async function fetchFrame(time, cm) {
  const img = await loadImage(imergUrl(time));
  return decodePixels(imagePixels(img), SRC_W, SRC_H, cm);
}
