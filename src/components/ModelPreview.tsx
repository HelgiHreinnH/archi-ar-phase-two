import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download, Replace, Trash2, FileBox } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface ModelPreviewProps {
  modelUrl: string;
  projectId: string;
  onReplace: () => void;
  onDelete: () => void;
}

function getFormat(url: string): string {
  if (url.toLowerCase().endsWith(".usdz")) return "USDZ";
  return "GLB";
}

function getFileName(url: string): string {
  return url.split("/").pop() || url;
}

const ModelPreview = ({ modelUrl, projectId, onReplace, onDelete }: ModelPreviewProps) => {
  const format = getFormat(modelUrl);
  const fileName = getFileName(modelUrl);

  const handleDownload = async () => {
    const { data, error } = await supabase.storage
      .from("project-models")
      .createSignedUrl(modelUrl, 60);

    if (error || !data?.signedUrl) {
      toast({ title: "Could not generate download link", variant: "destructive" });
      return;
    }
    window.open(data.signedUrl, "_blank");
  };

  const handleDelete = async () => {
    if (!confirm("Remove this model? The file will be deleted.")) return;
    const { error: storageErr } = await supabase.storage
      .from("project-models")
      .remove([modelUrl]);

    if (storageErr) {
      toast({ title: "Error removing file", variant: "destructive" });
      return;
    }

    const { error: dbErr } = await supabase
      .from("projects")
      .update({ model_url: null })
      .eq("id", projectId);

    if (dbErr) {
      toast({ title: "Error updating project", variant: "destructive" });
      return;
    }

    toast({ title: "Model removed" });
    onDelete();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border">
        <FileBox className="h-8 w-8 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{fileName}</p>
          <Badge variant="secondary" className="text-[10px] mt-1">{format}</Badge>
        </div>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="flex-1" onClick={handleDownload}>
          <Download className="mr-1 h-3 w-3" />
          Download
        </Button>
        <Button variant="outline" size="sm" onClick={onReplace}>
          <Replace className="h-3 w-3" />
        </Button>
        <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={handleDelete}>
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
};

export default ModelPreview;
