import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MapPin, ClipboardPaste, Check, AlertTriangle, Info, Plus, Trash2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  type MarkerPoint,
  getMarkerColor,
  normalizeMarkerData,
  convertLegacyMarkerData,
} from "@/lib/markerTypes";

// Re-export for backward compatibility
export type { MarkerPoint } from "@/lib/markerTypes";

interface MarkerCoordinateEditorProps {
  projectId: string;
  markerData: MarkerPoint[] | null;
  onUpdate: (data: MarkerPoint[]) => void;
}

const DEFAULT_MARKERS: MarkerPoint[] = [
  { index: 1, x: 0, y: 0, z: 0, label: "Anchor Point" },
  { index: 2, x: 2000, y: 0, z: 0, label: "Reference Point" },
  { index: 3, x: 0, y: 0, z: 1500, label: "Reference Point" },
];

const MIN_MARKERS = 3;
const MAX_MARKERS = 20;

function computeSpacingQuality(markers: MarkerPoint[]): { score: number; label: string; color: string } {
  if (markers.length < 3) {
    return { score: 0, label: "Need at least 3 markers", color: "text-destructive" };
  }

  // Check all pairwise distances
  const distances: number[] = [];
  for (let i = 0; i < markers.length; i++) {
    for (let j = i + 1; j < markers.length; j++) {
      const d = Math.sqrt(
        (markers[j].x - markers[i].x) ** 2 +
        (markers[j].y - markers[i].y) ** 2 +
        (markers[j].z - markers[i].z) ** 2
      );
      distances.push(d);
    }
  }

  if (distances.some((d) => d === 0)) {
    return { score: 0, label: "Invalid — points overlap", color: "text-destructive" };
  }

  const minDist = Math.min(...distances);
  const maxDist = Math.max(...distances);

  if (minDist < 1) {
    return { score: 0, label: "Invalid — points too close", color: "text-destructive" };
  }

  // Check triangle quality using the 3 most spread points
  // Use the first 3 for basic triangle check
  const ab = Math.sqrt(
    (markers[1].x - markers[0].x) ** 2 +
    (markers[1].y - markers[0].y) ** 2 +
    (markers[1].z - markers[0].z) ** 2
  );
  const ac = Math.sqrt(
    (markers[2].x - markers[0].x) ** 2 +
    (markers[2].y - markers[0].y) ** 2 +
    (markers[2].z - markers[0].z) ** 2
  );
  const bc = Math.sqrt(
    (markers[2].x - markers[1].x) ** 2 +
    (markers[2].y - markers[1].y) ** 2 +
    (markers[2].z - markers[1].z) ** 2
  );

  const s = (ab + ac + bc) / 2;
  const area = Math.sqrt(Math.max(0, s * (s - ab) * (s - ac) * (s - bc)));

  if (area < 0.001) {
    return { score: 0, label: "Invalid — points are collinear", color: "text-destructive" };
  }

  const angles = [
    Math.acos(Math.max(-1, Math.min(1, (ab * ab + ac * ac - bc * bc) / (2 * ab * ac)))),
    Math.acos(Math.max(-1, Math.min(1, (ab * ab + bc * bc - ac * ac) / (2 * ab * bc)))),
    Math.acos(Math.max(-1, Math.min(1, (ac * ac + bc * bc - ab * ab) / (2 * ac * bc)))),
  ].map((a) => (a * 180) / Math.PI);

  const minAngle = Math.min(...angles);
  const spreadRatio = minDist / maxDist;

  // Score based on angle quality and spacing consistency
  if (minAngle < 10) return { score: 1, label: "Poor — too narrow", color: "text-destructive" };
  if (minAngle < 20) return { score: 2, label: "Fair", color: "text-yellow-600" };
  if (minAngle < 30) return { score: 3, label: "Good", color: "text-yellow-600" };
  if (minAngle < 40) return { score: 4, label: "Very Good", color: "text-green-600" };
  return { score: 5, label: `Excellent${markers.length > 3 ? ` (${markers.length} markers)` : ""}`, color: "text-green-600" };
}

const MarkerCoordinateEditor = ({ projectId, markerData, onUpdate }: MarkerCoordinateEditorProps) => {
  const [markers, setMarkers] = useState<MarkerPoint[]>(
    markerData && markerData.length >= 3 ? markerData : DEFAULT_MARKERS
  );
  const [jsonInput, setJsonInput] = useState("");
  const [showJsonPaste, setShowJsonPaste] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const quality = computeSpacingQuality(markers);

  const updateMarker = useCallback((idx: number, field: keyof MarkerPoint, value: string | number) => {
    setMarkers((prev) =>
      prev.map((m) =>
        m.index === idx
          ? {
              ...m,
              [field]: typeof value === "string" && field !== "label" ? parseFloat(value) || 0 : value,
            }
          : m
      )
    );
    setDirty(true);
  }, []);

  const addMarker = useCallback(() => {
    setMarkers((prev) => {
      if (prev.length >= MAX_MARKERS) return prev;
      const maxIndex = Math.max(...prev.map((m) => m.index));
      return [...prev, { index: maxIndex + 1, x: 0, y: 0, z: 0, label: `Marker ${maxIndex + 1}` }];
    });
    setDirty(true);
  }, []);

  const removeMarker = useCallback((idx: number) => {
    setMarkers((prev) => {
      if (prev.length <= MIN_MARKERS) return prev;
      return prev.filter((m) => m.index !== idx);
    });
    setDirty(true);
  }, []);

  const handleJsonPaste = () => {
    try {
      const parsed = JSON.parse(jsonInput);

      // Try array format first: [{ "index": 1, "x": 0, "y": 0, "z": 0 }, ...]
      if (Array.isArray(parsed)) {
        const normalized = normalizeMarkerData(parsed);
        if (!normalized || normalized.length < 3) throw new Error("Need at least 3 markers");
        setMarkers(normalized);
        setDirty(true);
        setShowJsonPaste(false);
        setJsonInput("");
        toast({ title: `${normalized.length} markers imported` });
        return;
      }

      // Try legacy format: { "A": {"x": 0, "y": 0, "z": 0}, ... }
      const legacy = convertLegacyMarkerData(parsed);
      if (legacy) {
        setMarkers(legacy);
        setDirty(true);
        setShowJsonPaste(false);
        setJsonInput("");
        toast({ title: "3 markers imported (legacy format)" });
        return;
      }

      throw new Error("Unrecognized format");
    } catch (e: any) {
      toast({
        title: "Invalid JSON format",
        description: 'Expected: [{ "index": 1, "x": 0, "y": 0, "z": 0 }, ...] or legacy { "A": {...}, "B": {...}, "C": {...} }',
        variant: "destructive",
      });
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
            <MapPin className="h-5 w-5 text-destructive" />
            Marker Configuration
          </CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowJsonPaste(!showJsonPaste)}>
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
                Paste coordinate JSON from Rhino/Grasshopper. Formats accepted:
                <code className="block mt-1 bg-background p-2 rounded text-[11px] font-mono">
                  {'[{ "index": 1, "x": 0, "y": 0, "z": 0 }, { "index": 2, "x": 2000, ... }, ...]'}
                </code>
                <code className="block mt-1 bg-background p-2 rounded text-[11px] font-mono">
                  {'Legacy: { "A": {"x":0,"y":0,"z":0}, "B": {...}, "C": {...} }'}
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

        {/* Marker rows */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {markers.map((marker) => {
            const color = getMarkerColor(marker.index);
            return (
              <div key={marker.index} className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: color.bg }}
                    />
                    <span className="font-display font-semibold">Point {marker.index}</span>
                  </div>
                  {markers.length > MIN_MARKERS && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => removeMarker(marker.index)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
                <Input
                  value={marker.label || ""}
                  onChange={(e) => updateMarker(marker.index, "label", e.target.value)}
                  placeholder={`Marker ${marker.index}`}
                  className="text-xs h-8"
                />
                <div className="space-y-2">
                  {(["x", "y", "z"] as const).map((axis) => {
                    const val = marker[axis];
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
                              updateMarker(marker.index, axis, -num);
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
                                updateMarker(marker.index, axis, isNeg ? -numVal : numVal);
                              }
                            }}
                            onBlur={(e) => {
                              const num = parseFloat(e.target.value) || 0;
                              updateMarker(marker.index, axis, isNeg ? -num : num);
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

        {/* Add marker button */}
        {markers.length < MAX_MARKERS && (
          <Button variant="outline" size="sm" className="w-full" onClick={addMarker}>
            <Plus className="mr-1 h-3 w-3" />
            Add Marker ({markers.length}/{MAX_MARKERS})
          </Button>
        )}

        {/* Quality indicator */}
        <div className="flex items-center justify-between rounded-lg border bg-muted/20 px-4 py-3">
          <div className="flex items-center gap-2">
            {quality.score === 0 && <AlertTriangle className="h-4 w-4 text-destructive" />}
            <span className="text-sm font-medium">Spacing Quality:</span>
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
