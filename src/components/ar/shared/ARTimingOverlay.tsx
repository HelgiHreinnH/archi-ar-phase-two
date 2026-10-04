import { useEffect, useState } from "react";
import { AR_DEBUG, getARContext, getARTimings, subscribeARTiming } from "@/lib/arTiming";

/**
 * `?debug=1` only: the launch timing marks (see arTiming.ts) as a small
 * monospace panel, so a phone screenshot or screen recording carries the
 * numbers. pointer-events none — it never blocks the AR controls.
 */
const ARTimingOverlay = () => {
  const [, setTick] = useState(0);
  useEffect(() => subscribeARTiming(() => setTick((t) => t + 1)), []);
  if (!AR_DEBUG) return null;
  const rows = getARTimings();
  const ctx = getARContext();
  const tap = rows.find((r) => r.name === "tap")?.ms;
  return (
    <div
      className="pointer-events-none fixed left-2 z-[60] max-w-[62vw] rounded-md bg-black/70 px-2 py-1.5 font-mono text-[9px] leading-[1.35] text-white/90"
      // Top-left under the status card: clear of the launch button, the
      // re-place/screenshot controls and the scale readout.
      style={{ top: "calc(env(safe-area-inset-top, 0px) + 112px)" }}
      aria-hidden="true"
    >
      <div className="text-white/60">
        {Object.entries(ctx).map(([k, v]) => `${k}=${v}`).join(" ")}
      </div>
      {rows.map((r) => (
        <div key={r.name} className="flex justify-between gap-3 tabular-nums">
          <span>{r.name}{r.note ? ` (${r.note})` : ""}</span>
          <span>
            {(r.ms / 1000).toFixed(2)}s
            {tap != null && r.ms >= tap && r.name !== "tap" ? ` +${((r.ms - tap) / 1000).toFixed(1)}` : ""}
          </span>
        </div>
      ))}
    </div>
  );
};

export default ARTimingOverlay;
