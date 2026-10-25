import type { FlyWorld } from "../../bethesda/fly/world.js";
/** Host-only ECHO apparatus. Labels and interventions never cross the motion port.
 * Uses the actual DigitalFly body, gate, fixed clock and world collision checks.
 */
import { DigitalFly, FLY_VERSION } from "../../bethesda/fly/fly.js";
import { arenaWorld } from "../../bethesda/fly/arena.js";
import { EchoController } from "../../bethesda/fly/echo/controller.js";
import { EchoModel, type EchoVariant } from "../../bethesda/fly/echo/model.js";
import { NO_PERTURBATION } from "../../bethesda/fly/echo/apparatus.js";
import type {
  FlyNeuralAdapter,
  DecisionInput,
  MotorCommand,
} from "../../bethesda/fly/neural.js";
import { mulberry32 } from "../../lib/noise.js";
import type { FlyArm, FlyBlockSpec, FlyRun } from "./contracts.js";

export const ECHO_PROTOCOL_VERSION = "echo-apparatus/v2";
export const ECHO_TIMING = { onset: 2, recovery: 8, repeat: 14, end: 24 } as const;
const SPEEDS = [0.6, 1.8, 1, 1.4];
/** Engineering probe: same sensory/action seam as the native city controller,
 * with planned excitation instead of spontaneous behavioral arbitration.
 */
class Probe implements FlyNeuralAdapter {
  readonly descriptor = {
    id: "echo-motor-probe/v1",
    label: "Scripted motor probe",
    fidelity: "Host-scripted bounded walking excitation",
    simulatesNeurons: false,
    regions: [],
  };
  decide({ body }: DecisionInput): MotorCommand {
    return {
      mode: "walk",
      walkSpeed: desired(body.t),
      yawRate: Math.floor(body.t / 0.8) % 2 ? 0.4 : -0.4,
      reason: "scripted ECHO motor excitation",
    };
  }
}
const desired = (t: number) => SPEEDS[Math.floor((t + 1e-7) / 0.4) % SPEEDS.length]!;

/** A timed obstacle is real arena geometry: sensing, contacts and landing see the same world. */
export function temporaryObstacleWorld(
  open: FlyWorld,
  blocked: FlyWorld,
  present: () => boolean,
): FlyWorld {
  const current = () => (present() ? blocked : open);
  return {
    id: "echo-timed-obstacle",
    home: open.home,
    inputs: open.inputs,
    perchAt: (...args) => current().perchAt(...args),
    raycast: (...args) => current().raycast(...args),
    solid: (...args) => current().solid(...args),
    movers: (...args) => current().movers(...args),
    light: (...args) => current().light(...args),
    landingSites: (...args) => current().landingSites(...args),
    foodAt: (...args) => current().foodAt(...args),
    odour: (...args) => current().odour(...args),
    landmarks: (...args) => current().landmarks(...args),
  };
}

export interface EchoTrial {
  hashes: string[];
  gateRefusals: number;
  simulatedS: number;
  trackingErrorCmS: number;
  predictionErrorCmS: number | null;
  attributionAccuracy: number;
  /** Null when no observations have an unimpaired action response. */
  falseSelfAttribution: number | null;
  intervalCoverage: number | null;
  detectionLatencyS: number | null;
  recoveryLatencyS: number | null;
  earlyRecallErrorCmS: number;
  recalled: number;
  adaptedActions: number;
  checkpointVerified: boolean;
  /** Research-only labels, kept outside the controller. */
  condition: {
    gain: number;
    turnGain: number;
    driftMPerS: [number, number, number];
    noiseCmS: number;
    truth: string;
    sensorBiasCmS: number;
    temporaryObstacle: boolean;
    arenaM: [number, number, number];
  };
}

/** Development uses a separate seed domain/strength; evaluation parameters are
 * fixed in source before any held-out run. No API lets a design select doses.
 */
export function runEchoTrial(
  protocol: "echo_impairment" | "echo_causation" | "echo_memory",
  seed: number,
  trial: number,
  variant: EchoVariant,
  split: "development" | "evaluation" = "evaluation",
): EchoTrial {
  const rng = mulberry32(seed ^ Math.imul(trial + 1, 0x9e3779b1));
  const gain =
    split === "development"
      ? 0.65
      : [0.48, 0.57, 0.74, 0.81][trial % 4]! + (rng() - 0.5) * 0.02;
  const type = protocol === "echo_causation" ? trial % 6 : 0;
  const impaired = type === 0 || type === 2;
  const external = type === 1 || type === 2;
  const truth =
    type === 3
      ? "unreliable observations"
      : impaired && external
        ? "mixed"
        : impaired
          ? "action response changed"
          : "external disturbance";
  const noise = type === 3 ? 1.8 : split === "development" ? 0.03 : 0.04 + rng() * 0.04;
  const drift: [number, number, number] = external
    ? [0.005 + rng() * 0.002, 0, 0]
    : [0, 0, 0];
  const bias = type === 5 ? 0.6 : 0;
  const obstacle = type === 4;
  const turnGain = impaired && trial % 2 === 0 ? 0.65 : 1;
  const size: [number, number, number] =
    split === "development" ? [4, 2.5, 4] : [6 + rng(), 2.5, 5 + rng()];
  const memory = protocol === "echo_memory";
  const end = memory ? ECHO_TIMING.end : 12;
  const active = (t: number) =>
    (t >= ECHO_TIMING.onset && t < ECHO_TIMING.recovery) ||
    (memory && t >= ECHO_TIMING.repeat && t < 20);
  const controller = new EchoController(
    new Probe(),
    variant,
    new EchoModel(variant, { seed, simulator: FLY_VERSION }),
  );
  let worldTime = 0;
  const open = arenaWorld({ size, ambient: 0.6, pillars: [] });
  const blocked = arenaWorld({
    size,
    ambient: 0.6,
    platforms: [{ center: [0.055, 0.05, 0], half: [0.01, 0.05, 0.3] }],
  });
  const world = temporaryObstacleWorld(
    open,
    blocked,
    () => obstacle && active(worldTime),
  );
  const fly = new DigitalFly({
    seed,
    world,
    start: { p: [0, 0.1, 0], yaw: 0 },
    adapter: () => controller,
    perturbation: (t) => {
      worldTime = t;
      return {
        ...NO_PERTURBATION,
        movementGain: active(t) && impaired ? gain : 1,
        turningGain: active(t) ? turnGain : 1,
        driftMPerS: active(t) ? drift : [0, 0, 0],
        sensorNoiseCmS: active(t) ? noise : 0.04,
        sensorBiasCmS: active(t) ? bias : 0,
      };
    },
    logSize: 16,
  });
  const tracking: number[] = [],
    errors: number[] = [],
    recall: number[] = [],
    attribution: number[] = [],
    falseSelf: number[] = [];
  let detected: number | null = null,
    recovered: number | null = null;
  let checkpointVerified = false;
  for (let k = 0; k < end * 20; k++) {
    const t = k / 20;
    // Explicit amnesia ablation: reset the self-model at re-exposure only.
    if (variant === "reset_memory" && k === ECHO_TIMING.repeat * 20) {
      const fresh = new EchoModel(variant, { seed, simulator: FLY_VERSION });
      controller.resetExperimentalModel(fresh);
    }
    const before = [...fly.state.p];
    fly.advance(0.05);
    const s = controller.model.inspect();
    const achieved =
      (Math.hypot(fly.state.p[0] - before[0]!, fly.state.p[2] - before[2]!) * 100) / 0.05;
    if (t >= 4 && t < 7.5) {
      tracking.push(Math.abs(achieved - desired(t)));
      if (s.errorCmS !== null) errors.push(Math.abs(s.errorCmS));
      const attributionHypothesis =
        variant === "disabled"
          ? Math.abs(achieved - desired(t)) > 0.25
            ? "action response changed"
            : "unchanged"
          : s.attribution;
      attribution.push(Number(attributionHypothesis === truth));
      if (!impaired)
        falseSelf.push(
          Number(
            attributionHypothesis === "action response changed" ||
              attributionHypothesis === "mixed",
          ),
        );
    }
    if (
      t >= 2 &&
      t < 8 &&
      detected === null &&
      s.attribution === "action response changed"
    )
      detected = t - 2;
    if (t >= 8 && recovered === null && s.gain > 0.9 && s.attribution === "unchanged")
      recovered = t - 8;
    if (memory && t >= 14 && t < 15.5) recall.push(Math.abs(achieved - desired(t)));
    if (k === 100) {
      const restored = EchoModel.restore(controller.model.checkpoint());
      checkpointVerified = restored.checkpoint() === controller.model.checkpoint();
    }
  }
  const mean = (xs: number[]) =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
  const s = controller.model.inspect();
  return {
    hashes: [fly.stateHash()],
    gateRefusals: fly.state.counts.rejected,
    simulatedS: fly.state.t,
    trackingErrorCmS: mean(tracking),
    predictionErrorCmS: errors.length ? mean(errors) : null,
    attributionAccuracy: mean(attribution),
    falseSelfAttribution: falseSelf.length ? mean(falseSelf) : null,
    intervalCoverage: s.predictions ? s.covered / s.predictions : null,
    detectionLatencyS: detected,
    recoveryLatencyS: recovered,
    earlyRecallErrorCmS: mean(recall),
    recalled: s.recalled,
    adaptedActions: s.adaptedActions,
    checkpointVerified,
    condition: {
      gain: impaired ? gain : 1,
      turnGain,
      driftMPerS: drift,
      noiseCmS: noise,
      truth,
      sensorBiasCmS: bias,
      temporaryObstacle: obstacle,
      arenaM: size,
    },
  };
}

export function runEchoBlock(block: FlyBlockSpec, arm: FlyArm, seed: number): FlyRun {
  if (
    block.id !== "echo_impairment" &&
    block.id !== "echo_causation" &&
    block.id !== "echo_memory"
  )
    throw new Error("Not an ECHO block");
  const trials = Array.from({ length: block.trials }, (_, k) =>
    runEchoTrial(
      block.id as "echo_impairment" | "echo_causation" | "echo_memory",
      seed,
      k,
      arm.echo_variant ?? "disabled",
    ),
  );
  const mean = (f: (t: EchoTrial) => number | null) => {
    const values = trials.map(f).filter((v): v is number => v !== null);
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  };
  const prefix = block.id;
  return {
    echo_trials: trials,
    arm: arm.id,
    seed,
    block: block.id,
    final_hashes: trials.flatMap((t) => t.hashes),
    simulated_s: trials.reduce((a, t) => a + t.simulatedS, 0),
    gate_refusals: trials.reduce((a, t) => a + t.gateRefusals, 0),
    metrics: {
      [`${prefix}_tracking_error_cms`]: mean((t) => t.trackingErrorCmS),
      [`${prefix}_prediction_error_cms`]: mean((t) => t.predictionErrorCmS),
      [`${prefix}_attribution_accuracy`]: mean((t) => t.attributionAccuracy),
      [`${prefix}_false_self_attribution`]: mean((t) => t.falseSelfAttribution),
      [`${prefix}_interval_coverage`]: mean((t) => t.intervalCoverage),
      [`${prefix}_detection_latency_s`]: mean((t) => t.detectionLatencyS),
      [`${prefix}_recovery_latency_s`]: mean((t) => t.recoveryLatencyS),
      [`${prefix}_recall_error_cms`]: mean((t) => t.earlyRecallErrorCmS),
      [`${prefix}_recalls`]: mean((t) => t.recalled),
      [`${prefix}_adapted_actions`]: mean((t) => t.adaptedActions),
      [`${prefix}_checkpoint_verified`]: mean((t) => Number(t.checkpointVerified)),
    },
  };
}
