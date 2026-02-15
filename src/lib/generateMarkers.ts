/**
 * Generate branded marker images optimized for MindAR feature detection.
 * Creates 1200x1200px PNG images with high contrast patterns.
 */

const MARKER_COLORS: Record<string, { bg: string; name: string }> = {
  A: { bg: "#FF3B30", name: "Red" },
  B: { bg: "#34C759", name: "Green" },
  C: { bg: "#007AFF", name: "Blue" },
};

export interface MarkerPoint {
  x: number;
  y: number;
  z: number;
  label: string;
}

export interface GeneratedMarker {
  id: string;
  canvas: HTMLCanvasElement;
  dataUrl: string;
  blob: Blob;
}

/** Add geometric feature patterns to help MindAR detect unique points */
function addFeaturePatterns(ctx: CanvasRenderingContext2D, size: number) {
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

  // Add unique diagonal lines per quadrant for feature diversity
  ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
  ctx.lineWidth = 3;

  // Top-left quadrant pattern
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(60 + i * 40, 60);
    ctx.lineTo(60, 60 + i * 40);
    ctx.stroke();
  }

  // Bottom-right quadrant pattern
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(size - 60 - i * 40, size - 60);
    ctx.lineTo(size - 60, size - 60 - i * 40);
    ctx.stroke();
  }
}

/** Generate a single branded marker image */
export function generateMarkerCanvas(
  pointId: string,
  coords: MarkerPoint,
  projectName: string
): HTMLCanvasElement {
  const size = 1200;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  const color = MARKER_COLORS[pointId] || MARKER_COLORS.A;

  // 1. Solid background color
  ctx.fillStyle = color.bg;
  ctx.fillRect(0, 0, size, size);

  // 2. White border
  ctx.strokeStyle = "#FFFFFF";
  ctx.lineWidth = 16;
  ctx.strokeRect(30, 30, size - 60, size - 60);

  // 3. Inner border for more features
  ctx.lineWidth = 4;
  ctx.strokeRect(60, 60, size - 120, size - 120);

  // 4. Large letter
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "bold 360px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(pointId, size / 2, size * 0.35);

  // 5. "POINT X" label
  ctx.font = "bold 72px sans-serif";
  ctx.fillText(`POINT ${pointId}`, size / 2, size * 0.55);

  // 6. Marker label/description
  ctx.font = "48px sans-serif";
  ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
  ctx.fillText(coords.label || `Marker ${pointId}`, size / 2, size * 0.63);

  // 7. Coordinates
  ctx.font = "bold 36px monospace";
  ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
  ctx.fillText(
    `(${coords.x}, ${coords.y}, ${coords.z}) mm`,
    size / 2,
    size * 0.72
  );

  // 8. Project name
  ctx.font = "bold 40px sans-serif";
  ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
  ctx.fillText(projectName, size / 2, size * 0.88);

  // 9. "Archi AR" branding
  ctx.font = "28px sans-serif";
  ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
  ctx.fillText("Archi AR", size / 2, size * 0.95);

  // 10. Feature detection patterns
  addFeaturePatterns(ctx, size);

  return canvas;
}

/** Generate all marker images and return as blobs */
export async function generateAllMarkerImages(
  markers: Record<string, MarkerPoint>,
  projectName: string
): Promise<GeneratedMarker[]> {
  const results: GeneratedMarker[] = [];

  for (const [id, coords] of Object.entries(markers)) {
    const canvas = generateMarkerCanvas(id, coords, projectName);
    const dataUrl = canvas.toDataURL("image/png");
    const blob = await new Promise<Blob>((resolve) => {
      canvas.toBlob((b) => resolve(b!), "image/png");
    });

    results.push({ id, canvas, dataUrl, blob });
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
