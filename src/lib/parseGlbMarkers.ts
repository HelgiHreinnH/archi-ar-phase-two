import * as THREE from "three";
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
 * Extracts the world-space position of a THREE.Object3D.
 *
 * WHY THIS EXISTS:
 * Rhino's GLB exporter vertex-bakes all geometry — node.translation stays at
 * [0,0,0] and the actual world position is encoded directly into mesh vertex
 * data. Reading obj.getWorldPosition() therefore always returns (0,0,0) for
 * Rhino exports, regardless of where the object was placed in the scene.
 *
 * FIX: For mesh objects, compute the bounding-box centroid of the geometry
 * (which IS at the true world position for vertex-baked exports) and apply the
 * node's world matrix so that any parent transforms are still respected.
 * For empty/non-mesh nodes we fall back to getWorldPosition() as before, which
 * remains correct for non-Rhino exporters that use proper node transforms.
 */
function getObjectPosition(obj: THREE.Object3D): THREE.Vector3 {
  const mesh = obj as THREE.Mesh;
  if (mesh.isMesh && mesh.geometry) {
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox;
    if (box) {
      const center = new THREE.Vector3();
      box.getCenter(center);
      // Apply world matrix — handles parent transforms from non-Rhino exporters.
      // For Rhino (all matrices = identity) this is a no-op and center already
      // holds the correct world position.
      center.applyMatrix4(mesh.matrixWorld);
      return center;
    }
  }
  // Fallback for empty/non-mesh nodes (standard non-Rhino glTF exporters)
  obj.updateWorldMatrix(true, false);
  return obj.getWorldPosition(new THREE.Vector3());
}

/**
 * Parses a GLB file and looks for objects named marker_1 through marker_20
 * (case-insensitive, spaces/hyphens normalised to underscores).
 * Also supports legacy marker_A/B/C names (remapped to 1/2/3).
 * Returns sorted MarkerPoint[] or null if fewer than 3 found.
 *
 * RHINO WORKFLOW NOTE:
 * Rhino's GLB exporter silently drops Point objects — they do not appear as
 * nodes in the exported file. Use small mesh objects (e.g. Sphere r=0.001)
 * named marker_1, marker_2, marker_3 instead. At 1 mm they are invisible in
 * the AR view but export correctly and are detected by this parser.
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
            const pos = getObjectPosition(obj);
            found.set(LEGACY_MAP[name], {
              x: parseFloat(pos.x.toFixed(4)),
              y: parseFloat(pos.y.toFixed(4)),
              z: parseFloat(pos.z.toFixed(4)),
            });
            return;
          }

          // Check marker_N pattern
          const match = name.match(/^marker_(\d+)$/);
          if (match) {
            const idx = parseInt(match[1], 10);
            if (idx >= 1 && idx <= MAX_MARKERS) {
              const pos = getObjectPosition(obj);
              found.set(idx, {
                x: parseFloat(pos.x.toFixed(4)),
                y: parseFloat(pos.y.toFixed(4)),
                z: parseFloat(pos.z.toFixed(4)),
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
