/**
 * Generates an A4 print sheet PDF for tabletop AR projects.
 *
 * Layout (portrait A4):
 * - Header bar with project name
 * - Two columns: QR Code (left) | AR Reference Image (right)
 * - Step labels below each image
 * - Instructions section
 * - Footer branding
 */

import { jsPDF } from "jspdf";
import QRCode from "qrcode";

export async function downloadTabletopPrintSheet(
  projectName: string,
  shareUrl: string,
  arReferenceImageUrl: string
): Promise<void> {
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  const pageW = 210;
  const pageH = 297;
  const margin = 14;
  const contentW = pageW - margin * 2;

  // ── Colours ──
  const BLACK: [number, number, number] = [18, 18, 18];
  const WHITE: [number, number, number] = [255, 255, 255];
  const LIGHT_GREY: [number, number, number] = [245, 245, 245];
  const MID_GREY: [number, number, number] = [120, 120, 120];

  // ── Header bar ──
  const headerH = 22;
  pdf.setFillColor(...BLACK);
  pdf.rect(0, 0, pageW, headerH, "F");

  pdf.setTextColor(...WHITE);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);
  pdf.text(projectName.toUpperCase(), pageW / 2, headerH / 2 + 2.5, { align: "center" });

  pdf.setFontSize(7.5);
  pdf.setFont("helvetica", "normal");
  pdf.text("TABLETOP AR EXPERIENCE — PRINT SHEET", pageW / 2, headerH / 2 + 8, { align: "center" });

  // ── Two-column image area ──
  const colGap = 8;
  const colW = (contentW - colGap) / 2;
  const imgY = headerH + 10;
  const imgSize = colW; // square images

  // Left column: QR Code
  const qrCanvas = document.createElement("canvas");
  await QRCode.toCanvas(qrCanvas, shareUrl, {
    width: 600,
    margin: 2,
    color: { dark: "#121212", light: "#ffffff" },
  });
  const qrDataUrl = qrCanvas.toDataURL("image/png");

  // Card background for QR
  pdf.setFillColor(...LIGHT_GREY);
  pdf.roundedRect(margin, imgY, colW, imgSize + 22, 3, 3, "F");
  pdf.addImage(qrDataUrl, "PNG", margin + 4, imgY + 4, colW - 8, imgSize - 8);

  // Label below QR
  pdf.setTextColor(...BLACK);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.text("STEP 1 — SCAN TO LAUNCH", margin + colW / 2, imgY + imgSize + 2, { align: "center" });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7.5);
  pdf.setTextColor(...MID_GREY);
  pdf.text("Scan with your phone camera", margin + colW / 2, imgY + imgSize + 8, { align: "center" });

  // Right column: AR Reference Image
  const rightX = margin + colW + colGap;

  // Load the AR reference image
  const arImg = await loadImageAsDataUrl(arReferenceImageUrl);

  pdf.setFillColor(...LIGHT_GREY);
  pdf.roundedRect(rightX, imgY, colW, imgSize + 22, 3, 3, "F");
  pdf.addImage(arImg, "PNG", rightX + 4, imgY + 4, colW - 8, imgSize - 8);

  // Label below AR image
  pdf.setTextColor(...BLACK);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.text("STEP 2 — POINT CAMERA HERE", rightX + colW / 2, imgY + imgSize + 2, { align: "center" });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7.5);
  pdf.setTextColor(...MID_GREY);
  pdf.text("Point your camera at this marker", rightX + colW / 2, imgY + imgSize + 8, { align: "center" });

  // ── Divider ──
  const divY = imgY + imgSize + 28;
  pdf.setDrawColor(...LIGHT_GREY);
  pdf.setLineWidth(0.4);
  pdf.line(margin, divY, pageW - margin, divY);

  // ── Instructions ──
  const instrY = divY + 8;
  pdf.setTextColor(...BLACK);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);
  pdf.text("HOW TO USE", margin, instrY);

  const steps = [
    "1.  Print both images on this sheet at full size.",
    "2.  Place the AR Marker flat on the surface where you want the model to appear.",
    "3.  Scan the QR Code with your phone camera to open the AR experience.",
    "4.  Tap Launch AR, then point your phone camera at the AR Marker.",
    "5.  The 3D model will appear anchored to the marker.",
  ];

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8.5);
  pdf.setTextColor(...BLACK);

  let lineY = instrY + 7;
  for (const step of steps) {
    pdf.text(step, margin + 2, lineY);
    lineY += 6.5;
  }

  // ── Tip box ──
  const tipY = lineY + 4;
  pdf.setFillColor(...LIGHT_GREY);
  pdf.roundedRect(margin, tipY, contentW, 14, 2, 2, "F");
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(7.5);
  pdf.setTextColor(...MID_GREY);
  pdf.text(
    "TIP: For best tracking, print the AR Marker at A5 size or larger and place it on a flat, well-lit surface.",
    margin + 4,
    tipY + 5.5
  );
  pdf.setFont("helvetica", "normal");
  pdf.text(
    "Avoid glossy paper. Keep the marker fully visible and unobstructed during the AR session.",
    margin + 4,
    tipY + 10
  );

  // ── URL strip ──
  const urlY = tipY + 20;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7);
  pdf.setTextColor(...MID_GREY);
  pdf.text(`AR Experience URL: ${shareUrl}`, margin, urlY);

  // ── Footer ──
  pdf.setFillColor(...BLACK);
  pdf.rect(0, pageH - 12, pageW, 12, "F");
  pdf.setTextColor(...WHITE);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7);
  pdf.text("Generated by Archisparkle AR Platform", pageW / 2, pageH - 5, { align: "center" });

  pdf.save(`${projectName.replace(/\s+/g, "_")}_AR_PrintSheet.pdf`);
}

/**
 * Load a remote image URL as a base64 data URL (handles CORS via fetch).
 */
async function loadImageAsDataUrl(url: string): Promise<string> {
  const response = await fetch(url);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
