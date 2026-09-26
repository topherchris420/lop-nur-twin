import type { FireMode, WeaponClass } from "../core/types";

/**
 * What the player rig knows that the rest of the game does not: the state of
 * its own controller and weapon. Written by `PlayerRig` every frame, read by
 * the perception layer at decision time.
 *
 * A mutable singleton rather than React state, per AGENTS.md: it changes on the
 * frame loop.
 */
export const rigState = {
  /** The rig has weapons and a collision world. */
  ready: false,
  /** Sprinting or mantling: the rig will not let a shot out. */
  firingBlocked: false,
  sprinting: false,
  sliding: false,
  mantling: false,
  slot: "primary" as "primary" | "secondary",
  weaponClass: "assault" as WeaponClass,
  fireMode: "auto" as FireMode,
  /** The eased horizontal field of view the camera is using, degrees. */
  horizontalFovDeg: 80,
};
