import { describe, expect, it } from "vitest";
import { mulberry32 } from "@/lib/noise";
import { DECISION_SCHEMA_VERSION, TARGET_ACTIONS } from "./contract";
import { frameOf, parseAllAxes, validateDecision } from "./decision";
import { askedAxes, legalActionsFor, validateObservation } from "./observation";
import { RandomProvider } from "./providers";
import { coneHitFraction, aimRegionGeometry, angularRadiusDeg } from "./hitGeometry";
import { fakeAnswers, makeObservation } from "./testing/fixtures";
import { buildSystemOneRequest } from "../../../server/jev/question";

/**
 * The engagement part of the contract: target slots and aim regions, how they
 * are offered, asked, validated and executed-to-frame.
 */

const player = makeObservation().player;
const weapon = makeObservation().weapon;

describe("target and aim legality", () => {
  it("offers nothing to choose in direct control, so neither axis is asked", () => {
    const legal = legalActionsFor(player, weapon, {
      control: "direct",
      visibleEnemies: 3,
    });
    expect(legal.target).toEqual(["NONE"]);
    expect(legal.aim).toEqual(["CENTER_MASS"]);
    expect(askedAxes(legal)).toEqual(["move", "turn", "tilt", "weapon"]);
  });

  it("offers one slot per listed enemy in precision control, and no more", () => {
    for (let n = 0; n <= 4; n += 1) {
      const legal = legalActionsFor(player, weapon, {
        control: "precision",
        visibleEnemies: n,
      });
      expect(legal.target).toEqual(TARGET_ACTIONS.slice(0, 1 + n));
      expect(legal.aim.length).toBe(n > 0 ? 3 : 1);
    }
    // More enemies than the list holds still yields only listed slots.
    expect(
      legalActionsFor(player, weapon, { control: "precision", visibleEnemies: 9 }).target,
    ).toHaveLength(5);
  });

  it("rejects an observation whose target slots disagree with its enemy list", () => {
    const observation = makeObservation({ control: "precision" });
    expect(validateObservation(observation).ok).toBe(true);
    const forged = {
      ...observation,
      legal: { ...observation.legal, target: [...TARGET_ACTIONS] },
    };
    expect(validateObservation(forged).ok).toBe(false);
  });

  it("rejects free text where a slot belongs", () => {
    const observation = makeObservation({ control: "precision" });
    const answers = fakeAnswers(observation.legal, { target: "TARGET_0" });
    (answers["target"] as Record<string, unknown>)["choice"] = "enemy #17";
    expect(parseAllAxes(answers, observation.legal).ok).toBe(false);
  });

  it("rejects an answer for an axis that was not asked", () => {
    const observation = makeObservation({ control: "direct" });
    const answers = fakeAnswers(observation.legal);
    answers["target"] = {
      choice: "NONE",
      confidence: 1,
      probabilities: { NONE: 1 },
    };
    expect(parseAllAxes(answers, observation.legal).ok).toBe(false);
  });

  it("fills an unasked axis from its only option, with no invented probabilities", () => {
    const observation = makeObservation({ control: "direct" });
    const parsed = parseAllAxes(fakeAnswers(observation.legal), observation.legal);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.target).toBeNull();
    expect(parsed.value.aim).toBeNull();
    const frame = frameOf(parsed.value, observation.legal);
    expect(frame.target).toBe("NONE");
    expect(frame.aim).toBe("CENTER_MASS");
  });

  it("accepts a precision decision that names a slot and a region", () => {
    const observation = makeObservation({ control: "precision", sequence: 9 });
    const answers = fakeAnswers(observation.legal, { target: "TARGET_0", aim: "HEAD" });
    const axes = Object.fromEntries(
      Object.entries(answers).map(([axis, a]) => {
        const answer = a as { choice: string; confidence: number; probabilities: object };
        return [
          axis,
          {
            choice: answer.choice,
            confidence: answer.confidence,
            probabilities: answer.probabilities,
          },
        ];
      }),
    );
    const parsed = parseAllAxes(answers, observation.legal);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const result = validateDecision(
      {
        schemaVersion: DECISION_SCHEMA_VERSION,
        sequence: 9,
        source: "typesafe",
        model: "jev-1.13.0",
        frame: frameOf(parsed.value, observation.legal),
        axes,
        latencyMs: 150,
        usage: null,
      },
      { sequence: 9, legal: observation.legal },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.frame.target).toBe("TARGET_0");
      expect(result.value.frame.aim).toBe("HEAD");
    }
  });
});

describe("the question", () => {
  it("asks the original four questions in direct control", () => {
    const request = buildSystemOneRequest(
      makeObservation({ control: "direct" }),
      "jev-latest",
    );
    expect(Object.keys(request.questions).sort()).toEqual([
      "move",
      "tilt",
      "turn",
      "weapon",
    ]);
  });

  it("asks target and aim in precision control, and names each enemy by its slot", () => {
    const observation = makeObservation({ control: "precision" });
    const request = buildSystemOneRequest(observation, "jev-latest");
    expect(Object.keys(request.questions).sort()).toEqual(
      ["aim", "move", "target", "tilt", "turn", "weapon"].sort(),
    );
    expect(Object.keys(request.questions.target!.criteria)).toEqual(["NONE", "TARGET_0"]);
    const enemies = request.state["enemies_in_view_nearest_crosshair_first"] as Record<
      string,
      Record<string, unknown>
    >;
    expect(Object.keys(enemies)).toEqual(["TARGET_0"]);
    const target = enemies["TARGET_0"]!;
    expect(target["exposure"]).toBe("fully exposed");
    expect(String(target["motion"])).toMatch(/moving left/);
    // Sizes against the spread are stated as facts, not as advice.
    const chances = JSON.stringify(target["chance_per_round_with_crosshair_on_it"]);
    expect(chances).toMatch(/HEAD/);
    expect(JSON.stringify(request)).not.toMatch(
      /you should|best action|always fire|aim for the head/i,
    );
    // No entity id, coordinate or future ever reaches the question.
    expect(JSON.stringify(request)).not.toMatch(/"id"|entity|position|velocity/i);
  });
});

describe("the random baseline", () => {
  it("draws the same four numbers per decision in direct control as it always has", () => {
    const legal = legalActionsFor(player, weapon, {
      control: "direct",
      visibleEnemies: 2,
    });
    const a = new RandomProvider(42);
    // The original baseline, written out: four draws, one per axis, in order.
    const rand = mulberry32(42);
    const draw = <T>(options: readonly T[]): T =>
      options[Math.min(options.length - 1, Math.floor(rand() * options.length))]!;
    for (let i = 0; i < 20; i += 1) {
      const fa = a.pick(legal, "direct");
      expect([fa.move, fa.turn, fa.tilt, fa.weapon]).toEqual([
        draw(legal.move),
        draw(legal.turn),
        draw(legal.tilt),
        draw(legal.weapon),
      ]);
      expect(fa.target).toBe("NONE");
    }
  });

  it("is deterministic in precision control and picks only legal slots", () => {
    const legal = legalActionsFor(player, weapon, {
      control: "precision",
      visibleEnemies: 2,
    });
    const run = (): string[] => {
      const provider = new RandomProvider(7);
      return Array.from({ length: 50 }, () => {
        const frame = provider.pick(legal, "precision");
        expect(legal.target).toContain(frame.target);
        return `${frame.target}/${frame.aim}`;
      });
    };
    expect(run()).toEqual(run());
  });
});

describe("hit geometry", () => {
  it("matches the spread draw's small-angle geometry", () => {
    // Centred, a target wider than the cone takes every round.
    expect(coneHitFraction(0, 0.2, 0.5)).toBe(1);
    // Centred, a target half the cone's radius takes a quarter of it.
    expect(coneHitFraction(0, 1, 0.5)).toBeCloseTo(0.25, 9);
    // Far off, nothing.
    expect(coneHitFraction(3, 1, 0.5)).toBe(0);
    // No spread: a point, inside or not.
    expect(coneHitFraction(0.1, 0, 0.2)).toBe(1);
    expect(coneHitFraction(0.3, 0, 0.2)).toBe(0);
  });

  it("puts each aim point inside the body's own boxes", () => {
    const head = aimRegionGeometry("HEAD", "stand");
    const chest = aimRegionGeometry("UPPER_CHEST", "stand");
    const centre = aimRegionGeometry("CENTER_MASS", "stand");
    expect(head.heightM).toBeGreaterThan(chest.heightM);
    expect(chest.heightM).toBeGreaterThan(centre.heightM);
    expect(head.radiusM).toBeLessThan(centre.radiusM);
    expect(angularRadiusDeg(0.19, 30)).toBeCloseTo(0.3628, 3);
  });
});

describe("the engagement questions stand alone", () => {
  it("name where their facts are and state their premise, since parallel questions cannot see each other", () => {
    const request = buildSystemOneRequest(
      makeObservation({ control: "precision" }),
      "jev-latest",
    );
    const target = request.questions.target!.instructions.question;
    const aim = request.questions.aim!.instructions.question;
    expect(target).toContain("`enemies_in_view_nearest_crosshair_first`");
    expect(aim).toContain("`enemies_in_view_nearest_crosshair_first`");
    expect(aim).toMatch(/^Suppose/);
    // The aim question must not depend on the target answer it cannot see.
    expect(aim).not.toMatch(/the tracked enemy/);
  });
});
