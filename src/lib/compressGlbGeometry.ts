/**
 * In-browser GLB optimisation before upload — client for
 * `src/workers/optimizeGlb.worker.ts` (pipeline in `optimizeGlb.ts`).
 *
 * WHY IN THE BROWSER: the upload itself becomes ~10× smaller and nothing waits
 * on a server round trip afterwards. WHY A WORKER: a heavy Rhino interior takes
 * 20–40 s to merge and simplify; the dashboard must stay responsive.
 *
 * Every GLB goes through it — including Draco-compressed ones, which used to be
 * skipped (and so reached phones as 50 k draw calls).
 */
import type { ModelStats, OptimizeStage } from "./optimizeGlb";
import type { WorkerOut } from "@/workers/optimizeGlb.worker";

export interface GeometryCompressResult {
  file: File;
  changed: boolean;
  originalSize: number;
  compressedSize: number;
  before?: ModelStats;
  after?: ModelStats;
}

export const STAGE_LABEL: Record<OptimizeStage, string> = {
  decode: "Reading model…",
  materials: "Fixing materials…",
  merge: "Merging parts…",
  simplify: "Simplifying geometry…",
  compress: "Compressing…",
  write: "Finishing…",
};

/** Give up and upload the original rather than leave the architect waiting. */
const TIMEOUT_MS = 180_000;

export async function compressGlbGeometry(
  file: File,
  onStage: (s: OptimizeStage) => void = () => {},
): Promise<GeometryCompressResult> {
  const unchanged: GeometryCompressResult = {
    file, changed: false, originalSize: file.size, compressedSize: file.size,
  };
  const bytes = await file.arrayBuffer();
  const worker = new Worker(new URL("../workers/optimizeGlb.worker.ts", import.meta.url), { type: "module" });

  try {
    const res = await new Promise<Extract<WorkerOut, { type: "done" }>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Optimisation timed out")), TIMEOUT_MS);
      worker.onmessage = (e: MessageEvent<WorkerOut>) => {
        const m = e.data;
        if (m.type === "stage") onStage(m.stage);
        else if (m.type === "done") { clearTimeout(timer); resolve(m); }
        else { clearTimeout(timer); reject(new Error(m.message)); }
      };
      worker.onerror = (e) => { clearTimeout(timer); reject(new Error(e.message || "Worker failed")); };
      worker.postMessage({ bytes, origin: location.origin }, [bytes]);
    });

    console.log(
      `[optimizeGlb] ${Math.round(res.ms / 100) / 10} s · draw calls ${res.before.primitives} → ${res.after.primitives} · ` +
      `tris ${res.before.triangles} → ${res.after.triangles} · fixes ${JSON.stringify(res.fixes)}`,
    );
    // Even when bytes barely shrink, fewer draw calls is the win — keep it
    // unless the file somehow grew a lot.
    if (res.bytes.byteLength > file.size * 1.1) return { ...unchanged, before: res.before, after: res.after };
    return {
      file: new File([res.bytes], file.name, { type: "model/gltf-binary" }),
      changed: true,
      originalSize: file.size,
      compressedSize: res.bytes.byteLength,
      before: res.before,
      after: res.after,
    };
  } finally {
    worker.terminate();
  }
}
