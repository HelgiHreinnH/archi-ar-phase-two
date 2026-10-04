import { useEffect } from "react";
import { Camera, QrCode } from "lucide-react";
import { markAR } from "@/lib/arTiming";

/**
 * Tabletop / Wall pre-camera screen — the single tap (Oct 2026).
 *
 * Scanning the printed QR lands here, not in the camera: iOS only grants
 * motion access from a tap, and without it there is no world lock (8th Wall)
 * or gyro hold (MindAR). So one clean screen, one button. Dark, like the
 * camera that follows, so there is no white flash and no landing-card flash
 * (4 Oct test, bug 8).
 *
 * The click handler (ARViewer) asks for motion + camera synchronously; this
 * component only renders. While it is on screen the engine, the GLB and the
 * tracking target preload (see arPreload), so the tap lands on warm assets.
 */
interface QrPreCameraProps {
  projectName: string;
  mode: string;
  /** "1:50" style scale string from the project. */
  scale?: string | null;
  clientName?: string | null;
  /** Model preload progress 0–1, or null before it starts / when unknown. */
  modelProgress?: number | null;
  onLaunch: () => void;
}

const QrPreCamera = ({ projectName, mode, scale, clientName, modelProgress, onLaunch }: QrPreCameraProps) => {
  const isWall = mode === "wall";
  useEffect(() => { markAR("precamera-shown"); }, []);

  const pct = modelProgress != null ? Math.round(Math.max(0, Math.min(1, modelProgress)) * 100) : null;
  const preloadLabel = pct == null ? null : pct >= 100 ? "Model ready" : `Preparing model… ${pct}%`;

  return (
    <div className="fixed inset-0 flex flex-col bg-[#0a0d12] text-white">
      <div className="px-6 pt-[max(env(safe-area-inset-top),20px)]">
        <p className="font-display text-xs font-medium uppercase tracking-[0.18em] text-white/45">Archi AR</p>
      </div>

      <main className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <div className="relative mb-8 flex h-28 w-28 items-center justify-center">
          {/* Corner brackets — the same aiming frame the camera view uses. */}
          <span className="absolute left-0 top-0 h-7 w-7 rounded-tl-xl border-l-[3px] border-t-[3px] border-white/70" />
          <span className="absolute right-0 top-0 h-7 w-7 rounded-tr-xl border-r-[3px] border-t-[3px] border-white/70" />
          <span className="absolute bottom-0 left-0 h-7 w-7 rounded-bl-xl border-b-[3px] border-l-[3px] border-white/70" />
          <span className="absolute bottom-0 right-0 h-7 w-7 rounded-br-xl border-b-[3px] border-r-[3px] border-white/70" />
          <QrCode className="h-10 w-10 text-primary" />
        </div>

        <h1 className="font-display text-2xl font-semibold leading-tight">{projectName}</h1>
        {clientName && <p className="mt-1 text-sm text-white/55">For {clientName}</p>}

        <div className="mt-4 flex items-center gap-2 text-xs">
          <span className="rounded-full border border-white/20 px-3 py-1 font-medium text-white/85">
            {isWall ? "Wall" : "Tabletop"}
          </span>
          {scale && (
            <span className="rounded-full border border-white/20 px-3 py-1 font-mono tabular-nums text-white/85">
              Scale {scale}
            </span>
          )}
        </div>

        <p className="mt-6 max-w-xs text-sm leading-relaxed text-white/65">
          {isWall
            ? "Stand in front of the printed QR on the wall, then launch the camera and aim at it."
            : "Have the printed QR on the table in front of you, then launch the camera and aim at it."}
        </p>
      </main>

      <div className="px-6 pb-[max(env(safe-area-inset-bottom),20px)]">
        <button
          type="button"
          onClick={onLaunch}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-base font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition-transform active:scale-[0.98]"
        >
          <Camera className="h-5 w-5" />
          Launch AR Camera
        </button>
        <p className="mt-3 text-center text-[11px] leading-relaxed text-white/45">
          You'll be asked for camera and motion access. Motion keeps the model fixed in the room.
        </p>
        <p className="mt-1 h-4 text-center font-mono text-[10px] tabular-nums text-white/35" aria-live="polite">
          {preloadLabel}
        </p>
      </div>
    </div>
  );
};

export default QrPreCamera;
