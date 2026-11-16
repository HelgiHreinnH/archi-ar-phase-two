/**
 * Print-ready A4 PDFs for Spatial (multipoint) markers and the client QR page.
 * Layouts live in spatial/sheets.ts (locked design, 16 Nov 2026).
 * Supports N markers with dynamic numbering.
 */
import jsPDF from "jspdf";
import { type MarkerPoint, getSafeMarkerColor } from "@/lib/markerTypes";
import { markerSheetSvg, qrPageSvg } from "@/lib/spatial/sheets";
import { loadSheetFontCss, svgToCanvas } from "@/lib/spatial/raster";

const A4_W = 210;
const A4_H = 297;

function safeFileName(value: string): string {
  return value.trim().replace(/[^a-z0-9._-]+/gi, "_").replace(/^_+|_+$/g, "") || "project";
}

function savePdf(doc: jsPDF, fileName: string) {
  const blob = doc.output("blob");
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

const PAGE_PX_W = 2480; // A4 @ 300 dpi
const PAGE_PX_H = 3508;

/** Rasterise one finished page SVG at 300 dpi and place it full-bleed on the current PDF page. */
async function addPageImage(doc: jsPDF, svg: string): Promise<void> {
  const canvas = await svgToCanvas(svg, PAGE_PX_W, PAGE_PX_H);
  doc.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, A4_W, A4_H, undefined, "FAST");
}

/**
 * One location-marker sheet (Spatial, locked v7): title + logo, disc at exactly
 * 150 mm (= MARKER_SIZE_MM in MindARScene), X/Y/Z, origin row, placement steps,
 * round QR. The disc is drawn from the same SVG as the tracked marker image.
 */
async function addMarkerPage(
  doc: jsPDF,
  marker: MarkerPoint,
  projectName: string,
  shareUrl: string
): Promise<void> {
  const fontCss = await loadSheetFontCss();
  const svg = markerSheetSvg(
    {
      index: marker.index,
      x: marker.x,
      y: marker.y,
      z: marker.z,
      label: marker.label,
      projectName,
      color: getSafeMarkerColor(marker.index).bg,
      shareUrl,
    },
    fontCss
  );
  await addPageImage(doc, svg);
}

/** Client QR page: round QR badge, three steps, placement notes. */
async function addQrPage(doc: jsPDF, projectName: string, shareUrl: string): Promise<void> {
  const fontCss = await loadSheetFontCss();
  await addPageImage(doc, qrPageSvg({ projectName, shareUrl }, fontCss));
}

export async function generateMarkerPDF(
  marker: MarkerPoint,
  projectName: string,
  shareUrl: string
): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  await addMarkerPage(doc, marker, projectName, shareUrl);
  return doc;
}

/** Generate and trigger download of a single marker PDF. */
export async function downloadMarkerPDF(
  marker: MarkerPoint,
  projectName: string,
  shareUrl: string
): Promise<void> {
  const doc = await generateMarkerPDF(marker, projectName, shareUrl);
  savePdf(doc, `Marker_${marker.index}_${safeFileName(projectName)}.pdf`);
}

/** Generate and download all marker PDFs as one multi-page file. */
export async function downloadAllMarkerPDFs(
  markers: MarkerPoint[],
  projectName: string,
  shareUrl: string
): Promise<void> {
  if (!markers.length) return;

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  for (let i = 0; i < markers.length; i++) {
    if (i > 0) doc.addPage("a4", "portrait");
    await addMarkerPage(doc, markers[i], projectName, shareUrl);
  }

  savePdf(doc, `All_Markers_${safeFileName(projectName)}.pdf`);
}

/** Generate and download the client QR page (A4 PDF). */
export async function downloadQrPagePDF(projectName: string, shareUrl: string): Promise<void> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  await addQrPage(doc, projectName, shareUrl);
  savePdf(doc, `QR_${safeFileName(projectName)}.pdf`);
}
