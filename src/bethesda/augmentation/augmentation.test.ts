import { describe, expect, it } from "vitest";
import { arenaWorld, type ArenaSpec } from "../fly/arena";
import { ReducedOrderController } from "../fly/controller";
import { DigitalFly } from "../fly/fly";
import type { AdapterStreams, FlyNeuralAdapter } from "../fly/neural";
import { ECHO, EVA } from "../firstContact/originals";
import {
  adapterFor,
  CONTROLLERS,
  type SubjectController,
} from "../firstContact/subjects";
import { FailingAdvisor, GiantFiberAdvisor } from "./advisors";
import {
  AugmentedAdapter,
  canAdvise,
  onsetAgreement,
  type Advisor,
  type AdvisorValidation,
  type AdvisorView,
  type AugmentationOptions,
  type HybridAuthorization,
} from "./layer";

/** Looms every 4 s at a perched fly: the shadow scenario's kind of stimulus. */
const LOOMS: ArenaSpec = {
  size: [1, 0.6, 1],
  ambient: 1,
  lights: [{ at: [0, 0.6, 0], intensity: 1 }],
  looms: [
    {
      start: 3,
      period: 4,
      count: 12,
      from: [0.45, 0.05, 0],
      to: [0, 0.01, 0],
      speedMS: 0.9,
      radiusM: 0.02,
    },
  ],
};

const VALID: AdvisorValidation = {
  source: "augmentation.test.ts (a stand-in validation: never used outside the tests)",
  heldOut: true,
  hits: 40,
  misses: 2,
  falseAlarms: 1,
  correctRejections: 1000,
};

const AUTH: HybridAuthorization = {
  subject: "research-augmentation-test",
  by: "augmentation.test.ts",
  purpose: "test the hybrid path on a disposable subject",
  initiate: ["escape"],
  scope: "disposable-research-subject",
};

const inner = (c: SubjectController, seed: number) =>
  adapterFor(c, seed) ??
  ((rng: () => number, st: AdapterStreams) =>
    new ReducedOrderController(rng, st.navigation));

function fly(
  c: SubjectController,
  seed: number,
  wrap?: (inner: FlyNeuralAdapter) => FlyNeuralAdapter,
) {
  const make = inner(c, seed);
  return new DigitalFly({
    seed,
    world: arenaWorld(LOOMS),
    start: { p: [0, 0.1, 0], yaw: 0 },
    adapter: (rng, st) => (wrap ? wrap(make(rng, st)) : make(rng, st)),
  });
}

const opts = (o: Partial<AugmentationOptions> = {}): AugmentationOptions => ({
  subject: "research-augmentation-test",
  ...o,
});

describe("observe and advise leave the fly exactly as it was", () => {
  for (const c of CONTROLLERS)
    it(`${c}: the state hash steps identically with the layer in observe and in advise`, () => {
      const held: { observed?: AugmentedAdapter; advised?: AugmentedAdapter } = {};
      const bare = fly(c, 21);
      const obs = fly(
        c,
        21,
        (a) =>
          (held.observed = new AugmentedAdapter(a, new GiantFiberAdvisor(5), opts())),
      );
      const adv = fly(
        c,
        21,
        (a) =>
          (held.advised = new AugmentedAdapter(
            a,
            new GiantFiberAdvisor(5, VALID),
            opts({ mode: "advise" }),
          )),
      );
      for (let i = 0; i < 300; i++) {
        bare.advance(0.1);
        obs.advance(0.1);
        adv.advance(0.1);
        expect(obs.stateHash()).toBe(bare.stateHash());
        expect(adv.stateHash()).toBe(bare.stateHash());
      }
      expect(bare.state.counts.escapes).toBeGreaterThan(0);
      const observed = held.observed!,
        advised = held.advised!;
      const r = observed.record;
      expect(r.decisions).toBeGreaterThan(0);
      expect(r.predictions).toBeGreaterThan(0);
      expect(r.onsets.controller.length).toBe(bare.state.counts.escapes);
      // Observe and advise wear the controller's own descriptor.
      expect(obs.adapter).toBe(observed);
      expect(observed.descriptor).toBe(observed.inner.descriptor);
      for (const rec of advised.record.recommendations)
        expect(rec.expires).toBeGreaterThan(rec.t);
    }, 60_000);
});

describe("the advisor sees only what the fly senses", () => {
  it("has no position, velocity, heading, world, sites or looming identity", () => {
    const views: AdvisorView[] = [];
    const spy: Advisor = {
      id: "spy (test)",
      validation: null,
      predict: (v) => {
        views.push(v);
        return null;
      },
    };
    const f = fly("reduced-order", 3, (a) => new AugmentedAdapter(a, spy, opts()));
    f.advance(8);
    expect(views.length).toBeGreaterThan(100);
    const allowed = [
      "airflow",
      "airflowFrom",
      "light",
      "looming",
      "mode",
      "odour",
      "onFood",
      "pathway",
      "reserve",
      "t",
      "ttcFront",
      "ttcLeft",
      "ttcRight",
    ];
    for (const v of views) expect(Object.keys(v).sort()).toEqual(allowed);
    const seen = views.filter((v) => v.looming);
    expect(seen.length).toBeGreaterThan(0);
    for (const v of seen)
      expect(Object.keys(v.looming!).sort()).toEqual([
        "bearing",
        "elevation",
        "expansionDegS",
        "sizeDeg",
      ]);
  });
});

describe("the gates", () => {
  it("an unvalidated advisor may only observe", () => {
    const a = new ReducedOrderController(() => 0.5);
    expect(
      () => new AugmentedAdapter(a, new GiantFiberAdvisor(1), opts({ mode: "advise" })),
    ).toThrow(/not validated/);
    expect(canAdvise({ ...VALID, heldOut: false }).ok).toBe(false);
    expect(canAdvise({ ...VALID, hits: 10, misses: 10 }).ok).toBe(false);
    expect(canAdvise({ ...VALID, falseAlarms: 500 }).ok).toBe(false);
    expect(canAdvise(VALID).ok).toBe(true);
  });

  it("experimental hybrid needs an authorization naming a disposable research subject", () => {
    const a = new ReducedOrderController(() => 0.5);
    const adv: Advisor = new GiantFiberAdvisor(1, VALID);
    expect(
      () => new AugmentedAdapter(a, adv, opts({ mode: "experimental-hybrid" })),
    ).toThrow(/authorization/);
    expect(
      () =>
        new AugmentedAdapter(
          a,
          adv,
          opts({
            mode: "experimental-hybrid",
            authorization: { ...AUTH, subject: "research-other" },
          }),
        ),
    ).toThrow(/another subject/);
    for (const o of [EVA, ECHO])
      expect(
        () =>
          new AugmentedAdapter(a, adv, {
            subject: o.id,
            mode: "experimental-hybrid",
            authorization: { ...AUTH, subject: o.id },
          }),
      ).toThrow(/original individual/);
    // Even observing refuses an original's id.
    expect(() => new AugmentedAdapter(a, adv, { subject: ECHO.id })).toThrow(
      /original individual/,
    );
    const h = new AugmentedAdapter(
      a,
      adv,
      opts({ mode: "experimental-hybrid", authorization: AUTH }),
    );
    expect(h.descriptor.id).toMatch(/hybrid/);
  });
});

describe("failure falls back to the controller", () => {
  for (const how of ["throw", "malformed"] as const)
    it(`an advisor that fails (${how}) is switched off and the fly runs on as without it`, () => {
      const held: { layer?: AugmentedAdapter } = {};
      const bare = fly("echo", 9);
      const f = fly(
        "echo",
        9,
        (a) => (held.layer = new AugmentedAdapter(a, new FailingAdvisor(how), opts())),
      );
      for (let i = 0; i < 100; i++) {
        bare.advance(0.1);
        f.advance(0.1);
        expect(f.stateHash()).toBe(bare.stateHash());
      }
      const r = held.layer!.record;
      expect(r.disabled).not.toBeNull();
      expect(how === "throw" ? r.failures.thrown : r.failures.malformed).toBe(5);
    });

  it("over budget switches the advisor off; in observe the run stays reproducible", () => {
    let now = 0;
    const held: { layer?: AugmentedAdapter } = {};
    fly(
      "reduced-order",
      4,
      (a) =>
        (held.layer = new AugmentedAdapter(
          a,
          new GiantFiberAdvisor(2),
          opts({ budgetMs: 1, clock: () => (now += 2) }),
        )),
    ).advance(1);
    expect(held.layer!.record.disabled?.why).toMatch(/budget/);
    expect(held.layer!.record.reproducible).toBe(true);
  });
});

describe("experimental hybrid", () => {
  it("lets a validated advisor initiate only the authorized modes, through the body's gate", () => {
    const held: { layer?: AugmentedAdapter } = {};
    const f = fly(
      "reduced-order",
      21,
      (a) =>
        (held.layer = new AugmentedAdapter(
          a,
          new GiantFiberAdvisor(5, VALID),
          opts({ mode: "experimental-hybrid", authorization: AUTH }),
        )),
    );
    f.advance(30);
    const r = held.layer!.record;
    expect(r.mode).toBe("experimental-hybrid");
    expect(f.adapter.descriptor.id).toMatch(/hybrid/);
    // Whatever it initiated passed the body's own gate: the body refused none of its commands.
    expect(f.state.counts.rejected).toBe(0);
    for (const rec of r.recommendations) expect(rec.command.mode).toBe("escape");
  });
});

describe("event-level agreement", () => {
  it("matches onsets within the window, each prediction once", () => {
    expect(
      onsetAgreement({ controller: [1, 2, 3], advisor: [1.05, 2.5, 3.02, 3.04] }, 0.1),
    ).toEqual({ hits: 2, misses: 1, falseAlarms: 2 });
  });
});
