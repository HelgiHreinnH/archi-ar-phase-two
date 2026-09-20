/**
 * GLB-only model pipeline helpers.
 *
 * Archi AR renders every mode (tabletop, wall, spatial) through MindAR +
 * Three.js in the browser, which loads GLB on iOS and Android alike. GLB is
 * therefore the only accepted model format. These helpers:
 *
 *  1. `isGlbBytes` — verify a file really is binary glTF (magic "glTF", v2),
 *     so a renamed USDZ/zip can never reach storage.
 *  2. `optimizeGlbTextures` — shrink oversized embedded textures before
 *     upload. Draco (server-side, optimize-model) handles geometry; textures
 *     are usually the remaining bulk AND what decides whether iOS Safari runs
 *     out of GPU memory mid-AR. Textures are resized to ≤ MAX_TEXTURE_SIZE and
 *     re-encoded as JPEG (opaque) or PNG (with alpha). Only core glTF image
 *     formats are produced — no extensions, so every loader keeps working.
 *
 * `repackGlb` is the pure, testable part: it rebuilds the BIN chunk with some
 * bufferViews replaced and fixes every offset.
 */

export const MAX_TEXTURE_SIZE = 2048;
const JPEG_QUALITY = 0.88;

const GLB_MAGIC = 0x46546c67; // "glTF" little-endian
const CHUNK_JSON = 0x4e4f534a; // "JSON"
const CHUNK_BIN = 0x004e4942; // "BIN\0"

/* eslint-disable @typescript-eslint/no-explicit-any */
type GltfJson = Record<string, any>;

export function isGlbBytes(header: ArrayBuffer | Uint8Array): boolean {
  const bytes = header instanceof Uint8Array ? header : new Uint8Array(header);
  if (bytes.byteLength < 12) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(0, true) === GLB_MAGIC && view.getUint32(4, true) === 2;
}

export async function isGlbFile(file: Blob): Promise<boolean> {
  return isGlbBytes(await file.slice(0, 12).arrayBuffer());
}

export interface ParsedGlb {
  json: GltfJson;
  bin: Uint8Array | null;
}

export function parseGlb(buffer: ArrayBuffer): ParsedGlb {
  if (!isGlbBytes(buffer)) throw new Error("Not a GLB v2 file");
  const view = new DataView(buffer);
  const total = Math.min(view.getUint32(8, true), buffer.byteLength);
  let offset = 12;
  let json: GltfJson | null = null;
  let bin: Uint8Array | null = null;
  while (offset + 8 <= total) {
    const len = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (type === CHUNK_JSON && !json) {
      json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, start, len)));
    } else if (type === CHUNK_BIN && !bin) {
      bin = new Uint8Array(buffer, start, len);
    }
    offset = start + len;
  }
  if (!json) throw new Error("GLB has no JSON chunk");
  return { json, bin };
}

const pad4 = (n: number) => (n + 3) & ~3;

/**
 * Rebuild a GLB, replacing the bytes of selected bufferViews. All bufferViews
 * must live in buffer 0 (the embedded BIN chunk). Offsets are recomputed and
 * each view is 4-byte aligned (required for accessor data).
 */
export function repackGlb(
  json: GltfJson,
  bin: Uint8Array,
  replacements: Map<number, Uint8Array>,
): ArrayBuffer {
  const out = structuredClone(json) as GltfJson;
  const views: any[] = out.bufferViews ?? [];

  let size = 0;
  const parts: { offset: number; bytes: Uint8Array }[] = [];
  views.forEach((bv, i) => {
    const bytes =
      replacements.get(i) ??
      bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
    size = pad4(size);
    parts.push({ offset: size, bytes });
    bv.byteOffset = size;
    bv.byteLength = bytes.byteLength;
    size += bytes.byteLength;
  });
  const binLen = pad4(size);
  if (out.buffers?.[0]) out.buffers[0].byteLength = size;

  const newBin = new Uint8Array(binLen);
  for (const p of parts) newBin.set(p.bytes, p.offset);

  const jsonBytes = new TextEncoder().encode(JSON.stringify(out));
  const jsonLen = pad4(jsonBytes.byteLength);
  const hasBin = views.length > 0 || !!out.buffers?.length;
  const total = 12 + 8 + jsonLen + (hasBin ? 8 + binLen : 0);

  const glb = new ArrayBuffer(total);
  const dv = new DataView(glb);
  const u8 = new Uint8Array(glb);
  dv.setUint32(0, GLB_MAGIC, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true);
  dv.setUint32(16, CHUNK_JSON, true);
  u8.fill(0x20, 20, 20 + jsonLen); // JSON chunk pads with spaces
  u8.set(jsonBytes, 20);
  if (hasBin) {
    const b = 20 + jsonLen;
    dv.setUint32(b, binLen, true);
    dv.setUint32(b + 4, CHUNK_BIN, true);
    u8.set(newBin, b + 8);
  }
  return glb;
}

export interface TextureOptimizeResult {
  file: File;
  changed: boolean;
  originalSize: number;
  optimizedSize: number;
  texturesProcessed: number;
}

/** Can this GLB be safely repacked? (single embedded buffer, no external URIs) */
function isRepackable(json: GltfJson, bin: Uint8Array | null): bin is Uint8Array {
  if (!bin) return false;
  const buffers: any[] = json.buffers ?? [];
  if (buffers.length !== 1 || buffers[0].uri) return false;
  return (json.bufferViews ?? []).every((bv: any) => (bv.buffer ?? 0) === 0);
}

/**
 * PNG colour type from the IHDR chunk (byte 25). Types 0 (grey) and 2 (RGB)
 * carry no alpha channel unless a tRNS chunk is present.
 */
function pngMayHaveAlpha(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 26) return true;
  const colorType = bytes[25];
  if (colorType === 4 || colorType === 6) return true;
  // Look for a tRNS chunk before the image data (cheap: header region only).
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.byteLength, 4096)));
  const idat = head.indexOf("IDAT");
  const trns = head.indexOf("tRNS");
  return trns !== -1 && (idat === -1 || trns < idat);
}

/** Scan the (already downscaled) canvas for any non-opaque pixel. */
function canvasHasAlpha(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const data = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
}

function canvasToBytes(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? blob.arrayBuffer().then((b) => resolve(new Uint8Array(b)), reject) : reject(new Error("encode failed"))),
      type,
      quality,
    ),
  );
}

/**
 * Resize/re-encode embedded textures. Never throws for a valid GLB it can't
 * improve — it returns the original file with `changed: false`.
 */
export async function optimizeGlbTextures(file: File, maxSize = MAX_TEXTURE_SIZE): Promise<TextureOptimizeResult> {
  const unchanged = (n = 0): TextureOptimizeResult => ({
    file, changed: false, originalSize: file.size, optimizedSize: file.size, texturesProcessed: n,
  });
  if (typeof document === "undefined" || typeof createImageBitmap === "undefined") return unchanged();

  const { json, bin } = parseGlb(await file.arrayBuffer());
  const images: any[] = json.images ?? [];
  if (!images.length || !isRepackable(json, bin)) return unchanged();

  const replacements = new Map<number, Uint8Array>();
  let processed = 0;

  for (const img of images) {
    if (img.bufferView === undefined) continue;
    const mime: string = img.mimeType ?? "";
    if (mime !== "image/png" && mime !== "image/jpeg") continue; // leave KTX2/WebP alone
    const bv = json.bufferViews[img.bufferView];
    const src = bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);

    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(new Blob([src], { type: mime }));
    } catch {
      continue;
    }
    try {
      const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const mayHaveAlpha = mime === "image/png" && pngMayHaveAlpha(src);
      // Opaque JPEGs that are already small enough: nothing to gain.
      if (scale === 1 && !mayHaveAlpha && mime === "image/jpeg") continue;

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: mayHaveAlpha });
      if (!ctx) continue;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, 0, 0, w, h);

      // Opaque maps (the usual Rhino export) become JPEG; real alpha stays PNG.
      // The alpha scan runs on the downscaled canvas, never the full-res image.
      const outMime = mayHaveAlpha && canvasHasAlpha(ctx, w, h) ? "image/png" : "image/jpeg";
      if (scale === 1 && outMime === mime) continue;
      const bytes = await canvasToBytes(canvas, outMime, outMime === "image/jpeg" ? JPEG_QUALITY : undefined);
      if (bytes.byteLength >= src.byteLength) continue;

      replacements.set(img.bufferView, bytes);
      img.mimeType = outMime;
      processed++;
    } finally {
      bitmap.close();
    }
  }

  if (!replacements.size) return unchanged();
  const out = repackGlb(json, bin, replacements);
  if (out.byteLength >= file.size) return unchanged();
  const optimized = new File([out], file.name, { type: "model/gltf-binary" });
  return { file: optimized, changed: true, originalSize: file.size, optimizedSize: optimized.size, texturesProcessed: processed };
}
