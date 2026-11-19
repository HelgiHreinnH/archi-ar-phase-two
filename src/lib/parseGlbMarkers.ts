import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import type { MarkerPoint, Vec3Tuple } from "@/lib/markerTypes";
import { stripTextures } from "@/lib/glbFile";
import { markerIndexFromNodeName } from "@/lib/markerNames";
import { getMarkerLabel } from "@/lib/spatial/markerLabels";
import { EXTRAS_KEY, EXTRAS_SPATIAL_VERSION, SHEET_MM } from "@/lib/spatial/contract";

/** Node position vs extras `p` above this is a warning in the Markers step (contract §5.2). */
export const EXTRAS_TOLERANCE_MM = 1;
/** A plain Rhino export carries the A4 sheets as meshes; tolerance on their size (mesh rounding). */
const SHEET_TOLERANCE_MM = 2;
const MIN_MARKERS = 3;

/**
 * Extracts the world-space position of a THREE.Object3D.
 *
 * Rhino's GLB exporter vertex-bakes all geometry — node.translation stays at
 * [0,0,0] and the actual world position is encoded directly into mesh vertex
 * data. For mesh objects the bounding-box centre of the geometry (with the
 * node's world matrix applied) is the position; empty nodes fall back to
 * getWorldPosition(), which is right for exporters that use node transforms.
 */
function getObjectPosition(obj: THREE.Object3D): THREE.Vector3 {
  const mesh = obj as THREE.Mesh;
  if (mesh.isMesh && mesh.geometry) {
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox;
    if (box) {
      const center = new THREE.Vector3();
      box.getCenter(center);
      center.applyMatrix4(mesh.matrixWorld);
      return center;
    }
  }
  obj.updateWorldMatrix(true, false);
  return obj.getWorldPosition(new THREE.Vector3());
}

/**
 * glTF is Y-up in metres; the platform stores Rhino Z-up in millimetres.
 * Inverse of the export transform (Rhino writes with MapZToY on), contract §2:
 *   Rhino.X = glTF.X·1000,  Rhino.Y = −glTF.Z·1000,  Rhino.Z = glTF.Y·1000
 */
function gltfToRhinoMm(p: THREE.Vector3): { x: number; y: number; z: number } {
  return { x: p.x * 1000, y: -p.z * 1000, z: p.y * 1000 };
}

// ── asset.extras.archiar v2 (contract §5.2) ─────────────────────────────

export interface ExtrasMarker {
  key: number;
  name: string;
  /** Rhino frame, mm. */
  p: Vec3Tuple;
  /** Sheet normal (unit), null for a legacy Point marker. Cross-check only (D8). */
  n: Vec3Tuple | null;
  /** Sheet up (unit), null for a legacy Point marker. Cross-check only (D8). */
  up: Vec3Tuple | null;
}

export interface ArchiarExtrasV2 {
  v: 2;
  mode: "spatial";
  plugin?: string;
  sheet?: { w: number; h: number; circle: number; circleCentreFromTop: number };
  markers: ExtrasMarker[];
}

const isVec3 = (v: unknown): v is Vec3Tuple =>
  Array.isArray(v) && v.length === 3 && v.every((c) => typeof c === "number" && Number.isFinite(c));

/**
 * Reads `asset.extras.archiar`. A missing block, an older version or another
 * mode (Tabletop/Wall v1) is ignored without a warning: import must work
 * without extras. A v2 Spatial block that cannot be read gives a warning and
 * is ignored too — marker nodes are always the authority.
 */
export function readArchiarExtras(asset: unknown): { extras: ArchiarExtrasV2 | null; warnings: string[] } {
  const raw = (asset as { extras?: Record<string, unknown> } | undefined)?.extras?.[EXTRAS_KEY] as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== "object") return { extras: null, warnings: [] };
  if (raw.v !== EXTRAS_SPATIAL_VERSION || raw.mode !== "spatial") return { extras: null, warnings: [] };

  const unreadable = { extras: null, warnings: ["The file's Archi AR export data could not be read, so it was ignored. Marker positions come from the marker nodes."] };
  if (raw.units !== "mm" || raw.frame !== "rhino-z-up" || !Array.isArray(raw.markers)) return unreadable;

  const markers: ExtrasMarker[] = [];
  for (const m of raw.markers as Record<string, unknown>[]) {
    if (!m || typeof m !== "object" || typeof m.key !== "number" || !isVec3(m.p)) return unreadable;
    markers.push({
      key: m.key,
      name: typeof m.name === "string" ? m.name : `marker_${getMarkerLabel(m.key)}`,
      p: m.p,
      n: isVec3(m.n) ? m.n : null,
      up: isVec3(m.up) ? m.up : null,
    });
  }

  const warnings: string[] = [];
  const sheet = raw.sheet as ArchiarExtrasV2["sheet"] | undefined;
  if (sheet && (sheet.w !== SHEET_MM.w || sheet.h !== SHEET_MM.h || sheet.circle !== SHEET_MM.circle || sheet.circleCentreFromTop !== SHEET_MM.circleCentreFromTop)) {
    warnings.push(`The Rhino plugin used a different sheet (${sheet.w} × ${sheet.h} mm, Ø${sheet.circle}) than this platform prints (${SHEET_MM.w} × ${SHEET_MM.h} mm, Ø${SHEET_MM.circle}). Update the plugin.`);
  }
  return {
    extras: { v: 2, mode: "spatial", plugin: typeof raw.plugin === "string" ? raw.plugin : undefined, sheet, markers },
    warnings,
  };
}

/**
 * Cross-check node positions against extras `p`. Node position stays
 * authoritative; the difference is recorded on the marker and reported when
 * it is above EXTRAS_TOLERANCE_MM. Returns new markers (n/up attached) and warnings.
 */
export function crossCheckExtras(markers: MarkerPoint[], extras: ArchiarExtrasV2 | null): { markers: MarkerPoint[]; warnings: string[] } {
  if (!extras) return { markers, warnings: [] };
  const warnings: string[] = [];
  const byKey = new Map(extras.markers.map((m) => [m.key, m]));
  const out = markers.map((m) => {
    const e = byKey.get(m.index);
    if (!e) {
      warnings.push(`Marker ${getMarkerLabel(m.index)} is in the model but missing from the plugin's export data.`);
      return m;
    }
    const delta = Math.hypot(m.x - e.p[0], m.y - e.p[1], m.z - e.p[2]);
    if (delta > EXTRAS_TOLERANCE_MM) {
      warnings.push(`Marker ${getMarkerLabel(m.index)}: the marker node and the plugin's export data differ by ${delta.toFixed(1)} mm. The node position is used. Export again from the plugin.`);
    }
    return { ...m, extrasDeltaMm: Number(delta.toFixed(3)), n: e.n, up: e.up };
  });
  const found = new Set(markers.map((m) => m.index));
  for (const e of extras.markers) {
    if (!found.has(e.key)) warnings.push(`The plugin exported marker ${getMarkerLabel(e.key)}, but the model has no node for it.`);
  }
  return { markers: out, warnings };
}

// ── Plain Rhino export detection (contract §4.6, brief item C) ───────────

const SHEET_DIAGONAL_M = Math.hypot(SHEET_MM.w, SHEET_MM.h) / 1000;
const SHEET_AREA_M2 = (SHEET_MM.w * SHEET_MM.h) / 1e6;

/**
 * True for a planar mesh that measures one A4 sheet, in any orientation:
 * total area 210 × 297 mm and longest vertex distance = its diagonal.
 * Rotation-invariant, so a wall sheet at any heading counts.
 */
export function isSheetMesh(mesh: THREE.Mesh): boolean {
  const pos = mesh.geometry?.getAttribute?.("position") as THREE.BufferAttribute | undefined;
  if (!pos || pos.count < 3 || pos.count > 256) return false;
  mesh.updateWorldMatrix(true, false);
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < pos.count; i++) pts.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld));

  let maxD = 0;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) maxD = Math.max(maxD, pts[i].distanceTo(pts[j]));

  const index = mesh.geometry.getIndex();
  const tri = (k: number) => (index ? index.getX(k) : k);
  const triCount = (index ? index.count : pos.count) / 3;
  let area = 0;
  const ab = new THREE.Vector3(), ac = new THREE.Vector3();
  for (let t = 0; t < triCount; t++) {
    const a = pts[tri(3 * t)], b = pts[tri(3 * t + 1)], c = pts[tri(3 * t + 2)];
    area += ab.subVectors(b, a).cross(ac.subVectors(c, a)).length() / 2;
  }
  const tolM = SHEET_TOLERANCE_MM / 1000;
  return Math.abs(maxD - SHEET_DIAGONAL_M) <= tolM && Math.abs(area - SHEET_AREA_M2) <= SHEET_AREA_M2 * 0.02;
}

// ── Report ───────────────────────────────────────────────────────────────

export interface GlbMarkerReport {
  /** Every marker node found, sorted, Rhino mm — may be fewer than three. */
  markers: MarkerPoint[];
  /** At least three markers and not all at the origin: safe to store. */
  usable: boolean;
  /** Marker names as found, e.g. ["marker_A", "marker_B"]. */
  names: string[];
  extras: ArchiarExtrasV2 | null;
  warnings: string[];
  /** Meshes measuring one A4 sheet (a plain Rhino _Export leaks them). */
  sheetMeshes: number;
}

/**
 * Reads marker nodes (marker_A … marker_T, marker_1 … marker_20, optional
 * `_proxy`, contract §5.1 and D11) and asset.extras.archiar v2 in one pass.
 * Returns null for a non-GLB or a file three.js cannot parse.
 *
 * Rhino's writer emits each marker twice — the layer group node
 * (vertex-baked, at the origin) and the proxy mesh inside it. The mesh
 * carries the real position, so it always wins.
 */
export async function readGlbMarkers(file: File): Promise<GlbMarkerReport | null> {
  const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
  if (ext !== ".glb") return null;
  return readGlbMarkersFromBuffer(await file.arrayBuffer());
}

export function readGlbMarkersFromBuffer(input: ArrayBuffer): Promise<GlbMarkerReport | null> {
  // Markers only need node names + geometry; decoding textures here used to
  // block the UI for seconds on texture-heavy models.
  const buffer = stripTextures(input);
  const loader = new GLTFLoader();
  // Optimised uploads are meshopt-compressed.
  loader.setMeshoptDecoder(MeshoptDecoder);

  return new Promise((resolve) => {
    loader.parse(
      buffer,
      "",
      (gltf) => {
        gltf.scene.updateMatrixWorld(true);
        const found = new Map<number, { x: number; y: number; z: number; fromMesh: boolean; name: string }>();
        let sheetMeshes = 0;

        const record = (index: number, obj: THREE.Object3D) => {
          const fromMesh = !!(obj as THREE.Mesh).isMesh;
          const existing = found.get(index);
          if (existing?.fromMesh && !fromMesh) return;
          const pos = gltfToRhinoMm(getObjectPosition(obj));
          found.set(index, {
            x: parseFloat(pos.x.toFixed(4)),
            y: parseFloat(pos.y.toFixed(4)),
            z: parseFloat(pos.z.toFixed(4)),
            fromMesh,
            name: obj.name.replace(/[_-]?proxy$/i, ""),
          });
        };

        gltf.scene.traverse((obj) => {
          const index = markerIndexFromNodeName(obj.name);
          if (index !== null) {
            record(index, obj);
            return;
          }
          if ((obj as THREE.Mesh).isMesh && isSheetMesh(obj as THREE.Mesh)) sheetMeshes++;
        });

        const nodeMarkers: MarkerPoint[] = Array.from(found.entries())
          .sort(([a], [b]) => a - b)
          .map(([index, pos]) => ({ index, x: pos.x, y: pos.y, z: pos.z, label: `Marker ${index}`, source: "rhino" as const }));

        // Every marker at the origin means only empty nodes matched.
        const allAtOrigin = nodeMarkers.every((p) => p.x === 0 && p.y === 0 && p.z === 0);
        const { extras, warnings: extrasWarnings } = readArchiarExtras(gltf.asset);
        const { markers, warnings: crossWarnings } = crossCheckExtras(nodeMarkers, extras);

        resolve({
          markers,
          usable: markers.length >= MIN_MARKERS && !allAtOrigin,
          names: Array.from(found.values()).sort((a, b) => a.name.localeCompare(b.name)).map((f) => f.name),
          extras,
          warnings: [...extrasWarnings, ...crossWarnings],
          sheetMeshes,
        });
      },
      () => resolve(null),
    );
  });
}

/**
 * Compatibility wrapper: the usable marker list, or null when fewer than
 * three markers (or only origin nodes) were found.
 */
export async function parseGlbMarkers(file: File): Promise<MarkerPoint[] | null> {
  const report = await readGlbMarkers(file);
  return report?.usable ? report.markers : null;
}

// ── Import message (brief item C) ────────────────────────────────────────

export type MarkerImportKind = "ok" | "plain-rhino-export" | "too-few" | "none";

export interface MarkerImportMessage {
  kind: MarkerImportKind;
  title: string;
  description: string;
}

/** What the architect is told after upload. Pure, unit-tested. */
export function describeMarkerImport(report: GlbMarkerReport | null): MarkerImportMessage {
  if (report?.usable) {
    const letters = report.markers.map((m) => getMarkerLabel(m.index)).join(", ");
    return {
      kind: "ok",
      title: "Marker positions read from Rhino",
      description: `Found ${report.markers.length} markers (${letters}).${report.warnings.length ? ` ${report.warnings.length} warning${report.warnings.length > 1 ? "s" : ""} — see the Markers step.` : ""}`,
    };
  }
  const n = report?.markers.length ?? 0;
  if (n === 0 && (report?.sheetMeshes ?? 0) > 0) {
    return {
      kind: "plain-rhino-export",
      title: "This looks like a plain Rhino export",
      description: `The file has no marker nodes, but ${report!.sheetMeshes} A4 sheet${report!.sheetMeshes > 1 ? "s" : ""} (210 × 297 mm) inside the model. Export with the Archi AR plugin's Export button instead of Rhino's File › Export — it writes the markers and leaves the sheets out.`,
    };
  }
  if (n > 0) {
    return {
      kind: "too-few",
      title: `Only ${n} marker${n > 1 ? "s" : ""} found`,
      description: `Spatial needs at least ${MIN_MARKERS}. Found: ${report!.names.join(", ")}. Add markers with the Archi AR plugin in Rhino and export again.`,
    };
  }
  return {
    kind: "none",
    title: "No markers in this model",
    description: "Spatial reads marker positions from the GLB. Set up markers with the Archi AR plugin in Rhino and use its Export button.",
  };
}
