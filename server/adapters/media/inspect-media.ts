import { inflateSync, crc32 } from "node:zlib";
import { mediaBudget } from "../../../shared/contracts/desktop-media";

// The initial adapter accepts only the temporary generator's explicitly supported formats.
export function inspectPng(data: Buffer) {
  if (data.length > mediaBudget.perFile) throw new Error("MEDIA_SIZE_LIMIT");
  if (!data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error("MEDIA_INVALID_PNG");
  let offset = 8, width = 0, height = 0, ended = false, seenData = false;
  const compressed: Buffer[] = [];
  while (offset < data.length) {
    if (offset + 12 > data.length) throw new Error("MEDIA_INVALID_PNG");
    const size = data.readUInt32BE(offset), type = data.toString("ascii", offset + 4, offset + 8), end = offset + 12 + size;
    if (end > data.length || crc32(data.subarray(offset + 4, end - 4)) !== data.readUInt32BE(end - 4)) throw new Error("MEDIA_INVALID_PNG");
    const body = data.subarray(offset + 8, end - 4);
    if (offset === 8 && type !== "IHDR") throw new Error("MEDIA_INVALID_PNG");
    if (type === "IHDR") {
      if (offset !== 8 || size !== 13) throw new Error("MEDIA_INVALID_PNG");
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      if (!width || !height || width * height > mediaBudget.pixels) throw new Error("MEDIA_PIXEL_LIMIT");
      if (!body.subarray(8).equals(Buffer.from([8,6,0,0,0]))) throw new Error("MEDIA_PNG_UNSUPPORTED");
    } else if (type === "IDAT") { if (ended) throw new Error("MEDIA_INVALID_PNG"); compressed.push(body); seenData = true; }
    else if (type === "IEND") { if (size || !seenData || end !== data.length) throw new Error("MEDIA_INVALID_PNG"); ended = true; }
    else throw new Error("MEDIA_PNG_UNSUPPORTED");
    offset = end;
  }
  if (!ended) throw new Error("MEDIA_INVALID_PNG");
  const row = width * 4 + 1, raw = inflateSync(Buffer.concat(compressed), { maxOutputLength: row * height });
  if (raw.length !== row * height) throw new Error("MEDIA_INVALID_PNG");
  let transparentPixels = 0, left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) {
    // Filter zero is the v1 generator contract; other PNG encoders remain unsupported.
    if (raw[y * row] !== 0) throw new Error("MEDIA_PNG_UNSUPPORTED");
    for (let x = 0; x < width; x++) {
      const alpha = raw[y * row + 4 + x * 4];
      if (alpha < 255) transparentPixels++;
      if (alpha > 0) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
    }
  }
  return { width, height, transparentPixels, visibleBounds: right < 0 ? null : { left, top, width: right - left + 1, height: bottom - top + 1 } };
}
export function inspectWav(data: Buffer) {
  if (data.length > mediaBudget.perFile) throw new Error("MEDIA_SIZE_LIMIT");
  if (data.length < 44 || data.toString("ascii",0,4) !== "RIFF" || data.readUInt32LE(4) !== data.length - 8 || data.toString("ascii",8,16) !== "WAVEfmt " || data.readUInt32LE(16) !== 16 || data.readUInt16LE(20) !== 1 || data.toString("ascii",36,40) !== "data" || data.readUInt32LE(40) !== data.length - 44) throw new Error("MEDIA_WAV_UNSUPPORTED_OR_INVALID");
  const channels = data.readUInt16LE(22), sampleRate = data.readUInt32LE(24), block = data.readUInt16LE(32);
  if (![1,2].includes(channels) || ![22050,44100,48000].includes(sampleRate) || data.readUInt16LE(34) !== 16 || block !== channels * 2 || data.readUInt32LE(28) !== sampleRate * block || (data.length - 44) % block) throw new Error("MEDIA_WAV_UNSUPPORTED_OR_INVALID");
  return { channels, sampleRate, seconds: (data.length - 44) / (sampleRate * block) };
}
