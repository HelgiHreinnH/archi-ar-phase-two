/**
 * Render a single still image of a GLB — the project thumbnail.
 *
 * WHY A STILL: a live WebGL preview of an architectural model is the most
 * fragile thing on the dashboard. The thumbnail is rendered ONCE, at upload
 * time, and everything after that is a plain <img>.
 *
 * WITH TEXTURES (since 16 Nov 2026). The still used to be rendered from a
 * texture-free copy ("clay render"), which made the first thing an architect
 * saw after uploading a kitchen a white box — it read as "my textures are
 * gone". Textures are a core promise of the product, and the upload optimiser
 * already keeps every model inside a GPU texture budget, so the still now
 * shows them:
 *   1. within the budget (every optimised upload) → rendered as is;
 *   2. over it (optimisation switched off, heavy export) → textures are
 *      shrunk to THUMB_TEXTURE_SIZE for this one render;
 *   3. still over it, or the file can't be repacked → clay render, as before.
 * One render, then the context is thrown away, so nothing stays on the GPU.
 */
import * as THREE from "three";
import { measureModel } from "@/lib/modelPlacement";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { fitsTextureBudget, optimizeGlbTextures, stripTextures } from "@/lib/glbFile";
import { dropBrokenNormalMaps } from "@/lib/normalMaps";
import { removeMarkerCarriers } from "@/lib/markerNames";

const DRACO_DECODER_PATH = "/assets/three/jsm/libs/draco/gltf/";
const WIDTH = 1200;
const HEIGHT = 900;
/** Texture size used only when a model is over the budget (case 2 above). */
const THUMB_TEXTURE_SIZE = 1024;

/** The bytes to render: textured whenever the GPU budget allows it. */
async function previewBytes(file: File): Promise<ArrayBuffer> {
  const original = await file.arrayBuffer();
  if (fitsTextureBudget(original)) return original;
  try {
    const small = await optimizeGlbTextures(file, THUMB_TEXTURE_SIZE);
    if (small.changed) {
      const shrunk = await small.file.arrayBuffer();
      if (fitsTextureBudget(shrunk)) return shrunk;
    }
  } catch (err) {
    console.warn("[thumbnail] Could not shrink textures for the preview:", err);
  }
  return stripTextures(original, { keepMaterials: true });
}

function disposeObject(root: THREE.Object3D) {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (!m) continue;
      for (const value of Object.values(m)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      m.dispose();
    }
  });
}

/**
 * Returns a JPEG blob, or null when the model can't be rendered (no WebGL,
 * unreadable file, …). Never throws — a missing thumbnail is cosmetic.
 */
export async function renderGlbThumbnail(file: File): Promise<Blob | null> {
  let renderer: THREE.WebGLRenderer | null = null;
  let model: THREE.Object3D | null = null;
  let env: THREE.Texture | null = null;

  try {
    const buffer = await previewBytes(file);

    const draco = new DRACOLoader();
    draco.setDecoderPath(DRACO_DECODER_PATH);
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);
    loader.setMeshoptDecoder(MeshoptDecoder);

    const gltf = await new Promise<{ scene: THREE.Object3D }>((resolve, reject) =>
      loader.parse(buffer, "", resolve as (g: unknown) => void, reject),
    );
    draco.dispose();
    model = gltf.scene;
    dropBrokenNormalMaps(model);
    removeMarkerCarriers(model);

    const canvas = document.createElement("canvas");
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(WIDTH, HEIGHT, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;

    const scene = new THREE.Scene();
    // JPEG has no alpha — render on a neutral card background instead of black.
    scene.background = new THREE.Color(0xf4f4f5);
    const pmrem = new THREE.PMREMGenerator(renderer);
    env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    pmrem.dispose();
    scene.add(model);

    const box = measureModel(model, THREE);
    if (box.isEmpty()) return null;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(sphere.radius, 1e-3);

    const camera = new THREE.PerspectiveCamera(35, WIDTH / HEIGHT, radius / 100, radius * 100);
    const dir = new THREE.Vector3(1, 0.7, 1.3).normalize();
    camera.position.copy(sphere.center).addScaledVector(dir, (radius / Math.sin(THREE.MathUtils.degToRad(17.5))) * 1.02);
    camera.lookAt(sphere.center);

    renderer.render(scene, camera);

    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.85),
    );
  } catch (err) {
    console.warn("[thumbnail] Could not render model preview:", err);
    return null;
  } finally {
    if (model) disposeObject(model);
    env?.dispose();
    renderer?.dispose();
    renderer?.forceContextLoss();
  }
}
