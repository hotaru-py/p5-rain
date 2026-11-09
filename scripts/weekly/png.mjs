// Minimal PNG decoder for Node (no dependencies), enough for NASA GIBS images:
// 8-bit, non-interlaced, colour types 0 (grey), 2 (RGB), 3 (palette), 4 (grey+alpha), 6 (RGBA).
// Returns RGBA pixels, like canvas getImageData().
import zlib from 'node:zlib';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** @returns {{width: number, height: number, data: Uint8ClampedArray}} */
export function decodePNG(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');
  let width = 0, height = 0, depth = 0, type = -1, interlace = 0, palette = null, trns = null;
  const idat = [];
  for (let o = 8; o + 8 <= buf.length;) {
    const len = buf.readUInt32BE(o), kind = buf.toString('ascii', o + 4, o + 8), body = buf.subarray(o + 8, o + 8 + len);
    if (kind === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      depth = body[8]; type = body[9]; interlace = body[12];
    } else if (kind === 'PLTE') palette = body;
    else if (kind === 'tRNS') trns = body;
    else if (kind === 'IDAT') idat.push(body);
    else if (kind === 'IEND') break;
    o += 12 + len;
  }
  if (depth !== 8) throw new Error(`PNG bit depth ${depth} not supported`);
  if (interlace) throw new Error('interlaced PNG not supported');
  const ch = CHANNELS[type];
  if (!ch) throw new Error(`PNG colour type ${type} not supported`);
  if (type === 3 && !palette) throw new Error('palette PNG without PLTE');

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  if (raw.length < (stride + 1) * height) throw new Error('PNG data is truncated');
  const px = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride, up = dst - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[dst + x - ch] : 0;       // left
      const b = y > 0 ? px[up + x] : 0;               // above
      const c = y > 0 && x >= ch ? px[up + x - ch] : 0; // above-left
      let v = raw[src + x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`bad PNG filter ${filter}`);
      px[dst + x] = v & 255;
    }
  }

  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, j = 0; i < width * height; i++, j += ch) {
    const o = i * 4;
    if (type === 6) { out[o] = px[j]; out[o + 1] = px[j + 1]; out[o + 2] = px[j + 2]; out[o + 3] = px[j + 3]; }
    else if (type === 2) { out[o] = px[j]; out[o + 1] = px[j + 1]; out[o + 2] = px[j + 2]; out[o + 3] = 255; }
    else if (type === 0) { out[o] = out[o + 1] = out[o + 2] = px[j]; out[o + 3] = 255; }
    else if (type === 4) { out[o] = out[o + 1] = out[o + 2] = px[j]; out[o + 3] = px[j + 1]; }
    else { // palette
      const k = px[j];
      out[o] = palette[k * 3]; out[o + 1] = palette[k * 3 + 1]; out[o + 2] = palette[k * 3 + 2];
      out[o + 3] = trns && k < trns.length ? trns[k] : 255;
    }
  }
  return { width, height, data: out };
}
