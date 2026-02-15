/**
 * Client-side MindAR .mind file compiler.
 * Loads the MindAR compiler from CDN and compiles image targets in the browser.
 */

declare global {
  interface Window {
    MINDAR?: {
      Compiler: new () => {
        compileImageTargets: (
          images: HTMLImageElement[],
          progressCallback?: (progress: number) => void
        ) => Promise<any[]>;
        exportData: () => Promise<ArrayBuffer>;
      };
    };
    __MINDAR_COMPILER_LOADED?: boolean;
  }
}

/** Load the MindAR compiler script from CDN */
function loadCompilerScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.__MINDAR_COMPILER_LOADED && window.MINDAR?.Compiler) {
      resolve();
      return;
    }

    const script = document.createElement("script");
    // The compiler-only build (no Three.js dependency)
    script.src =
      "https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image.prod.js";
    script.onload = () => {
      window.__MINDAR_COMPILER_LOADED = true;
      resolve();
    };
    script.onerror = () =>
      reject(new Error("Failed to load MindAR compiler script"));
    document.head.appendChild(script);
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

  if (!window.MINDAR?.Compiler) {
    throw new Error("MindAR Compiler not available after loading script");
  }

  const compiler = new window.MINDAR.Compiler();

  // compileImageTargets expects an array of Image elements
  await compiler.compileImageTargets(images, (progress: number) => {
    onProgress?.(Math.round(progress * 100));
  });

  const buffer = await compiler.exportData();
  const blob = new Blob([buffer], { type: "application/octet-stream" });

  return { buffer, blob };
}
