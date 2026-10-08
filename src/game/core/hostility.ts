import { game, type Actor } from "./gameState";
import type { EntityId, Team } from "./types";

/**
 * Who may hurt whom. The one place hostility is decided: damage resolution,
 * kill credit, assists, suppression, bot perception, spawn scoring, the HUD's
 * radar and the seat's observation all ask here. In a free-for-all
 * (`ModeRules.freeForAll`, read off the running match) every other actor is an
 * enemy whatever its team colour; otherwise the other team is.
 *
 * It lives apart from `combat.ts` so the player seat can ask it without
 * importing the damage resolver (`pilot/authority.test.ts`). `combat.ts`
 * re-exports it. It decides nothing by itself; it only answers.
 */
export function freeForAllActive(): boolean {
  return game.matchDirector?.freeForAll === true;
}

/**
 * Is `other` hostile to an actor of `team` whose id is `selfId`? `other` needs
 * only an id and a team, so a gunfire ping (shooter id and team) is judged by
 * the same rule as a body.
 */
export function hostileTo(
  team: Team,
  selfId: EntityId | null,
  other: Pick<Actor, "id" | "team">,
): boolean {
  if (selfId !== null && other.id === selfId) return false;
  return freeForAllActive() || other.team !== team;
}

/** Are these two actors enemies under the running mode? */
export function areHostile(a: Actor, b: Actor): boolean {
  return hostileTo(a.team, a.id, b);
}
