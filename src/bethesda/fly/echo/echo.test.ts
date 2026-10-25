import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson } from "../../../lib/canonicalJson";
import { arenaWorld, type ArenaSpec } from "../arena";
import { type ReducedOrderController } from "../controller";
import { DigitalFly, FLY_VERSION } from "../fly";
import { type DecisionInput, type FlyNeuralAdapter, type MotorCommand } from "../neural";
import { PARAMS } from "../params";
import {
  PERTURBATION_SCHEMA,
  perturbationAt,
  perturbationErrors,
  type Perturbation,
  type PerturbationEpisode,
} from "../perturbation";
import { forward, left, type V3, wrapAngle } from "../units";
import { EchoAdapter, echoDescriptor } from "./adapter";
import {
  ECHO_CHECKPOINT,
  parseEchoCheckpoint,
  serializeEchoCheckpoint,
} from "./checkpoint";
import { INNATE, N, predict, X, type PeriodContext } from "./forward";
import { ECHO_PARAMS, ECHO_VERSION, EP } from "./params";
import {
  ECHO_VARIANTS,
  initialEchoState,
  SelfModel,
  type EchoEvent,
  type EchoVariant,
} from "./selfModel";
import { selfModelView } from "./view";
import { FLY_ECHO_VARIANTS } from "../../rain/scientificProtocol";

const ROOM: ArenaSpec = { size: [4, 2.5, 4], ambient: 0.6 };
const WALKING = { takeoffHz: 0, groomHz: 0, walkStartHz: 1, walkStopHz: 0.1 };
const episodes = (...e: PerturbationEpisode[]): Perturbation => ({
  schema: PERTURBATION_SCHEMA,
  episodes: e,
});

/** A walking fly in the open room, with an ECHO controller, and what it noticed and concluded. */
function walker(
  seed: number,
  options: {
    variant?: EchoVariant;
    perturbation?: Perturbation;
    config?: Record<string, number>;
    events?: EchoEvent[];
  } = {},
) {
  const events = options.events ?? [];
  const fly = new DigitalFly({
    seed,
    world: arenaWorld(ROOM),
    start: { p: [0, 0.5, 0], yaw: 0.3 },
    config: options.config ?? WALKING,
    adapter: EchoAdapter.factory({
      variant: options.variant ?? "full",
      seed,
      onEvent: (e) => events.push(e),
    }),
    ...(options.perturbation ? { perturbation: options.perturbation } : {}),
  });
  return { fly, echo: fly.adapter as EchoAdapter, events };
}
const run = (fly: DigitalFly, seconds: number, each?: () => void) => {
  for (let k = 0; k < Math.round(seconds * 20); k++) {
    fly.advance(0.05);
    each?.();
  }
};

/** A decision maker that walks at a fixed speed and turn, whatever happens. */
class Steady implements FlyNeuralAdapter {
  readonly descriptor = { ...echoDescriptor("full"), id: "steady-test" };
  constructor(private plan: (t: number) => MotorCommand) {}
  decide(input: DecisionInput): MotorCommand {
    return this.plan(input.body.t);
  }
}

describe("ECHO self-model: version, parameters and vocabulary", () => {
  it("names one version, fixes every number as a model choice, and shares its variants with the contract", () => {
    expect(ECHO_VERSION).toBe("echo-self-model/v1");
    for (const [name, p] of Object.entries(ECHO_PARAMS)) {
      expect(p.kind, name).toBe("model");
      expect(p.min, name).toBe(p.value);
      expect(p.max, name).toBe(p.value);
      expect(p.note.length, name).toBeGreaterThan(20);
    }
    expect([...FLY_ECHO_VARIANTS]).toEqual([...ECHO_VARIANTS]);
    for (const v of ECHO_VARIANTS) {
      const d = echoDescriptor(v);
      expect(d.simulatesNeurons).toBe(false);
      // Only the reactive controller reads no self-motion sense.
      expect(d.selfMotion).toBe(v !== "reactive");
      expect(d.fidelity).not.toMatch(/\b(conscious|aware of itself|sentien)/i);
    }
  });
});

describe("the forward model", () => {
  it("with innate beliefs reproduces the reduced-order body's walking law exactly", () => {
    // Speed changes, turns and stops, and the true displacement per period against the prediction.
    const plan = (t: number): MotorCommand =>
      t < 0.5
        ? { mode: "walk", walkSpeed: 3, yawRate: 0, reason: "test" }
        : t < 1.5
          ? { mode: "walk", walkSpeed: 1.2, yawRate: 2.5, reason: "test" }
          : t < 2
            ? { mode: "walk", walkSpeed: 3.6, yawRate: -4, reason: "test" }
            : { mode: "rest", reason: "test" };
    const fly = new DigitalFly({
      seed: 3,
      world: arenaWorld(ROOM),
      start: { p: [0, 0.5, 0], yaw: 1.1 },
      adapter: () => new Steady(plan),
    });
    const P = fly.params;
    let checked = 0;
    for (let k = 0; k < 50; k++) {
      const before = {
        p: [...fly.state.p] as V3,
        yaw: fly.state.yaw,
        v0: fly.state.walkSpeed / 100,
        mode: fly.state.mode,
      };
      const cmd = plan(fly.state.t);
      fly.advance(P.decisionPeriodMs / 1000);
      const d: V3 = [fly.state.p[0] - before.p[0], 0, fly.state.p[2] - before.p[2]];
      const f = forward(before.yaw),
        l = left(before.yaw);
      const observed = [
        d[0] * f[0] + d[2] * f[2],
        d[0] * l[0] + d[2] * l[2],
        wrapAngle(fly.state.yaw - before.yaw),
      ];
      const T = P.decisionPeriodMs / 1000,
        steps = Math.round(T / (P.physicsStepMs / 1000));
      const walking = cmd.mode === "walk";
      const ctx: PeriodContext = {
        kind: walking ? "walk" : "still",
        T,
        steps,
        h: T / steps,
        legSpeed0: before.mode === "walk" ? before.v0 : 0,
        legCommand: walking ? cmd.walkSpeed! / 100 : 0,
        tau: P.walkSpeedTauS,
        turnCommand: walking ? cmd.yawRate! : 0,
        airSpeed: 0,
        heading: 0,
        learnable: true,
      };
      const y = predict(INNATE, ctx).y;
      for (let i = 0; i < 3; i++) expect(y[i]).toBeCloseTo(observed[i]!, 12);
      checked++;
    }
    expect(checked).toBe(50);
  });

  it("is linear in a gain: half the leg gain predicts half the step", () => {
    const ctx: PeriodContext = {
      kind: "walk",
      T: 0.05,
      steps: 10,
      h: 0.005,
      legSpeed0: 0.02,
      legCommand: 0.03,
      tau: 0.1,
      turnCommand: 0,
      airSpeed: 0,
      heading: 0,
      learnable: true,
    };
    const half = INNATE.slice();
    half[X.legGain] = 0.5;
    expect(predict(half, ctx).y[0]).toBeCloseTo(predict(INNATE, ctx).y[0] / 2, 14);
    // A drift is felt whatever the legs do; standing still, only it moves the fly.
    const drift = INNATE.slice();
    drift[X.driftX] = 0.01;
    const still = predict(drift, { ...ctx, kind: "still" }).y;
    expect(Math.hypot(still[0], still[1])).toBeCloseTo(0.01 * 0.05, 12);
  });
});

describe("perturbations: applied by the body, never shown to the fly", () => {
  it("are refused when malformed", () => {
    expect(
      perturbationErrors(episodes({ id: "x", cause: "self", from: 5, until: 4 })),
    ).toContain("episode 0: until must follow from, or be null");
    expect(
      perturbationErrors(
        episodes({ id: "x", cause: "external", from: 0, until: null, drift: [1, 0] }),
      )[0],
    ).toMatch(/drift/);
    expect(() =>
      walker(1, {
        perturbation: episodes({
          id: "x",
          cause: "self",
          from: 0,
          until: null,
          speedGain: Number.NaN,
        }),
      }),
    ).toThrow(/perturbation refused/);
  });

  it("combine: gains multiply, biases and drifts add, within their windows", () => {
    const p = episodes(
      { id: "a", cause: "self", from: 1, until: 3, speedGain: 0.5, turnBias: 0.2 },
      { id: "b", cause: "self", from: 2, until: null, speedGain: 0.5, turnBias: 0.3 },
      { id: "c", cause: "external", from: 0, until: 10, drift: [0.01, 0] },
    );
    expect(perturbationAt(p, 0.5)).toMatchObject({
      speedGain: 1,
      turnBias: 0,
      drift: [0.01, 0],
    });
    expect(perturbationAt(p, 2.5)).toMatchObject({ speedGain: 0.25, turnBias: 0.5 });
    expect(perturbationAt(p, 3)).toMatchObject({ speedGain: 0.5, turnBias: 0.3 });
  });

  it("reduce how far a step carries the walking body, turn it, and carry it, while the legs step as commanded", () => {
    const plan = (): MotorCommand => ({
      mode: "walk",
      walkSpeed: 2,
      yawRate: 1,
      reason: "test",
    });
    const make = (perturbation?: Perturbation) =>
      new DigitalFly({
        seed: 4,
        world: arenaWorld(ROOM),
        start: { p: [0, 0.5, 0], yaw: 0 },
        adapter: () => new Steady(plan),
        ...(perturbation ? { perturbation } : {}),
      });
    const plain = make(),
      weak = make(
        episodes({
          id: "w",
          cause: "self",
          from: 0,
          until: null,
          speedGain: 0.5,
          turnGain: 0.5,
        }),
      );
    plain.advance(2);
    weak.advance(2);
    // The legs step identically; the body goes half as far and turns half as much.
    expect(weak.state.walkSpeed).toBe(plain.state.walkSpeed);
    expect(weak.state.counts.walkedM).toBeCloseTo(plain.state.counts.walkedM / 2, 6);
    expect(weak.state.yaw).toBeCloseTo(plain.state.yaw / 2, 9);
    // A resting fly is carried by a drift and turned by a spin, and nothing else moves it.
    const rest = new DigitalFly({
      seed: 4,
      world: arenaWorld(ROOM),
      start: { p: [0, 0.5, 0], yaw: 0 },
      adapter: () => new Steady(() => ({ mode: "rest", reason: "test" })),
      perturbation: episodes({
        id: "push",
        cause: "external",
        from: 0,
        until: null,
        drift: [0.01, 0],
        spin: 0.5,
      }),
    });
    rest.advance(1);
    expect(rest.state.p[0]).toBeCloseTo(0.01, 6);
    expect(rest.state.yaw).toBeCloseTo(0.5, 6);
    // A turning bias is the body's: standing still, it does nothing.
    const biased = new DigitalFly({
      seed: 4,
      world: arenaWorld(ROOM),
      start: { p: [0, 0.5, 0], yaw: 0 },
      adapter: () => new Steady(() => ({ mode: "rest", reason: "test" })),
      perturbation: episodes({
        id: "b",
        cause: "self",
        from: 0,
        until: null,
        turnBias: 1,
      }),
    });
    biased.advance(1);
    expect(biased.state.yaw).toBe(0);
  });

  it("of the sense change what the fly feels, never where the body goes", () => {
    const make = (perturbation?: Perturbation) => {
      const { fly } = walker(9, perturbation ? { perturbation } : {});
      run(fly, 20);
      return fly;
    };
    const clean = make();
    const faulty = make(
      episodes({
        id: "s",
        cause: "sensor",
        from: 0,
        until: null,
        flowNoise: 5,
        flowGain: 0.5,
        flowBias: [0.01, 0],
      }),
    );
    // Same body for a while: the sense differs from the first sample on, the body not
    // until the fly acts on what it felt.
    expect(clean.lastSelfMotion).not.toEqual(faulty.lastSelfMotion);
    const sense = (fly: DigitalFly) => fly.lastSelfMotion!;
    expect(Math.abs(sense(faulty).forward - sense(clean).forward)).toBeGreaterThan(0);
  });
});

describe("isolation: the self-model knows only what the fly can sense", () => {
  const dir = fileURLToPath(new URL(".", import.meta.url));
  const modules = readdirSync(dir).filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
  );

  it("never imports the world, the perturbations or the body, and reads no position, velocity or heading", () => {
    for (const f of modules) {
      const text = readFileSync(join(dir, f), "utf8");
      // The adapter builds the reduced-order controller and names the fly version; nothing else may import the body.
      const allowed =
        f === "adapter.ts"
          ? /\.\.\/(controller|fly|neural)\.js/
          : /\.\.\/(neural|selfMotion|params|units)\.js/;
      for (const m of text.matchAll(/from\s+"(\.\.\/[^"]+)"/g))
        if (!m[1]!.startsWith("../../"))
          expect(m[1], `${f} imports ${m[1]}`).toMatch(allowed);
      expect(text, f).not.toMatch(/perturbation\.js|world\.js|bethesdaWorld|arena\.js/);
      expect(text, f).not.toMatch(/\bbody\.(p|v|yaw|home|target|altitude)\b/);
      expect(text, f).not.toMatch(/\binput\.(sites|frame\.(below|looming|landmarks))\b/);
    }
  });

  it("does exactly the same with every privileged field scrambled", () => {
    // Record what a walking fly's controller was handed, then hand the same to two
    // self-models: one as given, one with position, velocity, heading, extent,
    // landing sites and target replaced by nonsense.
    const inputs: { input: DecisionInput; intention: MotorCommand }[] = [];
    const fly = new DigitalFly({
      seed: 21,
      world: arenaWorld(ROOM),
      start: { p: [0.2, 0.5, -0.1], yaw: 2 },
      config: WALKING,
      adapter: (rng, streams) => {
        const echo = new EchoAdapter(rng, streams, { variant: "full" });
        const inner = echo.inner;
        const decide = inner.decide.bind(inner);
        inner.decide = (input) => {
          const intention = decide(input);
          inputs.push({
            input: structuredClone(input),
            intention: structuredClone(intention),
          });
          return intention;
        };
        return echo;
      },
      perturbation: episodes({
        id: "w",
        cause: "self",
        from: 10,
        until: null,
        speedGain: 0.5,
      }),
    });
    run(fly, 30);
    const scramble = (input: DecisionInput): DecisionInput => ({
      ...input,
      body: {
        ...input.body,
        p: [123, -45, 6.7],
        v: [9, 9, 9],
        yaw: -2.2,
        altitude: 77,
        target: { id: "nowhere", point: [1, 2, 3] },
        home: { center: [50, 0, 50], radius: 1, ceiling: 2 },
      },
      sites: [],
    });
    const a = new SelfModel(initialEchoState("full", 21, FLY_VERSION)),
      b = new SelfModel(initialEchoState("full", 21, FLY_VERSION));
    const commands: [MotorCommand, MotorCommand][] = [];
    for (const { input, intention } of inputs) {
      a.observe(selfModelView(input));
      b.observe(selfModelView(scramble(input)));
      commands.push([
        a.act(intention, selfModelView(input)).command,
        b.act(intention, selfModelView(scramble(input))).command,
      ]);
    }
    expect(inputs.length).toBeGreaterThan(500);
    expect(JSON.stringify(b.state)).toBe(JSON.stringify(a.state));
    for (const [x, y] of commands) expect(y).toEqual(x);
    // And it did learn something from what it legitimately sensed.
    expect(a.state.belief.x[X.legGain]).toBeLessThan(0.7);
  });
});

describe("prediction and learning", () => {
  it("notices a hidden impairment, blames its own legs, learns the gain and compensates", () => {
    const { fly, echo, events } = walker(5, {
      perturbation: episodes({
        id: "w",
        cause: "self",
        from: 15,
        until: null,
        speedGain: 0.5,
      }),
    });
    run(fly, 60);
    const concluded = events.filter((e) => e.kind === "concluded");
    expect(concluded.some((e) => e.explanation === "self" && e.t >= 15)).toBe(true);
    expect(echo.model!.state.belief.x[X.legGain]).toBeCloseTo(0.5, 1);
    // Commands are asked for at twice the intended speed (up to the body's limit).
    expect(echo.model!.state.counts.compensated).toBeGreaterThan(100);
    expect(fly.state.counts.rejected).toBe(0);
  });

  it("tells a push at rest from its own impairment, and a noisier sense from both", () => {
    const pushed = walker(6, {
      config: { ...WALKING, walkStartHz: 0 },
      perturbation: episodes({
        id: "p",
        cause: "external",
        from: 5,
        until: 20,
        drift: [0.008, 0.004],
      }),
    });
    run(pushed.fly, 25);
    const first = pushed.events.find((e) => e.kind === "concluded");
    expect(first?.explanation).toBe("external");
    const noisy = walker(7, {
      perturbation: episodes({
        id: "n",
        cause: "sensor",
        from: 10,
        until: null,
        flowNoise: 5,
      }),
    });
    run(noisy.fly, 30);
    expect(
      noisy.events.find((e) => e.kind === "concluded" && e.t >= 10)?.explanation,
    ).toBe("sensor");
    // It trusts its sense less, and acts cautiously while it does.
    expect(noisy.echo.model!.state.noiseScale).toBeGreaterThan(2);
    expect(noisy.echo.model!.state.counts.cautious).toBeGreaterThan(0);
  });

  it("predicts its own motion with calibrated spread when nothing is wrong", () => {
    const { fly, echo, events } = walker(8);
    run(fly, 120);
    const c = echo.model!.state.calibration;
    expect(c.n).toBeGreaterThan(1500);
    for (let i = 0; i < 3; i++) {
      expect(c.in90[i]! / c.n).toBeGreaterThan(0.85);
      expect(c.in90[i]! / c.n).toBeLessThan(0.97);
      expect(c.in50[i]! / c.n).toBeGreaterThan(0.4);
      expect(c.in50[i]! / c.n).toBeLessThan(0.7);
    }
    // No change is concluded where there was none.
    expect(
      events.filter((e) => e.kind === "concluded" && e.explanation !== "none"),
    ).toEqual([]);
  });

  it("without learning, predicts and errs but never revises a belief", () => {
    const { fly, echo, events } = walker(5, {
      variant: "no_learning",
      perturbation: episodes({
        id: "w",
        cause: "self",
        from: 15,
        until: null,
        speedGain: 0.5,
      }),
    });
    run(fly, 40);
    expect(echo.model!.state.belief.x).toEqual([...INNATE]);
    expect(events.some((e) => e.kind === "noticed")).toBe(true);
  });

  it("is deterministic: one seed, one fly, whatever the step size", () => {
    const make = () =>
      walker(11, {
        perturbation: episodes(
          { id: "w", cause: "self", from: 8, until: 20, speedGain: 0.6 },
          { id: "p", cause: "external", from: 25, until: 35, drift: [0, 0.01] },
        ),
      }).fly;
    const a = make(),
      b = make(),
      c = make();
    run(a, 40);
    run(b, 40);
    for (let k = 0; k < 8000; k++) c.advance(0.005);
    expect(b.stateHash()).toBe(a.stateHash());
    expect(c.stateHash()).toBe(a.stateHash());
  });
});

describe("the baseline is untouched", () => {
  it("the reactive variant walks exactly as the reduced-order controller does", () => {
    const make = (
      adapter?: (rng: () => number, s: { navigation: () => number }) => FlyNeuralAdapter,
    ) =>
      new DigitalFly({
        seed: 13,
        world: arenaWorld(ROOM),
        start: { p: [0, 0.5, 0], yaw: 0 },
        config: { takeoffHz: 0.2 },
        ...(adapter ? { adapter } : {}),
        perturbation: episodes({
          id: "w",
          cause: "self",
          from: 5,
          until: null,
          speedGain: 0.7,
        }),
      });
    const plain = make(),
      reactive = make(EchoAdapter.factory({ variant: "reactive" }));
    for (let k = 0; k < 600; k++) {
      plain.advance(0.1);
      reactive.advance(0.1);
      expect(reactive.state).toEqual(plain.state);
    }
    expect((reactive.adapter as EchoAdapter).inner.state).toEqual(
      (plain.adapter as ReducedOrderController).state,
    );
    expect(reactive.lastSelfMotion).toBeNull();
  });

  it("a fly with no schedule and a decision maker that does not ask for the sense draws nothing new", () => {
    const fly = new DigitalFly({
      seed: 2,
      world: arenaWorld(ROOM),
      start: { p: [0, 0.5, 0], yaw: 0 },
    });
    fly.advance(5);
    expect(fly.perturbation).toBeNull();
    expect(fly.lastSelfMotion).toBeNull();
    expect(fly.activePerturbation()).toBeNull();
  });
});

describe("metacognition acts", () => {
  it("probes when walking cannot tell its own turning bias from a turning surface", () => {
    // A spin of the surface that starts while the fly walks: only standing still tells it from a bias.
    const { fly, events } = walker(14, {
      config: { ...WALKING, walkStopHz: 0 },
      perturbation: episodes({
        id: "s",
        cause: "external",
        from: 12,
        until: null,
        spin: 0.7,
      }),
    });
    run(fly, 40);
    const after = events.filter((e) => e.t >= 12);
    expect(after.some((e) => e.kind === "probe")).toBe(true);
    expect(after.find((e) => e.kind === "concluded")?.explanation).toBe("external");
  });

  it("every command it gives, however extreme its beliefs, passes the fly's gate", () => {
    const { fly, echo } = walker(15);
    run(fly, 3);
    const m = echo.model!;
    // Beliefs pushed to absurd values: compensation must still stay inside the gate.
    for (const x of [
      [0.001, 0.001, 50, 0.001, 0.001, -50, 0.4, -0.4, 30],
      [3, 3, -9, 3, 3, 9, 0, 0, -30],
    ]) {
      m.state.belief.x = x.slice();
      m.state.belief.P = Array.from({ length: N * N }, (_, i) =>
        i % (N + 1) === 0 ? 1e-6 : 0,
      );
      run(fly, 5);
      expect(fly.state.counts.rejected).toBe(0);
    }
    expect(fly.state.counts.rejected).toBe(0);
  });
});

describe("memory: bounded, serialized, restored, and never silent", () => {
  const busy = () =>
    episodes(
      ...Array.from({ length: 30 }, (_, i): PerturbationEpisode => ({
        id: `e${i}`,
        cause: i % 2 ? "self" : "external",
        from: 5 + i * 9,
        until: 9 + i * 9,
        ...(i % 2
          ? { speedGain: 0.5 + (i % 5) * 0.08 }
          : { drift: [0.008, 0] as [number, number] }),
      })),
    );

  it("keeps its stores within their bounds however long the fly lives", () => {
    const { fly, echo } = walker(16, { perturbation: busy() });
    run(fly, 290);
    const s = echo.model!.state;
    expect(s.history.length).toBeLessThanOrEqual(EP.historyPeriods);
    expect(s.episodes.length).toBeLessThanOrEqual(EP.episodesKept);
    expect(s.beliefs.length).toBeLessThanOrEqual(EP.beliefLogSize);
    expect(s.events.length).toBeLessThanOrEqual(32);
    expect(s.counts.inquiries).toBeGreaterThan(EP.episodesKept);
    // A checkpoint of all of it stays small.
    expect(serializeEchoCheckpoint(echo.checkpoint()!).length).toBeLessThan(400_000);
    for (const e of s.episodes) {
      expect(e.simulation).toEqual({ fly: FLY_VERSION, echo: ECHO_VERSION, seed: 16 });
      expect(e.observed.periods).toBeGreaterThan(0);
      expect(e.before).toHaveLength(N);
    }
  });

  it("round-trips a checkpoint byte for byte, and a fly restored from its own continues exactly", () => {
    const schedule = busy();
    const a = walker(17, { perturbation: schedule }),
      b = walker(17, { perturbation: schedule });
    run(a.fly, 60);
    run(b.fly, 60);
    const text = serializeEchoCheckpoint(b.echo.checkpoint()!);
    const parsed = parseEchoCheckpoint(text, { fly: FLY_VERSION, variant: "full" });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(serializeEchoCheckpoint(parsed.checkpoint)).toBe(text);
    expect(b.echo.restore(text)).toEqual([]);
    run(a.fly, 60);
    run(b.fly, 60);
    expect(canonicalJson(b.echo.model!.state)).toBe(canonicalJson(a.echo.model!.state));
    expect(b.fly.state).toEqual(a.fly.state);
    // The replacement is on record.
    expect(b.echo.state.replaced).toEqual([
      { t: 59.95, how: "restored", digest: JSON.parse(text).digest },
    ]);
    expect(a.echo.state.replaced).toEqual([]);
  });

  it("refuses a checkpoint from another version, variant or a changed byte, saying why", () => {
    const { fly, echo } = walker(18);
    run(fly, 10);
    const cp = echo.checkpoint()!;
    const text = serializeEchoCheckpoint(cp);
    const refuse = (t: string, variant = "full", flyVersion = FLY_VERSION) => {
      const r = parseEchoCheckpoint(t, { fly: flyVersion, variant });
      return r.ok ? [] : r.errors;
    };
    expect(refuse(text, "no_memory").join(" ")).toMatch(/cannot restore into/);
    expect(refuse(text, "full", "digital-fly/0").join(" ")).toMatch(
      /never reinterpreted/,
    );
    expect(refuse(text.replace(ECHO_VERSION, "echo-self-model/v0")).join(" ")).toMatch(
      /never reinterpreted/,
    );
    const tampered = JSON.parse(text);
    tampered.state.belief.x[0] = 0.123;
    expect(refuse(JSON.stringify(tampered)).join(" ")).toMatch(/digest does not hold/);
    expect(refuse("not json")).toEqual(["not JSON"]);
    expect(cp.schema).toBe(ECHO_CHECKPOINT);
    expect(cp.note).toMatch(/does not bring this fly back/);
    // A reactive controller has nothing to restore.
    const reactive = walker(18, { variant: "reactive" });
    expect(reactive.echo.checkpoint()).toBeNull();
    expect(reactive.echo.restore(text)[0]).toMatch(/no self-model/);
  });

  it("a reset forgets, and says so", () => {
    const { fly, echo } = walker(19, {
      perturbation: episodes({
        id: "w",
        cause: "self",
        from: 5,
        until: null,
        speedGain: 0.5,
      }),
    });
    run(fly, 30);
    expect(echo.model!.state.episodes.length).toBeGreaterThan(0);
    echo.reset();
    expect(echo.model!.state.episodes).toEqual([]);
    expect(echo.model!.state.belief.x).toEqual([...INNATE]);
    expect(echo.state.replaced).toHaveLength(1);
    expect(echo.state.replaced[0]).toMatchObject({ how: "reset", digest: null });
    // When: the last decision before it.
    expect(echo.state.replaced[0]!.t).toBeCloseTo(29.95, 6);
  });

  it("met again, a remembered impairment is recalled", () => {
    const { fly, events } = walker(20, {
      perturbation: episodes(
        { id: "a", cause: "self", from: 10, until: 40, speedGain: 0.5 },
        { id: "a2", cause: "self", from: 70, until: null, speedGain: 0.5 },
      ),
    });
    run(fly, 100);
    expect(
      events.some(
        (e) => e.kind === "concluded" && e.t >= 70 && e.candidate?.startsWith("recall:"),
      ),
    ).toBe(true);
  });
});

describe("performance", () => {
  it("a decision costs well under a millisecond, and the state stays small", () => {
    const { fly, echo } = walker(22, {
      perturbation: episodes({
        id: "w",
        cause: "self",
        from: 5,
        until: null,
        speedGain: 0.5,
      }),
    });
    const t0 = performance.now();
    run(fly, 120);
    const perDecision = (performance.now() - t0) / 2400;
    // The whole fly, body and senses included, at 20 decisions a second.
    expect(perDecision).toBeLessThan(2);
    expect(JSON.stringify(echo.state).length).toBeLessThan(400_000);
    expect(PARAMS.decisionPeriodMs.value).toBe(50);
  });
});
