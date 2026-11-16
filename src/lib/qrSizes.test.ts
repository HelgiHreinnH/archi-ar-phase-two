// @vitest-environment node
import { describe, expect, it } from "vitest";
import { qrSizeFromSearch, qrVariantForSize, buildSizedExperienceUrl } from "@/lib/qrSizes";
import { computeModelPlacement } from "@/lib/modelPlacement";
import { spatialQrSvg } from "@/lib/spatial/qr";

describe("QR sizes", () => {
  it("reads ?q= only for 50 / 100 / 150", () => {
    expect(qrSizeFromSearch("?q=50")).toBe(50);
    expect(qrSizeFromSearch("?x=1&q=100")).toBe(100);
    expect(qrSizeFromSearch("?q=150")).toBe(150);
    expect(qrSizeFromSearch("?q=75")).toBeNull();
    expect(qrSizeFromSearch("?q=abc")).toBeNull();
    expect(qrSizeFromSearch("")).toBeNull();
  });

  it("maps size to design: 50 subtle, 100/150 round", () => {
    expect(qrVariantForSize(50)).toBe("subtle");
    expect(qrVariantForSize(100)).toBe("round");
    expect(qrVariantForSize(150)).toBe("round");
  });

  it("each size is a different link and a different printed pattern", () => {
    const urls = ([150, 100, 50] as const).map((s) => buildSizedExperienceUrl("abc", s));
    expect(new Set(urls).size).toBe(3);
    expect(urls[1]).toMatch(/\/view\/abc\?q=100$/);
    const svgs = new Set(urls.map((u, i) => spatialQrSvg(u, i === 2 ? "subtle" : "round")));
    expect(svgs.size).toBe(3);
  });

  it("keeps the model's real size whatever the QR width (scale is in QR-width units)", () => {
    const real = (qr: number) => {
      const p = computeModelPlacement(10_000, qr, 50); // 10 m model, 1:50
      return p.scale * qr * 50; // marker units × QR width × denominator
    };
    expect(real(100)).toBeCloseTo(real(150), 6);
    expect(real(50)).toBeCloseTo(real(150), 6);
  });
});
