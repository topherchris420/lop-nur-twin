/**
 * Registered public reference imagery, beside the reconstruction.
 *
 * The most direct check anyone can make on a model like this is to put the
 * source next to it: crop the public scene the geometry was traced from,
 * register it to the same ground frame, and slide between the two. If a hangar
 * is in the wrong place, that comparison shows it in a second and no amount of
 * ledger reading will.
 *
 * Three constraints shape how this is done here, and together they rule out the
 * obvious implementation:
 *
 * 1. **The build fetches nothing and ships no binary assets.** So the scene
 *    cannot be baked into the bundle, and it cannot be downloaded at runtime.
 * 2. **Redistribution is not this project's to grant.** Copernicus Sentinel-2
 *    data is free and open under terms that require attribution, and other
 *    imagery a reviewer might want to use is not open at all. Shipping a copy
 *    would be making a licensing decision on the user's behalf.
 * 3. **Registration must not invent precision.** Every modeled metre is offset
 *    from one approximate reference coordinate carrying about ±40 m, so an
 *    overlay is registered to that same ±40 m and says so.
 *
 * What is left is the honest version, and it is also the one an analyst
 * actually wants: this module publishes the exact projected window the model
 * occupies, names the precise public scene the measurements were taken from,
 * and computes the ground sample distance a supplied crop must match. The user
 * brings the file. It is read in the browser, never uploaded, never fetched,
 * and released when the overlay closes.
 *
 * The transform is deliberately only local ↔ EPSG:32645. That is a pure
 * translation the project already publishes, exact to the metre. A geographic
 * transform would need a projection series this repository does not carry, and
 * approximating one would put fabricated precision on the screen next to real
 * measurements.
 */

import {
  GRID_EASTING_ORIGIN,
  GRID_NORTHING_ORIGIN,
  RUNWAY_CENTER,
  SITE_SIZE,
} from "./layout";
import { PRIMARY_CRS } from "./evidence";
import { SITE_PROFILE, getSource, type SourceId } from "./siteData";

/* ------------------------------------------------------------------ */
/* The projected frame                                                 */
/* ------------------------------------------------------------------ */

/**
 * Local metres to EPSG:32645. `+x` is east and `+z` is south, so northing
 * decreases as `z` grows — getting that sign backwards mirrors an overlay
 * north-for-south, which looks almost right and is completely wrong.
 */
export function localToProjected(x: number, z: number): [number, number] {
  return [GRID_EASTING_ORIGIN + x, GRID_NORTHING_ORIGIN - z];
}

/** EPSG:32645 back to local metres. Exact inverse of `localToProjected`. */
export function projectedToLocal(easting: number, northing: number): [number, number] {
  return [easting - GRID_EASTING_ORIGIN, GRID_NORTHING_ORIGIN - northing];
}

export interface ProjectedWindow {
  /** Half-width of the square window, in metres. */
  halfExtentM: number;
  minEastingM: number;
  maxEastingM: number;
  minNorthingM: number;
  maxNorthingM: number;
  /** Local-frame centre of the window, in metres. */
  centerLocal: readonly [number, number];
  crs: string;
}

/**
 * The projected window a square of local ground occupies, centred on a local
 * point. Rounded to a tenth of a metre — the frame's own registration is good
 * to about ±40 m, so printing more digits would be theatre.
 */
export function projectedWindow(
  halfExtentM: number,
  centerLocal: readonly [number, number] = [0, 0],
): ProjectedWindow {
  const [centerEasting, centerNorthing] = localToProjected(
    centerLocal[0],
    centerLocal[1],
  );
  const round = (value: number) => Math.round(value * 10) / 10;
  return {
    halfExtentM,
    minEastingM: round(centerEasting - halfExtentM),
    maxEastingM: round(centerEasting + halfExtentM),
    minNorthingM: round(centerNorthing - halfExtentM),
    maxNorthingM: round(centerNorthing + halfExtentM),
    centerLocal: [centerLocal[0], centerLocal[1]],
    crs: PRIMARY_CRS,
  };
}

/** The window covering the whole modeled site, centred on the layout origin. */
export const SITE_WINDOW: ProjectedWindow = projectedWindow(SITE_SIZE / 2);

/** A tighter window around the runway centre, for a close registration check. */
export const RUNWAY_WINDOW: ProjectedWindow = projectedWindow(1500, RUNWAY_CENTER);

/* ------------------------------------------------------------------ */
/* Cited scenes                                                        */
/* ------------------------------------------------------------------ */

export interface ReferenceScene {
  id: string;
  /** The public source register entry this scene is. */
  sourceId: SourceId;
  label: string;
  /** Ground sample distance the publisher states, in metres. */
  resolutionM: number;
  /** The window a crop should cover for this comparison. */
  window: ProjectedWindow;
  /** What a reviewer can and cannot conclude from overlaying this scene. */
  note: string;
}

/**
 * Scenes this project actually cites, with the window to crop them to.
 *
 * Only sources already in `PUBLIC_SOURCES` appear here, and only with figures
 * those sources state. There is no entry for imagery this project has not used,
 * however useful a higher-resolution scene would be — listing one would imply a
 * provenance the ledger does not have.
 */
export const REFERENCE_SCENES: readonly ReferenceScene[] = Object.freeze([
  {
    id: "sentinel-2-site",
    sourceId: "sentinel-2-scene-2025",
    label: "Sentinel-2 L2A, whole modeled site",
    resolutionM: 10,
    window: SITE_WINDOW,
    note: "The scene the runway was measured from. At 10 m, one pixel is six metres wider than the runway is; a building edge is a pixel or two, so an overlay checks placement and scale, not shape.",
  },
  {
    id: "sentinel-2-runway",
    sourceId: "sentinel-2-scene-2025",
    label: "Sentinel-2 L2A, runway centre",
    resolutionM: 10,
    window: RUNWAY_WINDOW,
    note: "A 3 km window on the runway centre, which is the one feature this project publishes a measurement of. Endpoint registration carries about ±40 m.",
  },
]);

export function getReferenceScene(id: string): ReferenceScene | undefined {
  return REFERENCE_SCENES.find((scene) => scene.id === id);
}

/** The attribution a scene must be displayed with, from the source register. */
export function sceneAttribution(scene: ReferenceScene): string {
  return getSource(scene.sourceId)?.attribution ?? "Attribution unavailable.";
}

/** The publisher's own page for the scene, so a reviewer can fetch it themselves. */
export function sceneSourceUrl(scene: ReferenceScene): string | undefined {
  return getSource(scene.sourceId)?.url;
}

/* ------------------------------------------------------------------ */
/* Registration                                                        */
/* ------------------------------------------------------------------ */

/** Image types a supplied crop may be. No SVG: it can carry script. */
export const ACCEPTED_IMAGE_TYPES: readonly string[] = [
  "image/png",
  "image/jpeg",
  "image/webp",
];

/** Largest supplied crop accepted, in bytes. A 4096² PNG sits well under this. */
export const MAX_IMAGE_BYTES = 24_000_000;

export interface RegistrationReport {
  /** Metres of ground per image pixel, on the long edge. */
  metresPerPixel: number;
  /** Pixels the crop would need to resolve the cited scene one-for-one. */
  nativePixels: number;
  /** True when the crop is at or finer than the source's own resolution. */
  atNativeResolution: boolean;
  /** True when the supplied image is square, as the window is. */
  square: boolean;
  /** Positional uncertainty the registration inherits, in metres. */
  registrationUncertaintyM: number;
  /** Everything the overlay cannot establish, stated rather than implied. */
  caveats: readonly string[];
}

/**
 * What a supplied crop is worth, once registered.
 *
 * Deliberately reports a metres-per-pixel rather than a quality score: a
 * reviewer comparing a 512 px crop of a 10 m scene needs to know each pixel is
 * 13 m of ground, because at that size a hangar is four pixels and a
 * disagreement of one pixel is not a finding.
 */
export function registrationReport(
  widthPx: number,
  heightPx: number,
  scene: ReferenceScene,
): RegistrationReport {
  const extentM = scene.window.halfExtentM * 2;
  const longEdge = Math.max(1, Math.max(widthPx, heightPx));
  const metresPerPixel = extentM / longEdge;
  const nativePixels = Math.ceil(extentM / scene.resolutionM);

  return {
    metresPerPixel,
    nativePixels,
    atNativeResolution: metresPerPixel <= scene.resolutionM,
    square: widthPx === heightPx,
    registrationUncertaintyM: SITE_PROFILE.runway.endpointUncertaintyM,
    caveats: [
      `Registration is to the published runway-centre reference coordinate, which carries about ±${SITE_PROFILE.runway.endpointUncertaintyM} m. The overlay and the model share that error, so agreement between them does not confirm either against the ground.`,
      `The supplied crop is assumed to cover exactly the printed ${scene.window.crs} window, north-up and unrotated. Nothing here verifies that it does — a mis-cropped image will register cleanly and be wrong.`,
      "Overlay agreement establishes placement and scale. It does not establish height, function, interior use or activity, none of which a nadir scene carries.",
      "The image is read in this browser and is never uploaded, transmitted or stored by this application.",
    ],
  };
}

/**
 * The instruction a reviewer follows to produce a registerable crop.
 *
 * Written out as steps rather than prose because it is a procedure someone will
 * follow with a GIS window open, and because printing the exact projected
 * bounds is what makes the comparison reproducible.
 */
export function registrationInstructions(scene: ReferenceScene): readonly string[] {
  const { window } = scene;
  return [
    `Open the cited source and retrieve the scene yourself — this application never fetches it.`,
    `Crop to ${window.crs}, north-up: easting ${window.minEastingM} to ${window.maxEastingM}, northing ${window.minNorthingM} to ${window.maxNorthingM}.`,
    `Export a square image; ${Math.ceil(
      (window.halfExtentM * 2) / scene.resolutionM,
    )} px matches the scene's own ${scene.resolutionM} m resolution one pixel for one pixel.`,
    "Load it below. It stays in this browser, and the model draws it on the ground plane at that exact window.",
  ];
}

/* ------------------------------------------------------------------ */
/* Overlay presentation                                                */
/* ------------------------------------------------------------------ */

/** How a registered overlay is drawn against the reconstruction. */
export type OverlayMode = "swipe" | "blend" | "reference-only";

export const OVERLAY_MODES: readonly OverlayMode[] = ["swipe", "blend", "reference-only"];

export const OVERLAY_MODE_META: Record<
  OverlayMode,
  { label: string; description: string }
> = {
  swipe: {
    label: "Swipe",
    description:
      "The reference scene fills the ground on one side of a moving line and the model's own pavement fills the other. Edges that continue across the line are registered; edges that jump are not.",
  },
  blend: {
    label: "Blend",
    description:
      "The scene is drawn over the whole ground plane at an adjustable opacity, so the model's geometry can be read against it directly.",
  },
  "reference-only": {
    label: "Reference only",
    description:
      "The scene alone, with the reconstruction's structures hidden. The honest baseline: this is what the public evidence looks like before anything was modeled from it.",
  },
};
