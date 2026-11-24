import * as THREE from "three";

/**
 * Moving points between the first-person weapon's private stage and the world.
 *
 * The rifle is drawn by `player/viewmodelStage.ts` in a scene of its own, with
 * its own camera sitting at that scene's origin and a narrower lens than the
 * world camera. `getWorldPosition()` on a weapon socket therefore answers in
 * *stage* space: half a metre in front of a camera that lives at (0, 0, 0). A
 * flash, a casing or a puff of smoke spawned there in the world scene is
 * spawned next to the world origin, kilometres from the player, which is how
 * the first-person muzzle effects went missing without an error.
 *
 * The mapping keeps the point on the same pixel. Both cameras share the
 * aspect; only the focal length differs, so at the same depth a point's
 * view-space x and y scale by the ratio of the two projections. The world
 * camera's transform then carries it into the world, where it sits exactly
 * behind the socket it was read from.
 */

const _view = new THREE.Vector3();

/** Stage-space point to the world point that projects onto the same pixel. */
export function viewmodelToWorld(
  point: THREE.Vector3,
  stageCamera: THREE.PerspectiveCamera,
  worldCamera: THREE.Camera,
  out: THREE.Vector3,
): THREE.Vector3 {
  _view.copy(point).applyMatrix4(stageCamera.matrixWorldInverse);
  const s = stageCamera.projectionMatrix.elements;
  const w = worldCamera.projectionMatrix.elements;
  // elements[0] = f / aspect, elements[5] = f for a perspective projection.
  const sx = Math.abs(w[0]!) > 1e-6 ? s[0]! / w[0]! : 1;
  const sy = Math.abs(w[5]!) > 1e-6 ? s[5]! / w[5]! : 1;
  _view.x *= sx;
  _view.y *= sy;
  return out.copy(_view).applyMatrix4(worldCamera.matrixWorld);
}

/** Stage-space direction to world space. Rotation only; no lens correction. */
export function viewmodelDirToWorld(
  direction: THREE.Vector3,
  stageCamera: THREE.PerspectiveCamera,
  worldCamera: THREE.Camera,
  out: THREE.Vector3,
): THREE.Vector3 {
  return out
    .copy(direction)
    .transformDirection(stageCamera.matrixWorldInverse)
    .transformDirection(worldCamera.matrixWorld);
}
