import { FlaskConical } from "lucide-react";

/**
 * Spatial while MindAR is off (decision 17 Nov 2026, `src/lib/arEngines.ts`).
 *
 * 8th Wall is the engine in every mode. Spatial on 8th Wall is in testing,
 * and MindAR must not run at any time in that phase, so a Spatial link on the
 * production site shows this screen instead of starting the old MindAR
 * viewer. On the 8th Wall test site the viewer redirects to the Spatial lab
 * before this screen is ever shown.
 *
 * Dark, like the other AR screens.
 */
interface SpatialInTestingProps {
  projectName: string;
}

const SpatialInTesting = ({ projectName }: SpatialInTestingProps) => (
  <div className="fixed inset-0 flex flex-col bg-[#0a0d12] text-white">
    <div className="px-6 pt-[max(env(safe-area-inset-top),20px)]">
      <p className="font-display text-xs font-medium uppercase tracking-[0.18em] text-white/45">Archi AR</p>
    </div>

    <main className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-white/10">
        <FlaskConical className="h-8 w-8 text-white/80" />
      </div>
      <h1 className="font-display text-2xl font-semibold leading-tight">Spatial AR is being upgraded</h1>
      <p className="mt-1 text-sm text-white/55">{projectName}</p>
      <p className="mt-5 max-w-xs text-sm leading-relaxed text-white/65">
        Full-scale Spatial experiences are moving to a new AR engine and are in testing right now. Ask the
        architect who shared this link for an updated one.
      </p>
    </main>
  </div>
);

export default SpatialInTesting;
