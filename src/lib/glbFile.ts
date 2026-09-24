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

/** Supabase Storage rejects non-ASCII keys (æ/ø/å → HTTP 400). */
export function storageSafeName(name: string): string {
  const map: Record<string, string> = { æ: "ae", ø: "oe", å: "aa", Æ: "Ae", Ø: "Oe", Å: "Aa", ð: "d", Ð: "D", þ: "th", Þ: "Th", ß: "ss" };
  const ascii = name
    .replace(/[æøåÆØÅðÐþÞß]/g, (c) => map[c])
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._ -]/g, "_");
  return ascii || "model.glb";
}

export const MAX_TEXTURE_SIZE = 2048;
const JPEG_QUALITY = 0.88;

/**
 * Total texture budget for one model, in megapixels.
 *
 * Bytes on disk are not what breaks a phone (or a laptop browser tab) —
 * decoded textures are. Every texture is uploaded to the GPU as RGBA with
 * mipmaps, i.e. ~5.3 MB per megapixel. A model with 43 textures at 2048² is
 * ~60 MP ≈ 300 MB of GPU memory, which crashes iOS Safari and can take a
 * desktop tab with it. 24 MP ≈ 128 MB keeps a heavy architectural model
 * inside what a phone can hold.
 */
const TEXTURE_BUDGET_MP = 24;
/** Never go below this: smaller than 512 looks obviously blurry up close. */
const MIN_TEXTURE_SIZE = 512;

/** Per-texture cap for a model with `count` textures, within the budget. */
export function textureSizeCap(count: number, maxSize = MAX_TEXTURE_SIZE): number {
  if (count <= 0) return maxSize;
  const perTexture = Math.sqrt((TEXTURE_BUDGET_MP * 1e6) / count);
  const rounded = Math.floor(perTexture / 128) * 128; // keep friendly GPU sizes
  return Math.min(maxSize, Math.max(MIN_TEXTURE_SIZE, rounded));
}

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

/**
 * Write a GLB with a new JSON chunk and the BIN chunk copied verbatim.
 *
 * Nothing in the binary moves, so every bufferView offset stays valid — including
 * compressed layouts (EXT_meshopt_compression) whose real byte ranges live inside
 * extension objects that a repack would not know how to move.
 */
export function writeGlb(json: GltfJson, bin: Uint8Array | null): ArrayBuffer {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = pad4(jsonBytes.byteLength);
  const binLen = bin ? pad4(bin.byteLength) : 0;
  const total = 12 + 8 + jsonLen + (bin ? 8 + binLen : 0);

  const glb = new ArrayBuffer(total);
  const dv = new DataView(glb);
  const u8 = new Uint8Array(glb);
  dv.setUint32(0, GLB_MAGIC, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true);
  dv.setUint32(16, CHUNK_JSON, true);
  u8.fill(0x20, 20, 20 + jsonLen);
  u8.set(jsonBytes, 20);
  if (bin) {
    const b = 20 + jsonLen;
    dv.setUint32(b, binLen, true);
    dv.setUint32(b + 4, CHUNK_BIN, true);
    u8.set(bin, b + 8);
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

  // Many textures → a smaller cap each, so the whole model fits in memory.
  const cap = textureSizeCap(images.length, maxSize);

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
      const scale = Math.min(1, cap / Math.max(bitmap.width, bitmap.height));
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
      let bytes = await canvasToBytes(canvas, outMime, outMime === "image/jpeg" ? JPEG_QUALITY : undefined);
      if (bytes.byteLength >= src.byteLength) {
        // A downscale must never be rejected just because re-encoding grew the
        // file: the point is GPU memory, not bytes. (A heavily compressed
        // source JPEG can re-encode larger at the same quality.) Try once more
        // at lower quality, then keep the smaller image regardless.
        if (scale === 1) continue; // same size and no gain — keep the original
        if (outMime === "image/jpeg") {
          const retry = await canvasToBytes(canvas, outMime, 0.75);
          if (retry.byteLength < bytes.byteLength) bytes = retry;
        }
      }

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

/**
 * Strip textures (and optionally materials) from a GLB so it can be parsed or
 * rendered without decoding a single image. Used for marker detection and for
 * the still-image thumbnail, where textures are pure cost: decoding them is
 * what makes a heavy model crash the tab.
 */
export function stripTextures(buffer: ArrayBuffer, opts: { keepMaterials?: boolean } = {}): ArrayBuffer {
  try {
    const { json, bin } = parseGlb(buffer);
    if (!json.images?.length && !json.materials?.length) return buffer;
    const lean: GltfJson = { ...json };
    delete lean.images;
    delete lean.textures;
    delete lean.samplers;

    if (opts.keepMaterials) {
      // Keep colours/roughness factors, drop every texture reference.
      const stripTextureRefs = (value: any): any => {
        if (Array.isArray(value)) return value.map(stripTextureRefs);
        if (value && typeof value === "object") {
          const out: Record<string, any> = {};
          for (const [k, v] of Object.entries(value)) {
            if (v && typeof v === "object" && "index" in (v as object) && /texture/i.test(k)) continue;
            out[k] = stripTextureRefs(v);
          }
          return out;
        }
        return value;
      };
      lean.materials = (json.materials ?? []).map(stripTextureRefs);
    } else {
      delete lean.materials;
      lean.meshes = (json.meshes ?? []).map((m: { primitives?: Record<string, unknown>[] }) => ({
        ...m,
        primitives: (m.primitives ?? []).map((prim) => {
          const { material: _material, ...rest } = prim;
          return rest;
        }),
      }));
    }
    // The image bytes stay in the buffer, unreferenced — nothing decodes them.
    // Rewriting the binary instead would corrupt compressed layouts.
    return writeGlb(lean, bin);
  } catch {
    return buffer; // fall back to the original file
  }
}
