import type { WeaponRuntime } from "../weapons/runtime";
import type { PlayerController } from "./controller";

/**
 * Start the seat's next life: full magazines and reserves, and a controller
 * with no mantle, slide, stance or landing carried over from the last one.
 *
 * Called by the rig whenever `game.playerSpawnEpoch` moves — a respawn
 * (`respawnActor`) or a new match (`resetPlayerForMatch`). The bots do the
 * same in `BotManager.respawn`; the player is an actor like any other and is
 * restocked by the same rule.
 */
export function startNewLife(
  weapons: readonly WeaponRuntime[],
  controller: PlayerController,
): void {
  for (const weapon of weapons) weapon.refill();
  controller.reset();
}
