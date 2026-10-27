/** Prespecified engineering assay; not a registered or independent biological validation. */
import { DigitalFly } from "../../fly/fly.js";
import { PrimitiveWorld, type Mover } from "../../fly/world.js";
import { wrapAngle, type V3 } from "../../fly/units.js";
import { yardSpec } from "../individuality.js";
import { ForagingAdapter } from "./adapter.js";
import { OlfactoryNavigation } from "./olfaction.js";

export const FORAGING_STUDY = {
  version: "echo-olfactory-study/v1",
  developmentSeeds: [1201, 1202, 1203],
  evaluationSeeds: [9301, 9302, 9303, 9304, 9305, 9306, 9307, 9308],
  seconds: 60,
  pulse: { from: 5, until: 20, strength: 0.5 },
  windMS: 0.1,
  source: [0.6, 0] as readonly [number, number],
  criteria: {
    orientation:
      "mean ON-window upwind alignment gain >= 0.2 and positive gain in >= 6/8 paired seeds",
    sourceApproach:
      ">= 20% reduction in mean closest source distance and improvement in >= 6/8 paired seeds",
    temporal:
      "ON peak exceeds sustained response; OFF rises after loss; max error against 1 ms independent RK4 < 0.002",
  },
  limitations: [
    "seeded engineering assays, not registered R.A.I.N. experiments",
    "walking constrained by model config; no spontaneous flight or walking stops",
    "single scalar odor; synthetic stationary Gaussian footprint, no fluid or turbulent plume solver",
    "source distance is an experimenter metric; no food reward in these assays",
    "no learned parameters in the new filters; sensory adaptation is not associative learning",
    "published time constants but model odor units, motor gains, geometry and protocol",
    "body is the existing reduced-order model; MuJoCo locomotion remains unvalidated",
  ],
} as const;

/** Stimulus rig only. The controller receives the normal delayed/noisy antenna samples. */
export class OdorTunnel extends PrimitiveWorld {
  time = 0;
  readonly stimulus: "pulse" | "spatial";
  constructor(stimulus: "pulse" | "spatial") {
    const spec = yardSpec(null);
    spec.cylinders = [];
    spec.sun = undefined;
    super(spec);
    this.stimulus = stimulus;
  }
  override movers(near: V3, radius: number, out: Mover[], t: number): void {
    this.time = t;
    super.movers(near, radius, out, t);
  }
  override odour(p: V3): number {
    const plan = FORAGING_STUDY;
    if (this.stimulus === "pulse")
      return this.time >= plan.pulse.from && this.time < plan.pulse.until
        ? plan.pulse.strength
        : 0;
    const downwind = plan.source[0] - p[0];
    if (downwind < 0) return 0;
    const width = 0.08 + 0.15 * downwind;
    return 0.5 * Math.exp(-downwind / 1.2 - (p[2] / width) ** 2 / 2);
  }
  wind(): V3 {
    return [-FORAGING_STUDY.windMS, 0, 0];
  }
}

export function assay(seed: number, enabled: boolean, stimulus: "pulse" | "spatial") {
  const world = new OdorTunnel(stimulus);
  const fly = new DigitalFly({
    seed,
    world,
    start: { p: [0, 0.002, 0], yaw: seed % 2 ? Math.PI / 2 : -Math.PI / 2 },
    config: {
      takeoffHz: 0,
      groomHz: 0,
      walkStartHz: 10,
      walkStopHz: 0,
      startReserve: 0.3,
      phototaxisGain: 0,
    },
    adapter: (rng, streams) =>
      new ForagingAdapter(
        rng,
        streams,
        seed,
        { immortality: true, associativeLearning: true, predictiveSelfModel: true },
        enabled,
      ),
  });
  const adapter = fly.adapter as ForagingAdapter;
  let closest = Infinity,
    alignment = 0,
    onSamples = 0,
    offsetTurn = 0,
    offsetSamples = 0;
  let lastYaw = fly.state.yaw;
  let predictionChecks = 0,
    predictionMismatches = 0;
  const trace: {
    seconds: number;
    position: V3;
    odour: number;
    on: number;
    off: number;
  }[] = [];
  for (let k = 0; k < FORAGING_STUDY.seconds * 20; k++) {
    const p = adapter.physiology;
    fly.state.reserve += p.advance(0.05, {
      mode: fly.state.mode,
      reserve: fly.state.reserve,
      capacity: fly.params.reserveJ,
    });
    fly.advance(0.05);
    const pending = adapter.model?.state.pending?.context,
      cmd = fly.lastCommand;
    if (
      pending?.kind === "walk" &&
      pending.learnable &&
      cmd?.mode === "walk" &&
      cmd.walkSpeed !== undefined
    ) {
      predictionChecks++;
      if (
        pending.legCommand !== cmd.walkSpeed / 100 ||
        pending.turnCommand !== (cmd.yawRate ?? 0)
      )
        predictionMismatches++;
    }
    // Short assay diagnostics, not an individual-life archive; count events instead of retaining episodes here.
    adapter.modelEvents.length = 0;
    const t = (k + 1) / 20;
    closest = Math.min(
      closest,
      Math.hypot(fly.state.p[0] - FORAGING_STUDY.source[0], fly.state.p[2]),
    );
    if (t >= 10 && t < 20 && fly.state.mode === "walk") {
      alignment += Math.cos(fly.state.yaw);
      onSamples++;
    }
    if (t >= 20 && t < 30 && fly.state.mode === "walk") {
      offsetTurn += Math.abs(wrapAngle(fly.state.yaw - lastYaw)) / 0.05;
      offsetSamples++;
    }
    lastYaw = fly.state.yaw;
    if (k % 20 === 19)
      trace.push({
        seconds: t,
        position: [...fly.state.p],
        odour: fly.lastFrame?.odour ?? 0,
        on: adapter.olfaction.state.on,
        off: adapter.olfaction.state.off,
      });
  }
  return {
    seed,
    enabled,
    stimulus,
    closestSourceM: closest,
    onAlignment: onSamples ? alignment / onSamples : null,
    offsetTurnRadS: offsetSamples ? offsetTurn / offsetSamples : null,
    searchTurns: adapter.olfaction.state.searchTurns,
    modulatedDecisions: adapter.olfaction.state.modulatedDecisions,
    rejected: fly.state.counts.rejected,
    predictionChecks,
    predictionMismatches,
    finite: [
      ...fly.state.p,
      fly.state.yaw,
      ...Object.values(adapter.olfaction.state).filter((v) => typeof v === "number"),
    ].every(Number.isFinite),
    trace,
  };
}

/** Independent 1 ms RK4 transcription of the continuous equations, not the production integrator. */
export function temporalAssay() {
  const model = new OlfactoryNavigation(1);
  let reference = [0, 0, 0, 0, 0]; // A_ON, A_OFF, ON, fast, slow
  const derivative = (s: number[], odor: number) => {
    const cOn = odor / (odor + 0.05 + s[0]!);
    const cOff = odor / (odor + 0.05 + s[1]!);
    return [
      (odor - s[0]!) / 9.8,
      (odor - s[1]!) / 10.08,
      (cOn - s[2]!) / 0.72,
      (cOff - s[3]!) / 0.62,
      (cOff - s[4]!) / 4.84,
    ];
  };
  const plus = (a: number[], b: number[], gain: number) =>
    a.map((x, i) => x + b[i]! * gain);
  let error = 0,
    peakOn = 0,
    lateOn = 0,
    peakOff = 0;
  for (let i = 0; i < 1200; i++) {
    const odour = i < 600 ? 0.5 : 0;
    model.sample(odour, 0.05);
    for (let j = 0; j < 50; j++) {
      const a = derivative(reference, odour);
      const b = derivative(plus(reference, a, 0.0005), odour);
      const c = derivative(plus(reference, b, 0.0005), odour);
      const d = derivative(plus(reference, c, 0.001), odour);
      reference = reference.map(
        (x, n) => x + (0.001 * (a[n]! + 2 * b[n]! + 2 * c[n]! + d[n]!)) / 6,
      );
    }
    const s = model.state;
    error = Math.max(
      error,
      Math.abs(s.on - reference[2]!),
      Math.abs(s.off - Math.max(0, reference[4]! - reference[3]!)),
    );
    if (i < 600) peakOn = Math.max(peakOn, s.on);
    if (i === 599) lateOn = s.on;
    if (i >= 600) peakOff = Math.max(peakOff, s.off);
  }
  return {
    maxError: error,
    peakOn,
    sustainedOn: lateOn,
    peakOffAfterLoss: peakOff,
    passed: error < 0.002 && peakOn > lateOn && peakOff > 0.1,
  };
}
