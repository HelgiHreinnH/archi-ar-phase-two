/** Browser-side SVG → canvas / PNG helpers for the Spatial print outputs. */

let fontCssPromise: Promise<string> | null = null;

/** Embedded font CSS, loaded on first use (≈130 kB, only needed for print sheets). */
export function loadSheetFontCss(): Promise<string> {
  fontCssPromise ??= import("@/lib/spatial/fonts").then((m) => m.SHEET_FONT_CSS);
  return fontCssPromise;
}

function loadSvgImage(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to rasterise SVG"));
    // data URL (not a blob URL) so Safari does not taint the canvas
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

/**
 * Rasterise an SVG document onto a white canvas of the given pixel size.
 * Drawn twice with a short pause: browsers decode embedded @font-face data
 * URIs lazily inside SVG images, so the first draw can use fallback fonts.
 */
export async function svgToCanvas(svg: string, width: number, height: number): Promise<HTMLCanvasElement> {
  const img = await loadSvgImage(svg);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const paint = () => {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
  };
  paint();
  if (svg.includes("@font-face")) {
    await new Promise((resolve) => window.setTimeout(resolve, 60));
    paint();
  }
  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = "image/png"): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Canvas export failed"))), type),
  );
}
