import { deflateSync } from "node:zlib";
import { mediaSpec, mediaBudget, temporaryGenerator, type MediaSpec } from "../../../shared/contracts/desktop-media";

export type GeneratedMedia = { name: string; data: Buffer; mime: string };
function crc32(data: Buffer) { let n = 0xffffffff; for (const byte of data) { n ^= byte; for (let bit = 0; bit < 8; bit++) n = (n >>> 1) ^ (0xedb88320 & -(n & 1)); } return (n ^ 0xffffffff) >>> 0; }
function chunk(type: string, data: Buffer) { const tag = Buffer.from(type), result = Buffer.alloc(data.length + 12); result.writeUInt32BE(data.length); tag.copy(result, 4); data.copy(result, 8); result.writeUInt32BE(crc32(Buffer.concat([tag, data])), data.length + 8); return result; }
function png(width: number, height: number, pixel: (x: number, y: number) => number[]) {
  if (width * height > mediaBudget.pixels) throw new Error("MEDIA_PIXEL_LIMIT");
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const rgba = pixel(x, y), offset = y * (width * 4 + 1) + 1 + x * 4; for (let c = 0; c < 4; c++) raw[offset + c] = rgba[c]; }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
/** Produces placeholder assets from explicit numeric settings, not from natural-language understanding. */
export function generateProceduralMedia(input: MediaSpec): GeneratedMedia[] {
  const spec = mediaSpec.parse(input);
  if (spec.kind === "sound") {
    const rate = Number(spec.sampleRate), samples = Math.round(rate * spec.seconds), block = spec.channels * 2, data = Buffer.alloc(44 + samples * block);
    data.write("RIFF"); data.writeUInt32LE(data.length - 8, 4); data.write("WAVEfmt ", 8); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(spec.channels, 22); data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * block, 28); data.writeUInt16LE(block, 32); data.writeUInt16LE(16, 34); data.write("data", 36); data.writeUInt32LE(samples * block, 40);
    for (let n = 0; n < samples; n++) {
      const phase = n * spec.frequency / rate, wave = spec.waveform === "sine" ? Math.sin(phase * Math.PI * 2) : 2 / Math.PI * Math.asin(Math.sin(phase * Math.PI * 2));
      const envelope = spec.fade ? Math.min(1, n / (rate * .01), (samples - 1 - n) / (rate * .01)) : 1;
      for (let c = 0; c < spec.channels; c++) data.writeInt16LE(Math.round(wave * envelope * 8191), 44 + n * block + c * 2);
    }
    return [{ name: "tone.wav", data, mime: "audio/wav" }];
  }
  const rgb = [1,3,5].map(n => parseInt(spec.color.slice(n, n + 2), 16));
  if (spec.kind === "art") {
    const data = png(spec.width, spec.height, (x, y) => {
      const scale = Math.min(spec.width, spec.height);
      const dx = Math.abs((x + .5 - spec.width / 2) * 2 / scale), dy = Math.abs((y + .5 - spec.height / 2) * 2 / scale);
      const filled = spec.shape === "circle" ? dx * dx + dy * dy <= .64 : spec.shape === "diamond" ? dx + dy <= .8 : Math.max(dx, dy) <= .8;
      return filled ? [...rgb, 255] : spec.transparent ? [0,0,0,0] : [24,24,24,255];
    });
    return [{ name: "shape.png", data, mime: "image/png" }];
  }
  const data = png(spec.width * spec.frames, spec.height, (x, y) => {
    const frame = Math.floor(x / spec.width), t = frame / (spec.frames - 1), dx = ((x % spec.width) + .5) / spec.width * 2 - 1, dy = (y + .5) / spec.height * 2 - 1;
    const ring = Math.abs(Math.hypot(dx, dy) - (.1 + .75 * t)) < .1;
    return [...rgb, ring ? Math.round(255 * (1 - t)) : 0];
  });
  return [{ name: "effect.png", data, mime: "image/png" }, { name: "effect.json", mime: "application/json", data: Buffer.from(JSON.stringify({ version: 1, generator: temporaryGenerator, image: "effect.png", layout: "horizontal", frameWidth: spec.width, frameHeight: spec.height, frames: spec.frames, seconds: spec.seconds, loop: false }, null, 2)) }];
}
