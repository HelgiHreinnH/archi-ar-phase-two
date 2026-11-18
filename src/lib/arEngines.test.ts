import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SPATIAL_TRACKING_FORMAT } from "./arEngines";

/**
 * Guard for the 17 Nov 2026 decision (8th Wall in every mode, MindAR parked
 * and archived) and the 18 Nov phase 3 (MindAR out of the app). These checks
 * fail loudly if MindAR finds its way back into the build.
 */
const root = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

const sourceFiles = (dir: string): string[] => {
  const out: string[] = [];
  for (const e of readdirSync(resolve(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...sourceFiles(rel));
    else if (/\.(ts|tsx|js)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(rel);
  }
  return out;
};

describe("MindAR is archived, 8th Wall is the engine (17–18 Nov 2026)", () => {
  it("new Spatial experiences are 8th Wall image targets", () => {
    expect(SPATIAL_TRACKING_FORMAT).toBe("8thwall-image");
  });

  it("mind-ar is not a dependency", () => {
    const pkg = JSON.parse(read("package.json"));
    expect({ ...pkg.dependencies, ...pkg.devDependencies }).not.toHaveProperty("mind-ar");
  });

  it("index.html neither preloads nor maps the MindAR runtime", () => {
    const html = read("index.html");
    expect(html).not.toMatch(/mind-ar@/);
    expect(html).not.toMatch(/"mindar-image-three"/);
  });

  it("no app source loads MindAR or imports the archived MindAR modules", () => {
    const loadsMindAR = /mind-ar@|mindar-image|from\s+["'][^"']*\/(MindARScene|MultipointViewer|MarkerPlacementValidator|compileMindFile|mindarEngine|sriError|arGyro|computeWorldTransform)["']|archive\/mindar\/src/;
    const offenders = sourceFiles("src").filter((f) => loadsMindAR.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it("the archived copy is kept (archived, not deleted)", () => {
    expect(existsSync(resolve(root, "archive/mindar/README.md"))).toBe(true);
    expect(existsSync(resolve(root, "archive/mindar/src/components/ar/multipoint/MindARScene.tsx"))).toBe(true);
  });
});
