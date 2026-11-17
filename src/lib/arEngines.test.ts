import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MINDAR_ENABLED, SPATIAL_TRACKING_FORMAT } from "./arEngines";

/**
 * Guard for the 17 Nov 2026 decision: 8th Wall in every mode, MindAR parked
 * and archived, and MindAR never called during the test phase. These checks
 * fail loudly if MindAR is switched back on or an entry point loses its guard.
 */
const root = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

describe("MindAR is off (17 Nov 2026)", () => {
  it("the switch is off and new Spatial experiences are 8th Wall image targets", () => {
    expect(MINDAR_ENABLED).toBe(false);
    expect(SPATIAL_TRACKING_FORMAT).toBe("8thwall-image");
  });

  it("index.html neither preloads nor maps the MindAR runtime", () => {
    const html = read("index.html");
    expect(html).not.toMatch(/mind-ar@/);
    expect(html).not.toMatch(/"mindar-image-three"/);
  });

  it.each([
    ["src/pages/ARViewer.tsx", "Spatial client viewer"],
    ["src/hooks/useMultipointGeneration.ts", ".mind compile at generation"],
    ["src/components/ExperienceWizard.tsx", "MindAR compiler preload"],
    ["src/components/wizard/StepMarkers.tsx", "placement validator (MindAR camera)"],
    ["src/components/GenerateExperience.tsx", "\"Revert to MindAR\""],
  ])("%s guards the %s with MINDAR_ENABLED", (file) => {
    expect(read(file)).toMatch(/MINDAR_ENABLED/);
  });

  it("only guarded entry points (or MindAR's own files) import the MindAR modules", () => {
    const mindarModules = /from\s+["'][^"']*\/(MindARScene|MultipointViewer|MarkerPlacementValidator|compileMindFile|mindarEngine)["']/;
    // MindAR's own files may import each other; everything else must be a guarded entry point.
    const allowed = new Set([
      "src/pages/ARViewer.tsx",
      "src/hooks/useMultipointGeneration.ts",
      "src/components/ExperienceWizard.tsx",
      "src/components/wizard/StepMarkers.tsx",
      "src/components/ar/multipoint/MultipointViewer.tsx",
      "src/components/ar/multipoint/MarkerPlacementValidator.tsx",
      "src/components/ar/multipoint/MindARScene.tsx",
    ]);
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(resolve(root, dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(rel);
        else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
          if (mindarModules.test(read(rel)) && !allowed.has(rel)) offenders.push(rel);
        }
      }
    };
    walk("src");
    expect(offenders).toEqual([]);
  });
});
