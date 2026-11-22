const sharp = require("sharp");
const { crc32 } = require("node:zlib");
const assert = require("node:assert/strict");

function pixels(size) {
  const bytes = Buffer.alloc(size);
  let state = 0x325742;
  for (let i = 0; i < size; i++) {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    bytes[i] = state & 255;
  }
  return bytes;
}

async function reportedPng() {
  const width = 1254, height = 1254, raw = Buffer.alloc(width * height * 3, 128);
  pixels(2_280_000).copy(raw);
  const png = await sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
  // Standard text chunk before IEND keeps this a complete, exactly 2.3 MB PNG.
  const extra = 2_300_000 - png.length, text = Buffer.alloc(extra, 32);
  assert.ok(extra >= 20);
  text.writeUInt32BE(extra - 12); text.write("tEXtFixture\0", 4, "ascii");
  text.writeUInt32BE(crc32(text.subarray(4, -4)), extra - 4);
  return Buffer.concat([png.subarray(0, -12), text, png.subarray(-12)]);
}

async function phoneJpeg() {
  const width = 4032, height = 3024;
  const out = await sharp(pixels(width * height * 3), { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 90 }).withMetadata({ orientation: 6 }).toBuffer();
  assert.ok(out.length >= 5_000_000 && out.length <= 15_000_000);
  return out;
}
module.exports = { reportedPng, phoneJpeg };
