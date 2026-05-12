/**
 * Track A — Three.js teardown helper.
 *
 * The audit (May 12, 2026) showed JS heap at 98% capacity (253MB / 258MB)
 * because navigating between AR experiences kept stacking renderers,
 * geometries, materials, and textures with nothing freeing them. This util
 * walks a scene graph and releases every GPU resource it touches.
 */

type AnyRenderer = {
  dispose?: () => void;
  forceContextLoss?: () => void;
  domElement?: HTMLCanvasElement;
};

type AnyMaterial = {
  dispose?: () => void;
  // Texture-bearing properties commonly attached to MeshStandardMaterial etc.
  map?: { dispose?: () => void } | null;
  normalMap?: { dispose?: () => void } | null;
  roughnessMap?: { dispose?: () => void } | null;
  metalnessMap?: { dispose?: () => void } | null;
  aoMap?: { dispose?: () => void } | null;
  emissiveMap?: { dispose?: () => void } | null;
  bumpMap?: { dispose?: () => void } | null;
  displacementMap?: { dispose?: () => void } | null;
  alphaMap?: { dispose?: () => void } | null;
  envMap?: { dispose?: () => void } | null;
  lightMap?: { dispose?: () => void } | null;
};

type AnyObject3D = {
  parent?: AnyObject3D | null;
  children?: AnyObject3D[];
  geometry?: { dispose?: () => void } | null;
  material?: AnyMaterial | AnyMaterial[] | null;
  traverse?: (cb: (obj: AnyObject3D) => void) => void;
  remove?: (child: AnyObject3D) => void;
};

const TEXTURE_KEYS: (keyof AnyMaterial)[] = [
  "map", "normalMap", "roughnessMap", "metalnessMap", "aoMap",
  "emissiveMap", "bumpMap", "displacementMap", "alphaMap", "envMap", "lightMap",
];

function disposeMaterial(mat: AnyMaterial | null | undefined) {
  if (!mat) return;
  for (const k of TEXTURE_KEYS) {
    const tex = mat[k] as { dispose?: () => void } | null | undefined;
    try { tex?.dispose?.(); } catch { /* noop */ }
  }
  try { mat.dispose?.(); } catch { /* noop */ }
}

/** Recursively dispose every geometry/material/texture in a scene. */
export function disposeScene(root: AnyObject3D | null | undefined) {
  if (!root?.traverse) return;
  root.traverse((obj) => {
    try { obj.geometry?.dispose?.(); } catch { /* noop */ }
    if (Array.isArray(obj.material)) {
      obj.material.forEach(disposeMaterial);
    } else if (obj.material) {
      disposeMaterial(obj.material);
    }
  });
}

/** Dispose the renderer, drop the GL context, and detach its canvas. */
export function disposeRenderer(renderer: AnyRenderer | null | undefined) {
  if (!renderer) return;
  try { renderer.dispose?.(); } catch { /* noop */ }
  try { renderer.forceContextLoss?.(); } catch { /* noop */ }
  try { renderer.domElement?.parentNode?.removeChild(renderer.domElement); } catch { /* noop */ }
}

/** Convenience: full teardown of (scene, renderer) plus optional camera detach. */
export function teardownThree(
  scene: AnyObject3D | null | undefined,
  renderer: AnyRenderer | null | undefined,
) {
  disposeScene(scene);
  disposeRenderer(renderer);
}
