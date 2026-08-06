import * as THREE from "three";
import { REST_AXIS } from "./rig";

/**
 * Analytic two-bone IK.
 *
 * The rig guarantees that every bone's rest rotation is identity, so a bone's
 * axis in its own local space is the same vector as its axis in model space —
 * which is what makes a closed-form solve possible here instead of an
 * iterative one. Given a chain origin, a target and a pole, this writes the
 * two bone quaternions directly; nothing allocates.
 *
 * The one property worth stating plainly, because getting it wrong is what a
 * hand-written gait always gets wrong: the reach is clamped strictly below
 * `l1 + l2`. A joint can therefore never straighten fully, let alone invert,
 * so a leg cannot hyperextend no matter what target it is handed. The pole
 * picks which side the joint bends toward, and it is the only thing that does,
 * so a knee bends forward because the pole points forward and for no other
 * reason.
 */

const _to = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _upper = new THREE.Vector3();
const _joint = new THREE.Vector3();
const _lower = new THREE.Vector3();
const _rest = new THREE.Vector3();
const _perp = new THREE.Vector3();
const _qRoot = new THREE.Quaternion();
const _qMid = new THREE.Quaternion();

function restAxis(index: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(
    REST_AXIS[index * 3]!,
    REST_AXIS[index * 3 + 1]!,
    REST_AXIS[index * 3 + 2],
  );
}

/**
 * Solve a two-bone chain so that the end of `mid` reaches `target`.
 *
 * `origin`, `target` and `pole` are all expressed in the space `root`'s
 * quaternion is relative to — i.e. the parent bone's space. `l1` and `l2` are
 * passed explicitly rather than read from `BONE_LENGTH` because a chain's
 * effective segment can span more than one bone: the forearm runs through a
 * twist bone before it reaches the hand.
 *
 * `outMid`, if given, receives the mid bone's rotation in that same parent
 * space, which is what a caller needs to orient whatever hangs off the end
 * (a foot to the ground, a hand to a grip).
 */
export function solveTwoBone(
  root: THREE.Bone,
  mid: THREE.Bone,
  rootIndex: number,
  midIndex: number,
  origin: THREE.Vector3,
  target: THREE.Vector3,
  pole: THREE.Vector3,
  l1: number,
  l2: number,
  outMid?: THREE.Quaternion,
): void {
  _to.subVectors(target, origin);
  let distance = _to.length();
  if (distance < 1e-5) {
    _to.set(0, -1, 0);
    distance = 1e-5;
  }
  _dir.copy(_to).divideScalar(distance);

  // Strictly inside full extension, and outside the fold where the solve is
  // degenerate. This clamp is the whole reason a limb cannot over-extend.
  const reach = Math.min((l1 + l2) * 0.985, Math.max(Math.abs(l1 - l2) + 0.02, distance));

  const cosRoot = (l1 * l1 + reach * reach - l2 * l2) / (2 * l1 * reach);
  const rootOffset = Math.acos(Math.min(1, Math.max(-1, cosRoot)));

  // The bend plane. `cross(dir, pole)` is signed so that rotating `dir` by a
  // positive angle about it carries the joint toward the pole.
  _axis.crossVectors(_dir, pole);
  if (_axis.lengthSq() < 1e-8) {
    // Target parallel to the pole: any perpendicular keeps the solve stable.
    _perp.set(1, 0, 0);
    _axis.crossVectors(_dir, _perp);
    if (_axis.lengthSq() < 1e-8) _axis.set(0, 0, 1);
  }
  _axis.normalize();

  _upper.copy(_dir).applyAxisAngle(_axis, rootOffset);
  _joint.copy(origin).addScaledVector(_upper, l1);
  _lower.copy(origin).addScaledVector(_dir, reach).sub(_joint).normalize();

  _qRoot.setFromUnitVectors(restAxis(rootIndex, _rest), _upper);
  _qMid.setFromUnitVectors(restAxis(midIndex, _rest), _lower);

  root.quaternion.copy(_qRoot);
  // The mid bone is parented to the root, so its local rotation is the
  // difference between the two.
  mid.quaternion.copy(_qRoot).invert().multiply(_qMid);
  if (outMid) outMid.copy(_qMid);
}
