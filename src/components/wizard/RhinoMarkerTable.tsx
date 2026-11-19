/**
 * Read-only marker list for Spatial when the markers came from the GLB
 * (D18, Helgi 19 Nov 2026: Rhino is the only source; no override here).
 * To change a coordinate the architect moves the sheet in Rhino, exports with
 * the plugin and uploads the new GLB.
 */
import { AlertTriangle, Lock } from "lucide-react";
import { getSafeMarkerColor, markerExtrasWarnings, type MarkerPoint } from "@/lib/markerTypes";
import { getMarkerLabel } from "@/lib/spatial/markerLabels";

const fmt = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 1, minimumFractionDigits: 1 });

export default function RhinoMarkerTable({ markers }: { markers: MarkerPoint[] }) {
  const flagged = markerExtrasWarnings(markers);
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <p>
          Read from the Rhino model ({markers.length} markers). Coordinates are set in Rhino only: move the sheet
          there, export with the Archi AR plugin and upload the new GLB in the Model step.
        </p>
      </div>

      {flagged.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
          <p>
            {flagged.map((m) => `${getMarkerLabel(m.index)} (${m.extrasDeltaMm!.toFixed(1)} mm)`).join(", ")}:{" "}
            the marker position in the model differs from the plugin's export data by more than 1 mm. The model
            position is used. Export again from the plugin to clear this.
          </p>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Marker</th>
              <th className="px-3 py-2 text-right font-medium">X (mm)</th>
              <th className="px-3 py-2 text-right font-medium">Y (mm)</th>
              <th className="px-3 py-2 text-right font-medium">Z (mm)</th>
            </tr>
          </thead>
          <tbody>
            {markers.map((m) => (
              <tr key={m.index} className="border-t">
                <td className="px-3 py-2">
                  <span className="inline-flex items-center gap-2 font-semibold">
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: getSafeMarkerColor(m.index).bg }} />
                    {getMarkerLabel(m.index)}
                  </span>
                </td>
                <td className="px-3 py-2 text-right font-mono">{fmt(m.x)}</td>
                <td className="px-3 py-2 text-right font-mono">{fmt(m.y)}</td>
                <td className="px-3 py-2 text-right font-mono">{fmt(m.z)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
