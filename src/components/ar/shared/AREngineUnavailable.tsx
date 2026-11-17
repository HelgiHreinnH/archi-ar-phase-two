import { AlertTriangle, RotateCcw } from "lucide-react";

/**
 * Tabletop / Wall: the AR engine (8th Wall) could not start.
 *
 * Until 16 Nov 2026 this case fell back to MindAR without telling anyone. The
 * client then saw a model that slid off the QR under a message saying it would
 * stay put (MindAR is image tracking only; its hold is gyro, rotation only).
 * A screen that says what happened and offers a retry is the better outcome,
 * for the client and for the architect whose presentation it is.
 *
 * Dark, like the pre-camera screen and the camera view it replaces.
 */
interface AREngineUnavailableProps {
  projectName: string;
  /** Engine message, shown small — for the person who has to debug it. */
  errorDetail?: string | null;
  /** Re-run the launch. Called from the tap, so permissions can be re-asked. */
  onRetry: () => void;
  /** Open the model without AR tracking (3D preview / native device AR). */
  onPreview?: () => void;
  onBack: () => void;
}

const AREngineUnavailable = ({ projectName, errorDetail, onRetry, onPreview, onBack }: AREngineUnavailableProps) => (
  <div className="fixed inset-0 flex flex-col bg-[#0a0d12] text-white">
    <div className="px-6 pt-[max(env(safe-area-inset-top),20px)]">
      <p className="font-display text-xs font-medium uppercase tracking-[0.18em] text-white/45">Archi AR</p>
    </div>

    <main className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-white/10">
        <AlertTriangle className="h-8 w-8 text-white/80" />
      </div>
      <h1 className="font-display text-2xl font-semibold leading-tight">AR couldn't start</h1>
      <p className="mt-1 text-sm text-white/55">{projectName}</p>
      <p className="mt-5 max-w-xs text-sm leading-relaxed text-white/65">
        The AR engine didn't load on this phone. Check your connection and try again. If the link
        opened inside another app, open it in Safari or Chrome instead.
      </p>
      {errorDetail && (
        <p className="mt-4 max-w-xs break-words font-mono text-[10px] leading-relaxed text-white/35">{errorDetail}</p>
      )}
    </main>

    <div className="px-6 pb-[max(env(safe-area-inset-bottom),20px)]">
      <button
        type="button"
        onClick={onRetry}
        className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-base font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition-transform active:scale-[0.98]"
      >
        <RotateCcw className="h-5 w-5" />
        Try again
      </button>
      {onPreview && (
        <button
          type="button"
          onClick={onPreview}
          className="mt-3 flex h-12 w-full items-center justify-center rounded-2xl border border-white/20 text-sm font-medium text-white/85 transition-transform active:scale-[0.98]"
        >
          Open the 3D preview instead
        </button>
      )}
      <button
        type="button"
        onClick={onBack}
        className="mt-2 h-10 w-full text-xs text-white/45 transition-colors hover:text-white/70"
      >
        Back
      </button>
    </div>
  </div>
);

export default AREngineUnavailable;
