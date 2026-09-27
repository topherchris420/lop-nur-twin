import * as THREE from "three";

/**
 * Heat shimmer over the lakebed.
 *
 * By day the dry bed of Lop Nur and the concrete laid on it are hot enough
 * that the air just above them bends light: a figure 100 m away across the
 * apron does not sit still in the eye, it wavers. Blacksite makes that a rule
 * of the world, the same for every seat:
 *
 *  - Beyond `onsetM` a body is **seen** displaced from where it is, by a small
 *    offset across the line of sight that grows with range and drifts slowly.
 *  - The human sees the displaced body: the character is drawn there.
 *  - A brain is told the displaced bearings and elevations, and the motor
 *    controller and Elite Operator track the displaced body.
 *  - The bots aim at the displaced body too.
 *  - Rounds, hitboxes and sight lines stay where the body really is.
 *
 * So a head at 130 m is no longer a one-round certainty for anyone, human,
 * model or bot; centre mass still is a fair shot; and holding the far end of
 * a sight line stops being free. Close in, nothing changes. At night there is
 * no shimmer.
 *
 * It is deterministic: the offset is a smooth function of simulation time, the
 * observed body's id and the distance, with no random draws. It is fiction —
 * like everything in `/play` it says nothing about the real site.
 */

export const MIRAGE = {
  /** No shimmer inside this range, metres. */
  onsetM: 45,
  /** Amplitude = gain × (distance − onset)^power, metres: 0.04 m at 60 m, ~0.22 m at 100 m, ~0.5 m at 150 m. */
  gain: 0.0012,
  power: 1.3,
  /** The sideways wander is this fraction of the vertical. Heat bends light mostly up and down. */
  lateral: 0.6,
  /** Slow drift: two incommensurate frequencies per axis, hertz. */
  slowHz: 0.37,
  fastHz: 1.13,
};

/** 0 at night, 1 by day. Set by the scene from the time of day. */
export const mirageState = { strength: 1 };

/** Peak apparent displacement of a body at this range, metres, before direction. */
export function mirageAmplitude(
  distanceM: number,
  strength = mirageState.strength,
): number {
  const beyond = distanceM - MIRAGE.onsetM;
  if (beyond <= 0 || strength <= 0) return 0;
  return strength * MIRAGE.gain * Math.pow(beyond, MIRAGE.power);
}

const _los = new THREE.Vector3();
const _side = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const GOLDEN = 2.399963229728653;

/**
 * Where a body at `position`, observed from `eye`, appears to be displaced:
 * written to `out` as an offset to add to any point on the body. Zero inside
 * the onset range and at night.
 */
export function mirageOffset(
  eye: THREE.Vector3,
  position: THREE.Vector3,
  bodyId: number,
  time: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  _los.set(position.x - eye.x, 0, position.z - eye.z);
  const distance = Math.hypot(_los.x, _los.z, position.y - eye.y);
  const amplitude = mirageAmplitude(distance);
  if (amplitude === 0) return out.set(0, 0, 0);
  if (_los.lengthSq() < 1e-8) return out.set(0, 0, 0);
  _los.normalize();
  _side.crossVectors(_los, UP);
  const phase = bodyId * GOLDEN;
  const tau = Math.PI * 2;
  const vertical =
    0.7 * Math.sin(tau * MIRAGE.slowHz * time + phase) +
    0.3 * Math.sin(tau * MIRAGE.fastHz * time + phase * 1.7);
  const sideways =
    0.7 * Math.sin(tau * MIRAGE.slowHz * 0.83 * time + phase * 2.3) +
    0.3 * Math.sin(tau * MIRAGE.fastHz * 1.21 * time + phase * 0.6);
  return out
    .copy(_side)
    .multiplyScalar(sideways * amplitude * MIRAGE.lateral)
    .addScaledVector(UP, vertical * amplitude);
}
