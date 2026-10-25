/**
 * Noticing that the model has stopped fitting: cumulative-sum change
 * detectors (Page 1954) over each period's prediction error. One watches the
 * normalized innovation squared, for errors large in any direction; a pair
 * per observed component watches the standardized error with its sign, for
 * errors small but always the same way (a slightly weaker leg walked slowly).
 * Each remembers where its sum last left zero, which is where an inquiry
 * takes the change to have begun.
 */
import { EP } from "./params.js";

export interface Detector {
  g: number;
  from: number;
  up: [number, number, number];
  down: [number, number, number];
  upFrom: [number, number, number];
  downFrom: [number, number, number];
}

export const freshDetector = (period: number): Detector => ({
  g: 0,
  from: period,
  up: [0, 0, 0],
  down: [0, 0, 0],
  upFrom: [period, period, period],
  downFrom: [period, period, period],
});

/**
 * Add one period. Returns the period where the change is taken to have
 * begun when any detector passes its alarm, else null.
 */
export function detect(
  d: Detector,
  period: number,
  nis: number,
  z: readonly [number, number, number],
): number | null {
  const g = Math.max(0, d.g + nis - 3 - EP.cusumSlack);
  if (d.g === 0 && g > 0) d.from = period;
  d.g = g;
  const starts: number[] = [];
  if (g > EP.cusumAlarm) starts.push(d.from);
  for (let i = 0; i < 3; i++) {
    const up = Math.max(0, d.up[i]! + z[i]! - EP.signedSlack);
    const down = Math.max(0, d.down[i]! - z[i]! - EP.signedSlack);
    if (d.up[i] === 0 && up > 0) d.upFrom[i] = period;
    if (d.down[i] === 0 && down > 0) d.downFrom[i] = period;
    d.up[i] = up;
    d.down[i] = down;
    if (up > EP.signedAlarm) starts.push(d.upFrom[i]!);
    if (down > EP.signedAlarm) starts.push(d.downFrom[i]!);
  }
  return starts.length ? Math.min(...starts) : null;
}
