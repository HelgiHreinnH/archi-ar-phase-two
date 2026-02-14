import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { MarkerData } from "@/components/MarkerCoordinateEditor";

const MARKER_NAMES = ["marker_a", "marker_b", "marker_c"] as const;
const MARKER_KEYS: Record<(typeof MARKER_NAMES)[number], "A" | "B" | "C"> = {
  marker_a: "A",
  marker_b: "B",
  marker_c: "C",
};

/**
 * Parses a GLB file and looks for objects named marker_A, marker_B, marker_C
 * (case-insensitive). Returns their world positions as MarkerData, or null
 * if not all three are found.
 */
export async function parseGlbMarkers(file: File): Promise<MarkerData | null> {
  const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
  if (ext !== ".glb") return null;

  const buffer = await file.arrayBuffer();
  const loader = new GLTFLoader();

  return new Promise((resolve) => {
    loader.parse(
      buffer,
      "",
      (gltf) => {
        const found: Partial<Record<"A" | "B" | "C", { x: number; y: number; z: number }>> = {};

        gltf.scene.traverse((obj) => {
          const name = obj.name.toLowerCase().replace(/[\s-]/g, "_");
          for (const markerName of MARKER_NAMES) {
            if (name === markerName) {
              // Get world position (accounts for parent transforms)
              obj.updateWorldMatrix(true, false);
              const pos = obj.getWorldPosition(
                new (
                  // Dynamic import to avoid pulling in full THREE at module level
                  obj.position.constructor as new () => typeof obj.position
                )()
              );
              found[MARKER_KEYS[markerName]] = {
                x: Math.round(pos.x),
                y: Math.round(pos.y),
                z: Math.round(pos.z),
              };
            }
          }
        });

        if (found.A && found.B && found.C) {
          resolve({
            A: { ...found.A, label: "Anchor Point" },
            B: { ...found.B, label: "Reference Point" },
            C: { ...found.C, label: "Reference Point" },
          });
        } else {
          resolve(null);
        }
      },
      () => {
        // Parse error — silently return null, user can enter manually
        resolve(null);
      }
    );
  });
}
