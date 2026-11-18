/**
 * Generate location-marker images for Spatial tracking (8th Wall image targets).
 * Creates 1200x1200px PNG images: the black/white organic circle marker (locked v11), unique per point.
 * Supports N markers (3-20) with extended color palette.
 */
import type { MarkerPoint } from "@/lib/markerTypes";
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
 * Generate a single location-marker image (an 8th Wall image target).
 * Spatial design (locked v11, 18 Nov 2026): the black/white circle fills the full
 * 1200 px square, white corners, no text. Number, coordinates, project name and
 * "POINT n" are NOT part of the tracked image — they live on the printed sheet
 * (see spatial/sheets.ts), so a sheet layout change never changes the tracked image.
 */
export async function generateMarkerCanvas(
  markerPoint: MarkerPoint,
  _projectName?: string
): Promise<HTMLCanvasElement> {
  const size = 1200;
  return svgToCanvas(markerDiscSvg(markerPoint.index, size), size, size);
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

