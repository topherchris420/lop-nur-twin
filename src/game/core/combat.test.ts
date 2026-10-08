import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { MatchDirector } from "../modes/match";
import {
  COMBAT,
  areHostile,
  queueEnvironmentalDamage,
  resolveDamage,
  respawnActor,
  seat,
  type KillReport,
} from "./combat";
import {
  addActor,
  createActor,
  game,
  queueDamage,
  removeActor,
  resetPlayerForMatch,
  type Actor,
} from "./gameState";

function hit(attacker: Actor, victim: Actor, amount: number): void {
  queueDamage({
    targetId: victim.id,
    attackerId: attacker.id,
    amount,
    kind: "bullet",
    region: "chest",
    direction: new THREE.Vector3(0, 0, -1),
    point: victim.position.clone(),
    distanceM: 10,
    penetrated: false,
    weaponId: "m4a1",
    time: 1,
  });
}

const added: Actor[] = [];
function bot(id: number, team: "blue" | "red"): Actor {
  const actor = createActor(id, `bot-${id}`, team);
  addActor(actor);
  added.push(actor);
  return actor;
}

beforeEach(() => {
  resetPlayerForMatch();
  game.damageQueue.length = 0;
});
afterEach(() => {
  for (const actor of added) removeActor(actor.id);
  added.length = 0;
  game.matchDirector = null;
  game.damageQueue.length = 0;
  seat.rules = "mercy";
  resetPlayerForMatch();
});

describe("hostility", () => {
  it("keeps team rules outside a free-for-all", () => {
    const a = bot(101, "blue");
    const b = bot(102, "blue");
    const c = bot(103, "red");
    game.matchDirector = new MatchDirector("tdm");
    expect(areHostile(a, b)).toBe(false);
    expect(areHostile(a, c)).toBe(true);
    expect(areHostile(a, a)).toBe(false);

    hit(a, b, 40);
    const out: KillReport[] = [];
    resolveDamage(1, out);
    expect(b.health).toBe(100);
    expect(COMBAT.friendlyFire).toBe(false);
  });

  it("makes every other actor an enemy in a free-for-all", () => {
    const a = bot(101, "blue");
    const b = bot(102, "blue");
    game.matchDirector = new MatchDirector("ffa");
    expect(areHostile(a, b)).toBe(true);
    expect(areHostile(a, game.player)).toBe(true);
    expect(areHostile(a, a)).toBe(false);

    // A blue bot can hurt, kill and be credited for the blue player.
    seat.rules = "even";
    hit(a, game.player, 150);
    const out: KillReport[] = [];
    resolveDamage(1, out);
    expect(game.player.alive).toBe(false);
    expect(out).toHaveLength(1);
    expect(out[0]!.attacker).toBe(a);
    expect(a.kills).toBe(1);
  });
});

describe("environmental damage", () => {
  it("kills the player through the ordinary pipeline, with nobody credited", () => {
    const shooter = bot(104, "red");
    hit(shooter, game.player, 10);
    resolveDamage(1, []);
    expect(game.player.lastAttackerId).toBe(shooter.id);

    queueEnvironmentalDamage(game.player, 100, "fall", 2);
    const out: KillReport[] = [];
    resolveDamage(2, out);
    expect(game.player.alive).toBe(false);
    expect(game.player.health).toBe(0);
    expect(game.player.deaths).toBe(1);
    expect(out).toHaveLength(1);
    expect(out[0]!.attacker).toBeNull();
    expect(shooter.kills).toBe(0);
    expect(game.player.lastAttackerId).toBeNull();
  });

  it("is not scaled by the seat's mercy rules", () => {
    seat.rules = "mercy";
    queueEnvironmentalDamage(game.player, 30, "fall", 1);
    resolveDamage(1, []);
    expect(game.player.health).toBe(70);
  });
});

describe("player spawn epoch", () => {
  it("moves on a respawn and on a new match, not on a bot respawn", () => {
    const start = game.playerSpawnEpoch;
    respawnActor(bot(105, "red"), new THREE.Vector3(), 0);
    expect(game.playerSpawnEpoch).toBe(start);
    respawnActor(game.player, new THREE.Vector3(), 0);
    expect(game.playerSpawnEpoch).toBe(start + 1);
    resetPlayerForMatch();
    expect(game.playerSpawnEpoch).toBe(start + 2);
  });
});
