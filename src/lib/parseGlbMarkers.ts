import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { MarkerPoint } from "@/lib/markerTypes";

const MAX_MARKERS = 20;

/** Legacy name → index mapping */
const LEGACY_MAP: Record<string, number> = {
  marker_a: 1,
  marker_b: 2,
  marker_c: 3,
};

/**
 * Parses a GLB file and looks for objects named marker_1 through marker_20
 * (case-insensitive, spaces/hyphens normalized to underscores).
 * Also supports legacy marker_A/B/C names (remapped to 1/2/3).
 * Returns sorted MarkerPoint[] or null if fewer than 3 found.
 */
export async function parseGlbMarkers(file: File): Promise<MarkerPoint[] | null> {
  const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
  if (ext !== ".glb") return null;

  const buffer = await file.arrayBuffer();
  const loader = new GLTFLoader();

  return new Promise((resolve) => {
    loader.parse(
      buffer,
      "",
      (gltf) => {
        const found = new Map<number, { x: number; y: number; z: number }>();

        gltf.scene.traverse((obj) => {
          const name = obj.name.toLowerCase().replace(/[\s-]/g, "_");

          // Check legacy names first
          if (LEGACY_MAP[name] !== undefined) {
            obj.updateWorldMatrix(true, false);
            const pos = obj.getWorldPosition(
              new (obj.position.constructor as new () => typeof obj.position)()
            );
            found.set(LEGACY_MAP[name], {
              x: Math.round(pos.x),
              y: Math.round(pos.y),
              z: Math.round(pos.z),
            });
            return;
          }

          // Check marker_N pattern
          const match = name.match(/^marker_(\d+)$/);
          if (match) {
            const idx = parseInt(match[1], 10);
            if (idx >= 1 && idx <= MAX_MARKERS) {
              obj.updateWorldMatrix(true, false);
              const pos = obj.getWorldPosition(
                new (obj.position.constructor as new () => typeof obj.position)()
              );
              found.set(idx, {
                x: Math.round(pos.x),
                y: Math.round(pos.y),
                z: Math.round(pos.z),
              });
            }
          }
        });

        if (found.size < 3) {
          resolve(null);
          return;
        }

        const markers: MarkerPoint[] = Array.from(found.entries())
          .sort(([a], [b]) => a - b)
          .map(([index, pos]) => ({
            index,
            x: pos.x,
            y: pos.y,
            z: pos.z,
            label: `Marker ${index}`,
          }));

        resolve(markers);
      },
      () => {
        resolve(null);
      }
    );
  });
}
