import {
  ALL_SEGMENTS,
  APRONS,
  RUNWAYS,
  RUNWAY_CENTER,
  STRUCTURES,
  type SegmentDef,
} from "./layout";
import { SITE_PROFILE } from "./siteData";
import { getUncertaintyForSubject } from "./evidence";
import { EVIDENCE_MODE_META } from "./evidenceMode";
import { DEFAULT_EVIDENCE_MODE, type EvidenceMode } from "./evidenceMode";
import { isSubjectDrawn } from "./drawState";
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
  /**
   * The layout subject the point snapped to. Absent for a free click, and for
   * points saved before it was recorded: those can name their vertex but not
   * say how well its position is known.
   */
  subjectId?: string;
}

/** A layout vertex a click can lock onto. */
export interface SnapTarget {
  x: number;
  z: number;
  label: string;
  /**
   * The backing layout record, so snapping respects the same evidence-timeline
   * and evidence-mode filters the scene draws with. A ruler that locks onto a
   * building the scene is not drawing would produce a measurement the viewer
   * cannot see the endpoints of.
   */
  source: { id: string };
  /**
   * The subject whose evidence documents this vertex's position. For most
   * vertices it is the layout subject itself; the runway's thresholds and
   * centre are positioned by the runway measurements, the one place this model
   * states a positional error.
   */
  positionedBy: string;
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
      positionedBy: "measurement-site-reference-coordinate",
    });
  }
  for (const segment of ALL_SEGMENTS) {
    const [fromLabel, toLabel] = segmentEndpointLabels(segment);
    const positionedBy =
      segment.id === runway?.id ? "measurement-runway-length" : segment.id;
    targets.push({
      x: segment.from[0],
      z: segment.from[1],
      label: fromLabel,
      source: segment,
      positionedBy,
    });
    targets.push({
      x: segment.to[0],
      z: segment.to[1],
      label: toLabel,
      source: segment,
      positionedBy,
    });
  }
  for (const apron of APRONS) {
    targets.push({
      x: apron.center[0],
      z: apron.center[1],
      label: `${apron.name} (center)`,
      source: apron,
      positionedBy: apron.id,
    });
  }
  for (const structure of STRUCTURES) {
    targets.push({
      x: structure.position[0],
      z: structure.position[1],
      label: structure.name,
      source: structure,
      positionedBy: structure.id,
    });
  }
  return targets;
})();

/**
 * Nearest snap target to a local point, within `maxDistM`, among the targets
 * the scene draws solid at the evidence-timeline date (null for now) in the
 * active evidence mode. Returns null when nothing drawn is close enough —
 * an outlined ghost is not something to measure from.
 *
 * `evidenceMode` defaults to the full simulation so a caller that has no mode
 * in hand — a test, a script — gets every modeled vertex.
 */
export function snapWorldPoint(
  x: number,
  z: number,
  maxDistM: number,
  snapshotDate: string | null,
  evidenceMode: EvidenceMode = DEFAULT_EVIDENCE_MODE,
): SnapTarget | null {
  let best: SnapTarget | null = null;
  let bestDistSq = maxDistM * maxDistM;
  for (const target of SNAP_TARGETS) {
    if (!isSubjectDrawn(target.source, snapshotDate, evidenceMode)) continue;
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

/** The snap target a recorded point sits on, if it names one. */
function snapTargetOf(point: MeasurePoint): SnapTarget | undefined {
  if (point.subjectId === undefined) return undefined;
  return SNAP_TARGETS.find(
    (target) =>
      target.source.id === point.subjectId &&
      target.x === point.x &&
      target.z === point.z,
  );
}

/**
 * How well one endpoint's position is known, from the evidence of the subject
 * that positions it — never a site-wide figure. Almost nothing in this model
 * states a positional error: the runway's measured thresholds do (about 40 m),
 * a building has at most the resolution of the scene it was drawn from as a
 * lower bound, and a free click marks no modeled feature at all. Printing the
 * runway's figure against every endpoint, as this tool once did, turned an
 * unknown into a number.
 */
export function positionalStatement(point: MeasurePoint): string {
  if (point.snappedTo === null) {
    return "free point: marks no modeled feature, so no positional claim";
  }
  const target = snapTargetOf(point);
  if (target === undefined) {
    return "positional error not recorded with this point";
  }
  const envelope = getUncertaintyForSubject(target.positionedBy);
  if (envelope?.horizontalMeters !== undefined) {
    return `positional error ±${envelope.horizontalMeters} m (${envelope.basis ?? "basis not stated"})`;
  }
  if (envelope?.footprintMeters !== undefined) {
    return `positional error not stated; at least ${envelope.footprintMeters} m, the resolution of the cited scene`;
  }
  return "positional error not stated";
}

/** Optional context that makes a pasted measurement reproducible. */
export interface MeasurementContext {
  snapshotDate: string | null;
  evidenceMode: EvidenceMode;
}

/**
 * A plain-text, citable summary of a measurement: the registered grid frame,
 * every vertex's easting/northing, snapped identity and how well its position
 * is known, each leg's distance and bearing, and the totals. Copied to the
 * clipboard so a measurement can be pasted into notes or a report instead of
 * re-described.
 */
export function measurementSummary(
  points: readonly MeasurePoint[],
  context?: MeasurementContext,
): string {
  const lines: string[] = [
    `${SITE_PROFILE.name} — measurement on the public-source reconstruction`,
    `Frame: ${SITE_PROFILE.localCrs.code} (${SITE_PROFILE.localCrs.name}); grid metres.`,
  ];
  if (context !== undefined) {
    lines.push(
      `Evidence timeline: ${context.snapshotDate ?? "now (the model's current state)"}; evidence mode: ${EVIDENCE_MODE_META[context.evidenceMode].label}.`,
    );
  }
  if (points.length === 0) {
    lines.push("No points placed.");
    return lines.join("\n");
  }

  lines.push("");
  points.forEach((point, index) => {
    const { easting, northing } = gridEastingNorthing(point.x, point.z);
    const identity = point.snappedTo ? `  ${point.snappedTo}` : "";
    lines.push(
      `P${index + 1}  E ${easting.toFixed(0)}  N ${northing.toFixed(0)}${identity} — ${positionalStatement(point)}`,
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
    "Distances are between modeled positions. A leg is no better known than its least certain endpoint, and where an endpoint's error is not stated, neither is the leg's. Not an aeronautical survey.",
  );
  return lines.join("\n");
}
