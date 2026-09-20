/**
 * In-browser geometry compression for uploaded GLBs (EXT_meshopt_compression).
 *
 * WHY IN THE BROWSER: compressing before upload makes the upload itself 3–10×
 * smaller and removes the server round trip (download → Draco → re-upload)
 * that used to keep the architect waiting after every upload.
 *
 * WHY MESHOPT (not Draco): decodes in milliseconds on phones without a worker
 * or WASM download, and every loader we use (Three.js GLTFLoader in the AR
 * scene + preview, model-viewer) supports it.
 *
 * Loaded with a dynamic import so none of this reaches the AR/viewer bundle.
 */
import { WebIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, weld, meshopt } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptDecoder } from "meshoptimizer";

export interface GeometryCompressResult {
  file: File;
  changed: boolean;
  originalSize: number;
  compressedSize: number;
}

const ALREADY_COMPRESSED = ["KHR_draco_mesh_compression", "EXT_meshopt_compression", "KHR_meshopt_compression"];

export async function compressGlbGeometry(file: File): Promise<GeometryCompressResult> {
  const unchanged: GeometryCompressResult = {
    file, changed: false, originalSize: file.size, compressedSize: file.size,
  };

  const bytes = new Uint8Array(await file.arrayBuffer());

  // Skip files that already carry geometry compression — re-encoding gains
  // little and Draco would need a decoder we don't ship to the dashboard.
  const jsonLen = new DataView(bytes.buffer, bytes.byteOffset).getUint32(12, true);
  const jsonText = new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen));
  if (ALREADY_COMPRESSED.some((ext) => jsonText.includes(`"${ext}"`))) return unchanged;

  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
  const io = new WebIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      "meshopt.encoder": MeshoptEncoder,
      "meshopt.decoder": MeshoptDecoder,
    });

  const document = await io.readBinary(bytes);
  await document.transform(
    dedup(),
    prune({ keepLeaves: true, keepAttributes: false }),
    weld(),
    // 16-bit positions ≈ 0.3 mm on a 20 m model — below anything visible in AR.
    meshopt({ encoder: MeshoptEncoder, level: "medium", quantizePosition: 16 }),
  );
  const out = await io.writeBinary(document);

  if (out.byteLength >= file.size) return unchanged;
  return {
    file: new File([out], file.name, { type: "model/gltf-binary" }),
    changed: true,
    originalSize: file.size,
    compressedSize: out.byteLength,
  };
}
