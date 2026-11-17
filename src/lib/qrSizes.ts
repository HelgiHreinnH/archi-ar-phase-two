/**
 * The three printed QR sizes Tabletop/Wall can read (16 Nov 2026).
 *
 * The size is carried IN the QR link (`/view/<id>?q=<mm>`), so each size is a
 * different printed pattern and the viewer knows the real width before the
 * camera starts. Scale and placement depend on it (modelPlacement markerSizeMm,
 * the 8th Wall target's physicalWidthInMeters).
 *
 *   150 mm  full A4 print sheet          → designed round badge
 *   100 mm  designed QR for a deck/slide → designed round badge
 *    50 mm  subtle QR for a printed plan → subtle (code + blue corners + logo)
 *
 * No `q` parameter = a project generated before this feature: 150 mm, plain
 * stored qr_code.png (see xr8QrTarget).
 */
import { buildPublicExperienceUrl } from "@/lib/publicExperienceUrl";
import type { SpatialQrVariant } from "@/lib/spatial/qr";

export const QR_SIZES_MM = [150, 100, 50] as const;
export type QrSizeMm = (typeof QR_SIZES_MM)[number];
export const DEFAULT_QR_SIZE_MM: QrSizeMm = 150;

export function isQrSizeMm(n: number): n is QrSizeMm {
  return (QR_SIZES_MM as readonly number[]).includes(n);
}

/** `?q=` from a location.search string; null when absent or not one of the three sizes. */
export function qrSizeFromSearch(search: string): QrSizeMm | null {
  const raw = new URLSearchParams(search).get("q");
  const n = raw ? Number(raw) : NaN;
  return isQrSizeMm(n) ? n : null;
}

/** Share link carrying the printed size. */
export function buildSizedExperienceUrl(shareId: string, sizeMm: QrSizeMm): string {
  return `${buildPublicExperienceUrl(shareId)}?q=${sizeMm}`;
}

/** Design used for a size: the 50 mm print is the subtle code, the others the round badge. */
export function qrVariantForSize(sizeMm: QrSizeMm): SpatialQrVariant {
  return sizeMm === 50 ? "subtle" : "round";
}
