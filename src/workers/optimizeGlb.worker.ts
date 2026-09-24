/// <reference lib="webworker" />
/**
 * Off-main-thread GLB optimisation (see src/lib/optimizeGlb.ts for the why).
 * A 50 MB Rhino export takes ~20–40 s here; on the main thread that would
 * freeze the dashboard for the whole time.
 *
 * Draco input: three's Emscripten decoder (public/assets/…/draco_wasm_wrapper.js
 * + .wasm) is a classic script that defines a global `DracoDecoderModule`. Module
 * workers can't importScripts(), so it is fetched and evaluated once.
 */
import { WebIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import { modelStats, optimizeDocument, type ModelStats, type OptimizeStage } from "@/lib/optimizeGlb";

const DRACO_WRAPPER = "/assets/three/jsm/libs/draco/draco_wasm_wrapper.js";
const DRACO_WASM = "/assets/three/jsm/libs/draco/draco_decoder.wasm";

export type WorkerIn = { bytes: ArrayBuffer; origin: string };
export type WorkerOut =
  | { type: "stage"; stage: OptimizeStage }
  | { type: "done"; bytes: ArrayBuffer; before: ModelStats; after: ModelStats; fixes: Record<string, number>; ms: number }
  | { type: "error"; message: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let dracoPromise: Promise<any> | null = null;
function loadDraco(origin: string) {
  if (!dracoPromise) {
    dracoPromise = (async () => {
      const [src, wasmBinary] = await Promise.all([
        fetch(new URL(DRACO_WRAPPER, origin)).then((r) => r.text()),
        fetch(new URL(DRACO_WASM, origin)).then((r) => r.arrayBuffer()),
      ]);
      const factory = new Function(`${src}\nreturn DracoDecoderModule;`)();
      // Emscripten modules are thenables; resolve to the ready module.
      return new Promise((resolve) => factory({ wasmBinary, onModuleLoaded: resolve }));
    })();
  }
  return dracoPromise;
}

const post = (m: WorkerOut, transfer: Transferable[] = []) =>
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer);

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  const t0 = performance.now();
  try {
    const bytes = new Uint8Array(e.data.bytes);
    post({ type: "stage", stage: "decode" });
    await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);

    const jsonLen = new DataView(bytes.buffer).getUint32(12, true);
    const json = new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen));
    const deps: Record<string, unknown> = {
      "meshopt.encoder": MeshoptEncoder,
      "meshopt.decoder": MeshoptDecoder,
    };
    if (json.includes('"KHR_draco_mesh_compression"')) {
      deps["draco3d.decoder"] = await loadDraco(e.data.origin);
    }

    const io = new WebIO().registerExtensions(ALL_EXTENSIONS).registerDependencies(deps);
    const doc = await io.readBinary(bytes);
    const before = modelStats(doc);

    const { fixes } = await optimizeDocument(
      doc,
      { encoder: MeshoptEncoder, simplifier: MeshoptSimplifier },
      (stage) => post({ type: "stage", stage }),
    );

    post({ type: "stage", stage: "write" });
    const after = modelStats(doc);
    const out = await io.writeBinary(doc);
    const buf = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
    post({ type: "done", bytes: buf, before, after, fixes, ms: Math.round(performance.now() - t0) }, [buf]);
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
