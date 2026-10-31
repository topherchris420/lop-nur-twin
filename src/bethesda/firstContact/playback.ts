/**
 * Playback: a partner's own recorded flight, presented to a subject.
 *
 * A partner is a research subject that flew in an arena of its own. Its
 * trajectory is recorded once, and stretches of steady flight are cut from it
 * by fixed kinematic criteria. A presentation places one stretch in the
 * subject's world so that the partner's own path passes the subject at a
 * chosen miss distance from a chosen direction: the placement is the
 * experimenter's (a `design` frame map: rotation about the vertical and a
 * translation, no scaling); the motion is the partner's.
 *
 * This is the playback design of animal-behaviour experiments: open loop and
 * non-contingent, so the partner never sees the subject and nothing the
 * subject does changes what it is shown. Every partner's stretches are cut by
 * the same criteria, so a "stranger" and a "familiar" partner differ only in
 * which individual flew them; `speedAtPassMS` is recorded so that a report can
 * check it.
 */
import { arenaWorld, type ArenaSpec } from "../fly/arena.js";
import { forward, yawOf, type V3 } from "../fly/units.js";
import { mulberry32 } from "../../lib/noise.js";
import { applyMap, type FrameMap } from "./frames.js";
import { researchSubject, type SubjectSpec } from "./subjects.js";

export interface TracePoint {
  p: V3;
  flying: boolean;
}

/** Records a partner flying alone: its body every `stepS` for `durationS` (after `settleS`). */
export function recordPartner(
  spec: SubjectSpec,
  arena: ArenaSpec,
  { durationS, stepS, settleS }: { durationS: number; stepS: number; settleS: number },
): TracePoint[] {
  const { fly } = researchSubject(spec, arenaWorld(arena, `partner-arena:${spec.id}`));
  fly.advance(settleS);
  const steps = Math.round(durationS / stepS);
  const out: TracePoint[] = [];
  for (let k = 0; k <= steps; k++) {
    if (k) fly.advance(stepS);
    out.push({
      p: [fly.state.p[0], fly.state.p[1], fly.state.p[2]],
      flying: fly.state.mode === "flight",
    });
  }
  return out;
}

export interface SegmentCriteria {
  /** The stretch's length (s); the pass is at its middle. */
  durationS: number;
  /** Horizontal speed at the pass (m/s). */
  minPassSpeedMS: number;
  maxPassSpeedMS: number;
  /** Mean speed over the stretch, at least (m/s). */
  minMeanSpeedMS: number;
}

export interface FlightSegment {
  partner: string;
  /** Which stretch of this partner's recording, in order. */
  index: number;
  /** The partner's body every step through the stretch, in its own arena's frame. */
  samples: V3[];
  /** The sample at the stretch's middle: the point placed beside the subject. */
  pass: number;
  /** Horizontal speed at the pass (m/s). */
  speedAtPassMS: number;
}

/** Cuts non-overlapping stretches of continuous flight that meet the criteria. */
export function flightSegments(
  partner: string,
  trace: readonly TracePoint[],
  stepS: number,
  c: SegmentCriteria,
): FlightSegment[] {
  const n = Math.round(c.durationS / stepS);
  const half = Math.floor(n / 2);
  const out: FlightSegment[] = [];
  let k = 0;
  while (k + n < trace.length) {
    const win = trace.slice(k, k + n + 1);
    if (!win.every((x) => x.flying)) {
      k++;
      continue;
    }
    const a = win[half - 1]!.p,
      b = win[half + 1]!.p;
    const speed = Math.hypot(b[0] - a[0], b[2] - a[2]) / (2 * stepS);
    let path = 0;
    for (let i = 1; i < win.length; i++)
      path += Math.hypot(
        win[i]!.p[0] - win[i - 1]!.p[0],
        win[i]!.p[1] - win[i - 1]!.p[1],
        win[i]!.p[2] - win[i - 1]!.p[2],
      );
    const meanSpeed = path / c.durationS;
    if (
      speed >= c.minPassSpeedMS &&
      speed <= c.maxPassSpeedMS &&
      meanSpeed >= c.minMeanSpeedMS
    ) {
      out.push({
        partner,
        index: out.length,
        samples: win.map((x) => [x.p[0], x.p[1], x.p[2]]),
        pass: half,
        speedAtPassMS: speed,
      });
      k += n + 1;
    } else k++;
  }
  return out;
}

export interface Placement {
  /** Where the subject's body is and which way it faces, when the presentation starts. */
  subject: { p: V3; yaw: number };
  /** Direction the partner comes from, relative to the subject's heading (rad, + left). */
  approachRad: number;
  /** How far from the subject's body the partner's path passes (m). */
  missM: number;
  /** Which side the pass point is on (+1 left of the path, −1 right), and its elevation above level (rad). */
  side: 1 | -1;
  elevationRad: number;
}

/**
 * The frame map that puts `seg`'s pass point beside the subject: the partner
 * travels toward the subject from `approachRad`, and its pass point sits
 * `missM` from the subject's body, perpendicular to its travel.
 */
export function placementMap(seg: FlightSegment, pl: Placement, id: string): FrameMap {
  const a = seg.samples[seg.pass - 1]!,
    b = seg.samples[seg.pass + 1]!;
  const fromDir = forward(pl.subject.yaw + pl.approachRad);
  // Travelling toward the subject: opposite to where it comes from.
  const travelYaw = yawOf(-fromDir[0], -fromDir[2]);
  const yaw = travelYaw - yawOf(b[0] - a[0], b[2] - a[2]);
  // Perpendicular to travel, to one side, raised by the elevation.
  const lat = forward(travelYaw + (pl.side * Math.PI) / 2);
  const ce = Math.cos(pl.elevationRad),
    se = Math.sin(pl.elevationRad);
  const offset: V3 = [lat[0] * ce * pl.missM, se * pl.missM, lat[2] * ce * pl.missM];
  const rotated = applyMap(
    {
      id: "r",
      from: "x",
      to: "y",
      yaw,
      scale: 1,
      translate: [0, 0, 0],
      class: "design",
      note: "rotation only",
    },
    seg.samples[seg.pass]!,
  );
  return {
    id,
    from: `partner-arena:${seg.partner}`,
    to: "subject-arena",
    yaw,
    scale: 1,
    translate: [
      pl.subject.p[0] + offset[0] - rotated[0],
      pl.subject.p[1] + offset[1] - rotated[1],
      pl.subject.p[2] + offset[2] - rotated[2],
    ],
    class: "design",
    note: `playback placement: ${seg.partner} stretch ${seg.index} passes ${(pl.missM * 1000).toFixed(1)} mm from the subject, approaching from ${((pl.approachRad * 180) / Math.PI).toFixed(0)}°`,
  };
}

/** A seeded placement draw: the approach direction, side and elevation are the design's random choices. */
export function drawPlacement(
  rng: () => number,
  subject: { p: V3; yaw: number },
  missM: number,
  maxElevationRad: number,
): Placement {
  return {
    subject: { p: [subject.p[0], subject.p[1], subject.p[2]], yaw: subject.yaw },
    approachRad: (rng() * 2 - 1) * Math.PI,
    missM,
    side: rng() < 0.5 ? 1 : -1,
    elevationRad: rng() * maxElevationRad,
  };
}

export const seeded = (seed: number) => mulberry32(seed >>> 0);
