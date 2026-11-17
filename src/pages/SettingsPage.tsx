import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Download, Trash2, Shield, Package, Loader2 } from "lucide-react";
import { accountSummary, confirmPhrase, downloadModelsZip, phraseMatches } from "@/lib/accountDeletion";

const SettingsPage = () => {
  const { user, signOut } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Delete account: 1 what goes, 2 download or continue, 3 type the phrase (Helgi, 17 Nov 2026).
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof accountSummary>> | null>(null);
  const [typed, setTyped] = useState("");
  const [zipping, setZipping] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const phrase = confirmPhrase(user?.email);

  const openDelete = async (open: boolean) => {
    setDeleteOpen(open);
    if (!open) return;
    setStep(1);
    setTyped("");
    setDownloaded(false);
    setSummary(null);
    try {
      setSummary(await accountSummary());
    } catch {
      setSummary({ projects: [], models: 0 });
    }
  };

  const handleDownloadModels = async (projects = summary?.projects) => {
    try {
      const list = projects ?? (await accountSummary()).projects;
      setZipping("Preparing…");
      const n = await downloadModelsZip(list, (done, total) =>
        setZipping(done < total ? `Packing ${done + 1} of ${total}…` : "Saving…"),
      );
      setDownloaded(n > 0);
      toast(n
        ? { title: "Models downloaded", description: `${n} model${n === 1 ? "" : "s"} saved as a .zip file.` }
        : { title: "No models to download", description: "None of your experiences has a model yet." });
    } catch {
      toast({ title: "Download failed", description: "Could not pack your models. Please try again.", variant: "destructive" });
    } finally {
      setZipping(null);
    }
  };

  const handleExportData = async () => {
    setExporting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const res = await supabase.functions.invoke("export-user-data", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (res.error) throw res.error;

      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `user-data-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);

      toast({ title: "Data exported", description: "Your data has been downloaded." });
    } catch {
      toast({ title: "Export failed", description: "Could not export your data. Please try again.", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteAccount = async () => {
    setDeleting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const res = await supabase.functions.invoke("delete-user-data", {
        body: { confirmPhrase: typed },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (res.error) throw res.error;

      await signOut();
      navigate("/");
      toast({ title: "Account deleted", description: "Your account and all data have been permanently removed." });
    } catch {
      toast({ title: "Deletion failed", description: "Could not delete your account. Please try again.", variant: "destructive" });
    } finally {
      setDeleting(false);
      setTyped("");
    }
  };

  return (
    <div className="max-w-2xl space-y-6 animate-fade-in">
      <div>
        <h1 className="font-display text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your account and preferences.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-display">Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Email</Label>
            <Input value={user?.email || ""} disabled />
          </div>
          <div className="space-y-2">
            <Label>Full Name</Label>
            <Input value={user?.user_metadata?.full_name || ""} placeholder="Your name" disabled />
          </div>
          <div className="space-y-2">
            <Label>Company</Label>
            <Input placeholder="Your studio or company" disabled />
          </div>
          <Button disabled>Save Changes</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2">
            <Shield className="h-5 w-5" /> Data &amp; Privacy
          </CardTitle>
          <CardDescription>
            Manage your personal data in compliance with GDPR.{" "}
            <a href="/privacy" className="text-primary underline">Read our Privacy Policy</a>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div>
              <p className="font-medium">Export Your Data</p>
              <p className="text-sm text-muted-foreground">Download all your personal data as a JSON file.</p>
            </div>
            <Button variant="outline" onClick={handleExportData} disabled={exporting}>
              <Download className="mr-2 h-4 w-4" />
              {exporting ? "Exporting…" : "Download"}
            </Button>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-4">
            <div>
              <p className="font-medium">Download Your Models</p>
              <p className="text-sm text-muted-foreground">Every experience's 3D model (GLB) in one .zip file.</p>
            </div>
            <Button variant="outline" onClick={() => handleDownloadModels()} disabled={!!zipping}>
              {zipping ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Package className="mr-2 h-4 w-4" />}
              {zipping ?? "Download .zip"}
            </Button>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-destructive/30 p-4">
            <div>
              <p className="font-medium text-destructive">Delete Account</p>
              <p className="text-sm text-muted-foreground">Permanently delete your account, projects, and all uploaded files.</p>
            </div>
            <AlertDialog open={deleteOpen} onOpenChange={(o) => { if (!deleting) void openDelete(o); }}>
              <AlertDialogTrigger asChild>
                <Button variant="destructive">
                  <Trash2 className="mr-2 h-4 w-4" /> Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <p className="text-xs font-medium text-muted-foreground">Step {step} of 3</p>

                {step === 1 && (
                  <>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete your account?</AlertDialogTitle>
                      <AlertDialogDescription asChild>
                        <div className="space-y-2">
                          <p>Everything below is deleted permanently. It cannot be undone.</p>
                          <ul className="list-disc pl-5">
                            <li>
                              {summary
                                ? `${summary.projects.length} experience${summary.projects.length === 1 ? "" : "s"} and ${summary.models} 3D model${summary.models === 1 ? "" : "s"}`
                                : "Your experiences and 3D models"}
                            </li>
                            <li>QR codes, marker sheets and client links (they stop working)</li>
                            <li>Your profile and login</li>
                          </ul>
                        </div>
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <Button variant="destructive" onClick={() => setStep(2)}>Continue</Button>
                    </AlertDialogFooter>
                  </>
                )}

                {step === 2 && (
                  <>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Keep your models?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Download your 3D models as one .zip file before they are deleted. You get each
                        experience's GLB as stored on Archi AR (optimised for phones when "Optimize for
                        AR" was on). QR codes and marker sheets are not included.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <Button
                      variant="outline"
                      onClick={() => handleDownloadModels()}
                      disabled={!!zipping || !summary?.models}
                    >
                      {zipping ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Package className="mr-2 h-4 w-4" />}
                      {zipping ?? (summary?.models ? `Download ${summary.models} model${summary.models === 1 ? "" : "s"} (.zip)` : "No models to download")}
                    </Button>
                    {downloaded && <p className="text-sm text-muted-foreground">Downloaded. Check your downloads folder before you go on.</p>}
                    <AlertDialogFooter>
                      <Button variant="ghost" onClick={() => setStep(1)} disabled={!!zipping}>Back</Button>
                      <Button variant="destructive" onClick={() => setStep(3)} disabled={!!zipping}>
                        {downloaded ? "Continue to delete" : "Skip and delete"}
                      </Button>
                    </AlertDialogFooter>
                  </>
                )}

                {step === 3 && (
                  <>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Confirm deletion</AlertDialogTitle>
                      <AlertDialogDescription>
                        Type <span className="font-mono font-semibold text-foreground">{phrase}</span> to delete your account.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="space-y-2 py-2">
                      <Label htmlFor="delete-phrase">Confirmation</Label>
                      <Input
                        id="delete-phrase"
                        autoComplete="off"
                        autoCapitalize="off"
                        spellCheck={false}
                        className="font-mono"
                        placeholder={phrase}
                        value={typed}
                        onChange={(e) => setTyped(e.target.value)}
                      />
                    </div>
                    <AlertDialogFooter>
                      <Button variant="ghost" onClick={() => setStep(2)} disabled={deleting}>Back</Button>
                      <Button
                        variant="destructive"
                        onClick={handleDeleteAccount}
                        disabled={!phraseMatches(typed, user?.email) || deleting}
                      >
                        {deleting ? "Deleting…" : "Delete my account"}
                      </Button>
                    </AlertDialogFooter>
                  </>
                )}
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default SettingsPage;
