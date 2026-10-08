import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MatchDirector } from "../modes/match";
import { recordGunfirePing } from "../core/combat";
import {
  addActor,
  createActor,
  game,
  removeActor,
  resetPlayerForMatch,
  type Actor,
} from "../core/gameState";
import { useGameStore } from "../core/gameStore";
import { validateObservation } from "./observation";
import { Perception, type PerceptionInput } from "./perception";

/**
 * Who perception calls an enemy is the mode's rule, the one `areHostile`
 * applies to damage: in a free-for-all a bot wearing the player's colour is
 * an enemy, in team deathmatch it is a teammate. What may be reported about
 * an enemy (in view, heard) is unchanged either way.
 */

const input: PerceptionInput = {
  sequence: 1,
  previousFrame: null,
  previousOutcome: null,
  control: "precision",
  trackedId: null,
  navigation: "steps",
  travel: null,
};

const added: Actor[] = [];
function bot(id: number, team: "blue" | "red", x: number, z: number): Actor {
  const actor = createActor(id, `bot-${id}`, team);
  actor.position.set(x, 0, z);
  addActor(actor);
  added.push(actor);
  return actor;
}

const initialMode = useGameStore.getState().mode;

beforeEach(() => {
  resetPlayerForMatch();
  game.world = null;
  game.time = 10;
  game.player.position.set(0, 0, 0);
  game.player.yaw = 0;
  game.player.pitch = 0;
  game.cameraForward.set(0, 0, -1);
  game.cameraPosition.set(0, 1.6, 0);
  game.hud.gunfirePings.length = 0;
});

afterEach(() => {
  for (const actor of added) removeActor(actor.id);
  added.length = 0;
  game.matchDirector = null;
  game.hud.gunfirePings.length = 0;
  useGameStore.setState({ mode: initialMode });
  resetPlayerForMatch();
});

function capture(mode: "tdm" | "ffa") {
  game.matchDirector = new MatchDirector(mode);
  useGameStore.setState({ mode });
  const perception = new Perception();
  const observation = perception.capture(input);
  const validated = validateObservation(observation);
  expect(validated.ok ? "" : validated.error).toBe("");
  return { observation, perception };
}

describe("perception's enemies follow the mode's hostility rule", () => {
  it("reports a same-colour bot in view as an enemy in a free-for-all", () => {
    expect(game.player.team).toBe("blue");
    const mate = bot(201, "blue", 0, -20);
    const { observation, perception } = capture("ffa");
    expect(observation.perception.visibleEnemies).toHaveLength(1);
    expect(observation.perception.visibleEnemies[0]!.distanceM).toBeGreaterThan(15);
    expect(perception.lastTargetIds).toEqual([mate.id]);
    // Nobody is an ally when everyone is hostile.
    expect(observation.perception.allies).toEqual([]);
  });

  it("does not report a same-colour bot in view as an enemy in team deathmatch", () => {
    bot(201, "blue", 0, -20);
    const { observation, perception } = capture("tdm");
    expect(observation.perception.visibleEnemies).toEqual([]);
    expect(perception.lastTargetIds).toEqual([]);
    expect(observation.perception.allies).toHaveLength(1);
  });

  it("still reports an other-colour bot in view as an enemy in team deathmatch", () => {
    const enemy = bot(202, "red", 0, -20);
    const { observation, perception } = capture("tdm");
    expect(observation.perception.visibleEnemies).toHaveLength(1);
    expect(perception.lastTargetIds).toEqual([enemy.id]);
  });

  it("does not report a same-colour bot behind the player in either mode", () => {
    bot(201, "blue", 0, 20);
    expect(capture("ffa").observation.perception.visibleEnemies).toEqual([]);
    expect(capture("tdm").observation.perception.visibleEnemies).toEqual([]);
  });

  it("hears a same-colour bot's gunfire in a free-for-all, never the player's own", () => {
    const mate = bot(201, "blue", 0, 30); // behind: heard, not seen
    recordGunfirePing(mate, game.time);
    recordGunfirePing(game.player, game.time);

    const ffa = capture("ffa").observation.perception.contacts;
    expect(ffa.filter((c) => c.source === "gunfire")).toHaveLength(1);
    expect(ffa[0]!.distanceM).toBeCloseTo(30, 0);

    const tdm = capture("tdm").observation.perception.contacts;
    expect(tdm.filter((c) => c.source === "gunfire")).toEqual([]);
  });
});
