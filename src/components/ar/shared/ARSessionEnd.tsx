import type { ReactNode } from "react";
import { Box, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ARSessionEndProps {
  project: { name: string; client_name?: string | null };
  /** Re-enter the camera. Called from a tap, so iOS motion permission can be asked again. */
  onViewAgain: () => void;
  /**
   * Viewer feedback slot — deliberately empty for now.
   *
   * Archi AR is a design tool: the viewer (the designer's client) should be
   * able to leave a rating and a comment on the model for the designer to
   * take into account. That feature will render here, between the heading and
   * the "View again" button, so it is the first thing a client sees after
   * closing the camera. Not built yet: it needs a `model_feedback` table
   * (project_id, rating, comment, created_at) with an insert-only policy for
   * anonymous viewers and a read policy for the project owner, plus a view of
   * it on the designer's project page.
   */
  feedbackSlot?: ReactNode;
}

/** Shown after the viewer closes the AR camera. */
const ARSessionEnd = ({ project, onViewAgain, feedbackSlot }: ARSessionEndProps) => (
  <div className="min-h-[100dvh] bg-background flex flex-col items-center justify-center px-6 py-10">
    <div className="w-full max-w-sm space-y-8 text-center animate-fade-in">
      <div className="space-y-4">
        <div className="mx-auto h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center">
          <Box className="h-7 w-7 text-primary" />
        </div>
        <div className="space-y-1.5">
          <h1 className="font-display text-xl font-bold">{project.name}</h1>
          <p className="text-sm text-muted-foreground">
            Thanks for taking a look{project.client_name ? `, ${project.client_name}` : ""}.
          </p>
        </div>
      </div>

      {feedbackSlot}

      <Button size="lg" className="w-full h-12" onClick={onViewAgain}>
        <RotateCcw className="h-4 w-4 mr-2" />
        View in AR again
      </Button>

      <p className="text-xs text-muted-foreground/70">Powered by Archi AR</p>
    </div>
  </div>
);

export default ARSessionEnd;
