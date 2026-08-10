/**
 * Evidence X-ray: making the four layers of this model physically separate.
 *
 * The reconstruction draws four different kinds of thing in one convincing
 * picture — what a cited scene shows, what a publication says, what this
 * project inferred, and what it invented so the site reads as a place — and by
 * default they are equally solid, equally lit and equally sharp. A viewer has
 * no way to see the difference without clicking each one, and a screenshot
 * carries none of it at all. That is the failure mode this module exists to fix:
 * *a reconstruction that renders a guess and an observation identically is
 * making a claim it has not earned.*
 *
 * `evidenceMode.ts` already answers this by subtraction — pick a threshold and
 * the weaker classes stop being drawn. That is honest and it is all-or-nothing,
 * and what it cannot show is the *relationship* between the layers: how little
 * of the site is observed, and how much of the impressive part is sitting on
 * top of it.
 *
 * X-ray shows that relationship instead of hiding one side of it. Two things
 * happen at once, and both are ordinal — stronger evidence always reads as more
 * solid and sits lower:
 *
 * - **Stratification.** Each classification lifts to its own altitude, so the
 *   model separates into four strata like an exploded diagram. Observed stays
 *   on the ground because it is the only layer that is *of* the ground.
 * - **Ghosting.** Weaker layers stop being drawn as finished buildings and
 *   become schematic shells — translucent, edge-lit, eaten away by a dissolve
 *   that gets stronger as the support gets weaker.
 *
 * The dissolve is the part that matters and it is deliberately not a fade. A
 * uniformly transparent building still reads as a building seen through glass.
 * Something with holes eaten through it reads as incomplete, which is the
 * accurate impression.
 *
 * Nothing here decides what class a subject is — that is the ledger's job, read
 * through `effectiveClassification`. This module only decides what a class
 * *looks like*.
 */

import { EVIDENCE_CLASSIFICATIONS, type EvidenceClassification } from "./evidence";

export type XrayMode =
  /** The reconstruction as built: one solid, convincing picture. */
  | "off"
  /** Layers stay in place; weaker ones ghost and dissolve where they stand. */
  | "ghost"
  /** Layers separate vertically into four strata, weaker ones ghosted. */
  | "stratified";

export const XRAY_MODES: readonly XrayMode[] = ["off", "ghost", "stratified"];

export const XRAY_MODE_META: Record<
  XrayMode,
  { label: string; shortLabel: string; glyph: string; description: string }
> = {
  off: {
    label: "Reconstruction",
    shortLabel: "Solid",
    // Glyphs pair with every label so a mode is never signalled by colour or
    // position alone (WCAG 1.4.1).
    glyph: "■",
    description:
      "The complete model, drawn as one solid scene. Observation, inference and invention are equally sharp here, which is exactly why the other two modes exist.",
  },
  ghost: {
    label: "X-ray in place",
    shortLabel: "X-ray",
    glyph: "◫",
    description:
      "Every subject stays where it is, and how solid it looks becomes how well it is supported. Interpreted and illustrative content turns to dissolving shells you can see straight through.",
  },
  stratified: {
    label: "X-ray stratified",
    shortLabel: "Strata",
    glyph: "≣",
    description:
      "The four evidence layers separate vertically into an exploded diagram, observed on the ground and illustrative highest. Drop lines connect each lifted subject to where it actually sits.",
  },
};

/**
 * How one classification is drawn under X-ray.
 *
 * `liftM` is in metres of altitude. The spacing is wide enough that the four
 * strata read as separate at a site-wide camera distance, and the tallest
 * modeled structure is 30 m, so no stratum can intersect the one above it.
 */
export interface XrayLayerTreatment {
  classification: EvidenceClassification;
  /** Altitude this layer rises to when stratified, in metres. */
  liftM: number;
  /** Whether the detailed model is drawn, or a schematic shell instead. */
  body: "solid" | "ghost";
  /** Shell opacity, when ghosted. */
  opacity: number;
  /**
   * How much of the shell is eaten away, 0-1. Weaker support means more of the
   * surface is simply missing rather than merely transparent.
   */
  dissolve: number;
  /** What the viewer is being told by this treatment. */
  reading: string;
}

/**
 * The single table that decides what each layer looks like.
 *
 * Ordinal by construction: lift rises, opacity falls and dissolve grows
 * monotonically from observed to illustrative, so a stronger claim can never
 * render as less certain than a weaker one. `xrayTreatmentsAreOrdinal()` asserts
 * that property, and the unit tests hold it to it.
 */
export const XRAY_LAYERS: Readonly<Record<EvidenceClassification, XrayLayerTreatment>> = {
  observed: {
    classification: "observed",
    liftM: 0,
    body: "solid",
    opacity: 1,
    dissolve: 0,
    reading:
      "Stays on the ground and stays solid: this is the layer that is actually of the ground.",
  },
  reported: {
    classification: "reported",
    liftM: 115,
    body: "solid",
    opacity: 0.92,
    dissolve: 0.08,
    reading:
      "Lifted clear of the observed layer but still drawn as built: a publication says it is there, and this model chose where to put it.",
  },
  interpreted: {
    classification: "interpreted",
    liftM: 235,
    body: "ghost",
    opacity: 0.34,
    dissolve: 0.34,
    reading:
      "A shell rather than a building. This project assigned the identity and the dimensions; no cited source states them.",
  },
  illustrative: {
    classification: "illustrative",
    liftM: 355,
    body: "ghost",
    opacity: 0.18,
    dissolve: 0.58,
    reading:
      "Barely there, because it is barely a claim. Scene dressing added so the site reads as a place, resolved in nothing.",
  },
};

/** The layers in render order, strongest first. */
export const XRAY_LAYER_ORDER: readonly XrayLayerTreatment[] =
  EVIDENCE_CLASSIFICATIONS.map((classification) => XRAY_LAYERS[classification]);

/**
 * True when the treatment table is monotonic across all three channels.
 *
 * Checked by the test suite rather than at runtime: a table that lets an
 * interpreted subject look more solid than a reported one would quietly invert
 * the whole point of the mode, and it is the kind of mistake a careless edit
 * makes and nobody notices in a screenshot.
 */
export function xrayTreatmentsAreOrdinal(): boolean {
  for (let index = 1; index < XRAY_LAYER_ORDER.length; index += 1) {
    const stronger = XRAY_LAYER_ORDER[index - 1];
    const weaker = XRAY_LAYER_ORDER[index];
    if (stronger === undefined || weaker === undefined) return false;
    if (weaker.liftM <= stronger.liftM) return false;
    if (weaker.opacity > stronger.opacity) return false;
    if (weaker.dissolve < stronger.dissolve) return false;
  }
  return true;
}

/**
 * The treatment for a subject, given the mode and which layer is focused.
 *
 * Focus is an emphasis, never a filter: an unfocused layer is pushed down to a
 * faint shell but is still drawn, because a viewer isolating the observed layer
 * needs to see how much is being held back, not have it silently removed. That
 * is the same reason `describeEvidenceMode` reports what a mode withholds.
 */
export function xrayTreatment(
  classification: EvidenceClassification,
  mode: XrayMode,
  focus: EvidenceClassification | null,
): XrayLayerTreatment {
  const base = XRAY_LAYERS[classification];
  if (mode === "off") {
    return { ...base, liftM: 0, body: "solid", opacity: 1, dissolve: 0 };
  }

  const lifted = mode === "stratified" ? base.liftM : 0;
  if (focus === null || focus === classification) {
    return { ...base, liftM: lifted };
  }

  return {
    ...base,
    liftM: lifted,
    body: "ghost",
    // Unfocused layers drop to a common faint shell rather than keeping their
    // own opacity, so the focused layer is unambiguous at a glance.
    opacity: Math.min(base.opacity, 0.1),
    dissolve: Math.max(base.dissolve, 0.8),
  };
}

/** Narrow an untrusted string to a mode, for URL parameters and stored state. */
export function parseXrayMode(value: unknown): XrayMode | null {
  return typeof value === "string" && (XRAY_MODES as readonly string[]).includes(value)
    ? (value as XrayMode)
    : null;
}

/**
 * A one-line statement of what the mode is doing to the scene, for the HUD and
 * for the accessible view.
 */
export function describeXrayMode(
  mode: XrayMode,
  focus: EvidenceClassification | null,
): string {
  const meta = XRAY_MODE_META[mode];
  if (mode === "off") return meta.description;
  const focusNote =
    focus === null
      ? ""
      : ` Isolating the ${focus} layer; the other three stay drawn as faint shells rather than being hidden.`;
  return `${meta.description}${focusNote}`;
}
