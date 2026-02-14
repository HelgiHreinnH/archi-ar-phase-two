import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MapPin, ClipboardPaste, Check, AlertTriangle, Info } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

export interface MarkerPoint {
  x: number;
  y: number;
  z: number;
  label: string;
}

export interface MarkerData {
  A: MarkerPoint;
  B: MarkerPoint;
  C: MarkerPoint;
}

interface MarkerCoordinateEditorProps {
  projectId: string;
  markerData: MarkerData | null;
  onUpdate: (data: MarkerData) => void;
}

const DEFAULT_MARKERS: MarkerData = {
  A: { x: 0, y: 0, z: 0, label: "Anchor Point" },
  B: { x: 2000, y: 0, z: 0, label: "Reference Point" },
  C: { x: 0, y: 0, z: 1500, label: "Reference Point" },
};

const MARKER_CONFIG = [
  { id: "A" as const, color: "bg-marker-red", textColor: "text-marker-red", name: "Point A", defaultLabel: "Anchor Point" },
  { id: "B" as const, color: "bg-marker-green", textColor: "text-marker-green", name: "Point B", defaultLabel: "Reference Point" },
  { id: "C" as const, color: "bg-marker-blue", textColor: "text-marker-blue", name: "Point C", defaultLabel: "Reference Point" },
] as const;

function computeTriangleQuality(markers: MarkerData): { score: number; label: string; color: string } {
  const ab = Math.sqrt(
    (markers.B.x - markers.A.x) ** 2 +
    (markers.B.y - markers.A.y) ** 2 +
    (markers.B.z - markers.A.z) ** 2
  );
  const ac = Math.sqrt(
    (markers.C.x - markers.A.x) ** 2 +
    (markers.C.y - markers.A.y) ** 2 +
    (markers.C.z - markers.A.z) ** 2
  );
  const bc = Math.sqrt(
    (markers.C.x - markers.B.x) ** 2 +
    (markers.C.y - markers.B.y) ** 2 +
    (markers.C.z - markers.B.z) ** 2
  );

  if (ab === 0 || ac === 0 || bc === 0) {
    return { score: 0, label: "Invalid — points overlap", color: "text-destructive" };
  }

  // Calculate area using Heron's formula
  const s = (ab + ac + bc) / 2;
  const area = Math.sqrt(Math.max(0, s * (s - ab) * (s - ac) * (s - bc)));

  if (area < 0.001) {
    return { score: 0, label: "Invalid — points are collinear", color: "text-destructive" };
  }

  // Check angles — ideal triangle has no angle too small or too large
  const angles = [
    Math.acos(Math.max(-1, Math.min(1, (ab * ab + ac * ac - bc * bc) / (2 * ab * ac)))),
    Math.acos(Math.max(-1, Math.min(1, (ab * ab + bc * bc - ac * ac) / (2 * ab * bc)))),
    Math.acos(Math.max(-1, Math.min(1, (ac * ac + bc * bc - ab * ab) / (2 * ac * bc)))),
  ].map((a) => (a * 180) / Math.PI);

  const minAngle = Math.min(...angles);

  if (minAngle < 10) return { score: 1, label: "Poor — too narrow", color: "text-destructive" };
  if (minAngle < 20) return { score: 2, label: "Fair", color: "text-marker-yellow" };
  if (minAngle < 30) return { score: 3, label: "Good", color: "text-marker-yellow" };
  if (minAngle < 40) return { score: 4, label: "Very Good", color: "text-marker-green" };
  return { score: 5, label: "Excellent", color: "text-marker-green" };
}

const isValidMarkerData = (data: unknown): data is MarkerData => {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return ["A", "B", "C"].every(
    (k) => d[k] && typeof d[k] === "object" && "x" in (d[k] as object)
  );
};

const MarkerCoordinateEditor = ({ projectId, markerData, onUpdate }: MarkerCoordinateEditorProps) => {
  const [markers, setMarkers] = useState<MarkerData>(isValidMarkerData(markerData) ? markerData : DEFAULT_MARKERS);
  const [jsonInput, setJsonInput] = useState("");
  const [showJsonPaste, setShowJsonPaste] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const quality = computeTriangleQuality(markers);

  const updateMarker = useCallback((id: "A" | "B" | "C", field: keyof MarkerPoint, value: string | number) => {
    setMarkers((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        [field]: typeof value === "string" && field !== "label" ? parseFloat(value) || 0 : value,
      },
    }));
    setDirty(true);
  }, []);

  const handleJsonPaste = () => {
    try {
      const parsed = JSON.parse(jsonInput);
      // Support format: { "A": {"x": 0, "y": 0, "z": 0}, ... }
      if (!parsed.A || !parsed.B || !parsed.C) {
        throw new Error("Missing A, B, or C");
      }
      const newMarkers: MarkerData = {
        A: { x: Number(parsed.A.x) || 0, y: Number(parsed.A.y) || 0, z: Number(parsed.A.z) || 0, label: parsed.A.label || markers.A.label },
        B: { x: Number(parsed.B.x) || 0, y: Number(parsed.B.y) || 0, z: Number(parsed.B.z) || 0, label: parsed.B.label || markers.B.label },
        C: { x: Number(parsed.C.x) || 0, y: Number(parsed.C.y) || 0, z: Number(parsed.C.z) || 0, label: parsed.C.label || markers.C.label },
      };
      setMarkers(newMarkers);
      setDirty(true);
      setShowJsonPaste(false);
      setJsonInput("");
      toast({ title: "Coordinates imported" });
    } catch {
      toast({ title: "Invalid JSON format", description: 'Expected: { "A": {"x":0,"y":0,"z":0}, "B": {...}, "C": {...} }', variant: "destructive" });
    }
  };

  const handleSave = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("projects")
      .update({ marker_data: markers as any })
      .eq("id", projectId);

    if (error) {
      toast({ title: "Error saving coordinates", variant: "destructive" });
    } else {
      toast({ title: "Coordinates saved" });
      setDirty(false);
      onUpdate(markers);
    }
    setSaving(false);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="font-display flex items-center gap-2">
            <MapPin className="h-5 w-5 text-marker-red" />
            Marker Configuration
          </CardTitle>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowJsonPaste(!showJsonPaste)}
            >
              <ClipboardPaste className="mr-1 h-3 w-3" />
              Paste JSON
            </Button>
            {dirty && (
              <Button size="sm" onClick={handleSave} disabled={saving}>
                <Check className="mr-1 h-3 w-3" />
                {saving ? "Saving..." : "Save"}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* JSON Paste Area */}
        {showJsonPaste && (
          <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
            <div className="flex items-start gap-2">
              <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <p className="text-xs text-muted-foreground">
                Paste coordinate JSON from Rhino/Grasshopper. Expected format:
                <code className="block mt-1 bg-background p-2 rounded text-[11px] font-mono">
                  {'{ "A": {"x": 0, "y": 0, "z": 0}, "B": {"x": 2000, "y": 0, "z": 0}, "C": {"x": 0, "y": 0, "z": 1500} }'}
                </code>
              </p>
            </div>
            <Textarea
              value={jsonInput}
              onChange={(e) => setJsonInput(e.target.value)}
              placeholder="Paste JSON here..."
              rows={3}
              className="font-mono text-xs"
            />
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => { setShowJsonPaste(false); setJsonInput(""); }}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleJsonPaste} disabled={!jsonInput.trim()}>
                Import
              </Button>
            </div>
          </div>
        )}

        {/* Coordinate Inputs */}
        <div className="grid gap-4 sm:grid-cols-3">
          {MARKER_CONFIG.map((cfg) => {
            const point = markers[cfg.id];
            return (
              <div key={cfg.id} className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <div className={`h-3 w-3 rounded-full ${cfg.color}`} />
                  <span className="font-display font-semibold">{cfg.name}</span>
                </div>
                <Input
                  value={point.label}
                  onChange={(e) => updateMarker(cfg.id, "label", e.target.value)}
                  placeholder={cfg.defaultLabel}
                  className="text-xs h-8"
                />
                <div className="grid grid-cols-3 gap-2">
                  {(["x", "y", "z"] as const).map((axis) => {
                    const val = point[axis];
                    const isNeg = typeof val === "number" ? val < 0 : String(val).startsWith("-");
                    const absVal = typeof val === "number" ? Math.abs(val) : String(val).replace(/^-/, "");
                    return (
                      <div key={axis}>
                        <Label className="text-[10px] text-muted-foreground uppercase">{axis} (mm)</Label>
                        <div className="flex gap-1">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 w-8 shrink-0 px-0 font-mono text-xs"
                            onClick={() => {
                              const num = typeof val === "number" ? val : parseFloat(String(val)) || 0;
                              updateMarker(cfg.id, axis, -num);
                            }}
                          >
                            {isNeg ? "−" : "+"}
                          </Button>
                          <Input
                            type="text"
                            inputMode="numeric"
                            value={absVal}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v === "" || /^\d*\.?\d*$/.test(v)) {
                                const numVal = parseFloat(v) || 0;
                                updateMarker(cfg.id, axis, isNeg ? -numVal : numVal);
                              }
                            }}
                            onBlur={(e) => {
                              const num = parseFloat(e.target.value) || 0;
                              updateMarker(cfg.id, axis, isNeg ? -num : num);
                            }}
                            className="font-mono text-sm h-8"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Triangle Quality */}
        <div className="flex items-center justify-between rounded-lg border bg-muted/20 px-4 py-3">
          <div className="flex items-center gap-2">
            {quality.score === 0 ? (
              <AlertTriangle className="h-4 w-4 text-destructive" />
            ) : null}
            <span className="text-sm font-medium">Triangle Quality:</span>
            <span className={`text-sm font-semibold ${quality.color}`}>
              {"⭐".repeat(quality.score)} {quality.label}
            </span>
          </div>
          {quality.score >= 3 && (
            <Badge variant="secondary" className="text-xs">
              Ready for AR
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default MarkerCoordinateEditor;
