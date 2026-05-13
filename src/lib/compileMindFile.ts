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
function loadCompilerScript(): Promise<void> {
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

/**
 * Compile an array of HTMLImageElements into a .mind target file.
 * @param images Array of marker images (HTMLImageElement)
 * @param onProgress Optional callback receiving 0-100 progress percentage
 * @returns The compiled .mind file as ArrayBuffer and Blob
 */
export async function compileMindFile(
  images: HTMLImageElement[],
  onProgress?: (percent: number) => void
): Promise<CompileResult> {
  await loadCompilerScript();
  await waitForCompiler();

  const CompilerClass = window.MINDAR!.IMAGE!.Compiler;
  const compiler = new CompilerClass();

  // compileImageTargets expects an array of Image elements
  await compiler.compileImageTargets(images, (progress: number) => {
    onProgress?.(Math.round(progress * 100));
  });

  const buffer = await compiler.exportData();
  const blob = new Blob([buffer], { type: "application/octet-stream" });

  return { buffer, blob };
}
