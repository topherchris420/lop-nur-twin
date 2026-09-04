import {
  ALL_SEGMENTS,
  APRONS,
  RUNWAYS,
  RUNWAY_CENTER,
  STRUCTURES,
  isVisibleAtTimelineYear,
  type SegmentDef,
  type TemporalDef,
} from "./layout";
import { SITE_PROFILE } from "./siteData";
import {
  DEFAULT_EVIDENCE_MODE,
  isSubjectVisible,
  type EvidenceMode,
} from "./evidenceMode";
import { localToProjected } from "./geospatial";

/**
 * The site-scale measuring tool. Everything here is deterministic and offline:
 * points are local metres in the layout frame (+x east, +z south), and the
 * public readouts are derived from the same registered EPSG:32645 origin the
 * telemetry HUD uses. Snapping locks a click onto a modeled layout vertex so a
 * measurement is reproducible rather than a pixel guess — which is the whole
 * point of a "measurable, citable" frame of reference.
 */

/** A single vertex of a measurement path, in local metres. */
export interface MeasurePoint {
  /** local east, metres */
  x: number;
  /** local south, metres */
  z: number;
  /** label of the modeled vertex this point snapped to, or null for a free click */
  snappedTo: string | null;
}

/** A layout vertex a click can lock onto. */
export interface SnapTarget {
  x: number;
  z: number;
  label: string;
  /**
   * The backing layout record, so snapping respects the same timeline and
   * evidence-mode filters the scene draws with. A ruler that locks onto a
   * building the current mode is withholding would produce a measurement the
   * viewer cannot see the endpoints of.
   */
  source: TemporalDef & { id: string };
}

const CARDINALS = [
  "N",
  "NNE",
  "NE",
  "ENE",
  "E",
  "ESE",
  "SE",
  "SSE",
  "S",
  "SSW",
  "SW",
  "WSW",
  "W",
  "WNW",
  "NW",
  "NNW",
] as const;

/** Compass point for a grid bearing (0 = north, clockwise). */
export function bearingCardinal(deg: number): string {
  const index = Math.round((((deg % 360) + 360) % 360) / 22.5) % 16;
  return CARDINALS[index] ?? "N";
}

function segmentEndpointLabels(segment: SegmentDef): [string, string] {
  if (segment.id === RUNWAYS[0]?.id) {
    return ["Runway 05 threshold", "Runway 23 threshold"];
  }
  return [`${segment.name} — start`, `${segment.name} — end`];
}

/**
 * Every modeled vertex a measurement can snap to: the runway thresholds and
 * center, both ends of every strip/taxiway/street/road, every apron center, and
 * every structure/aircraft position. Built once from the single source layout.
 */
export const SNAP_TARGETS: readonly SnapTarget[] = (() => {
  const targets: SnapTarget[] = [];
  const runway = RUNWAYS[0];
  if (runway) {
    targets.push({
      x: RUNWAY_CENTER[0],
      z: RUNWAY_CENTER[1],
      label: "Runway center",
      source: runway,
    });
  }
  for (const segment of ALL_SEGMENTS) {
    const [fromLabel, toLabel] = segmentEndpointLabels(segment);
    targets.push({
      x: segment.from[0],
      z: segment.from[1],
      label: fromLabel,
      source: segment,
    });
    targets.push({ x: segment.to[0], z: segment.to[1], label: toLabel, source: segment });
  }
  for (const apron of APRONS) {
    targets.push({
      x: apron.center[0],
      z: apron.center[1],
      label: `${apron.name} (center)`,
      source: apron,
    });
  }
  for (const structure of STRUCTURES) {
    targets.push({
      x: structure.position[0],
      z: structure.position[1],
      label: structure.name,
      source: structure,
    });
  }
  return targets;
})();

/**
 * Nearest snap target to a local point, within `maxDistM`, respecting the
 * active timeline year and the active evidence mode. Returns null when nothing
 * currently drawn is close enough.
 *
 * `evidenceMode` defaults to the full simulation so a caller that has no mode
 * in hand — a test, a script — gets every modeled vertex.
 */
export function snapWorldPoint(
  x: number,
  z: number,
  maxDistM: number,
  year: number,
  evidenceMode: EvidenceMode = DEFAULT_EVIDENCE_MODE,
): SnapTarget | null {
  let best: SnapTarget | null = null;
  let bestDistSq = maxDistM * maxDistM;
  for (const target of SNAP_TARGETS) {
    if (!isVisibleAtTimelineYear(target.source, year)) continue;
    if (!isSubjectVisible(target.source.id, evidenceMode)) continue;
    const distSq = (target.x - x) ** 2 + (target.z - z) ** 2;
    if (distSq <= bestDistSq) {
      bestDistSq = distSq;
      best = target;
    }
  }
  return best;
}

export interface GridCoordinate {
  easting: number;
  northing: number;
}

/** Local metres → the public EPSG:32645 easting/northing the HUD reports. */
export function gridEastingNorthing(x: number, z: number): GridCoordinate {
  return localToProjected({ x, z });
}

/** Planar distance between two local points, in metres. */
export function distanceM(a: MeasurePoint, b: MeasurePoint): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

/**
 * Grid bearing from `a` to `b`: 0° = grid north (−z), increasing clockwise
 * through east (+x). Matches the runway bearing convention in the profile.
 */
export function gridBearingDeg(a: MeasurePoint, b: MeasurePoint): number {
  const deltaEast = b.x - a.x;
  const deltaNorth = -(b.z - a.z);
  return ((Math.atan2(deltaEast, deltaNorth) * 180) / Math.PI + 360) % 360;
}

/** Total length walked along the path, summing every leg. */
export function pathTotalM(points: readonly MeasurePoint[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += distanceM(points[index - 1]!, points[index]!);
  }
  return total;
}

/** Straight-line distance between the first and last vertex. */
export function straightLineM(points: readonly MeasurePoint[]): number {
  if (points.length < 2) return 0;
  return distanceM(points[0]!, points[points.length - 1]!);
}

/** "842 m" under a kilometre, "3.60 km" above it. */
export function formatDistanceM(m: number): string {
  if (!Number.isFinite(m)) return "—";
  if (m < 1000) return `${m.toFixed(0)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

/** "046° NE" — zero-padded grid bearing plus its compass point. */
export function formatBearingDeg(deg: number): string {
  const normalized = ((deg % 360) + 360) % 360;
  return `${normalized.toFixed(0).padStart(3, "0")}° ${bearingCardinal(normalized)}`;
}

/**
 * A plain-text, citable summary of a measurement: the registered grid frame,
 * every vertex's easting/northing (and any snapped identity), each leg's
 * distance and bearing, and the totals. Copied to the clipboard so a
 * measurement can be pasted into notes or a report instead of re-described.
 */
export function measurementSummary(points: readonly MeasurePoint[]): string {
  const lines: string[] = [
    `${SITE_PROFILE.name} — digital-twin measurement`,
    `Frame: ${SITE_PROFILE.localCrs.code} (${SITE_PROFILE.localCrs.name}); grid metres.`,
  ];
  if (points.length === 0) {
    lines.push("No points placed.");
    return lines.join("\n");
  }

  lines.push("");
  points.forEach((point, index) => {
    const { easting, northing } = gridEastingNorthing(point.x, point.z);
    const identity = point.snappedTo ? `  ${point.snappedTo}` : "";
    lines.push(
      `P${index + 1}  E ${easting.toFixed(0)}  N ${northing.toFixed(0)}${identity}`,
    );
  });

  if (points.length >= 2) {
    lines.push("");
    for (let index = 1; index < points.length; index += 1) {
      const from = points[index - 1]!;
      const to = points[index]!;
      lines.push(
        `Leg ${index}→${index + 1}  ${formatDistanceM(distanceM(from, to))}  bearing ${formatBearingDeg(gridBearingDeg(from, to))}`,
      );
    }
    lines.push("");
    lines.push(`Path total: ${formatDistanceM(pathTotalM(points))}`);
    lines.push(
      `Straight line P1→P${points.length}: ${formatDistanceM(straightLineM(points))}`,
    );
  }

  lines.push("");
  lines.push(
    `Modeled interpretation from public imagery; endpoints carry ~${SITE_PROFILE.runway.endpointUncertaintyM} m uncertainty. Not an aeronautical survey.`,
  );
  return lines.join("\n");
}
