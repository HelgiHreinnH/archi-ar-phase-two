/**
 * Generate branded marker images optimized for MindAR feature detection.
 * Creates 1200x1200px PNG images with high contrast patterns.
 * Supports N markers (3-20) with extended color palette.
 */
import { type MarkerPoint, getSafeMarkerColor } from "@/lib/markerTypes";

export interface GeneratedMarker {
  id: string;
  index: number;
  canvas: HTMLCanvasElement;
  dataUrl: string;
  blob: Blob;
}

/** Add geometric feature patterns to help MindAR detect unique points */
function addFeaturePatterns(ctx: CanvasRenderingContext2D, size: number, index: number) {
  ctx.fillStyle = "rgba(255, 255, 255, 0.25)";

  // Corner circles
  const positions = [
    [120, 120], [size - 120, 120],
    [120, size - 120], [size - 120, size - 120],
    [size / 2, 100], [100, size / 2],
    [size - 100, size / 2], [size / 2, size - 100],
  ];

  positions.forEach(([x, y]) => {
    ctx.beginPath();
    ctx.arc(x, y, 25, 0, Math.PI * 2);
    ctx.fill();
  });

  // Unique patterns per marker index for feature diversity
  ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
  ctx.lineWidth = 3;

  // Top-left quadrant pattern
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(60 + i * 40, 60);
    ctx.lineTo(60, 60 + i * 40);
    ctx.stroke();
  }

  // Bottom-right quadrant pattern (offset by index for uniqueness)
  const offset = (index * 15) % 60;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(size - 60 - i * 40 - offset, size - 60);
    ctx.lineTo(size - 60, size - 60 - i * 40 - offset);
    ctx.stroke();
  }

  // Additional uniqueness: small dots in a pattern based on index
  ctx.fillStyle = "rgba(255, 255, 255, 0.2)";
  for (let i = 0; i < index && i < 10; i++) {
    const angle = (i / Math.max(index, 1)) * Math.PI * 2;
    const cx = size / 2 + Math.cos(angle) * (size * 0.38);
    const cy = size / 2 + Math.sin(angle) * (size * 0.38);
    ctx.beginPath();
    ctx.arc(cx, cy, 12, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Generate a single branded marker image */
export function generateMarkerCanvas(
  markerPoint: MarkerPoint,
  projectName: string
): HTMLCanvasElement {
  const size = 1200;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  const color = getSafeMarkerColor(markerPoint.index);
  const displayId = String(markerPoint.index);

  // 1. Solid background color
  ctx.fillStyle = color.bg;
  ctx.fillRect(0, 0, size, size);

  // 2. White border
  ctx.strokeStyle = "#FFFFFF";
  ctx.lineWidth = 16;
  ctx.strokeRect(30, 30, size - 60, size - 60);

  // 3. Inner border
  ctx.lineWidth = 4;
  ctx.strokeRect(60, 60, size - 120, size - 120);

  // 4. Large number
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "bold 360px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(displayId, size / 2, size * 0.35);

  // 5. "POINT N" label
  ctx.font = "bold 72px sans-serif";
  ctx.fillText(`POINT ${displayId}`, size / 2, size * 0.55);

  // 6. Marker label/description
  ctx.font = "48px sans-serif";
  ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
  ctx.fillText(markerPoint.label || `Marker ${displayId}`, size / 2, size * 0.63);

  // 7. Coordinates
  ctx.font = "bold 36px monospace";
  ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
  ctx.fillText(
    `(${markerPoint.x}, ${markerPoint.y}, ${markerPoint.z}) mm`,
    size / 2,
    size * 0.72
  );

  // 8. Project name
  ctx.font = "bold 40px sans-serif";
  ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
  ctx.fillText(projectName, size / 2, size * 0.88);

  // 9. Branding
  ctx.font = "28px sans-serif";
  ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
  ctx.fillText("Archi AR", size / 2, size * 0.95);

  // 10. Feature detection patterns (unique per marker)
  addFeaturePatterns(ctx, size, markerPoint.index);

  return canvas;
}

/** Generate all marker images from MarkerPoint[] and return as blobs */
export async function generateAllMarkerImages(
  markers: MarkerPoint[],
  projectName: string
): Promise<GeneratedMarker[]> {
  const results: GeneratedMarker[] = [];

  for (const marker of markers) {
    const canvas = generateMarkerCanvas(marker, projectName);
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
