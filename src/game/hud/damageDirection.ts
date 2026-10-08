import { forwardToYaw, yawDelta } from "../core/types";

/**
 * Where the damage arc points, as a canvas rotation in radians: 0 is the top
 * of the screen (straight ahead), positive is clockwise (towards the right).
 *
 * `travelAngle` is what `core/combat.ts` records in `game.hud.damageDirs`:
 * `atan2(x, z)` of the round's *travel* direction, shooter to victim. The
 * shooter is therefore behind it, at the opposite heading — the same reading
 * `pilot/perception.ts` gives a brain, so the HUD and the observation agree
 * on where a hit came from. Using the travel heading itself put a shooter in
 * front of the player at the bottom of the screen.
 */
export function damageArcRotation(
  travelAngle: number,
  cameraForwardX: number,
  cameraForwardZ: number,
): number {
  const shooterX = -Math.sin(travelAngle);
  const shooterZ = -Math.cos(travelAngle);
  // Game yaw grows to the left (see `yawToForward`), canvas rotation to the
  // right, hence the sign.
  return -yawDelta(
    forwardToYaw(cameraForwardX, cameraForwardZ),
    forwardToYaw(shooterX, shooterZ),
  );
}
