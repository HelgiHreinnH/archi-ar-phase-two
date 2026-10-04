import { describe, expect, it } from "vitest";
import { formatARTimingLine, getARTimings, markAR, markARRepeat, resetARSessionMarks } from "./arTiming";

describe("arTiming", () => {
  it("records each mark once, in time order", () => {
    markAR("project-fetched");
    markAR("project-fetched"); // ignored
    markAR("tap");
    const names = getARTimings().map((r) => r.name);
    expect(names.filter((n) => n === "project-fetched")).toHaveLength(1);
    expect(names.indexOf("project-fetched")).toBeLessThan(names.indexOf("tap"));
  });

  it("keeps repeatable events apart", () => {
    markARRepeat("camera-recovered");
    markARRepeat("camera-recovered");
    const names = getARTimings().map((r) => r.name);
    expect(names).toContain("camera-recovered#1");
    expect(names).toContain("camera-recovered#2");
  });

  it("formats one line with context and the pass-criteria spans", () => {
    const line = formatARTimingLine(
      [
        { name: "precamera-shown", ms: 1500 },
        { name: "tap", ms: 4000 },
        { name: "model-locked", ms: 9000 },
        { name: "model-visible", ms: 9500 },
      ],
      { engine: "8thwall", mode: "tabletop" },
    );
    expect(line).toBe(
      "[ar-timing] engine=8thwall mode=tabletop precamera-shown=1.50s tap=4.00s model-locked=9.00s " +
        "model-visible=9.50s tap→visible=5.50s tap→locked=5.00s scan→precamera=1.50s",
    );
  });

  it("a new session keeps the page-load marks only", () => {
    markAR("model-visible");
    resetARSessionMarks();
    const names = getARTimings().map((r) => r.name);
    expect(names).toContain("project-fetched");
    expect(names).not.toContain("tap");
    expect(names).not.toContain("model-visible");
  });
});
