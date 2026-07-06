/**
 * Generates an A4 print sheet PDF for tabletop AR projects.
 *
 * The QR code is BOTH the launch link and the AR anchor: the compiled .mind
 * tracking target is built from this exact QR image, and the 3D model locks
 * onto its centre in the AR view.
 *
 * CRITICAL — physical size: MindARScene assumes the printed tracking target is
 * MARKER_SIZE_MM (150mm) wide. The QR on this sheet is laid out at exactly
 * 150 × 150mm, and the sheet must be printed at 100% scale ("actual size")
 * for the model's scale to be correct.
 *
 * Layout (portrait A4):
 * - Header bar with project name
 * - Centred 150mm QR code with cut guides
 * - Instructions section
 * - Footer branding
 */

import { jsPDF } from "jspdf";
import QRCode from "qrcode";
import { TABLETOP_QR_OPTIONS } from "@/hooks/useTabletopGeneration";

/** Must match MARKER_SIZE_MM in MindARScene.tsx */
const QR_PRINT_SIZE_MM = 150;

export async function downloadTabletopPrintSheet(
  projectName: string,
  shareUrl: string
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
  pdf.text("TABLETOP AR EXPERIENCE — PRINT AT 100% / ACTUAL SIZE", pageW / 2, headerH / 2 + 8, { align: "center" });

  // ── Centred QR code at exact physical size ──
  // Rendered with the same options used at generation time so the print
  // matches the compiled .mind tracking target.
  const qrCanvas = document.createElement("canvas");
  await QRCode.toCanvas(qrCanvas, shareUrl, TABLETOP_QR_OPTIONS);
  const qrDataUrl = qrCanvas.toDataURL("image/png");

  const qrX = (pageW - QR_PRINT_SIZE_MM) / 2;
  const qrY = headerH + 14;
  pdf.addImage(qrDataUrl, "PNG", qrX, qrY, QR_PRINT_SIZE_MM, QR_PRINT_SIZE_MM);

  // Corner cut guides around the QR
  pdf.setDrawColor(...MID_GREY);
  pdf.setLineWidth(0.3);
  const g = 6; // guide length
  const o = 3; // offset from QR edge
  const x0 = qrX - o, y0 = qrY - o, x1 = qrX + QR_PRINT_SIZE_MM + o, y1 = qrY + QR_PRINT_SIZE_MM + o;
  // top-left
  pdf.line(x0, y0 + g, x0, y0); pdf.line(x0, y0, x0 + g, y0);
  // top-right
  pdf.line(x1 - g, y0, x1, y0); pdf.line(x1, y0, x1, y0 + g);
  // bottom-left
  pdf.line(x0, y1 - g, x0, y1); pdf.line(x0, y1, x0 + g, y1);
  // bottom-right
  pdf.line(x1 - g, y1, x1, y1); pdf.line(x1, y1 - g, x1, y1);

  // Label below QR
  const labelY = y1 + 7;
  pdf.setTextColor(...BLACK);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.text("SCAN TO LAUNCH — THE MODEL APPEARS ON THIS CODE", pageW / 2, labelY, { align: "center" });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7.5);
  pdf.setTextColor(...MID_GREY);
  pdf.text(`Printed size: ${QR_PRINT_SIZE_MM} × ${QR_PRINT_SIZE_MM} mm — do not scale`, pageW / 2, labelY + 5, { align: "center" });

  // ── Divider ──
  const divY = labelY + 11;
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
    "1.  Print this sheet at 100% scale (no 'fit to page').",
    "2.  Place it flat on the table where the model should appear.",
    "3.  Scan the QR code with a phone or tablet camera to open the experience.",
    "4.  Tap Launch AR, then point the camera back at this QR code.",
    "5.  The 3D model appears anchored to the centre of the code.",
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
    "TIP: Use matte paper on a flat, well-lit surface. Keep the QR code fully visible while viewing.",
    margin + 4,
    tipY + 5.5
  );
  pdf.setFont("helvetica", "normal");
  pdf.text(
    "The model stays locked to the code — move around it to view the design from all sides.",
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
