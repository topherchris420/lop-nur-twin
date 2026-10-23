/**
 * Wing kinematics for drawing, never for physics.
 *
 * The stroke shape is FlyBody's own fallback wingbeat pattern
 * (`flybody/tasks/pattern_generators.py`, Apache-2.0): wing yaw, roll and pitch
 * joint angles over one cycle, applied to both wings, which the MJCF defines
 * as mirror images. FlyBody's code describes it as "a simple artificial base
 * wing pattern approximation"; the trained-flight base pattern is in the
 * GPL-3.0 figshare release and is deliberately not imported. So this is a
 * visual approximation of a wingbeat, and the panel says so.
 *
 * The renderer samples it at its own frame time: the simulator advances only
 * the beat frequency and the left/right amplitude asymmetry, so the 218 Hz
 * beat never sets the physics or decision rate.
 */
export interface WingAngles {
  yaw: number;
  roll: number;
  pitch: number;
}

/** FlyBody's prototype pattern at phase `x` in [0, 2π). Radians. */
export function prototypeStroke(x: number): WingAngles {
  return {
    yaw: 1.1 * Math.sin(x - Math.PI / 2) + 0.3,
    roll: 0.25 * Math.sin(1.5 * x) - 0.1,
    pitch: 1.35 * Math.sin(x) + 0.8,
  };
}

/**
 * The stroke with its amplitude scaled about the cycle mean (an asymmetric
 * amplitude is how the simulator shows steering), clamped to the joint range.
 */
export function strokeAt(
  x: number,
  amplitude: number,
  range: { yaw: [number, number]; roll: [number, number]; pitch: [number, number] },
): WingAngles {
  const s = prototypeStroke(x);
  // Cycle means of the prototype: yaw 0.3, pitch 0.8; roll's 1.5x term does not close the cycle, so
  // its offset −0.1 is used as the centre.
  const scaled = {
    yaw: 0.3 + (s.yaw - 0.3) * amplitude,
    roll: -0.1 + (s.roll + 0.1) * amplitude,
    pitch: 0.8 + (s.pitch - 0.8) * amplitude,
  };
  const c = (v: number, r: [number, number]) => Math.min(r[1], Math.max(r[0], v));
  return {
    yaw: c(scaled.yaw, range.yaw),
    roll: c(scaled.roll, range.roll),
    pitch: c(scaled.pitch, range.pitch),
  };
}
