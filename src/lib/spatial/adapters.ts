/**
 * Engine adapter registry for the Spatial lab.
 *
 * On `main` no engine is wired in: the lab page says so and production is
 * untouched. Each `spatial-*` branch replaces the matching `case` with a lazy
 * import of its adapter. Keep this file tiny so branch merges stay trivial.
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
