import { Grid3X3, LayoutPanelTop, MapPin, type LucideIcon } from "lucide-react";

export type ExperienceMode = "tabletop" | "wall" | "multipoint";

/** Normalise the raw `projects.mode` column to one of the three modes. */
export function toExperienceMode(raw: string | null | undefined): ExperienceMode {
  return raw === "multipoint" ? "multipoint" : raw === "wall" ? "wall" : "tabletop";
}

interface ModeCopy {
  /** UI label ("Spatial" is the UI name for the internal `multipoint` value). */
  label: string;
  icon: LucideIcon;
  /** Where the printed QR code goes — used in guidance copy. */
  surface: string;
}

export const MODE_COPY: Record<ExperienceMode, ModeCopy> = {
  tabletop: { label: "Tabletop", icon: Grid3X3, surface: "table" },
  wall: { label: "Wall", icon: LayoutPanelTop, surface: "wall" },
  multipoint: { label: "Spatial", icon: MapPin, surface: "space" },
};
