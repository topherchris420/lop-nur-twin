import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { resolveDamage, seat, type KillReport } from "../core/combat";
import {
  addActor,
  createActor,
  game,
  queueDamage,
  removeActor,
  resetPlayerForMatch,
  type Actor,
} from "../core/gameState";
import type { GameModeId, HitRegion } from "../core/types";
import { MatchDirector } from "./match";
import { SCORE_VALUES } from "./scoring";

const added: Actor[] = [];
function bot(id: number, team: "blue" | "red"): Actor {
  const actor = createActor(id, `bot-${id}`, team);
  addActor(actor);
  added.push(actor);
  return actor;
}

function director(mode: GameModeId): MatchDirector {
  const d = new MatchDirector(mode);
  d.phase = "live";
  game.matchDirector = d;
  return d;
}

/** One lethal hit, resolved and scored the way the scene does it. */
function kill(d: MatchDirector, attacker: Actor, victim: Actor, region: HitRegion): void {
  queueDamage({
    targetId: victim.id,
    attackerId: attacker.id,
    amount: 1000,
    kind: "bullet",
    region,
    direction: new THREE.Vector3(0, 0, -1),
    point: victim.position.clone(),
    distanceM: 10,
    penetrated: false,
    weaponId: "m4a1",
    time: 1,
  });
  const out: KillReport[] = [];
  resolveDamage(1, out);
  for (const report of out) d.onKill(report);
  victim.alive = true;
  victim.health = victim.maxHealth;
}

beforeEach(() => {
  resetPlayerForMatch();
  seat.rules = "even";
});
afterEach(() => {
  for (const actor of added) removeActor(actor.id);
  added.length = 0;
  game.matchDirector = null;
  seat.rules = "mercy";
  resetPlayerForMatch();
});

describe("player kill score", () => {
  it("counts a headshot bonus once", () => {
    const d = director("tdm");
    kill(d, game.player, bot(201, "red"), "head");
    expect(game.player.score).toBe(
      SCORE_VALUES.kill + SCORE_VALUES.headshotBonus + SCORE_VALUES.firstBlood,
    );
  });

  it("counts a body kill at the base value", () => {
    const d = director("tdm");
    kill(d, game.player, bot(202, "red"), "chest");
    expect(game.player.score).toBe(SCORE_VALUES.kill + SCORE_VALUES.firstBlood);
  });
});

describe("team deathmatch", () => {
  it("scores kills to the killer's team and ignores friendly fire", () => {
    const d = director("tdm");
    const blue = bot(203, "blue");
    const red = bot(204, "red");
    kill(d, blue, red, "chest");
    kill(d, red, blue, "chest");
    kill(d, red, blue, "chest");
    kill(d, blue, bot(205, "blue"), "chest");
    expect([d.scoreBlue, d.scoreRed]).toEqual([1, 2]);
  });
});

describe("free-for-all", () => {
  it("lets a same-colour bot kill the player", () => {
    const d = director("ffa");
    kill(d, bot(206, "blue"), game.player, "chest");
    expect(game.player.deaths).toBe(1);
    expect(d.scoreRed).toBe(1);
  });

  it("scores the player against the best individual in the field", () => {
    const d = director("ffa");
    const blueBot = bot(207, "blue");
    const redBot = bot(208, "red");
    kill(d, blueBot, redBot, "chest");
    kill(d, blueBot, redBot, "chest");
    kill(d, redBot, blueBot, "chest");
    kill(d, game.player, blueBot, "chest");
    // Blue is the player alone; red is the leader's own tally, not a team sum.
    expect([d.scoreBlue, d.scoreRed]).toEqual([1, 2]);
  });

  it("gives the win to the player only when the player leads", () => {
    const behind = director("ffa");
    const rival = bot(209, "blue");
    kill(behind, rival, bot(210, "red"), "chest");
    behind.timeRemaining = 0;
    behind.update(0.016);
    expect(behind.getResult()?.winner).toBe("red");

    resetPlayerForMatch();
    rival.kills = 0;
    const ahead = director("ffa");
    kill(ahead, game.player, rival, "chest");
    ahead.timeRemaining = 0;
    ahead.update(0.016);
    expect(ahead.getResult()?.winner).toBe("blue");
  });
});
