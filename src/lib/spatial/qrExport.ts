/** PNG export of the Spatial QR outputs (designed round badge / subtle). */
import { spatialQrSvg, type SpatialQrVariant } from "@/lib/spatial/qr";
import { canvasToBlob, svgToCanvas } from "@/lib/spatial/raster";

/** Render a Spatial QR variant to a PNG blob (square, white background). */
export async function spatialQrPng(shareUrl: string, variant: SpatialQrVariant, px = 2000): Promise<Blob> {
  return canvasToBlob(await svgToCanvas(spatialQrSvg(shareUrl, variant), px, px));
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/** Download a Spatial QR variant as PNG. */
export async function downloadSpatialQrPng(
  shareUrl: string,
  variant: SpatialQrVariant,
  projectName: string
): Promise<void> {
  const safe = projectName.trim().replace(/[^a-z0-9._-]+/gi, "_").replace(/^_+|_+$/g, "") || "project";
  downloadBlob(await spatialQrPng(shareUrl, variant), `QR_${variant}_${safe}.png`);
}
