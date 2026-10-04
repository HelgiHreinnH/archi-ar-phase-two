import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  MoreHorizontal, ExternalLink, Share2, Link2, FileText, Pencil, Copy, Archive, ArchiveRestore, Trash2, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import SharePopover from "@/components/SharePopover";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { friendlyError } from "@/lib/plans";
import { buildPublicExperienceUrl } from "@/lib/publicExperienceUrl";
import { downloadTabletopPrintSheet } from "@/lib/generateTabletopPDF";
import { ARCHIVED, duplicateProject, isArchived, restoredStatus } from "@/lib/projectActions";
import type { Tables } from "@/integrations/supabase/types";

type Project = Tables<"projects">;

interface ProjectCardMenuProps {
  project: Project;
  /** All of the user's project names — used to name duplicates. */
  allNames: ReadonlyArray<string>;
}

type OpenDialog = null | "share" | "rename" | "archive" | "delete";

/**
 * The ⋯ menu in the top-right corner of an experience card (Dashboard and
 * Experiences list). Clicks inside never open the card itself.
 */
const ProjectCardMenu = ({ project, allNames }: ProjectCardMenuProps) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState(project.name);

  const archived = isArchived(project);
  const live = project.status === "active" && !!project.share_link;
  const shareUrl = project.share_link ? buildPublicExperienceUrl(project.share_link) : null;
  const singleQr = project.mode === "tabletop" || project.mode === "wall";

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["projects"] });
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      console.error(`[ProjectCardMenu] ${label} failed:`, err);
      toast({ title: `${label} failed`, description: friendlyError(err), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const copyLink = () => run("Copy link", async () => {
    await navigator.clipboard.writeText(shareUrl!);
    toast({ title: "Client link copied" });
  });

  const printSheet = () => run("Print sheet", async () => {
    let storedQrUrl: string | null = null;
    if (project.qr_code_url) {
      const { data } = await supabase.storage.from("project-assets").createSignedUrl(project.qr_code_url, 300);
      storedQrUrl = data?.signedUrl ?? null;
    }
    await downloadTabletopPrintSheet(project.name, shareUrl!, project.mode === "wall" ? "wall" : "table", storedQrUrl);
  });

  const rename = () => run("Rename", async () => {
    const name = newName.trim();
    if (!name || name === project.name) { setDialog(null); return; }
    const { error } = await supabase.from("projects").update({ name }).eq("id", project.id);
    if (error) throw error;
    await refresh();
    setDialog(null);
    toast({ title: "Renamed", description: name });
  });

  const duplicate = () => run("Duplicate", async () => {
    const copy = await duplicateProject(project, allNames);
    await refresh();
    toast({
      title: "Duplicated",
      description: copy.model_url || !project.model_url
        ? `"${copy.name}" is a new draft.`
        : `"${copy.name}" is a new draft. The model couldn't be copied, so upload it again.`,
    });
  });

  const setArchived = (toArchive: boolean) => run(toArchive ? "Archive" : "Restore", async () => {
    const status = toArchive ? ARCHIVED : restoredStatus(project);
    const { error } = await supabase.from("projects").update({ status }).eq("id", project.id);
    if (error) throw error;
    await refresh();
    setDialog(null);
    toast({
      title: toArchive ? "Archived" : "Restored",
      description: toArchive
        ? "The client link is switched off. Restore it any time from Archived."
        : status === "active" ? "The client link works again." : "Back in your experiences as a draft.",
    });
  });

  const remove = () => run("Delete", async () => {
    const { error } = await supabase.from("projects").delete().eq("id", project.id);
    if (error) throw error;
    await refresh();
    setDialog(null);
    toast({ title: "Experience deleted" });
  });

  return (
    <div onClick={stop} onKeyDown={stop}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 -mr-2 -mt-1 text-muted-foreground hover:text-foreground"
            aria-label={`Actions for ${project.name}`}
            disabled={busy}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56" onClick={stop}>
          <DropdownMenuItem onSelect={() => navigate(`/dashboard/experiences/${project.id}`)}>
            <ExternalLink className="mr-2 h-4 w-4" /> Open
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!live} onSelect={() => setDialog("share")}>
            <Share2 className="mr-2 h-4 w-4" /> Share…
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!live} onSelect={copyLink}>
            <Link2 className="mr-2 h-4 w-4" /> Copy client link
          </DropdownMenuItem>
          {singleQr && (
            <DropdownMenuItem disabled={!live} onSelect={printSheet}>
              <FileText className="mr-2 h-4 w-4" /> Download QR print sheet
            </DropdownMenuItem>
          )}
          {!live && !archived && (
            <p className="px-2 pb-1.5 text-[11px] text-muted-foreground">Generate the experience to share it.</p>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => { setNewName(project.name); setDialog("rename"); }}>
            <Pencil className="mr-2 h-4 w-4" /> Rename…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={duplicate}>
            <Copy className="mr-2 h-4 w-4" /> Duplicate
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {archived ? (
            <DropdownMenuItem onSelect={() => setArchived(false)}>
              <ArchiveRestore className="mr-2 h-4 w-4" /> Restore
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => setDialog("archive")}>
              <Archive className="mr-2 h-4 w-4" /> Archive…
            </DropdownMenuItem>
          )}
          <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setDialog("delete")}>
            <Trash2 className="mr-2 h-4 w-4" /> Delete…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {shareUrl && (
        <SharePopover
          shareUrl={shareUrl}
          projectName={project.name}
          open={dialog === "share"}
          onOpenChange={(o) => setDialog(o ? "share" : null)}
        />
      )}

      <Dialog open={dialog === "rename"} onOpenChange={(o) => setDialog(o ? "rename" : null)}>
        <DialogContent className="sm:max-w-sm" onClick={stop}>
          <DialogHeader>
            <DialogTitle>Rename experience</DialogTitle>
            <DialogDescription>The client sees this name in the AR view.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-2"
            onSubmit={(e) => { e.preventDefault(); void rename(); }}
          >
            <Label htmlFor={`rename-${project.id}`}>Name</Label>
            <Input id={`rename-${project.id}`} value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus maxLength={120} />
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
              <Button type="submit" disabled={busy || !newName.trim()}>Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={dialog === "archive"} onOpenChange={(o) => setDialog(o ? "archive" : null)}>
        <AlertDialogContent onClick={stop}>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive "{project.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              It moves to Archived and the client link stops working until you restore it.
              {singleQr && " It still counts toward your free Tabletop/Wall models."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); void setArchived(true); }} disabled={busy}>
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={dialog === "delete"} onOpenChange={(o) => setDialog(o ? "delete" : null)}>
        <AlertDialogContent onClick={stop}>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{project.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the experience and its client link for good. It can't be undone.
              {!archived && " To keep it but hide it, archive it instead."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => { e.preventDefault(); void remove(); }}
              disabled={busy}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ProjectCardMenu;
