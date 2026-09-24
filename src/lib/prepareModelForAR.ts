/**
 * Runtime fixes applied to every GLB before it goes into an AR scene
 * (8th Wall WorldLockScene and MindARScene). The upload optimiser
 * (optimizeGlb.ts) does the same material fixes at the file level; doing them
 * here too means models uploaded before that existed also look right.
 *
 * three.js objects come from the self-hosted runtime module, so types are loose.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

const ROOM_ENV_URL = "/assets/three/jsm/environments/RoomEnvironment.js";
const TEXTURE_SLOTS = ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap"];

/**
 * - Mipmapped, mildly anisotropic textures (Rhino writes LINEAR min filter →
 *   shimmer and moiré once a 1:10 model shrinks every texture).
 * - Transmission glass → plain alpha blend (transmission renders the whole
 *   scene a second time, every frame).
 * - Rhino "display colour" fallback materials (unnamed, metal 1, rough 1, no
 *   map) → matte, instead of black.
 */
export function tuneMaterialsForMobile(model: any, T: any, renderer?: any): void {
  const maxAniso = Math.min(4, renderer?.capabilities?.getMaxAnisotropy?.() ?? 1);
  const seenMat = new Set<any>();
  const seenTex = new Set<any>();

  model.traverse((o: any) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m || seenMat.has(m)) continue;
      seenMat.add(m);

      if (m.transmission > 0) {
        const t = m.transmission;
        m.transmission = 0;
        m.transparent = true;
        m.opacity = Math.max(0.15, 1 - 0.85 * t);
        m.depthWrite = false;
        m.side = T.DoubleSide;
      }
      if ("clearcoat" in m) m.clearcoat = 0;
      if ("sheen" in m) m.sheen = 0;
      if ("iridescence" in m) m.iridescence = 0;

      if (!m.name && !m.map && m.metalness >= 0.99 && m.roughness >= 0.99) {
        m.metalness = 0;
        m.roughness = 0.8;
      }

      for (const slot of TEXTURE_SLOTS) {
        const tex = m[slot];
        if (!tex || seenTex.has(tex)) continue;
        seenTex.add(tex);
        tex.generateMipmaps = true;
        tex.minFilter = T.LinearMipmapLinearFilter;
        tex.anisotropy = maxAniso;
        tex.needsUpdate = true;
      }
      m.needsUpdate = true;
    }
  });
}

/**
 * Freeze local matrices below the model root. Placement only ever moves the
 * root (or its anchor), so recomputing ~2 k child matrices every frame is
 * pure waste on unoptimised uploads.
 */
export function freezeModelMatrices(model: any): void {
  model.updateMatrixWorld(true);
  model.traverse((o: any) => {
    if (o === model) return;
    o.matrixAutoUpdate = false;
  });
}

/**
 * Neutral studio environment (PMREM RoomEnvironment) so metals and glossy
 * surfaces have something to reflect. Without it every metal renders black.
 * Generated once per renderer; ~20 ms.
 */
export async function applyRoomEnvironment(scene: any, renderer: any, T: any): Promise<void> {
  if (!scene || !renderer || scene.environment) return;
  try {
    const { RoomEnvironment } = await import(/* @vite-ignore */ ROOM_ENV_URL);
    const pmrem = new T.PMREMGenerator(renderer);
    const room = new RoomEnvironment(renderer);
    scene.environment = pmrem.fromScene(room, 0.04).texture;
    room.dispose?.();
    pmrem.dispose();
  } catch (e) {
    console.warn("[prepareModelForAR] environment skipped:", e);
  }
}

/**
 * fetch() with download progress (0–1). Falls back to a plain read when the
 * response has no length (e.g. compressed transfer).
 */
export async function fetchWithProgress(url: string, onProgress?: (f: number) => void): Promise<{ ok: boolean; status: number; buffer: ArrayBuffer }> {
  const res = await fetch(url);
  const total = Number(res.headers.get("content-length")) || 0;
  if (!res.ok || !res.body || !total || !onProgress) {
    const buffer = res.ok ? await res.arrayBuffer() : new ArrayBuffer(0);
    onProgress?.(1);
    return { ok: res.ok, status: res.status, buffer };
  }
  const reader = res.body.getReader();
  const out = new Uint8Array(total);
  let got = 0;
  let lastReport = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (got + value.byteLength > out.byteLength) {
      // Server lied about length — fall back to growing.
      const grown = new Uint8Array(Math.max(out.byteLength * 2, got + value.byteLength));
      grown.set(out.subarray(0, got));
      grown.set(value, got);
      got += value.byteLength;
      return { ok: true, status: res.status, buffer: await concatRest(reader, grown, got) };
    }
    out.set(value, got);
    got += value.byteLength;
    const f = got / total;
    if (f - lastReport >= 0.02) { lastReport = f; onProgress(f); }
  }
  onProgress(1);
  return { ok: true, status: res.status, buffer: out.buffer.slice(0, got) };
}

async function concatRest(reader: ReadableStreamDefaultReader<Uint8Array>, buf: Uint8Array, got: number): Promise<ArrayBuffer> {
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (got + value.byteLength > buf.byteLength) {
      const grown = new Uint8Array(Math.max(buf.byteLength * 2, got + value.byteLength));
      grown.set(buf.subarray(0, got));
      buf = grown;
    }
    buf.set(value, got);
    got += value.byteLength;
  }
  return buf.buffer.slice(0, got);
}
