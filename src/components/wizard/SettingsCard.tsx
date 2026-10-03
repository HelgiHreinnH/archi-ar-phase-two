import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Check, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

interface SettingsCardProps {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  /** Right side of the title row (e.g. an info popover). */
  action?: ReactNode;
  /** Bottom line, pinned to the card's foot so side-by-side cards align. */
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
}

/**
 * Shared shell for the "Scale & Quality" step (Oct 2026): the presentation
 * config and Model quality cards sit side by side and must read as one set —
 * same header (icon · title · subtitle), same padding, equal height, and the
 * save status pinned to the bottom of both.
 */
const SettingsCard = ({ icon: Icon, title, subtitle, action, footer, className = "", children }: SettingsCardProps) => (
  <Card className={`flex h-full flex-col ${className}`}>
    <CardHeader className="pb-4">
      <CardTitle className="text-base flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" />
        {title}
        {action && <span className="ml-auto">{action}</span>}
      </CardTitle>
      <p className="text-sm text-muted-foreground">{subtitle}</p>
    </CardHeader>
    <CardContent className="flex flex-1 flex-col gap-4">
      <div className="flex-1">{children}</div>
      {footer}
    </CardContent>
  </Card>
);

export const SaveStatusLine = ({ status }: { status: SaveStatus }) => (
  <p className="h-4 text-[11px] text-muted-foreground flex items-center gap-1" aria-live="polite">
    {status === "saving" && (<><Loader2 className="h-3 w-3 animate-spin" /> Saving…</>)}
    {status === "saved" && (<><Check className="h-3 w-3 text-green-600" /> Changes saved</>)}
    {status === "error" && <span className="text-destructive">Not saved — check your connection</span>}
  </p>
);

export default SettingsCard;
