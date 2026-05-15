import { Button } from "@/components/ui/button";
import { Camera } from "lucide-react";

interface ARPermissionProps {
  onCancel: () => void;
  onRetry: () => void;
  errorMessage?: string | null;
}

const ARPermission = ({ onCancel, onRetry, errorMessage }: ARPermissionProps) => {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="max-w-sm w-full text-center space-y-6">
        <div className="bg-destructive/10 rounded-full w-20 h-20 flex items-center justify-center mx-auto">
          <Camera className="h-10 w-10 text-destructive" />
        </div>
        <div className="space-y-2">
          <h1 className="font-display text-2xl font-bold">Camera Access Required</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {errorMessage || "Please enable camera permissions in your device settings to view this AR experience."}
          </p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onCancel}>
            Cancel
          </Button>
          <Button className="flex-1" onClick={onRetry}>
            Try Again
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ARPermission;
