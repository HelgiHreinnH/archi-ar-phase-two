/**
 * Spatial engine adapter registry.
 *
 * 17 Nov 2026: 8th Wall is the engine in every mode, so the 8th Wall adapter is
 * wired in on `main` and used by the production viewer (SpatialWorldViewer) and
 * the lab page. Zappar and Immersal were closed with the bake-off (branches
 * archive/spatial-zappar, archive/spatial-immersal) and return null.
 */
import type { LabEngine } from "@/lib/lab";
import type { SpatialTracker } from "./SpatialTracker";

export async function loadSpatialAdapter(engine: LabEngine): Promise<SpatialTracker | null> {
  switch (engine) {
    case "8thwall": {
      // spatial-8thwall branch: 8th Wall engine binary, image targets inside SLAM.
      const { create8thWallTracker } = await import("./adapter8thWall");
      return create8thWallTracker();
    }
    case "zappar":
    case "immersal":
    default:
      return null;
  }
}
