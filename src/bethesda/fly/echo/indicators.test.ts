import { describe, expect, it } from "vitest";
import { arenaWorld, type ArenaSpec } from "../arena";
import { DigitalFly } from "../fly";
import { type MotorCommand } from "../neural";
import { PERTURBATION_SCHEMA, type Perturbation } from "../perturbation";
import { EchoAdapter } from "./adapter";
import { freshSchema, interruptionRisk, learn, predict } from "./attentionSchema";
import { EP } from "./params";
import { type EchoEvent, type EchoVariant } from "./selfModel";
import { type SelfModelView } from "./view";
import { compete, freshWorkspace, intentionBid, type Bid } from "./workspace";

const ROOM: ArenaSpec = { size: [4, 2.5, 4], ambient: 0.6 };
/** A fly with urges: it takes off and grooms often, so they compete with its attention to itself. */
const BUSY = { takeoffHz: 0.5, groomHz: 0.5, walkStartHz: 1, walkStopHz: 0.1 };
const WALKING = { takeoffHz: 0, groomHz: 0, walkStartHz: 1, walkStopHz: 0.1 };
const impaired: Perturbation = {
  schema: PERTURBATION_SCHEMA,
  episodes: [{ id: "w", cause: "self", from: 15, until: null, speedGain: 0.5 }],
};

function fly(
  seed: number,
  variant: EchoVariant,
  config: Record<string, number>,
  onEvent?: (e: EchoEvent, echo: EchoAdapter) => void,
) {
  const events: EchoEvent[] = [];
  const commands: MotorCommand[] = [];
  let echo: EchoAdapter | null = null;
  const f = new DigitalFly({
    seed,
    world: arenaWorld(ROOM),
    start: { p: [0, 0.5, 0], yaw: 0.3 },
    config,
    perturbation: impaired,
    adapter: EchoAdapter.factory({
      variant,
      seed,
      onEvent: (e) => {
        events.push(e);
        if (echo) onEvent?.(e, echo);
      },
      onDecision: (d) => commands.push(d.command),
    }),
  });
  echo = f.adapter as EchoAdapter;
  const run = (seconds: number) => {
    for (let k = 0; k < Math.round(seconds * 20); k++) f.advance(0.05);
  };
  return { fly: f, echo, events, commands, run };
}

const bid = (source: Bid["source"], salience: number): Bid => ({
  source,
  salience,
  what: source,
});
const view = (over: Partial<SelfModelView> = {}): SelfModelView =>
  ({ mode: "walk", reserve: 1, ...over }) as SelfModelView;

describe("the workspace: one content at a time, broadcast", () => {
  it("lets in one content, keeps it against an equal, and gives it up to a clearly stronger one", () => {
    const ws = freshWorkspace();
    expect(compete(ws, [bid("routine", 0.3)], 0, 0.05, false)).toBeNull();
    expect(ws.holder).toBeNull();
    expect(
      compete(ws, [bid("self", 1), bid("routine", 0.7)], 0.05, 0.05, false)?.source,
    ).toBe("self");
    // An equal does not take it; a rival past the margin does.
    expect(
      compete(ws, [bid("self", 1), bid("routine", 1.04)], 0.1, 0.05, false),
    ).toBeNull();
    expect(ws.holder?.source).toBe("self");
    expect(
      compete(ws, [bid("self", 1), bid("routine", 1.1)], 0.15, 0.05, false)?.source,
    ).toBe("routine");
    expect(ws.past.at(-1)).toMatchObject({ source: "self", from: 0.05, until: 0.15 });
    // What holds it keeps it while it still matters, and lets go below the release level;
    // nothing weak enters an empty workspace.
    compete(ws, [bid("routine", 0.3), bid("self", 0.45)], 0.2, 0.05, false);
    expect(ws.holder?.source).toBe("routine");
    compete(ws, [bid("routine", 0.2), bid("self", 0.45)], 0.25, 0.05, false);
    expect(ws.holder).toBeNull();
    expect(ws.ignitions).toBe(2);
    expect(ws.held).toMatchObject({ self: 0.1, routine: 0.1 });
  });

  it("shielded, holds off a rival it may, but never a hazard, a touch or the air", () => {
    for (const [source, salience, enters] of [
      ["routine", 1.9, false],
      ["pursuit", 1.9, false],
      ["routine", 2.1, true],
      ["hazard", EP.hazardSalience, true],
      ["touch", EP.touchSalience, true],
      ["air", EP.airSalience, true],
    ] as const) {
      const ws = freshWorkspace();
      compete(ws, [bid("self", 1)], 0, 0.05, true);
      compete(ws, [bid("self", 1), bid(source, salience)], 0.05, 0.05, true);
      expect(ws.holder?.source, `${source} ${salience}`).toBe(enters ? source : "self");
    }
  });

  it("reads the controller's intention as a bid, with the fly's hunger behind food", () => {
    const at = (c: Partial<MotorCommand>, v?: Partial<SelfModelView>) =>
      intentionBid({ mode: "walk", reason: "", ...c }, view(v));
    expect(at({ mode: "flight", saccade: 0.5 }).source).toBe("hazard");
    expect(at({ mode: "escape" }).source).toBe("hazard");
    expect(at({ mode: "land" })).toMatchObject({
      source: "pursuit",
      salience: EP.landSalience,
    });
    expect(at({ mode: "feed" }, { reserve: 0.2 }).salience).toBeCloseTo(
      EP.foodSalience + 0.8,
    );
    expect(at({ mode: "feed" }, { reserve: 1 }).salience).toBeCloseTo(EP.foodSalience);
    expect(at({ mode: "takeoff" }, { mode: "rest" }).salience).toBe(EP.takeoffSalience);
    expect(at({ mode: "groom" }).salience).toBe(EP.groomSalience);
    expect(at({ mode: "flight" }, { mode: "flight" }).salience).toBe(EP.flightSalience);
    expect(at({ mode: "walk" })).toMatchObject({ source: "routine", what: "walking" });
  });
});

describe("the attention schema: a model of its own attention", () => {
  it("learns how often each content takes its workspace and how long it holds it", () => {
    const A = freshSchema();
    const dt = 0.05;
    // A takeoff urge every 2 s for 10 minutes, each holding the workspace 0.5 s.
    for (let k = 0; k < 12000; k++)
      learn(
        A,
        k % 40 === 0 ? "routine" : null,
        k % 40 === 10 ? { source: "routine", heldS: 0.5 } : null,
        dt,
      );
    expect(A.rate.routine).toBeCloseTo(0.5, 1);
    expect(A.rate.self).toBe(0);
    expect(A.dwell.routine).toBeCloseTo(0.5, 5);
    expect(A.dwell.self).toBe(EP.schemaDwellS);
  });

  it("expects interruption only from what it could hold off, and predicts its focus", () => {
    const A = freshSchema();
    A.rate.routine = 0.5;
    A.rate.touch = 5;
    A.dwell.self = 3;
    expect(interruptionRisk(A, "self", 2)).toBeCloseTo(1 - Math.exp(-1), 6);
    expect(interruptionRisk(A, "routine", 2)).toBe(0);
    const ws = freshWorkspace();
    compete(ws, [bid("self", 1)], 10, 0.05, false);
    predict(A, ws, 11);
    expect(A.expect).toMatchObject({ holder: "self", remainingS: 2, next: "touch" });
    expect(A.expect.nextInS).toBeCloseTo(1 / 5.5, 6);
  });
});

describe("the indicators at work in a fly", () => {
  it("while its inquiry holds the workspace it keeps to its feet, and asks its questions only then", () => {
    let probes = 0;
    const f = fly(12, "full", BUSY, (e, echo) => {
      if (e.kind !== "probe") return;
      probes++;
      expect(echo.model!.state.workspace!.holder?.source).toBe("self");
    });
    f.run(90);
    const S = f.echo.model!.state;
    expect(S.counts.inquiries).toBeGreaterThan(0);
    expect(S.workspace!.ignitions).toBeGreaterThan(10);
    expect(S.workspace!.held.self).toBeGreaterThan(0);
    expect(S.counts.held).toBeGreaterThan(0);
    expect(
      f.commands.some((c) => c.reason.startsWith("attending to its own movement")),
    ).toBe(true);
    expect(probes).toBe(S.counts.probes);
    expect(f.fly.state.counts.rejected).toBe(0);
  });

  it("models its own attention, and shields an inquiry it expects to be interrupted", () => {
    const f = fly(12, "full", BUSY);
    f.run(90);
    const A = f.echo.model!.state.attention!;
    expect(A.rate.routine).toBeGreaterThan(0);
    expect(f.echo.model!.state.counts.shielded).toBeGreaterThan(0);
    const bare = fly(12, "no_attention_schema", BUSY);
    bare.run(90);
    expect(bare.echo.model!.state.attention).toBeNull();
    expect(bare.echo.model!.state.workspace).not.toBeNull();
    expect(bare.echo.model!.state.counts.shielded).toBe(0);
  });

  it("without a workspace nothing is broadcast and nothing held", () => {
    const f = fly(12, "no_workspace", BUSY);
    f.run(90);
    const S = f.echo.model!.state;
    expect(S.workspace).toBeNull();
    expect(S.attention).toBeNull();
    expect(S.counts.held).toBe(0);
    expect(S.counts.inquiries).toBeGreaterThan(0);
  });

  it("takes a second look before it commits, and says so", () => {
    const looks = fly(5, "full", WALKING);
    const once = fly(5, "no_metacognition", WALKING);
    looks.run(40);
    once.run(40);
    const first = (es: EchoEvent[]) =>
      es.find((e) => e.kind === "concluded" && e.t >= 15)!;
    const a = first(looks.events),
      b = first(once.events);
    expect(a.explanation).toBe("self");
    expect(b.explanation).toBe("self");
    expect(a.checked).toBe("confirmed");
    expect(b.checked).toBeUndefined();
    // The same fly up to the first verdict: one acts on it at once, the other looks again for checkPeriods.
    const T = 0.05;
    expect(a.t - b.t).toBeGreaterThanOrEqual(EP.checkPeriods * T - 1e-9);
    expect(looks.echo.model!.state.counts.confirmed).toBeGreaterThan(0);
    expect(once.echo.model!.state.counts.confirmed).toBe(0);
  });

  it("revises a conclusion its second look contradicts", () => {
    const f = fly(26, "full", BUSY);
    f.run(90);
    const revised = f.events.filter(
      (e) => e.kind === "concluded" && e.checked === "revised",
    );
    expect(revised.length).toBe(f.echo.model!.state.counts.revised);
    expect(revised.length).toBeGreaterThan(0);
  });
});
