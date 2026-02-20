import { useEffect, useRef, useCallback, useState } from "react";

interface MindARSceneProps {
  /** URL of the .mind compiled image target file */
  imageTargetSrc: string;
  /** URL of the .glb model to render on the anchor */
  modelUrl?: string | null;
  /**
   * "tabletop" — 1 marker, model floats above table surface.
   * "multipoint" (anything else) — 3 markers, model sits at floor level on anchor 0.
   */
  mode?: string;
  /** Number of image targets in the .mind file — derived from mode by caller */
  maxTrack?: number;
  /** Called when a target is found (index) */
  onTargetFound?: (index: number) => void;
  /** Called when a target is lost (index) */
  onTargetLost?: (index: number) => void;
  /** Called when MindAR is ready and running */
  onReady?: () => void;
  /** Called on error */
  onError?: (error: Error) => void;
  /**
   * Scale denominator. The model is assumed to be built 1:1 in millimetres.
   * e.g. 1 = true size, 50 = 1:50 scale, 100 = 1:100 scale.
   */
  modelScale?: number;
  /** Initial Y rotation in degrees */
  initialRotation?: number;
}


const THREE_ESM_URL =
  "https://unpkg.com/three@0.160.0/build/three.module.js";
const GLTF_LOADER_URL = "three/addons/loaders/GLTFLoader.js";
const MINDAR_THREE_URL =
  "https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-three.prod.js";

/**
 * Physical size of the printed AR marker in millimetres.
 * 1 MindAR unit ≈ 1 marker width. Used to convert real-world mm to scene units.
 */
const MARKER_SIZE_MM = 150;

/**
 * Float height above the marker plane in MindAR scene units.
 * 1 MindAR unit = MARKER_SIZE_MM (150mm) in real space.
 * To float 40mm: 40 / 150 ≈ 0.267 units.
 * (The old value 0.04 was only ~6mm — a comment/constant mismatch.)
 */
const FLOAT_ABOVE_MARKER = 0.267;

async function loadMindAR(): Promise<void> {
  if ((window as any).MINDAR?.IMAGE?.MindARThree) return;
  await import(/* @vite-ignore */ MINDAR_THREE_URL);
  if (!(window as any).MINDAR?.IMAGE?.MindARThree) {
    throw new Error("MindAR module loaded but runtime not found on window.MINDAR");
  }
}

const MindARScene = ({
  imageTargetSrc,
  modelUrl,
  mode = "tabletop",
  maxTrack = 1,
  onTargetFound,
  onTargetLost,
  onReady,
  onError,
  modelScale = 1,
  initialRotation = 0,
}: MindARSceneProps) => {
  const isTabletop = mode === "tabletop";
  // Tabletop: 1 marker, model floats 40mm above table surface.
  // Multi-point: 3 markers (A/B/C), model sits flush at marker-A floor plane.
  const floatAboveMarker = isTabletop ? FLOAT_ABOVE_MARKER : 0;

  const containerRef = useRef<HTMLDivElement>(null);
  const mindarRef = useRef<any>(null);
  const [isStarting, setIsStarting] = useState(true);

  const onTargetFoundRef = useRef(onTargetFound);
  const onTargetLostRef = useRef(onTargetLost);
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onTargetFoundRef.current = onTargetFound;
    onTargetLostRef.current = onTargetLost;
    onReadyRef.current = onReady;
    onErrorRef.current = onError;
  }, [onTargetFound, onTargetLost, onReady, onError]);

  const startAR = useCallback(async () => {
    if (!containerRef.current) return;

    try {
      if (!window.isSecureContext) {
        throw new Error("Camera requires a secure (HTTPS) connection.");
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Your browser does not support camera access.");
      }

      await loadMindAR();

      const MINDAR = (window as any).MINDAR;
      let ThreeLib = (window as any).THREE;
      if (!ThreeLib) {
        ThreeLib = await import(/* @vite-ignore */ THREE_ESM_URL);
      }

      if (!MINDAR?.IMAGE?.MindARThree) {
        throw new Error("MindAR not available after loading");
      }

      // Assign a stable ID so our injected CSS can target it
      const containerId = "mindar-ar-container";
      containerRef.current.id = containerId;

      // ─── Inject persistent CSS to override MindAR's inline pixel styles ───
      // MindAR sets width/height in pixels via JS style attributes.
      // A <style> tag with !important beats inline styles in all browsers.
      const styleTag = document.createElement("style");
      styleTag.id = "mindar-fill-style";
      styleTag.textContent = `
        #${containerId} { position: fixed !important; inset: 0 !important; width: 100% !important; height: 100% !important; overflow: hidden !important; }
        #${containerId} canvas { position: absolute !important; top: 0 !important; left: 0 !important; width: 100% !important; height: 100% !important; object-fit: cover !important; }
        #${containerId} video  { position: absolute !important; top: 0 !important; left: 0 !important; width: 100% !important; height: 100% !important; object-fit: cover !important; }
      `;
      document.head.appendChild(styleTag);

      const mindarThree = new MINDAR.IMAGE.MindARThree({
        container: containerRef.current,
        imageTargetSrc,
        maxTrack,
        uiLoading: "no",
        uiScanning: "no",
        uiError: "no",
      });

      mindarRef.current = mindarThree;

      const { renderer, scene, camera } = mindarThree;

      // Setup lighting
      const ambientLight = new ThreeLib.AmbientLight(0xffffff, 0.8);
      scene.add(ambientLight);
      const directionalLight = new ThreeLib.DirectionalLight(0xffffff, 1.2);
      directionalLight.position.set(5, 10, 7.5);
      directionalLight.castShadow = true;
      scene.add(directionalLight);

      // ── Create anchors ───────────────────────────────────────────────────────
      // Tabletop mode:    1 anchor (index 0) — single AR reference marker.
      // Multi-point mode: 3 anchors (index 0=A, 1=B, 2=C) — three position markers.
      // The GLB model is ONLY loaded onto anchor 0 in both modes.
      // Anchors 1 and 2 (multi-point only) are tracking-only — they trigger the
      // status UI callbacks but do not carry any 3D content.
      for (let i = 0; i < maxTrack; i++) {
        const anchor = mindarThree.addAnchor(i);

        // Load GLB model onto anchor 0 only
        if (i === 0 && modelUrl) {
          let model: any = null;
          // lastKnownMatrix: updated every frame by onTargetUpdate while tracking.
          // Used to freeze the model in world space when the marker is lost.
          const lastKnownMatrix = new ThreeLib.Matrix4();
          let isWorldPlaced = false;   // true once the model has been frozen into scene space
          let isMatrixValid = false;   // true once onTargetUpdate has written at least one real pose
          let updateFrameCount = 0;    // counts frames since last target found — guards cold-start

          try {
            const { GLTFLoader } = await import(/* @vite-ignore */ GLTF_LOADER_URL);
            const loader = new GLTFLoader();
            const gltf = await new Promise<any>((resolve, reject) => {
              loader.load(modelUrl, resolve, undefined, reject);
            });
            model = gltf.scene;

            // ── Scale calculation ──────────────────────────────────────────
            // Models are built 1:1 in millimetres.
            // MindAR unit ≈ MARKER_SIZE_MM (physical marker width in mm).
            // At scale 1:N, real dimensions shrink by factor N.
            const box = new ThreeLib.Box3().setFromObject(model);
            const size = box.getSize(new ThreeLib.Vector3());
            const center = box.getCenter(new ThreeLib.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            const normalizedScale = (MARKER_SIZE_MM / modelScale) / maxDim;

            model.scale.set(normalizedScale, normalizedScale, normalizedScale);

            // Position: centred X/Z on marker.
            // Tabletop: float 40mm above marker surface so model sits on the table.
            // Multi-point: sit flush at marker plane (floor level at marker A).
            model.position.x = -center.x * normalizedScale;
            model.position.y = -box.min.y * normalizedScale + floatAboveMarker;
            model.position.z = -center.z * normalizedScale;

            // Apply initial rotation (compass direction)
            if (initialRotation) {
              model.rotation.y = ThreeLib.MathUtils.degToRad(initialRotation);
            }

            // Save local-space transform so we can restore it when re-attaching
            const localPos = model.position.clone();
            const localQuat = model.quaternion.clone();
            const localScale = model.scale.clone();

            // Standard MindAR way: model lives inside anchor.group
            anchor.group.add(model);

            // ── onTargetUpdate: fires every frame MindAR has a valid pose ──────
            // MindAR writes anchor.group.matrix with the live tracking pose immediately
            // BEFORE this callback fires — so it is always valid here (never the zero matrix).
            // We compute lastKnownMatrix by direct multiplication to bypass Three.js
            // matrixWorld propagation timing entirely.
            anchor.onTargetUpdate = () => {
              if (model && !isWorldPlaced) {
                updateFrameCount++;

                // Force model's local matrix to be current from position/quat/scale.
                // Three.js defers this normally until renderer.render() — we need it now.
                model.updateMatrix();

                // Build the world matrix by directly multiplying:
                //   anchor.group.matrix  (MindAR's live camera-relative pose — just written)
                // × model.matrix         (model's local offset within the anchor group)
                // This is equivalent to matrixWorld but has zero timing dependency.
                lastKnownMatrix.copy(anchor.group.matrix).multiply(model.matrix);

                // Mark the matrix as valid after a short stabilisation window.
                // This prevents the cold-start race where onTargetLost fires
                // on the very first frame before onTargetUpdate has run.
                if (!isMatrixValid && updateFrameCount >= 3) {
                  isMatrixValid = true;
                }
              }
            };

            // ── onTargetFound: MindAR has already set anchor.group.matrix ─
            anchor.onTargetFound = () => {
              if (model && isWorldPlaced) {
                // Model was frozen in scene space — move it back into the anchor
                // group so it tracks the marker again.
                scene.remove(model);
                model.matrixAutoUpdate = true;
                anchor.group.add(model);

                // Restore the model's local transforms inside the anchor group
                model.position.set(localPos.x, localPos.y, localPos.z);
                model.quaternion.copy(localQuat);
                model.scale.set(localScale.x, localScale.y, localScale.z);

                // Force model.matrix to reflect position/quat/scale RIGHT NOW,
                // before onTargetUpdate fires in the same MindAR frame.
                // Without this, onTargetUpdate would sample the stale frozen matrix.
                model.updateMatrix();

                isWorldPlaced = false;
                // Reset frame counter — give the tracker a few frames to stabilise
                // before we allow onTargetLost to freeze at a new position.
                updateFrameCount = 0;
                isMatrixValid = false;
              }
              onTargetFoundRef.current?.(i);
            };

            // ── onTargetLost: anchor.group.matrix is NOW the invisible zero matrix ─
            // Use lastKnownMatrix (sampled by onTargetUpdate the frame before loss)
            // to freeze the model in place in scene space.
            anchor.onTargetLost = () => {
              // Guard: only freeze if we have captured a valid pose.
              // If the matrix is not yet valid (cold start / re-scan before stabilisation),
              // skip the freeze — the model stays inside the anchor group (invisible) rather
              // than being placed at world origin (which looks broken).
              if (model && !isWorldPlaced && isMatrixValid) {
                anchor.group.remove(model);
                scene.add(model);

                // Copy the last valid camera-relative pose into model.matrix.
                // With matrixAutoUpdate = false, Three.js uses model.matrix directly
                // for rendering — position/quaternion/scale are ignored.
                model.matrix.copy(lastKnownMatrix);
                model.matrixAutoUpdate = false;
                isWorldPlaced = true;
              }
              onTargetLostRef.current?.(i);
            };

          } catch (loadError) {
            console.warn("Failed to load GLB model:", loadError);
            anchor.onTargetFound = () => onTargetFoundRef.current?.(i);
            anchor.onTargetLost = () => onTargetLostRef.current?.(i);
          }
        } else {
          // Anchors 1 (B) and 2 (C) — multi-point mode only.
          // These are tracking-only anchors: they update the detection UI
          // status but carry no 3D model. No world-anchoring logic needed.
          anchor.onTargetFound = () => onTargetFoundRef.current?.(i);
          anchor.onTargetLost = () => onTargetLostRef.current?.(i);
        }
      }

      // Start MindAR (requests camera, loads target)
      await mindarThree.start();
      setIsStarting(false);
      onReadyRef.current?.();

      // Render loop — pose sampling is handled by anchor.onTargetUpdate,
      // so the animation loop only needs to render the scene.
      renderer.setAnimationLoop(() => {
        renderer.render(scene, camera);
      });
    } catch (err) {
      console.error("MindAR initialization error:", err);
      setIsStarting(false);
      onErrorRef.current?.(err instanceof Error ? err : new Error(String(err)));
    }
  }, [imageTargetSrc, modelUrl, mode, maxTrack, modelScale, initialRotation]);

  useEffect(() => {
    startAR();

    return () => {
      // Clean up injected style tag
      document.getElementById("mindar-fill-style")?.remove();

      if (mindarRef.current) {
        try {
          mindarRef.current.stop();
        } catch {
          // Ignore cleanup errors
        }
        mindarRef.current = null;
      }
    };
  }, [startAR]);

  return (
    <div
      ref={containerRef}
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        overflow: "hidden",
        zIndex: 0,
      }}
    />
  );
};

export default MindARScene;
