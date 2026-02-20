/**
 * Generates a high-contrast, feature-rich AR reference image for tabletop MindAR tracking.
 * 1200x1200px black-and-white geometric pattern optimised for computer vision detection.
 *
 * MindAR requirements:
 * - Minimum 512x512px
 * - High contrast (black/white)
 * - Rich local features — avoid large uniform areas
 * - Unique enough to distinguish from background
 */

export interface TabletopMarkerResult {
  canvas: HTMLCanvasElement;
  blob: Blob;
  dataUrl: string;
}

export async function generateTabletopMarkerImage(
  projectName: string
): Promise<TabletopMarkerResult> {
  const SIZE = 1200;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;

  const W = SIZE;
  const H = SIZE;
  const CX = W / 2;
  const CY = H / 2;

  // ── Background: white ──
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, W, H);

  // ── Outer border (thick black frame) ──
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 28;
  ctx.strokeRect(14, 14, W - 28, H - 28);

  // ── Second border (thin, inset) ──
  ctx.lineWidth = 6;
  ctx.strokeRect(52, 52, W - 104, H - 104);

  // ── Corner finder squares (like QR corner blocks) ──
  const cornerSize = 120;
  const cornerInner = 72;
  const cornerPad = 72;
  const corners = [
    [cornerPad, cornerPad],
    [W - cornerPad - cornerSize, cornerPad],
    [cornerPad, H - cornerPad - cornerSize],
    [W - cornerPad - cornerSize, H - cornerPad - cornerSize],
  ] as const;

  for (const [cx, cy] of corners) {
    // Outer filled square
    ctx.fillStyle = "#000000";
    ctx.fillRect(cx, cy, cornerSize, cornerSize);
    // White inner
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(cx + 20, cy + 20, cornerSize - 40, cornerSize - 40);
    // Black centre dot
    ctx.fillStyle = "#000000";
    ctx.fillRect(cx + 40, cy + 40, cornerSize - 80, cornerSize - 80);
  }

  // ── Diagonal cross lines (full canvas) ──
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(72 + cornerSize + 20, 72 + cornerSize + 20);
  ctx.lineTo(W - 72 - cornerSize - 20, H - 72 - cornerSize - 20);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(W - 72 - cornerSize - 20, 72 + cornerSize + 20);
  ctx.lineTo(72 + cornerSize + 20, H - 72 - cornerSize - 20);
  ctx.stroke();

  // ── Concentric rings at centre ──
  for (let r = 220; r >= 40; r -= 36) {
    ctx.beginPath();
    ctx.arc(CX, CY, r, 0, Math.PI * 2);
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = r > 100 ? 8 : 6;
    ctx.stroke();
  }

  // ── Central filled circle ──
  ctx.beginPath();
  ctx.arc(CX, CY, 22, 0, Math.PI * 2);
  ctx.fillStyle = "#000000";
  ctx.fill();

  // ── Compass arms (horizontal + vertical) ──
  const armLen = 190;
  const armW = 12;
  ctx.fillStyle = "#000000";
  // Top
  ctx.fillRect(CX - armW / 2, CY - 220 - armLen / 2, armW, armLen / 2);
  // Bottom
  ctx.fillRect(CX - armW / 2, CY + 220, armW, armLen / 2);
  // Left
  ctx.fillRect(CX - 220 - armLen / 2, CY - armW / 2, armLen / 2, armW);
  // Right
  ctx.fillRect(CX + 220, CY - armW / 2, armLen / 2, armW);

  // ── Mid-edge tick marks ──
  const tickLen = 40;
  const tickW = 10;
  const pad = 80;
  // Top edge
  ctx.fillRect(CX - tickW / 2, pad, tickW, tickLen);
  // Bottom edge
  ctx.fillRect(CX - tickW / 2, H - pad - tickLen, tickW, tickLen);
  // Left edge
  ctx.fillRect(pad, CY - tickW / 2, tickLen, tickW);
  // Right edge
  ctx.fillRect(W - pad - tickLen, CY - tickW / 2, tickLen, tickW);

  // ── Feature dots at 45° positions (between corners and centre) ──
  const dotRadius = 18;
  const dotOffset = 320;
  const dotPositions = [
    [CX - dotOffset, CY - dotOffset],
    [CX + dotOffset, CY - dotOffset],
    [CX - dotOffset, CY + dotOffset],
    [CX + dotOffset, CY + dotOffset],
    [CX, CY - dotOffset - 20],
    [CX, CY + dotOffset + 20],
    [CX - dotOffset - 20, CY],
    [CX + dotOffset + 20, CY],
  ] as const;

  for (const [dx, dy] of dotPositions) {
    ctx.beginPath();
    ctx.arc(dx, dy, dotRadius, 0, Math.PI * 2);
    ctx.fillStyle = "#000000";
    ctx.fill();
  }

  // ── Small grid pattern in upper-right quadrant area (adds texture) ──
  const gridX = CX + 80;
  const gridY = 80;
  const gridW = 200;
  const gridH = 200;
  const gridStep = 25;
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 3;
  for (let gx = gridX; gx <= gridX + gridW; gx += gridStep) {
    ctx.beginPath();
    ctx.moveTo(gx, gridY);
    ctx.lineTo(gx, gridY + gridH);
    ctx.stroke();
  }
  for (let gy = gridY; gy <= gridY + gridH; gy += gridStep) {
    ctx.beginPath();
    ctx.moveTo(gridX, gy);
    ctx.lineTo(gridX + gridW, gy);
    ctx.stroke();
  }

  // ── Same grid in lower-left quadrant ──
  const gridX2 = W - gridX - gridW;
  const gridY2 = H - gridY - gridH;
  for (let gx = gridX2; gx <= gridX2 + gridW; gx += gridStep) {
    ctx.beginPath();
    ctx.moveTo(gx, gridY2);
    ctx.lineTo(gx, gridY2 + gridH);
    ctx.stroke();
  }
  for (let gy = gridY2; gy <= gridY2 + gridH; gy += gridStep) {
    ctx.beginPath();
    ctx.moveTo(gridX2, gy);
    ctx.lineTo(gridX2 + gridW, gy);
    ctx.stroke();
  }

  // ── "AR MARKER" label ──
  ctx.fillStyle = "#000000";
  ctx.font = "bold 36px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("AR MARKER", CX, H - 115);

  // ── Project name (truncated) ──
  const maxLen = 24;
  const displayName =
    projectName.length > maxLen
      ? projectName.slice(0, maxLen - 1) + "…"
      : projectName;
  ctx.font = "22px monospace";
  ctx.fillText(displayName.toUpperCase(), CX, H - 75);

  // ── Bottom thin separator above text ──
  ctx.fillRect(CX - 200, H - 138, 400, 3);

  // Produce blob and data URL
  const dataUrl = canvas.toDataURL("image/png");
  const blob = await new Promise<Blob>((resolve) => {
    canvas.toBlob((b) => resolve(b!), "image/png");
  });

  return { canvas, blob, dataUrl };
}

/**
 * Convert the AR marker canvas to an HTMLImageElement for the MindAR compiler.
 */
export function markerCanvasToImage(
  canvas: HTMLCanvasElement
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = canvas.toDataURL("image/png");
  });
}
