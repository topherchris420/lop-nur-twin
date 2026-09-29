import { AXES, targetSlot, type Axis, type ControlFrame } from "./contract";
import { legalActionsFor, type JevObservation } from "./observation";

/**
 * Is a decision still legal when it reaches execution?
 *
 * A remote brain decides about a world that has moved on by the time its
 * answer arrives: 150–450 ms for Jev, seconds for a conventional LLM. The loop
 * already discards answers that are too old, for a request that was
 * abandoned, or from a previous life. This is the second check, made at the
 * moment the frame would start: recompute what is legal *now* and compare the
 * choice against it. The observation and the choice are the brain's; the
 * snapshot is the host's reading of the world at execution, by the same rules
 * perception uses.
 *
 * Under the `strict` policy (the default) a frame with any illegal part is
 * refused whole and the seat idles until the next valid decision: fail closed.
 * A stale answer does not become authoritative because it arrived. Under
 * `observe` it executes anyway and the record says so — the behaviour before
 * this check existed, kept only so the difference can be measured.
 *
 * `worldChanged` lists every difference found, legal or not, so an evaluation
 * can ask how often the world moved under a decision without invalidating it.
 */

export const STALE_POLICIES = ["strict", "observe"] as const;
export type StalePolicy = (typeof STALE_POLICIES)[number];

export interface ExecutionSnapshot {
  alive: boolean;
  health: number;
  stance: JevObservation["player"]["stance"];
  grounded: boolean;
  pitchDeg: number;
  weapon: Pick<
    JevObservation["weapon"],
    "ammo" | "magSize" | "reserve" | "reloading" | "canFire"
  >;
  /** Enemies in view now, by perception's rule (capped as the observation caps them). */
  visibleEnemies: number;
  /**
   * For a TARGET_n choice: the enemy that slot named is still alive and in
   * view. Null when the frame names no target.
   */
  targetStillValid: boolean | null;
  /** The navigator is taking the body somewhere now. */
  travelling: boolean;
}

export interface Revalidation {
  worldChanged: string[];
  illegal: Axis[];
}

export function revalidate(
  observation: JevObservation,
  frame: ControlFrame,
  now: ExecutionSnapshot,
): Revalidation {
  const changed: string[] = [];
  const then = observation;
  if (!now.alive) changed.push("seat_died");
  if (now.health < then.player.health - 1) changed.push("health_dropped");
  if (now.stance !== then.player.stance) changed.push("stance_changed");
  const shown = then.perception.visibleEnemies.length;
  if (now.visibleEnemies > shown) changed.push("enemy_appeared");
  if (now.visibleEnemies < shown) changed.push("enemy_left_view");
  if (now.targetStillValid === false) changed.push("target_gone");
  const w = then.weapon;
  if (
    now.weapon.ammo !== w.ammo ||
    now.weapon.reloading !== w.reloading ||
    now.weapon.canFire !== w.canFire
  ) {
    changed.push("weapon_state");
  }

  // Slots name entries of the observation, so slot existence is judged
  // against it; whether the named enemy is still there is `targetStillValid`.
  const legalNow = legalActionsFor(
    { stance: now.stance, grounded: now.grounded, pitchDeg: now.pitchDeg },
    now.weapon,
    {
      control: then.control,
      visibleEnemies: shown,
      navigation: then.navigation,
      places: then.perception.places.length,
      travelling: now.travelling,
    },
  );
  const illegal: Axis[] = [];
  for (const axis of AXES) {
    if (axis === "target") {
      if (targetSlot(frame.target) !== null && now.targetStillValid === false)
        illegal.push(axis);
      continue;
    }
    if (!(legalNow[axis] as readonly string[]).includes(frame[axis])) illegal.push(axis);
  }
  if (!now.alive) {
    for (const axis of AXES) if (!illegal.includes(axis)) illegal.push(axis);
  }
  return { worldChanged: changed, illegal };
}
