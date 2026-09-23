/**
 * Build an 8th Wall image target from the project's printed QR — in the
 * browser, at view time. No compile step and no stored file: an 8th Wall
 * PLANAR target is just a 480×640 (3:4 portrait) greyscale image plus
 * metadata; features are extracted by the engine at load.
 *
 * The QR is square, so it fills the full 480 px width and sits centred in the
 * 640 px height with white above and below (the paper around the printed QR
 * is white too). `physicalWidthInMeters` = the printed QR width, so the
 * target's width in the scene is the QR's real width.
 *
 * The source image MUST be the exact QR that was printed: the stored
 * qr_code.png (signed URL from get-public-project), or a re-render with the
 * shared TABLETOP_QR_OPTIONS as a fallback.
 */
import QRCode from "qrcode";
import { TABLETOP_QR_OPTIONS } from "@/hooks/useTabletopGeneration";
import { buildPublicExperienceUrl } from "@/lib/publicExperienceUrl";

export const TARGET_W = 480;
export const TARGET_H = 640;
export const QR_TARGET_NAME = "archi-qr";

export interface Xr8ImageTargetData {
  imagePath: string;
  name: string;
  type: "PLANAR";
  metadata: null;
  physicalWidthInMeters: number;
  properties: {
    top: number;
    left: number;
    width: number;
    height: number;
    isRotated: boolean;
    originalWidth: number;
    originalHeight: number;
  };
  resources: Record<string, string>;
  created: number;
  updated: number;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load the QR image for tracking."));
    img.src = src;
  });
}

async function qrSource(qrUrl: string | null | undefined, shareId: string): Promise<CanvasImageSource> {
  if (qrUrl) {
    try {
      return await loadImage(qrUrl);
    } catch {
      /* fall through to a deterministic re-render */
    }
  }
  const c = document.createElement("canvas");
  await QRCode.toCanvas(c, buildPublicExperienceUrl(shareId), TABLETOP_QR_OPTIONS);
  return c;
}

export async function buildQrImageTarget(
  qrUrl: string | null | undefined,
  shareId: string,
  qrSizeMm: number,
): Promise<Xr8ImageTargetData> {
  const src = await qrSource(qrUrl, shareId);
  const canvas = document.createElement("canvas");
  canvas.width = TARGET_W;
  canvas.height = TARGET_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, TARGET_W, TARGET_H);
  ctx.imageSmoothingEnabled = false; // keep QR module edges crisp
  ctx.drawImage(src, 0, (TARGET_H - TARGET_W) / 2, TARGET_W, TARGET_W);

  // Luminance (greyscale), as the 8th Wall image-target CLI produces.
  const px = ctx.getImageData(0, 0, TARGET_W, TARGET_H);
  const d = px.data;
  for (let i = 0; i < d.length; i += 4) {
    const y = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    d[i] = d[i + 1] = d[i + 2] = y;
  }
  ctx.putImageData(px, 0, 0);

  const now = Date.now();
  return {
    imagePath: canvas.toDataURL("image/png"),
    name: QR_TARGET_NAME,
    type: "PLANAR",
    metadata: null,
    physicalWidthInMeters: qrSizeMm / 1000,
    properties: {
      top: 0,
      left: 0,
      width: TARGET_W,
      height: TARGET_H,
      isRotated: false,
      originalWidth: TARGET_W,
      originalHeight: TARGET_H,
    },
    resources: {},
    created: now,
    updated: now,
  };
}
