import { QrCode } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Launch ring overlay — artboards B1/B2/B3 of the ArchiAR Launch Ring canvas
 * (Notion: "Roadmap — camera-first journey + launch ring · Sep 19, 2026").
 *
 *  B1 loading          — scrim 0.58, 120px progress ring, real download %.
 *  B2 loaded           — scrim 0.20, 240px corner-bracket reticle + QR dot.
 *  B3 found, loading   — brackets close into a solid frame, 64px ring in the
 *                         centre carries the remaining download %.
 *
 * The reticle sits at optical centre: it is an aiming target, not a touch
 * target, so the whole overlay is pointer-events-none. Colours come from the
 * `--primary` token in src/index.css (220 80% 50% ≈ #1A5EE5).
 */
export type LaunchRingState = "loading" | "loaded" | "found-loading";

interface LaunchRingProps {
  state: LaunchRingState;
  /** Download percentage 0–100, or null when the size is unknown. */
  progress: number | null;
  /** False until MindAR reports the camera feed is live. */
  cameraReady: boolean;
  /** Heading + body for B2, already mode-aware (QR surface vs. Spatial markers). */
  aimTitle: string;
  aimBody: string;
}

const PRIMARY = "hsl(var(--primary))";
const TRACK = "rgba(255,255,255,0.28)";

/** SVG progress ring. `size` px square; stroke/radius follow the B1 spec at 120px. */
function ProgressRing({ size, radius, stroke, progress }: {
  size: number;
  radius: number;
  stroke: number;
  progress: number | null;
}) {
  const c = 2 * Math.PI * radius;
  const known = progress != null;
  const pct = known ? Math.max(0, Math.min(100, progress!)) : 25;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      // -90deg start; an unknown size spins a quarter arc instead of faking a %.
      className={cn("-rotate-90", !known && "animate-spin")}
      aria-hidden="true"
    >
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={TRACK} strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={PRIMARY}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct / 100)}
        style={{ transition: "stroke-dashoffset 200ms ease-out" }}
      />
    </svg>
  );
}

/** Four 4px white corner brackets, 16px corner radius, 240px square. */
function Brackets() {
  const arm = "absolute h-12 w-12 border-white";
  return (
    <>
      <span className={cn(arm, "left-0 top-0 border-l-4 border-t-4 rounded-tl-2xl")} />
      <span className={cn(arm, "right-0 top-0 border-r-4 border-t-4 rounded-tr-2xl")} />
      <span className={cn(arm, "left-0 bottom-0 border-l-4 border-b-4 rounded-bl-2xl")} />
      <span className={cn(arm, "right-0 bottom-0 border-r-4 border-b-4 rounded-br-2xl")} />
    </>
  );
}

const LaunchRing = ({ state, progress, cameraReady, aimTitle, aimBody }: LaunchRingProps) => {
  const pctLabel = progress != null ? `${Math.round(progress)}%` : "…";

  let title: string;
  let body: string;
  if (state === "loading") {
    title = "Getting your model ready";
    body = cameraReady ? "Camera is already on — you can start aiming" : "Starting camera…";
  } else if (state === "found-loading") {
    title = "Marker found — hold steady";
    body = progress != null ? `Placing your model, ${Math.round(progress)}%` : "Placing your model…";
  } else {
    title = aimTitle;
    body = aimBody;
  }

  return (
    <div
      className="pointer-events-none absolute inset-0 z-[3] flex items-center justify-center transition-colors duration-300"
      style={{ backgroundColor: `rgba(10,13,18,${state === "loading" ? 0.58 : 0.2})` }}
      role="status"
      aria-live="polite"
    >
      <div className="relative flex h-[240px] w-[240px] items-center justify-center">
        {state === "loading" && (
          <div className="relative flex h-[120px] w-[120px] items-center justify-center">
            <ProgressRing size={120} radius={55} stroke={6} progress={progress} />
            <span className="absolute font-display text-2xl font-semibold tabular-nums text-white">
              {pctLabel}
            </span>
          </div>
        )}

        {state === "loaded" && (
          <>
            <Brackets />
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 shadow-lg">
              <QrCode className="h-6 w-6" style={{ color: PRIMARY }} />
            </div>
          </>
        )}

        {state === "found-loading" && (
          <>
            {/* Brackets closed into a solid frame */}
            <div
              className="absolute inset-0 rounded-2xl border-4 transition-all duration-300"
              style={{ borderColor: PRIMARY, backgroundColor: "hsl(var(--primary) / 0.14)" }}
            />
            <div className="relative flex h-16 w-16 items-center justify-center">
              <ProgressRing size={64} radius={28} stroke={5} progress={progress} />
              <span className="absolute text-[11px] font-semibold tabular-nums text-white">
                {pctLabel}
              </span>
            </div>
          </>
        )}

        {/* Copy sits under the ring/reticle without shifting its optical centre. */}
        <div className="absolute left-1/2 top-full mt-5 w-[min(80vw,300px)] -translate-x-1/2 text-center">
          <p className="font-display text-base font-semibold text-white drop-shadow">{title}</p>
          <p className="mt-1 text-xs leading-relaxed text-white/80 drop-shadow">{body}</p>
        </div>
      </div>
    </div>
  );
};

export default LaunchRing;
