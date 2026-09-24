/**
 * Render a single still image of a GLB — the project thumbnail.
 *
 * WHY: a live WebGL preview of an architectural model is the most fragile
 * thing on the dashboard. A model with dozens of large textures needs hundreds
 * of megabytes of GPU memory, which crashes browser tabs (iOS Safari first).
 * The thumbnail is rendered ONCE, at upload time, from a texture-free copy of
 * the model, and everything after that is a plain <img>.
 *
 * Materials keep their colours (base colour / metallic / roughness factors);
 * only image textures are dropped, so the result reads as a clean clay render.
 */
import * as THREE from "three";
import { measureModel } from "@/lib/modelPlacement";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { stripTextures } from "@/lib/glbFile";

const DRACO_DECODER_PATH = "/assets/three/jsm/libs/draco/gltf/";
const WIDTH = 1200;
const HEIGHT = 900;

function disposeObject(root: THREE.Object3D) {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) m?.dispose();
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
    const buffer = stripTextures(await file.arrayBuffer(), { keepMaterials: true });

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
