/**
 * Generate location-marker images for MindAR tracking (Spatial mode).
 * Creates 1200x1200px PNG images: the Archi AR dial disc, one colour per marker.
 * Supports N markers (3-20) with extended color palette.
 */
import { type MarkerPoint, getSafeMarkerColor } from "@/lib/markerTypes";
import { markerDiscSvg } from "@/lib/spatial/design";
import { svgToCanvas } from "@/lib/spatial/raster";

export interface GeneratedMarker {
  id: string;
  index: number;
  canvas: HTMLCanvasElement;
  dataUrl: string;
  blob: Blob;
}

/**
 * Generate a single location-marker image (MindAR tracking target).
 * Spatial design (locked 16 Nov 2026): the disc fills the full 1200 px square,
 * white corners, number in the centre. Coordinates, project name and "POINT n"
 * are NOT part of the tracked image — they live on the printed sheet
 * (see spatial/sheets.ts), so layout changes never force a new .mind compile.
 */
export async function generateMarkerCanvas(
  markerPoint: MarkerPoint,
  _projectName?: string
): Promise<HTMLCanvasElement> {
  const size = 1200;
  const color = getSafeMarkerColor(markerPoint.index);
  return svgToCanvas(markerDiscSvg(markerPoint.index, color.bg, size), size, size);
}

/** Generate all marker images from MarkerPoint[] and return as blobs */
export async function generateAllMarkerImages(
  markers: MarkerPoint[],
  projectName: string
): Promise<GeneratedMarker[]> {
  const results: GeneratedMarker[] = [];

  for (const marker of markers) {
    const canvas = await generateMarkerCanvas(marker, projectName);
    const dataUrl = canvas.toDataURL("image/png");
    const blob = await new Promise<Blob>((resolve) => {
      canvas.toBlob((b) => resolve(b!), "image/png");
    });

    results.push({
      id: String(marker.index),
      index: marker.index,
      canvas,
      dataUrl,
      blob,
    });
  }

  return results;
}

/** Convert canvas to HTMLImageElement (needed for MindAR compiler) */
export function canvasToImage(canvas: HTMLCanvasElement): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = canvas.toDataURL("image/png");
  });
}
