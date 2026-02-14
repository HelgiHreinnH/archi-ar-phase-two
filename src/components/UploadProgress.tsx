import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

interface UploadProgressProps {
  progress: number;
  uploadedBytes: number;
  totalBytes: number;
  onCancel?: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const UploadProgress = ({ progress, uploadedBytes, totalBytes, onCancel }: UploadProgressProps) => {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          {formatBytes(uploadedBytes)} / {formatBytes(totalBytes)}
        </span>
        <span className="font-medium">{Math.round(progress)}%</span>
      </div>
      <Progress value={progress} className="h-2" />
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">⚠️ Don't close this tab during upload</p>
        {onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel} className="h-7 text-xs">
            <X className="mr-1 h-3 w-3" />
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
};

export default UploadProgress;
