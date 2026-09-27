import { describe, expect, it } from "vitest";
import { mulberry32 } from "@/lib/noise";
import {
  askedAxes,
  legalActionsFor,
  validateObservation,
  type Place,
} from "./observation";
import { RandomProvider } from "./providers";
import { ScriptedProvider } from "./policies";
import { makeObservation } from "./testing/fixtures";
import { buildSystemOneRequest } from "../../../server/jev/question";

/**
 * Places navigation: how places are offered, validated and asked about. The
 * navigator's own behaviour is tested in navigator.test.ts.
 */

const cover: Place = {
  kind: "cover",
  bearingDeg: -120,
  distanceM: 9,
  hidden: true,
  routeExposedM: 4.5,
  threatDistanceM: 71,
};
const advance: Place = {
  kind: "advance",
  bearingDeg: 15,
  distanceM: 20,
  hidden: true,
  routeExposedM: 0,
  threatDistanceM: 48,
};

const player = makeObservation().player;
const weapon = makeObservation().weapon;

describe("place legality", () => {
  it("offers only NONE under steps navigation, so the axis is not asked", () => {
    const legal = legalActionsFor(player, weapon, {
      control: "precision",
      visibleEnemies: 1,
      navigation: "steps",
      places: 3,
      travelling: true,
    });
    expect(legal.go).toEqual(["NONE"]);
    expect(askedAxes(legal)).not.toContain("go");
  });

  it("offers one slot per listed place, and CONTINUE only while travelling", () => {
    const idle = legalActionsFor(player, weapon, {
      control: "precision",
      visibleEnemies: 0,
      navigation: "places",
      places: 2,
      travelling: false,
    });
    expect(idle.go).toEqual(["NONE", "PLACE_0", "PLACE_1"]);
    const moving = legalActionsFor(player, weapon, {
      control: "direct",
      visibleEnemies: 0,
      navigation: "places",
      places: 0,
      travelling: true,
    });
    expect(moving.go).toEqual(["NONE", "CONTINUE"]);
  });

  it("validates a places observation, and rejects places listed under steps", () => {
    const ok = makeObservation({
      navigation: "places",
      perception: { places: [cover, advance] },
      travel: { kind: "cover", bearingDeg: -118, remainingM: 7.5 },
    });
    expect(validateObservation(ok).ok).toBe(true);
    expect(ok.legal.go).toEqual(["NONE", "CONTINUE", "PLACE_0", "PLACE_1"]);

    const stepsWithPlaces = makeObservation({ navigation: "steps" });
    stepsWithPlaces.perception.places = [cover];
    expect(validateObservation(stepsWithPlaces).ok).toBe(false);

    const unknownKind = makeObservation({
      navigation: "places",
      perception: { places: [{ ...cover, kind: "sniper_nest" as Place["kind"] }] },
    });
    expect(validateObservation(unknownKind).ok).toBe(false);

    const coordinates = makeObservation({
      navigation: "places",
      perception: { places: [{ ...cover, x: 1200 } as Place] },
    });
    expect(validateObservation(coordinates).ok).toBe(false);
  });
});

describe("the places question", () => {
  const observation = makeObservation({
    control: "precision",
    navigation: "places",
    perception: { places: [cover, advance] },
    travel: null,
  });
  const request = buildSystemOneRequest(observation, "jev-latest");

  it("asks where to go, and names each place by its slot", () => {
    expect(Object.keys(request.questions)).toContain("go");
    expect(Object.keys(request.questions.go!.criteria)).toEqual([
      "NONE",
      "PLACE_0",
      "PLACE_1",
    ]);
    const places = request.state["places_nearest_first"] as Record<
      string,
      Record<string, unknown>
    >;
    expect(Object.keys(places)).toEqual(["PLACE_0", "PLACE_1"]);
    expect(places["PLACE_0"]!["hidden_there_from_known_enemies"]).toBe(true);
    expect(String(places["PLACE_0"]!["route_in_sight_of_known_enemies"])).toMatch(
      /about 5 m of the 9 m/,
    );
    expect(String(places["PLACE_1"]!["route_in_sight_of_known_enemies"])).toBe(
      "none of it",
    );
  });

  it("states the go question's premise, since questions cannot see each other", () => {
    const text = request.questions.go!.instructions.question;
    expect(text).toMatch(/places_nearest_first/);
    expect(text).toMatch(/travelling_to/);
  });

  it("describes places without advice, and without coordinates", () => {
    const text = JSON.stringify(request);
    expect(text).not.toMatch(/you should|best place|safest|always take cover/i);
    expect(text).not.toMatch(/"x"|"z"|position|coordinates/i);
  });
});

describe("the random baseline under places", () => {
  it("leaves the precision stream unchanged and draws the destination last", () => {
    const legal = legalActionsFor(player, weapon, {
      control: "precision",
      visibleEnemies: 2,
      navigation: "places",
      places: 3,
      travelling: false,
    });
    const a = new RandomProvider(42);
    const rand = mulberry32(42);
    const draw = <T>(options: readonly T[]): T =>
      options[Math.min(options.length - 1, Math.floor(rand() * options.length))]!;
    for (let i = 0; i < 20; i += 1) {
      const frame = a.pick(legal, "precision", "places");
      expect([
        frame.move,
        frame.turn,
        frame.tilt,
        frame.weapon,
        frame.target,
        frame.aim,
        frame.go,
      ]).toEqual([
        draw(legal.move),
        draw(legal.turn),
        draw(legal.tilt),
        draw(legal.weapon),
        draw(legal.target),
        draw(legal.aim),
        draw(legal.go),
      ]);
    }
  });
});

describe("the skirmisher under places", () => {
  it("heads for cover when hit, and keeps going while it travels there", () => {
    const hit = makeObservation({
      control: "precision",
      navigation: "places",
      perception: { places: [advance, cover] },
    });
    const provider = new ScriptedProvider("skirmisher");
    expect(provider.pick(hit).go).toBe("PLACE_1");
    const onTheWay = makeObservation({
      control: "precision",
      navigation: "places",
      perception: { places: [advance, cover] },
      travel: { kind: "cover", bearingDeg: -110, remainingM: 4 },
    });
    expect(provider.pick(onTheWay).go).toBe("CONTINUE");
  });

  it("closes on distant enemies through places hidden from them", () => {
    const base = makeObservation().perception.visibleEnemies[0]!;
    const far = makeObservation({
      control: "precision",
      navigation: "places",
      player: { health: 100 },
      perception: {
        damage: null,
        visibleEnemies: [{ ...base, distanceM: 110 }],
        places: [cover, advance],
      },
    });
    expect(new ScriptedProvider("skirmisher").pick(far).go).toBe("PLACE_1");
  });
});
