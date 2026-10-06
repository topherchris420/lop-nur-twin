import type { Perspective } from "./contracts";

/**
 * How the four perspectives look: R.A.I.N.'s own embodiment, taken from its
 * Godot client in topherchris420/james_library (`scripts/agent_avatar.gd`
 * LOOKS for skin and hair, `themes/lab/theme.json` for clothing) when the
 * runtime was consolidated here. Presentation only — it changes
 * nothing about who they are or what they say. Light enough for the city
 * bundle, which draws them on outings.
 */
export const EMBODIMENT: Record<
  Perspective,
  { body: string; accent: string; hair: string; skin: string }
> = {
  James: { body: "#6EA5E8", accent: "#355B88", hair: "#2A3D59", skin: "#6EA5E8" },
  Jasmine: { body: "#D88B5F", accent: "#8D5235", hair: "#231713", skin: "#8a5a3f" },
  Luca: { body: "#4FB1A8", accent: "#276A63", hair: "#1F4944", skin: "#F0CFAC" },
  Elena: { body: "#8F85DA", accent: "#524B8E", hair: "#2D2959", skin: "#F0CFAC" },
};
