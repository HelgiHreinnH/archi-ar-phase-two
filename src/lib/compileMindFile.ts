/**
 * Client-side MindAR .mind file compiler.
 * Loads the MindAR compiler from CDN (ES module) and compiles image targets in the browser.
 *
 * Key details:
 * - mind-ar@1.2.5 `mindar-image.prod.js` is an ES module that exposes
 *   `window.MINDAR.IMAGE.Compiler` (not `window.MINDAR.Compiler`).
 * - It dynamically imports a ~2 MB controller chunk, so we must load it
 *   with `<script type="module">` so the browser can resolve the relative import.
 */

declare global {
  interface Window {
    MINDAR?: {
      IMAGE?: {
        Compiler: new () => {
          compileImageTargets: (
            images: HTMLImageElement[],
            progressCallback?: (progress: number) => void
          ) => Promise<any[]>;
          exportData: () => Promise<ArrayBuffer>;
        };
      };
    };
    __MINDAR_COMPILER_LOADED?: boolean;
  }
}

const CDN_BASE =
  "https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image.prod.js";

// Audit C-1 / L-5 (May 2026): SRI hash pinned for the MindAR compiler entry module.
// Recompute when bumping `mind-ar` version:
//   curl -sL <CDN_BASE> | python3 -c "import sys,hashlib,base64; print('sha384-'+base64.b64encode(hashlib.sha384(sys.stdin.buffer.read()).digest()).decode())"
// NOTE: SRI on the entry verifies only this file. Its dynamic sub-imports
// (controller-*.js, ui-*.js) are referenced by content-hashed filenames pinned
// inside this verified module, so tampering with the chain would invalidate
// either this hash or the URL the browser resolves.
const CDN_SRI = "sha384-hWwJbySAF+K3yQuqupwebOlSqX/EqF48nEWrP0b07KI4dPCptfGG63ldC2IgjRRg";

import { MindARSRIError, isLikelySRIFailure, sriBypassEnabled } from "./sriError";

/**
 * Load the MindAR compiler via an ES module script tag.
 * The CDN file sets `window.MINDAR.IMAGE = { Controller, Compiler, UI }`.
 */
let compilerLoad: Promise<void> | null = null;

function loadCompilerScript(): Promise<void> {
  // Memoised: preloading and compiling share one script load.
  if (!compilerLoad) {
    compilerLoad = injectCompilerScript().catch((err) => {
      compilerLoad = null; // allow a retry after a failure
      throw err;
    });
  }
  return compilerLoad;
}

/**
 * Warm the MindAR compiler (~2 MB incl. TensorFlow.js) in the background as
 * soon as the project wizard opens, so pressing "Generate" doesn't start
 * with a multi-second download. Safe to call repeatedly; never throws.
 */
export function preloadMindCompiler(): void {
  if (typeof window === "undefined") return;
  const start = () => { void loadCompilerScript().then(() => waitForCompiler()).catch(() => {}); };
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
  if (ric) ric(start); else setTimeout(start, 1500);
}

function injectCompilerScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.__MINDAR_COMPILER_LOADED && window.MINDAR?.IMAGE?.Compiler) {
      resolve();
      return;
    }

    const script = document.createElement("script");
    script.type = "module";
    script.src = CDN_BASE;
    // Audit C-1: allow a `?nosri=1` recovery path so users can unblock
    // themselves when our pinned hash drifts from the current CDN bytes.
    if (!sriBypassEnabled()) {
      script.integrity = CDN_SRI;
      script.crossOrigin = "anonymous";
    } else {
      script.crossOrigin = "anonymous";
    }

    script.onload = () => {
      // Module scripts resolve all static imports before onload fires,
      // so window.MINDAR.IMAGE should be populated.
      window.__MINDAR_COMPILER_LOADED = true;
      resolve();
    };

    script.onerror = async () => {
      // Disambiguate SRI mismatch vs network failure by re-fetching the URL.
      const reachable = await isLikelySRIFailure(CDN_BASE);
      if (reachable) {
        reject(new MindARSRIError(CDN_BASE,
          "MindAR compiler integrity check failed. The CDN file may have been updated upstream."));
      } else {
        reject(new Error("Failed to load MindAR compiler script (network error)"));
      }
    };

    document.head.appendChild(script);
  });
}

/**
 * Module scripts set globals asynchronously — the `onload` of the
 * <script type="module"> fires after the module is *fetched*, but the
 * module body may execute in the next microtask. We poll briefly to
 * make sure `window.MINDAR.IMAGE.Compiler` is available.
 */
function waitForCompiler(timeout = 10_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (window.MINDAR?.IMAGE?.Compiler) {
        resolve();
        return;
      }
      if (Date.now() - start > timeout) {
        reject(
          new Error(
            "MindAR Compiler did not become available within timeout"
          )
        );
        return;
      }
      setTimeout(check, 100);
    };
    check();
  });
}

export interface CompileResult {
  buffer: ArrayBuffer;
  blob: Blob;
}

/** A compile that hasn't finished by now has stalled (a healthy QR compile takes ~5 s). */
export const COMPILE_TIMEOUT_MS = 60_000;

export class MindCompileError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
    /** True when the WebGL path failed for GPU reasons → the CPU compiler can take over. */
    public readonly gpuFailure = false,
  ) {
    super(message);
    this.name = "MindCompileError";
  }
}

const GPU_FAILURE_RE = /kernel .* not registered|backend 'cpu'|webgl|context lost/i;

function isGpuFailure(reason: unknown): boolean {
  const raw = reason instanceof Error ? reason.message : String(reason ?? "");
  return GPU_FAILURE_RE.test(raw);
}

/**
 * Compile an array of HTMLImageElements into a .mind target file.
 *
 * Oct 2026: MindAR's compiler can fail *inside* its own async code (e.g. no
 * WebGL → TensorFlow falls back to CPU → "Kernel 'BinomialFilter' not
 * registered"). That error surfaces only as an unhandled rejection and the
 * compile promise never settles — the Generate step then spins forever.
 * We race the compile against those global errors and a timeout so the
 * architect always gets an answer.
 *
 * @param images Array of marker images (HTMLImageElement)
 * @param onProgress Optional callback receiving 0-100 progress percentage
 * @returns The compiled .mind file as ArrayBuffer and Blob
 */
export async function compileMindFile(
  images: HTMLImageElement[],
  onProgress?: (percent: number) => void,
  timeoutMs = COMPILE_TIMEOUT_MS,
): Promise<CompileResult> {
  // Oct 2026: without WebGL, skip straight to the CPU compiler (slower, same
  // .mind). With WebGL, try the fast path and fall back if the GPU fails.
  if (!hasWebGL()) {
    console.warn("[compileMindFile] WebGL unavailable — compiling on the CPU");
    return compileOnCpu(images, onProgress);
  }
  try {
    return await compileWithWebGL(images, onProgress, timeoutMs);
  } catch (err) {
    if (err instanceof MindCompileError && err.gpuFailure) {
      console.warn("[compileMindFile] WebGL compile failed — retrying on the CPU", err.cause ?? err);
      onProgress?.(0);
      return compileOnCpu(images, onProgress);
    }
    throw err;
  }
}

/** True when this browser can create a WebGL context right now. */
export function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2") || canvas.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return false;
    const ok = !gl.isContextLost();
    gl.getExtension("WEBGL_lose_context")?.loseContext(); // free the slot immediately
    return ok;
  } catch {
    return false;
  }
}

/** A CPU compile of one 600 px QR takes tens of seconds on a laptop; allow plenty. */
export const CPU_COMPILE_TIMEOUT_MS = 240_000;

/** Greyscale exactly like mind-ar's compiler-base.js: floor((r+g+b)/3). */
function toGreyImage(img: HTMLImageElement) {
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, img.width, img.height);
  const rgba = ctx.getImageData(0, 0, img.width, img.height).data;
  const data = new Uint8Array(img.width * img.height);
  for (let i = 0; i < data.length; i++) {
    const o = i * 4;
    data[i] = Math.floor((rgba[o] + rgba[o + 1] + rgba[o + 2]) / 3);
  }
  return { data, width: img.width, height: img.height };
}

function compileOnCpu(
  images: HTMLImageElement[],
  onProgress?: (percent: number) => void,
  timeoutMs = CPU_COMPILE_TIMEOUT_MS,
): Promise<CompileResult> {
  const targetImages = images.map(toGreyImage);
  const t0 = performance.now();
  return new Promise<CompileResult>((resolve, reject) => {
    const worker = new Worker(new URL("../workers/mindCompileCpu.worker.ts", import.meta.url), { type: "module" });
    const finish = () => { clearTimeout(timer); worker.terminate(); };
    const timer = setTimeout(() => {
      finish();
      reject(new MindCompileError(
        "Building the tracking target took too long on this computer. Restart your browser (that usually brings graphics acceleration back) and try again.",
      ));
    }, timeoutMs);
    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg?.type === "progress") {
        onProgress?.(Math.min(100, Math.round(msg.percent)));
      } else if (msg?.type === "done") {
        finish();
        const buffer = msg.buffer as ArrayBuffer;
        console.log(`[compileMindFile] CPU: ${images.length} target(s) in ${Math.round(performance.now() - t0)} ms`);
        resolve({ buffer, blob: new Blob([buffer], { type: "application/octet-stream" }) });
      } else if (msg?.type === "error") {
        finish();
        console.error("[compileMindFile] CPU compiler failed:", msg.message);
        reject(new MindCompileError(`Building the tracking target failed: ${msg.message}. Reload the page and try again.`));
      }
    };
    worker.onerror = (e) => {
      finish();
      console.error("[compileMindFile] CPU worker crashed:", e);
      reject(new MindCompileError("Building the tracking target failed. Reload the page and try again."));
    };
    worker.postMessage({ type: "compile", targetImages }, targetImages.map((t) => t.data.buffer));
  });
}

async function compileWithWebGL(
  images: HTMLImageElement[],
  onProgress?: (percent: number) => void,
  timeoutMs = COMPILE_TIMEOUT_MS,
): Promise<CompileResult> {
  await loadCompilerScript();
  await waitForCompiler();

  const CompilerClass = window.MINDAR!.IMAGE!.Compiler;
  const compiler = new CompilerClass();
  const t0 = performance.now();

  let cleanup = () => {};
  const failure = new Promise<never>((_, reject) => {
    const onRejection = (e: PromiseRejectionEvent) => {
      reject(new MindCompileError(describeCompileFailure(e.reason), e.reason, isGpuFailure(e.reason)));
    };
    const onError = (e: ErrorEvent) => {
      reject(new MindCompileError(describeCompileFailure(e.error ?? e.message), e.error, isGpuFailure(e.error ?? e.message)));
    };
    const timer = setTimeout(() => {
      reject(new MindCompileError(
        document.hidden
          ? "Compiling paused because the tab was in the background. Keep this tab open in front while generating, then try again."
          : "Compiling the tracking target stalled. Reload the page and try again — if it keeps happening, try Chrome.",
        undefined,
        !document.hidden, // a foreground stall is usually the GPU → let the CPU compiler try
      ));
    }, timeoutMs);
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("error", onError);
    cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("error", onError);
    };
  });

  try {
    // MindAR reports progress as 0–100 already.
    await Promise.race([
      compiler.compileImageTargets(images, (progress: number) => {
        onProgress?.(Math.min(100, Math.round(progress)));
      }),
      failure,
    ]);
    const buffer = await Promise.race([compiler.exportData(), failure]);
    console.log(`[compileMindFile] ${images.length} target(s) in ${Math.round(performance.now() - t0)} ms`);
    const blob = new Blob([buffer], { type: "application/octet-stream" });
    return { buffer, blob };
  } finally {
    cleanup();
    failure.catch(() => {}); // settled or not, never an unhandled rejection of our own
  }
}

/** Plain-language reason for a compiler failure (keeps the raw error for the console). */
export function describeCompileFailure(reason: unknown): string {
  const raw = reason instanceof Error ? reason.message : String(reason ?? "");
  console.error("[compileMindFile] compiler failed:", reason);
  if (/kernel .* not registered|backend 'cpu'|webgl/i.test(raw)) {
    // Normally invisible: compileMindFile retries these on the CPU.
    return "Graphics acceleration (WebGL) isn't available in this browser right now. Restart the browser and try again.";
  }
  if (/context lost/i.test(raw)) {
    return "The graphics context was lost while compiling. Reload the page and try again.";
  }
  return `Compiling the tracking target failed${raw ? `: ${raw}` : ""}. Reload the page and try again.`;
}
