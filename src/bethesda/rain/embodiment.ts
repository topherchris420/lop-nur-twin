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

/**
 * Who each perspective is drawn as, from the same Godot client's `LOOKS`
 * table: James is an octopus in spectacles; Jasmine wears safety goggles as a
 * headband and gold hoops, with a natural afro; Luca a sweater, a scarf and
 * swept hair; Elena a blazer and an A-line skirt, long hair and glasses.
 * Jasmine's clothes are the lab's own, not the client's: where the client
 * dresses her in overalls, the lab has a yellow off-the-shoulder top, a satin
 * wrap skirt slit to the thigh, heels and a fine gold chain. `figures.ts` models
 * them in 3D from this table and nothing else.
 */
export type Look =
  | { archetype: "octopus"; accessory: "spectacles" }
  | {
      archetype: "humanoid";
      build: "feminine" | "masculine";
      hair: "afro" | "swept" | "long";
      outfit: "off_shoulder_wrap" | "scarf" | "blazer_skirt";
      accessory: "goggles" | "glasses" | "";
      earrings: boolean;
      lashes: boolean;
      /** Lip colour where the client gives one. */
      lips: string | null;
    };

export const LOOKS: Record<Perspective, Look> = {
  James: { archetype: "octopus", accessory: "spectacles" },
  Jasmine: {
    archetype: "humanoid",
    build: "feminine",
    hair: "afro",
    outfit: "off_shoulder_wrap",
    accessory: "goggles",
    earrings: true,
    lashes: true,
    lips: "#6e2a36",
  },
  Luca: {
    archetype: "humanoid",
    build: "masculine",
    hair: "swept",
    outfit: "scarf",
    accessory: "",
    earrings: false,
    lashes: false,
    lips: null,
  },
  Elena: {
    archetype: "humanoid",
    build: "feminine",
    hair: "long",
    outfit: "blazer_skirt",
    accessory: "glasses",
    earrings: false,
    lashes: true,
    lips: "#b4485a",
  },
};
