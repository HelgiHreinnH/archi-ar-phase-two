/**
 * AR launch timing (Phase 0, 4 Oct 2026 user test follow-up).
 *
 * The 4 Oct screen recording showed ~60 s from scan to a working engine, and
 * nothing in the code could say where it went. Every step of the launch now
 * drops a `performance.mark("ar:<name>")` the FIRST time it happens, measured
 * from navigation start (performance.timeOrigin = 0 ms = the moment the
 * browser started loading the page the QR opened).
 *
 * Read it on the phone with `?debug=1` (on-screen overlay, see
 * ARTimingOverlay) or in the console as one `[ar-timing]` line, logged when the
 * model is first visible and again when the viewer closes.
 */

export const AR_MARKS = [
  "app-start",        // ARViewer chunk evaluated (JS bundle in)
  "project-fetched",  // get-public-project answered (or session cache hit)
  "precamera-shown",  // single tap screen painted (Tabletop/Wall)
  "tap",              // "Launch AR Camera" tapped
  "camera-granted",   // getUserMedia from the tap resolved
  "engine-script",    // engine JS loaded (MindAR + TF.js / 8th Wall xr.js + slam)
  "target-ready",     // tracking target loaded (.mind / QR image target scanning)
  "camera-live",      // first live video frame from the engine's camera
  "engine-ready",     // engine reports it is tracking (MindAR start() / XR8 onStart)
  "glb-downloaded",   // model bytes in hand
  "qr-seen",          // first QR sighting
  "model-parsed",     // GLB parsed and placed on the QR anchor
  "model-locked",     // lock event (steady QR → fixed pose)
  "model-visible",    // first rendered frame with the model on screen
] as const;

export type ArMark = (typeof AR_MARKS)[number];

type Listener = () => void;

const marks = new Map<string, number>();
const notes = new Map<string, string>();
const listeners = new Set<Listener>();
let summaryLogged = false;

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** Record a mark once (later calls for the same name are ignored). */
export function markAR(name: ArMark | string, note?: string): void {
  if (marks.has(name)) return;
  marks.set(name, Math.round(now()));
  if (note) notes.set(name, note);
  try { performance.mark(`ar:${name}`); } catch { /* old Safari without User Timing L3 */ }
  for (const l of listeners) l();
  if (name === "model-visible") logARTimingSummary();
}

/** Record an event that may repeat (e.g. camera recoveries): kept as name#n. */
export function markARRepeat(name: string, note?: string): void {
  let i = 1;
  while (marks.has(`${name}#${i}`)) i++;
  markAR(`${name}#${i}`, note);
}

/** Context shown with the numbers (engine, mode, cache state). */
const context = new Map<string, string>();
export function setARContext(key: string, value: string): void {
  context.set(key, value);
  for (const l of listeners) l();
}

export interface ArTimingRow {
  name: string;
  ms: number;
  note?: string;
}

export function getARTimings(): ArTimingRow[] {
  return [...marks.entries()]
    .map(([name, ms]) => ({ name, ms, note: notes.get(name) }))
    .sort((a, b) => a.ms - b.ms);
}

export function getARContext(): Record<string, string> {
  return Object.fromEntries(context);
}

/**
 * One line, easy to paste: context first, then every mark in time order as
 * name=seconds, and the tap→visible span the pass criteria are written in.
 */
export function formatARTimingLine(
  rows: ArTimingRow[] = getARTimings(),
  ctx: Record<string, string> = getARContext(),
): string {
  const head = Object.entries(ctx).map(([k, v]) => `${k}=${v}`);
  const body = rows.map((r) => `${r.name}=${(r.ms / 1000).toFixed(2)}s`);
  const at = (n: string) => rows.find((r) => r.name === n)?.ms;
  const tap = at("tap");
  const vis = at("model-visible");
  const lock = at("model-locked");
  const spans: string[] = [];
  if (tap != null && vis != null) spans.push(`tap→visible=${((vis - tap) / 1000).toFixed(2)}s`);
  if (tap != null && lock != null) spans.push(`tap→locked=${((lock - tap) / 1000).toFixed(2)}s`);
  const pre = at("precamera-shown");
  if (pre != null) spans.push(`scan→precamera=${(pre / 1000).toFixed(2)}s`);
  return ["[ar-timing]", ...head, ...body, ...spans].join(" ");
}

export function logARTimingSummary(force = false): void {
  if (summaryLogged && !force) return;
  summaryLogged = true;
  console.log(formatARTimingLine());
}

export function subscribeARTiming(l: Listener): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** Marks for one AR session (✕ → "View in AR again" starts a fresh run). */
export function resetARSessionMarks(): void {
  const keep = new Set(["app-start", "project-fetched", "precamera-shown"]);
  for (const k of [...marks.keys()]) if (!keep.has(k)) marks.delete(k);
  summaryLogged = false;
  for (const l of listeners) l();
}

export const AR_DEBUG =
  typeof window !== "undefined" && new URLSearchParams(window.location.search).get("debug") === "1";

if (typeof window !== "undefined") {
  // Handy from Safari's Web Inspector: __arTiming() prints the line again.
  (window as unknown as { __arTiming?: () => string }).__arTiming = () => formatARTimingLine();
}
