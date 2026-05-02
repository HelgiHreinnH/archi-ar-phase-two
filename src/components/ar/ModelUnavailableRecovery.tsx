import { useState, useEffect } from "react";
import { AlertTriangle, Loader2, Copy, Check, RefreshCw } from "lucide-react";
import { toast } from "sonner";

interface ModelUnavailableRecoveryProps {
  shareId: string;
  projectName?: string;
  errorDetail?: string | null;
  onRetry: () => Promise<void> | void;
}

/**
 * Guided recovery flow shown when the project loaded but the 3D model
 * URL could not be signed/fetched. Offers manual + auto-retry, and a
 * copy-shareId action for support requests.
 */
const ModelUnavailableRecovery = ({
  shareId,
  projectName,
  errorDetail,
  onRetry,
}: ModelUnavailableRecoveryProps) => {
  const [attempts, setAttempts] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [autoRetryIn, setAutoRetryIn] = useState<number | null>(8);

  const handleRetry = async () => {
    setRetrying(true);
    setAutoRetryIn(null);
    try {
      await onRetry();
      setAttempts((n) => n + 1);
    } finally {
      setRetrying(false);
      // Re-arm the auto-retry countdown after each manual attempt
      setAutoRetryIn(15);
    }
  };

  // Auto-retry countdown — only runs while idle and under the cap
  useEffect(() => {
    if (retrying || autoRetryIn === null || attempts >= 3) return;
    if (autoRetryIn <= 0) {
      handleRetry();
      return;
    }
    const t = setTimeout(() => setAutoRetryIn((v) => (v ?? 0) - 1), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRetryIn, retrying, attempts]);

  const copyShareId = async () => {
    try {
      await navigator.clipboard.writeText(shareId);
      setCopied(true);
      toast.success("Reference ID copied", {
        description: "Send it to the project owner so they can investigate.",
      });
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error("Could not copy automatically", {
        description: shareId,
      });
    }
  };

  const exhausted = attempts >= 3;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="text-center space-y-5 max-w-sm">
        <div className="mx-auto h-14 w-14 rounded-full bg-destructive/10 flex items-center justify-center">
          <AlertTriangle className="h-7 w-7 text-destructive/70" />
        </div>

        <div className="space-y-2">
          <h1 className="font-display text-xl font-bold">Model Unavailable</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {exhausted
              ? "We tried a few times but still couldn't load the 3D model for this experience. The link may have expired or the model may have been removed."
              : "We couldn't load the 3D model for this experience. This usually clears up on its own — we'll try again automatically."}
          </p>
          {projectName && (
            <p className="text-xs text-muted-foreground/70">
              Experience: <span className="font-medium">{projectName}</span>
            </p>
          )}
        </div>

        {/* Retry status */}
        <div className="rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground space-y-2">
          {retrying ? (
            <div className="flex items-center justify-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>Reconnecting…</span>
            </div>
          ) : exhausted ? (
            <span>Auto-retry stopped after {attempts} attempts.</span>
          ) : autoRetryIn !== null ? (
            <span>
              Retrying automatically in <span className="font-semibold">{autoRetryIn}s</span>
              {attempts > 0 && <> · attempt {attempts + 1} of 3</>}
            </span>
          ) : (
            <span>Ready to retry.</span>
          )}
        </div>

        <div className="space-y-2">
          <button
            onClick={handleRetry}
            disabled={retrying}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium py-2.5 hover:bg-primary/90 disabled:opacity-60 transition-colors"
          >
            <RefreshCw className={`h-4 w-4 ${retrying ? "animate-spin" : ""}`} />
            Try again now
          </button>

          <button
            onClick={copyShareId}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl border bg-background text-foreground text-xs font-medium py-2 hover:bg-muted transition-colors"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-green-600" />
                Reference ID copied
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                Copy reference ID for support
              </>
            )}
          </button>
        </div>

        {/* Reference details for support */}
        <details className="text-left text-[11px] text-muted-foreground/80">
          <summary className="cursor-pointer text-center hover:text-foreground transition-colors">
            Technical details
          </summary>
          <div className="mt-2 rounded-lg bg-muted/40 p-3 space-y-1 font-mono break-all">
            <div>
              <span className="opacity-60">id:</span> {shareId || "unknown"}
            </div>
            {errorDetail && (
              <div>
                <span className="opacity-60">error:</span> {errorDetail}
              </div>
            )}
            <div>
              <span className="opacity-60">attempts:</span> {attempts}
            </div>
          </div>
        </details>
      </div>
    </div>
  );
};

export default ModelUnavailableRecovery;
