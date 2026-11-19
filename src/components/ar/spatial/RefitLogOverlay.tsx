/**
 * Debug overlay for the rotation isolation log (contract §6.4, item F).
 * Display only. Shows the newest entries and the worst heading jump / drift,
 * and copies the whole log as JSON for the test notes.
 */
import { useState } from "react";
import type { RefitLog } from "@/lib/spatial/refitLog";

export default function RefitLogOverlay({ log, tick }: { log: RefitLog; tick: number }) {
  const [copied, setCopied] = useState(false);
  void tick; // re-render driver from the parent's refit interval
  const rows = log.list().slice(-8).reverse();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(log.toJSON(), null, 1));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked: the console has every entry */ }
  };
  return (
    <div className="pointer-events-auto absolute left-2 top-28 z-20 w-[min(92vw,360px)] rounded-lg bg-black/75 p-2 font-mono text-[10px] leading-tight text-white/90">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span>
          refit log · max jump {log.maxJumpDeg().toFixed(1)}° · max drift {log.maxDriftDeg().toFixed(1)}°
        </span>
        <button type="button" onClick={copy} className="rounded bg-white/15 px-2 py-0.5">{copied ? "copied" : "copy"}</button>
      </div>
      {rows.map((e, i) => (
        <div key={`${e.t}-${i}`} className={e.event === "lock" ? "text-sky-300" : e.event === "post-lock" ? "text-amber-200" : undefined}>
          {e.t.toFixed(1).padStart(6)}s {e.event.padEnd(14)} yaw {e.yawDeg?.toFixed(1) ?? "—"}°
          {e.dYawDeg !== null ? ` Δ${e.dYawDeg.toFixed(1)}` : ""}
          {e.driftDeg != null ? ` drift ${e.driftDeg.toFixed(1)}` : ""} rms {e.rmsMm?.toFixed(0) ?? "—"} n{e.markers} {e.tracking}
          {e.note ? ` · ${e.note}` : ""}
        </div>
      ))}
    </div>
  );
}
