import { artworkLimit, inspectArtwork, stillRasterDimensions } from "./token-artwork";

export const photoAccept = "image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif";
const originalLimit = 24 * 1024 * 1024;
const invalid = "Choose a still JPEG, PNG, WebP or HEIC photo.";
const heicHelp = "This browser could not open this HEIC photo. Open this page in Safari on iPhone (iOS 17 or later) and choose it again, or select a JPEG, PNG or WebP.";

function checkDimensions(width: number, height: number) {
  if (!width || !height || width > 12_288 || height > 12_288 || width * height > 50_000_000)
    throw new Error("Choose a photo up to 50 megapixels and 12,288 pixels on its longest side.");
}

// Bound native HEIF decoding using image spatial extents in the item properties.
function checkHeic(bytes: Uint8Array, tag: (at: number) => string) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const first = view.getUint32(0);
  if (first < 16 || first > Math.min(1024, bytes.length) || first % 4) throw new Error(invalid);
  const brands = [tag(8)];
  for (let pos = 16; pos < first; pos += 4) brands.push(tag(pos));
  if (!brands.some(b => ["heic","heix","mif1"].includes(b)) ||
      brands.some(b => ["avif","avis","msf1","hevc","hevx","qt  "].includes(b))) throw new Error(invalid);
  let boxes = 0, extents = 0;
  function visit(start: number, end: number, level: number) {
    for (let pos = start; pos < end;) {
      if (++boxes > 8192 || pos + 8 > end) throw new Error(invalid);
      const size = view.getUint32(pos) || end - pos, type = tag(pos + 4);
      if (size < 8 || size > end - pos || type === "moov") throw new Error(invalid);
      const next = pos + size;
      if ((level === 0 && type === "meta") || (level === 1 && type === "iprp") || (level === 2 && type === "ipco")) {
        const child = pos + (type === "meta" ? 12 : 8);
        if (child > next) throw new Error(invalid);
        visit(child, next, level + 1);
      } else if (level === 3 && type === "ispe") {
        if (size < 20) throw new Error(invalid);
        checkDimensions(view.getUint32(pos + 12), view.getUint32(pos + 16));
        extents++;
      }
      pos = next;
    }
  }
  visit(first, bytes.length, 0);
  if (!extents) throw new Error(invalid);
}

export function photoMime(bytes: Uint8Array, declared: string) {
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  let mime: string;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) mime = "image/jpeg";
  else if (bytes[0] === 0x89 && tag(1).startsWith("PNG")) mime = "image/png";
  else if (tag(0) === "RIFF" && tag(8) === "WEBP") mime = "image/webp";
  else if (bytes.length >= 16 && tag(4) === "ftyp") mime = "image/heic";
  else throw new Error(invalid);
  if (declared && declared !== "application/octet-stream" && declared !== mime && !(mime === "image/heic" && declared === "image/heif"))
    throw new Error("The file type does not match the contents of this photo.");
  if (mime === "image/heic") checkHeic(bytes, tag);
  else {
    const { width, height } = stillRasterDimensions(bytes, mime);
    checkDimensions(width, height);
  }
  return mime;
}

export async function prepareUploadImage(file: File, kind: "avatar" | "artwork"): Promise<File> {
  if (!file.size) throw new Error("This file is empty. Choose another photo.");
  if (file.size > originalLimit) throw new Error("Choose a photo up to 24 MiB.");
  const mime = photoMime(new Uint8Array(await file.arrayBuffer()), file.type);
  const url = URL.createObjectURL(file.slice(0, file.size, mime));
  const image = new Image(), canvas = document.createElement("canvas");
  try {
    image.src = url;
    try { await image.decode(); }
    catch { throw new Error(mime === "image/heic" ? heicHelp : "This photo could not be opened. Choose another copy or photo."); }
    // Image decoding applies camera orientation before drawing to the clean canvas.
    checkDimensions(image.naturalWidth, image.naturalHeight);
    const max = kind === "avatar" ? 512 : 1024;
    const scale = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext("2d", {willReadFrequently:true});
    if (!ctx) throw new Error("Your browser could not prepare the photo. Try again in a new tab.");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const encode = (type: string) => new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, 0.9));
    let blob = await encode("image/webp");
    // Safari's canvas may return PNG for WebP requests. Use bounded JPEG there.
    if (blob?.type !== "image/webp" || !blob.size || blob.size > artworkLimit) {
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      blob = await encode("image/jpeg");
      // Some WebKit installations can decode HEIC but return null from both
      // native encoders. Only pass our bounded, oriented pixels to the fallback.
      if (!blob?.size) {
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
        if (pixels.data[3] !== 255) throw new Error("Your browser could not read the photo preview. Choose the photo again.");
        const { default: encodeJpeg } = await import("jpeg-js/lib/encoder");
        const jpeg = encodeJpeg(pixels, 88);
        blob = new Blob([new Uint8Array(jpeg.data)], {type:"image/jpeg"});
      }
    }
    if (!blob || !blob.size || blob.size > artworkLimit) throw new Error("The photo could not be optimized. Try choosing it again.");
    inspectArtwork(new Uint8Array(await blob.arrayBuffer()), blob.type);
    return new File([blob], kind + "." + blob.type.slice(6), { type: blob.type });
  } finally {
    URL.revokeObjectURL(url);
    image.removeAttribute("src");
    canvas.width = canvas.height = 0;
  }
}
