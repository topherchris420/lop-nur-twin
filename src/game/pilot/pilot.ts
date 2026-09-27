import * as THREE from "three";
import {
  game,
  createInputState,
  clearInputEdges,
  eyePosition,
  type InputState,
} from "../core/gameState";
import { useGameStore, type BrainKind } from "../core/gameStore";
import {
  HUMAN_METRICS,
  MASK_MOVEMENT,
  MASK_SIGHT,
  OPPOSING_TEAM,
  forwardToYaw,
  yawToForward,
  type EntityId,
  type HitRegion,
} from "../core/types";
import { GROUND_ZONES } from "@/lib/layout";
import { mirageOffset } from "../world/mirage";
import {
  MOVE_INPUT,
  WEAPON_INPUT,
  frameLabel,
  placeSlot,
  targetSlot,
  type Axis,
  type ControlFrame,
  type ControlMode,
  type NavigationMode,
} from "./contract";
import { aimRegionGeometry } from "./hitGeometry";
import {
  PrecisionMotorController,
  type MotorBody,
  type MotorSense,
  type MotorTelemetry,
  type MotorWeapon,
} from "./motor";
import type { DecisionAxes } from "./decision";
import { ActionExecutor, type FrameEndReason } from "./executor";
import {
  DecisionLoop,
  type AcceptedDecision,
  type FailureKind,
  type LoopClock,
  type LoopEvent,
} from "./loop";
import { PilotMetrics, type EpisodeMetrics } from "./metrics";
import type { PreviousOutcome } from "./observation";
import { Perception, sightOf } from "./perception";
import { Debrief, type EnemySample } from "./debrief";
import { PlaceNavigator, type NavSense, type NavTelemetry } from "./navigator";
import type { FoundPlace } from "./places";
import {
  DelayedProvider,
  JevHttpProvider,
  RandomProvider,
  newSessionId,
  probeJevService,
  type JevServiceStatus,
} from "./providers";
import {
  TraceRecorder,
  hashObservation,
  type DecisionSource,
  type ParsedTrace,
  type TraceRecord,
} from "./recorder";
import { ScriptedProvider, type ScriptPolicy } from "./policies";
import {
  JEV_CAPABILITIES,
  LOCAL_POLICY_CAPABILITIES,
  negotiate,
  type Capabilities,
  type Negotiated,
} from "./capabilities";
import { rigState } from "./rigState";

/**
 * The player's pilot seat: who is flying, and the machinery between a brain's
 * decision and the rig's input.
 *
 * `PlayerRig` asks it for input once per step. With a human in the seat it
 * returns null and the rig reads the keyboard and mouse as it always has. With
 * a brain in the seat it returns an `InputState` the executor has written —
 * the same struct, the same fields — and the rig, the controller, the weapon
 * runtime and the damage resolver cannot tell the difference. That is the whole
 * integration: nothing downstream of the input knows a model is playing.
 *
 * Decisions are requested on a timer, never from the frame loop; the network
 * call is fire-and-forget, and an answer becomes input only on the next frame,
 * after validation, staleness checks and the executor's own bounds.
 */

export type PilotStatus =
  | "OFF"
  | "CONNECTING"
  | "OBSERVING"
  | "DECIDING"
  | "EXECUTING"
  | "TIMEOUT"
  | "UNAVAILABLE"
  | "ERROR"
  | "DEAD"
  | "RESPAWNING"
  | "PAUSED"
  | "MATCH_COMPLETE";

/** Who the HUD says is in control. LIVE JEV is only ever a TypeSafe answer. */
export type ControlLabel =
  "HUMAN" | "LIVE JEV" | "RANDOM" | "SCRIPTED" | "REPLAY" | "FALLBACK";

export interface PilotTelemetry {
  brain: BrainKind;
  /** How the brain's aim reaches the view. Meaningless for the human. */
  control: ControlMode;
  label: ControlLabel;
  status: PilotStatus;
  /** Latest observation sequence issued. */
  sequence: number;
  /** Sequence of the frame executing now. */
  executingSequence: number | null;
  frame: ControlFrame | null;
  frameSource: DecisionSource | null;
  axes: DecisionAxes | null;
  model: string | null;
  latencyMs: number | null;
  serverLatencyMs: number | null;
  inFlight: boolean;
  lastError: string | null;
  service: JevServiceStatus | null;
  target: { distanceM: number; bearingDeg: number; onCrosshair: boolean } | null;
  seed: number;
  fallback: "random" | null;
  traceRecords: number;
  /** The precision controller's live state; `bound` is false outside precision control. */
  motor: MotorTelemetry;
  /** Who walks the body, and where the navigator is taking it. */
  navigation: NavigationMode;
  nav: NavTelemetry;
  /** This episode's shooting, for the spectator panel. */
  shots: number;
  hits: number;
  kills: number;
  deaths: number;
}

export interface BrainOptions {
  seed: number;
  /** The scripted reference policy, for the `script` brain. */
  policy: ScriptPolicy;
  fallback: "random" | null;
  trace: ParsedTrace | null;
  control: ControlMode;
  /** How a brain's movement reaches the body; see `NAVIGATION_MODES`. */
  navigation: NavigationMode;
  /** An experiment's decision interval for a local brain; null for the default. */
  intervalMs: number | null;
  /** Injected answer delay for a local brain, ms. Never applied to Jev. */
  latencyMs: number;
}

const TICK_MS = 50;
const RESPAWN_BANNER_MS = 1200;

const browserClock: LoopClock = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (handle) => window.clearTimeout(handle as number),
};

interface Executing {
  sequence: number;
  source: DecisionSource;
  axes: DecisionAxes | null;
  record: TraceRecord | null;
  startSim: number;
  startShots: number;
  startHits: number;
  startKills: number;
  startDamageTaken: number;
  startX: number;
  startZ: number;
}

interface Pending {
  sequence: number;
  frame: ControlFrame;
  source: DecisionSource;
  axes: DecisionAxes | null;
  record: TraceRecord | null;
  /** Wall time the decision was accepted, for the execution-latency figure. */
  receivedAt: number;
}

/** Slot → entity maps kept for this many recent observations. */
const SLOT_MEMORY = 32;
/** Every this many steps the aim is measured against the nearest visible enemy. */
const AUDIT_STRIDE = 3;
/** An enemy counts as "being aimed at" within this cone, for the uniform audit. */
const AUDIT_CONE_DEG = 10;

const _eye = new THREE.Vector3();
const _chest = new THREE.Vector3();
const _navFrom = new THREE.Vector3();
const _shift = new THREE.Vector3();
const _navDir = new THREE.Vector3();
const _to = new THREE.Vector3();

interface ReplayState {
  records: TraceRecord[];
  index: number;
  t0: number;
  start: number | null;
}

class Pilot {
  /** The input a brain writes. The human's lives in the rig's `InputManager`. */
  readonly input: InputState = createInputState();
  readonly executor = new ActionExecutor();
  /** The local tracking controller. Runs only in precision control. */
  readonly motor = new PrecisionMotorController();
  /** The local walking controller. Runs only under places navigation. */
  readonly navigator = new PlaceNavigator();
  readonly perception = new Perception();
  readonly recorder = new TraceRecorder();
  readonly metrics = new PilotMetrics();
  /** What the seat perceived against what happened. Kept for every seat. */
  readonly debrief = new Debrief();
  private debriefDt = 0;
  readonly telemetry: PilotTelemetry = {
    brain: "human",
    label: "HUMAN",
    status: "OFF",
    sequence: 0,
    executingSequence: null,
    frame: null,
    frameSource: null,
    axes: null,
    model: null,
    latencyMs: null,
    serverLatencyMs: null,
    inFlight: false,
    lastError: null,
    service: null,
    target: null,
    seed: 0,
    fallback: null,
    traceRecords: 0,
    control: "direct",
    motor: this.motor.telemetry,
    navigation: "steps",
    nav: this.navigator.telemetry,
    shots: 0,
    hits: 0,
    kills: 0,
    deaths: 0,
  };

  /** Set by the rig: grab the pointer for the human, inside the takeover gesture. */
  requestHumanLock: (() => void) | null = null;
  /** Set by the rig: drop anything the human's input manager still holds. */
  resetHumanInput: (() => void) | null = null;

  private brain: BrainKind = "human";
  private options: BrainOptions = {
    seed: 0,
    policy: "marksman",
    fallback: null,
    trace: null,
    control: "direct",
    navigation: "steps",
    intervalMs: null,
    latencyMs: 0,
  };
  /** The interface the seat is actually running, after negotiation. */
  private negotiated: Negotiated | null = null;
  /** What was asked for, before negotiation: the idempotence key. */
  private requested: BrainOptions = { ...this.options };
  /** The entities behind each observation's target slots, by sequence. Never sent. */
  private readonly slots = new Map<number, EntityId[]>();
  /** The world points behind each observation's place slots, by sequence. Never sent. */
  private readonly placeSlots = new Map<number, FoundPlace[]>();
  private readonly navSense: NavSense;
  private auditPhase = 0;
  private readonly sense: MotorSense;
  /** This simulation step's length, for the weapon-readiness lookahead. */
  private readonly step = { dt: 1 / 60 };
  private loop: DecisionLoop | null = null;
  private replay: ReplayState | null = null;
  private pending: Pending | null = null;
  private executing: Executing | null = null;
  private lastEnded: { frame: ControlFrame; outcome: PreviousOutcome } | null = null;
  private lastExecutedSequence = 0;
  private lifeId = 0;
  private wasAlive = true;
  private respawnedAt = -Infinity;
  private director: unknown = null;
  private readonly session = newSessionId();
  private failure: { kind: FailureKind; detail: string } | null = null;
  /** The last decision accepted came from the fallback, not the primary. */
  private fallbackActive = false;
  /**
   * Monotonic counters for frame outcomes. Episode statistics are reset by
   * benchmarks and match changes; a frame's baseline must not be, or its
   * outcome goes negative — which is how a reset once wedged the pilot: the
   * server rightly refused `shotsFired: -3`, and the bad value rode along in
   * every observation after it.
   */
  private readonly lifetime = { shots: 0, hits: 0, damageTaken: 0 };
  /** The event time of the last damaging round, to count each round once. */
  private lastHitEventTime: number | null = null;
  private timer: number | null = null;
  private lastX = 0;
  private lastZ = 0;
  private matchId = "";
  private probe: AbortController | null = null;

  constructor() {
    this.executor.onFrameEnd = (frame, reason, simTime) =>
      this.finishFrame(frame, reason, simTime);
    this.sense = this.createSense();
    this.navSense = {
      now: 0,
      x: 0,
      z: 0,
      yaw: 0,
      probe: (dirX, dirZ, range) => {
        const world = game.world;
        if (!world) return null;
        const p = game.player.position;
        _navFrom.set(p.x, p.y + 0.9, p.z);
        _navDir.set(dirX, 0, dirZ);
        const hit = world.raycast(
          _navFrom,
          _navDir,
          range,
          MASK_MOVEMENT,
          game.player.id,
        );
        return hit ? hit.distance : null;
      },
    };
    this.navigator.events = {
      onGo: (kind) => this.metrics.onPlaceChosen(kind),
      onRelease: (reason, kind, seconds) => {
        this.metrics.onPlaceReleased(reason, seconds);
        this.recorder.event({
          kind: "travel_ended",
          sequence: null,
          detail: `${kind}: ${reason} after ${seconds.toFixed(1)} s`,
        });
      },
    };
    this.motor.events = {
      onBind: (_id, switched) => this.metrics.onBind(switched),
      onRelease: (id, reason) => {
        this.metrics.onRelease(reason);
        if (reason === "lost_sight" || reason === "eliminated" || reason === "timeout") {
          this.recorder.event({
            kind: "target_released",
            sequence: null,
            detail: reason,
          });
        }
        void id;
      },
      onAcquired: (seconds) => this.metrics.onAcquired(seconds),
      onTrackingSample: (error) => this.metrics.onTracking(error),
      onTriggerOpportunity: (fired) => this.metrics.onTriggerOpportunity(fired),
      onRecoilCompensation: (degrees) => this.metrics.onRecoilCompensation(degrees),
    };
  }

  /**
   * What the precision controller may sense: the eye, the real aim direction,
   * the field of view, its own body and weapon, and — for the one enemy it was
   * given — a living body and sight-line tests. The same collision world and
   * the same `hasLineOfSight` the bots and the perception layer use.
   */
  private createSense(): MotorSense {
    const step = this.step;
    const weapon: MotorWeapon = {
      get fireMode() {
        return rigState.weapon?.fireMode ?? "semi";
      },
      get weaponClass() {
        return rigState.weapon?.def.weaponClass ?? "assault";
      },
      get muzzleVelocity() {
        return rigState.weapon?.def.ballistics.muzzleVelocity ?? 800;
      },
      get pellets() {
        return rigState.weapon?.def.ballistics.pellets ?? 1;
      },
      get ads() {
        return rigState.weapon?.ads ?? 0;
      },
      get readyToFire() {
        const w = rigState.weapon;
        if (!w || rigState.firingBlocked || w.ammo <= 0 || w.isReloading) return false;
        return w.state !== "raising" && w.cycleRemainingS <= step.dt * 0.999;
      },
      get isReloading() {
        return rigState.weapon?.isReloading ?? false;
      },
      spreadDeg: (stance, speed, airborne) =>
        rigState.weapon ? rigState.weapon.spreadDeg(stance, speed, airborne) : 90,
    };
    const apparent: MotorBody = { stance: "stand", position: new THREE.Vector3() };
    const sense: MotorSense = {
      now: 0,
      eye: new THREE.Vector3(),
      aim: new THREE.Vector3(0, 0, -1),
      halfFovDeg: { h: 40, v: 25 },
      player: {
        speed: 0,
        stance: "stand",
        grounded: true,
        yaw: 0,
        velocity: new THREE.Vector3(),
      },
      weapon,
      body: (id) => {
        const actor = game.actorById.get(id);
        if (!actor || !actor.alive || actor.team !== OPPOSING_TEAM[game.player.team]) {
          return null;
        }
        // The body the seat sees: displaced by the heat shimmer at range, as
        // it is drawn for a person. Rounds still meet the real one.
        apparent.stance = actor.stance;
        apparent.position
          .copy(actor.position)
          .add(mirageOffset(sense.eye, actor.position, actor.id, game.time, _shift));
        return apparent;
      },
      sightline: (id, point) => {
        const world = game.world;
        return world ? world.hasLineOfSight(sense.eye, point, MASK_SIGHT, id) : false;
      },
    };
    return sense;
  }

  private refreshNavSense(): NavSense {
    const sense = this.navSense;
    const player = game.player;
    sense.now = game.time;
    sense.x = player.position.x;
    sense.z = player.position.z;
    sense.yaw = player.yaw;
    return sense;
  }

  private refreshSense(): MotorSense {
    const sense = this.sense;
    const player = game.player;
    sense.now = game.time;
    eyePosition(player, sense.eye);
    sense.aim.copy(game.cameraForward);
    if (sense.aim.lengthSq() < 1e-8) sense.aim.set(0, 0, -1);
    sense.aim.normalize();
    sense.halfFovDeg.h = rigState.horizontalFovDeg / 2;
    sense.halfFovDeg.v = Math.max(10, game.cameraFov / 2);
    sense.player.speed = player.speed;
    sense.player.stance = player.stance;
    sense.player.grounded = player.grounded;
    sense.player.yaw = player.yaw;
    sense.player.velocity.copy(player.velocity);
    return sense;
  }

  /** Look deltas the brain's controls wrote last step, for weapon sway. */
  get lastLookYaw(): number {
    return this.motor.telemetry.bound
      ? this.motor.lastLookYaw
      : this.executor.lastLookYaw;
  }

  get lastLookPitch(): number {
    return this.motor.telemetry.bound
      ? this.motor.lastLookPitch
      : this.executor.lastLookPitch;
  }

  get controlMode(): ControlMode {
    return this.options.control;
  }

  get active(): boolean {
    return this.brain !== "human";
  }

  get currentBrain(): BrainKind {
    return this.brain;
  }

  /* ---------------------------------------------------------------- */
  /* Brain selection                                                   */
  /* ---------------------------------------------------------------- */

  /** Put a brain (or the human) in the seat. Idempotent for the same settings. */
  setBrain(brain: BrainKind, options: BrainOptions): void {
    const previous = this.requested;
    if (
      brain === this.brain &&
      options.seed === previous.seed &&
      options.policy === previous.policy &&
      options.fallback === previous.fallback &&
      options.trace === previous.trace &&
      options.control === previous.control &&
      options.navigation === previous.navigation &&
      options.intervalMs === previous.intervalMs &&
      options.latencyMs === previous.latencyMs
    ) {
      return;
    }
    this.release();
    this.brain = brain;
    // What the seat runs is what both sides support. The simulation's rules do
    // not depend on it; which axes are asked, how often, and which local
    // controllers execute do.
    const local = brain === "random" || brain === "script";
    const capabilities: Capabilities =
      brain === "jev"
        ? JEV_CAPABILITIES
        : brain === "replay" && options.trace
          ? {
              ...LOCAL_POLICY_CAPABILITIES,
              control: [options.trace.header.control],
              navigation: [options.trace.header.navigation],
            }
          : LOCAL_POLICY_CAPABILITIES;
    const negotiated =
      brain === "human"
        ? null
        : negotiate(capabilities, {
            control: options.control,
            navigation: options.navigation,
            intervalMs: local ? options.intervalMs : null,
          });
    this.negotiated = negotiated;
    this.options = negotiated
      ? {
          ...options,
          control: negotiated.control,
          navigation: negotiated.navigation,
          latencyMs: local ? options.latencyMs : 0,
        }
      : options;
    this.requested = options;
    this.failure = null;
    this.fallbackActive = false;
    this.telemetry.service = null;
    this.telemetry.lastError = null;
    this.telemetry.model = null;
    this.telemetry.seed = options.seed;
    this.telemetry.fallback = options.fallback;
    this.telemetry.control = options.control;
    this.telemetry.navigation = options.navigation;

    if (brain === "human") {
      this.stopTimer();
      this.updateTelemetry();
      return;
    }

    if (brain === "replay") {
      const trace = options.trace;
      if (trace) {
        this.replay = {
          records: trace.records,
          index: 0,
          t0: trace.records[0]?.actionStart ?? 0,
          start: null,
        };
      } else {
        this.failure = { kind: "invalid", detail: "No compatible trace is loaded." };
      }
    } else {
      const inner =
        brain === "jev"
          ? new JevHttpProvider(this.session)
          : brain === "script"
            ? new ScriptedProvider(options.policy)
            : new RandomProvider(options.seed);
      const primary =
        brain !== "jev" && this.options.latencyMs > 0
          ? new DelayedProvider(inner, this.options.latencyMs)
          : inner;
      const fallback =
        brain === "jev" && options.fallback === "random"
          ? new RandomProvider((options.seed ^ 0x9e3779b9) >>> 0)
          : null;
      this.loop = new DecisionLoop({
        primary,
        fallback,
        clock: browserClock,
        minIntervalMs: negotiated?.intervalMs,
        onDecision: (decision) => this.accept(decision),
        onEvent: (event) => this.onLoopEvent(event),
      });
    }
    this.beginEpisode();
    this.startTimer();
    if (brain === "jev") this.checkService();
  }

  /**
   * Human takeover. Immediate: the request in flight is abandoned, every
   * AI-held control is released, the brain is switched off, and the match
   * carries on under the keyboard and mouse.
   */
  takeover(): void {
    if (!this.active) return;
    const from = this.brain;
    this.recorder.event({ kind: "takeover", sequence: null, detail: `from ${from}` });
    this.release();
    this.brain = "human";
    this.failure = null;
    this.stopTimer();
    this.resetHumanInput?.();
    this.updateTelemetry();
    const store = useGameStore.getState();
    if (store.brain !== "human") store.setBrain("human");
    this.requestHumanLock?.();
  }

  /** Stop everything a brain is doing, without changing who is in the seat. */
  private release(): void {
    this.loop?.stop();
    this.loop = null;
    this.replay = null;
    this.pending = null;
    this.probe?.abort();
    this.probe = null;
    this.slots.clear();
    this.placeSlots.clear();
    this.executor.clear(this.input, game.time);
    this.motor.reset();
    this.navigator.reset();
  }

  private checkService(): void {
    const controller = new AbortController();
    this.probe = controller;
    void probeJevService(undefined, controller.signal).then((status) => {
      if (this.probe !== controller) return;
      this.telemetry.service = status;
      if (!status.available && this.metrics.counters.accepted === 0) {
        this.failure = { kind: "unavailable", detail: status.detail };
        this.telemetry.lastError = status.detail;
      }
    });
  }

  /* ---------------------------------------------------------------- */
  /* Episodes                                                          */
  /* ---------------------------------------------------------------- */

  private beginEpisode(): void {
    const store = useGameStore.getState();
    this.matchId = `${store.matchSeed.toString(16)}-${Date.now().toString(36)}`;
    this.metrics.reset(game.player.kills, game.player.deaths, performance.now());
    this.debrief.reset();
    this.labelMetrics();
    this.lastEnded = null;
    this.lastExecutedSequence = 0;
    this.perception.reset();
    if (this.brain !== "human") {
      this.recorder.begin({
        brain: this.brain,
        policy: this.brain === "script" ? this.options.policy : null,
        seed: this.options.seed,
        control: this.options.control,
        navigation: this.options.navigation,
        interface: this.negotiated
          ? {
              intervalMs: this.negotiated.intervalMs,
              injectedLatencyMs: this.options.latencyMs,
              inference: this.negotiated.inference,
              notes: this.negotiated.notes,
            }
          : null,
        mode: store.mode,
        matchId: this.matchId,
        startedAt: new Date().toISOString(),
        build:
          typeof __BUILD_COMMIT__ === "string" && __BUILD_COMMIT__
            ? __BUILD_COMMIT__
            : null,
      });
    }
  }

  /** Restart the statistics from now, keeping the brain, trace and match. */
  resetMetrics(): void {
    this.metrics.reset(game.player.kills, game.player.deaths, performance.now());
    this.debrief.reset();
    this.labelMetrics();
  }

  /** Every statistic says which controller and profile produced it. */
  private labelMetrics(): void {
    const metrics = this.metrics;
    metrics.brain = this.brain;
    metrics.control = this.brain === "human" ? "none" : this.options.control;
    metrics.profile =
      this.brain === "human" ? useGameStore.getState().playerProfile : "n/a";
    const store = useGameStore.getState();
    metrics.navigation =
      this.brain === "human"
        ? "none"
        : this.options.navigation === "places" && store.placeOrder === "shuffled"
          ? "places-shuffled"
          : this.options.navigation;
    metrics.intervalMs = this.negotiated?.intervalMs ?? null;
    metrics.injectedLatencyMs = this.brain === "human" ? 0 : this.options.latencyMs;
    metrics.seat = useGameStore.getState().seatRules;
  }

  /** Current metrics, from the player's own kill and death counters. */
  episode(): EpisodeMetrics {
    return {
      ...this.metrics.snapshot(game.player.kills, game.player.deaths, performance.now()),
      debrief: this.debrief.summary(),
    };
  }

  /* ---------------------------------------------------------------- */
  /* Timer — decisions happen here, never on the frame loop            */
  /* ---------------------------------------------------------------- */

  private startTimer(): void {
    if (this.timer !== null || typeof window === "undefined") return;
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  private stopTimer(): void {
    if (this.timer === null) return;
    window.clearInterval(this.timer);
    this.timer = null;
  }

  private tick(): void {
    const loop = this.loop;
    if (!loop) {
      this.updateTelemetry();
      return;
    }
    const screen = useGameStore.getState().screen;
    const phase = game.matchDirector?.phase;
    const eligible =
      screen === "playing" &&
      phase !== "post" &&
      game.player.alive &&
      rigState.ready &&
      game.world !== null;
    loop.tick({
      eligible,
      lifeId: this.lifeId,
      capture: (sequence) => {
        const observation = this.perception.capture({
          sequence,
          previousFrame: this.executor.current ?? this.lastEnded?.frame ?? null,
          previousOutcome: this.executing
            ? this.outcome(this.executing, game.time)
            : (this.lastEnded?.outcome ?? null),
          control: this.options.control,
          trackedId: this.motor.targetId,
          navigation: this.options.navigation,
          travel: this.navigator.target,
        });
        this.rememberSlots(sequence);
        return observation;
      },
    });
    this.telemetry.sequence = loop.lastSequence;
    this.updateTelemetry();
  }

  private rememberSlots(sequence: number): void {
    this.slots.set(sequence, [...this.perception.lastTargetIds]);
    this.placeSlots.set(sequence, [...this.perception.lastPlaces]);
    for (const key of this.slots.keys()) {
      if (key <= sequence - SLOT_MEMORY) this.slots.delete(key);
    }
    for (const key of this.placeSlots.keys()) {
      if (key <= sequence - SLOT_MEMORY) this.placeSlots.delete(key);
    }
  }

  private accept(decision: AcceptedDecision): void {
    const source: DecisionSource = decision.fallback
      ? "fallback-random"
      : decision.provider;
    const counters = this.metrics.counters;
    counters.accepted += 1;
    this.fallbackActive = decision.fallback;
    if (decision.fallback) counters.fallback += 1;
    else this.failure = null;
    this.metrics.onFrame(decision.frame);
    const axes = decision.axes;
    const confidence: Partial<Record<Axis, number>> | null = axes
      ? Object.fromEntries(
          (["move", "turn", "tilt", "weapon", "target", "aim"] as const).flatMap(
            (axis) => {
              const answer = axes[axis];
              return answer ? [[axis, answer.confidence]] : [];
            },
          ),
        )
      : null;
    this.metrics.onDecisionLatency(
      decision.latencyMs,
      decision.serverLatencyMs,
      decision.model,
      confidence,
    );
    if (decision.model) this.telemetry.model = decision.model;
    this.telemetry.latencyMs = decision.latencyMs;
    this.telemetry.serverLatencyMs = decision.serverLatencyMs;

    const record = this.recorder.record({
      type: "decision",
      timestamp: new Date().toISOString(),
      sequence: decision.sequence,
      source,
      observationHash: hashObservation(decision.observation),
      legal: decision.observation.legal,
      frame: decision.frame,
      axes: decision.axes,
      model: decision.model,
      latencyMs: Math.round(decision.latencyMs),
      serverLatencyMs: decision.serverLatencyMs,
      actionStart: null,
      actionExpiry: null,
      actionEnd: null,
      endReason: null,
      execution: null,
      playerAfter: null,
      matchId: this.matchId,
      seed: this.options.seed,
    });
    this.telemetry.traceRecords = this.recorder.size;

    // One pending frame at most; only ever replaced by a newer one.
    if (this.pending && this.pending.sequence >= decision.sequence) {
      this.metrics.counters.stale += 1;
      return;
    }
    this.pending = {
      sequence: decision.sequence,
      frame: decision.frame,
      source,
      axes: decision.axes,
      record,
      receivedAt: performance.now(),
    };
  }

  private onLoopEvent(event: LoopEvent): void {
    const counters = this.metrics.counters;
    switch (event.kind) {
      case "requested":
        counters.requested += 1;
        break;
      case "aborted":
        counters.aborted += 1;
        break;
      case "stale":
        counters.stale += 1;
        this.recorder.event({
          kind: "stale",
          sequence: event.sequence,
          detail: event.reason,
        });
        break;
      case "duplicate":
        counters.duplicates += 1;
        this.recorder.event({ kind: "duplicate", sequence: event.sequence, detail: "" });
        break;
      case "failure": {
        const kind = event.failure;
        if (kind === "timeout") counters.timeouts += 1;
        else if (kind === "rate_limited") counters.rateLimited += 1;
        else if (kind === "unavailable") counters.unavailable += 1;
        else if (kind === "invalid") counters.invalid += 1;
        else if (kind === "aborted") counters.aborted += 1;
        else counters.errors += 1;
        this.failure = { kind, detail: event.detail };
        this.telemetry.lastError = `${kind}: ${event.detail}`.slice(0, 160);
        this.recorder.event({
          kind:
            kind === "timeout"
              ? "timeout"
              : kind === "unavailable"
                ? "unavailable"
                : kind === "invalid"
                  ? "invalid"
                  : kind === "rate_limited"
                    ? "rate_limited"
                    : "error",
          sequence: event.sequence,
          detail: event.detail,
        });
        break;
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* Frame loop                                                        */
  /* ---------------------------------------------------------------- */

  /**
   * Called by `PlayerRig` once per rendered step. Tracks life, match and
   * statistics for every controller, and — when a brain is in the seat and the
   * player can act — returns the brain's input for this step.
   */
  frame(dt: number, playing: boolean): InputState | null {
    const player = game.player;
    const simTime = game.time;

    if (game.matchDirector !== this.director) {
      this.director = game.matchDirector;
      this.beginEpisode();
      this.lastX = player.position.x;
      this.lastZ = player.position.z;
    }

    if (this.wasAlive && !player.alive) {
      this.lifeId += 1;
      this.metrics.onDeath();
      this.recordDeath(simTime);
      this.loop?.abandon();
      this.pending = null;
      this.executor.clear(this.input, simTime);
      this.motor.reset();
      this.navigator.reset();
      if (this.active) {
        this.recorder.event({ kind: "death", sequence: null, detail: game.hud.killedBy });
      }
    } else if (!this.wasAlive && player.alive) {
      this.lifeId += 1;
      this.respawnedAt = performance.now();
      this.perception.reset();
      this.lastX = player.position.x;
      this.lastZ = player.position.z;
      if (this.active)
        this.recorder.event({ kind: "respawn", sequence: null, detail: "" });
    }
    this.wasAlive = player.alive;

    if (playing) {
      const moved = Math.hypot(
        player.position.x - this.lastX,
        player.position.z - this.lastZ,
      );
      this.metrics.step(dt, player.alive, moved);
      if (player.alive) {
        this.metrics.stepState(
          dt,
          game.adsProgress,
          this.active &&
            (this.fallbackActive || this.executing?.source === "fallback-random"),
        );
        this.auditPhase = (this.auditPhase + 1) % AUDIT_STRIDE;
        this.debriefDt += dt;
        if (this.auditPhase === 0) {
          const audit = this.auditNearest();
          if (audit) this.metrics.onAimAudit(audit.errorDeg);
          this.debrief.sample(simTime, this.debriefDt, this.senseEnemies());
          this.debriefDt = 0;
        }
      }
    }
    if (this.brain === "human") {
      this.metrics.profile = useGameStore.getState().playerProfile;
    }
    this.lastX = player.position.x;
    this.lastZ = player.position.z;

    if (!this.active) {
      this.updateTelemetry();
      return null;
    }
    if (!playing || !player.alive) {
      if (this.executor.current) this.executor.clear(this.input, simTime);
      this.motor.reset();
      this.navigator.reset();
      this.pending = null;
      this.updateTelemetry();
      return null;
    }

    if (this.brain === "replay") this.advanceReplay(simTime);

    const next = this.pending;
    if (next) {
      this.pending = null;
      if (next.sequence > this.lastExecutedSequence) this.begin(next, simTime);
    }
    this.executor.apply(this.input, {
      simTime,
      dt,
      stance: player.stance,
      fireMode: rigState.fireMode,
    });
    if (this.options.navigation === "places") {
      // The navigator walks toward the chosen place, overwriting only the
      // movement axes and sprint. With no destination it changes nothing.
      const frame = this.executor.current;
      const firing = frame ? WEAPON_INPUT[frame.weapon].fire : false;
      this.navigator.apply(this.input, this.refreshNavSense(), firing);
    }
    if (this.options.control === "precision") {
      // The executor has written the brain's frame; the tracking controller
      // now executes its engagement part. With nothing bound it changes nothing.
      const frame = this.executor.current;
      const weapon = frame ? WEAPON_INPUT[frame.weapon] : null;
      this.step.dt = dt;
      this.motor.apply(
        this.input,
        this.refreshSense(),
        {
          fire: weapon?.fire ?? false,
          ads: weapon?.ads ?? false,
          sprintRequested: frame ? MOVE_INPUT[frame.move].sprint : false,
          forTarget: frame ? frame.target !== "NONE" : false,
        },
        dt,
      );
    }
    this.updateTelemetry();
    return this.input;
  }

  /**
   * The aim measured against the nearest visible enemy within
   * `AUDIT_CONE_DEG` of the crosshair: angle to its chest, and its range. The
   * same measurement for every controller, human included, so the figures it
   * feeds can be compared across them. Sight is tested exactly as perception
   * tests it.
   */
  private auditNearest(): { errorDeg: number; rangeM: number; id: EntityId } | null {
    const world = game.world;
    if (!world) return null;
    const player = game.player;
    const enemyTeam = OPPOSING_TEAM[player.team];
    eyePosition(player, _eye);
    const aim = game.cameraForward;
    if (aim.lengthSq() < 1e-8) return null;
    let best: { errorDeg: number; rangeM: number; id: EntityId } | null = null;
    for (const other of game.actors) {
      if (other.isPlayer || !other.alive || other.team !== enemyTeam) continue;
      const chest = aimRegionGeometry("UPPER_CHEST", other.stance);
      _chest.set(other.position.x, other.position.y + chest.heightM, other.position.z);
      _to.copy(_chest).sub(_eye);
      const range = _to.length();
      if (range < 0.5 || range > 165) continue;
      const error = (_to.angleTo(aim) * 180) / Math.PI;
      if (error > AUDIT_CONE_DEG || (best && error >= best.errorDeg)) continue;
      if (!world.hasLineOfSight(_eye, _chest, MASK_SIGHT, other.id)) continue;
      best = { errorDeg: error, rangeM: range, id: other.id };
    }
    return best;
  }

  /**
   * For the debrief: every living enemy within sight range, whether the seat
   * can see it (perception's own rule, `sightOf`) and whether it holds a
   * sight line to the seat's chest (whichever way it faces).
   */
  private senseEnemies(): EnemySample[] {
    const player = game.player;
    const world = game.world;
    const out: EnemySample[] = [];
    if (!world) return out;
    const enemyTeam = OPPOSING_TEAM[player.team];
    eyePosition(player, _eye);
    const aim = game.cameraForward;
    const aimYaw = forwardToYaw(aim.x, aim.z);
    const aimPitch = Math.asin(THREE.MathUtils.clamp(aim.y, -1, 1));
    const fov = {
      h: rigState.horizontalFovDeg / 2,
      v: Math.max(10, game.cameraFov / 2),
    };
    _chest.set(
      player.position.x,
      player.position.y + HUMAN_METRICS.eyeHeight[player.stance] - 0.35,
      player.position.z,
    );
    for (const other of game.actors) {
      if (other.isPlayer || !other.alive || other.team !== enemyTeam) continue;
      if (other.position.distanceTo(player.position) > 165) continue;
      const inView = sightOf(_eye, aimYaw, aimPitch, fov, other) !== null;
      eyePosition(other, _to);
      const exposedTo = world.hasLineOfSight(_to, _chest, MASK_SIGHT, player.id);
      out.push({ id: other.id, inView, exposedTo });
    }
    return out;
  }

  private recordDeath(simTime: number): void {
    const player = game.player;
    const attacker =
      player.lastAttackerId !== null ? game.actorById.get(player.lastAttackerId) : null;
    const killer = attacker && !attacker.isPlayer ? attacker : null;
    // Cover within reach: anything standing within 10 m at waist height.
    let openGround = true;
    const world = game.world;
    if (world) {
      _eye.set(player.position.x, player.position.y + 0.9, player.position.z);
      for (let i = 0; i < 8 && openGround; i += 1) {
        yawToForward((i / 8) * Math.PI * 2, _to);
        if (world.raycast(_eye, _to, 10, MASK_MOVEMENT, player.id)) openGround = false;
      }
    }
    let place: string | null = null;
    let nearest = Infinity;
    for (const zone of GROUND_ZONES) {
      const d =
        Math.hypot(
          zone.position[0] - player.position.x,
          zone.position[1] - player.position.z,
        ) - zone.radius;
      if (d < nearest) {
        nearest = d;
        place = zone.name;
      }
    }
    const record = this.debrief.onDeath(
      simTime,
      killer ? { id: killer.id, name: killer.name } : null,
      {
        rangeM: killer ? killer.position.distanceTo(player.position) : null,
        openGround,
        place,
      },
    );
    if (this.active) {
      this.recorder.event({
        kind: "debrief",
        sequence: null,
        detail: `${record.cls}${record.killer ? ` by ${record.killer}` : ""}${record.rangeM === null ? "" : ` at ${Math.round(record.rangeM)} m`}${record.openGround ? " on open ground" : ""}`,
      });
    }
  }

  /** After the rig has consumed the step, clear one-shot edges and look deltas. */
  endFrame(): void {
    if (this.active) clearInputEdges(this.input);
  }

  private begin(next: Pending, simTime: number): void {
    const player = game.player;
    this.lastExecutedSequence = next.sequence;
    this.executor.start(next.frame, simTime);
    this.metrics.onExecutionLatency(Math.max(0, performance.now() - next.receivedAt));
    if (this.options.control === "precision") {
      // The slot names an enemy of the observation this decision was made
      // from. Unknown slots — a map already forgotten — bind nothing.
      const slot = targetSlot(next.frame.target);
      const id = slot === null ? undefined : this.slots.get(next.sequence)?.[slot];
      this.motor.engage(
        id === undefined ? null : { targetId: id, aim: next.frame.aim },
        simTime,
      );
      if (next.record) next.record.engagement = { targetBound: id !== undefined };
    }
    if (this.options.navigation === "places") {
      const go = next.frame.go;
      if (go === "NONE") {
        this.navigator.clear(simTime);
      } else if (go === "CONTINUE") {
        this.navigator.confirm(simTime);
      } else {
        const slot = placeSlot(go);
        const place =
          slot === null ? undefined : this.placeSlots.get(next.sequence)?.[slot];
        // A slot whose observation has been forgotten binds nothing.
        if (place) {
          this.navigator.go(place, simTime, {
            x: player.position.x,
            z: player.position.z,
          });
        }
        if (next.record)
          next.record.travel = {
            placeBound: place !== undefined,
            kind: place?.kind ?? null,
          };
      }
    }
    this.executing = {
      sequence: next.sequence,
      source: next.source,
      axes: next.axes,
      record: next.record,
      startSim: simTime,
      startShots: this.lifetime.shots,
      startHits: this.lifetime.hits,
      startKills: player.kills,
      startDamageTaken: this.lifetime.damageTaken,
      startX: player.position.x,
      startZ: player.position.z,
    };
    if (next.record) {
      next.record.actionStart = round3(simTime);
      next.record.actionExpiry = round3(this.executor.expiryTime);
    }
  }

  private outcome(executing: Executing, simTime: number): PreviousOutcome {
    const player = game.player;
    const elapsed = Math.max(0, simTime - executing.startSim);
    const moved = Math.hypot(
      player.position.x - executing.startX,
      player.position.z - executing.startZ,
    );
    const frame = this.executor.current ?? this.lastEnded?.frame ?? null;
    const wantsMove = frame
      ? MOVE_INPUT[frame.move].x !== 0 || MOVE_INPUT[frame.move].y !== 0
      : false;
    return {
      shotsFired: Math.max(0, Math.min(1000, this.lifetime.shots - executing.startShots)),
      hitConfirmed: this.lifetime.hits > executing.startHits,
      killConfirmed: player.kills > executing.startKills,
      damageTaken: this.lifetime.damageTaken > executing.startDamageTaken,
      movementBlocked: wantsMove && elapsed >= 0.2 && moved / elapsed < 0.6,
    };
  }

  private finishFrame(
    frame: ControlFrame,
    reason: FrameEndReason,
    simTime: number,
  ): void {
    const executing = this.executing;
    if (!executing) return;
    const outcome = this.outcome(executing, simTime);
    this.lastEnded = { frame, outcome };
    this.executing = null;
    const record = executing.record;
    if (record) {
      const player = game.player;
      record.actionEnd = round3(simTime);
      record.endReason = reason;
      record.execution = outcome;
      record.playerAfter = {
        alive: player.alive,
        health: Math.round(player.health),
        position: [
          round3(player.position.x),
          round3(player.position.y),
          round3(player.position.z),
        ],
        headingDeg: Math.round(((((-player.yaw * 180) / Math.PI) % 360) + 360) % 360),
        ammo: game.hud.ammo,
        reserve: game.hud.reserve,
      };
    }
  }

  private advanceReplay(simTime: number): void {
    const replay = this.replay;
    if (!replay) return;
    if (replay.start === null) replay.start = simTime;
    let due: TraceRecord | null = null;
    while (replay.index < replay.records.length) {
      const record = replay.records[replay.index]!;
      const at = replay.start + ((record.actionStart ?? 0) - replay.t0);
      if (at > simTime) break;
      if (due) {
        // A slow frame made two recorded frames due at once; the later wins.
        this.recorder.event({
          kind: "skipped",
          sequence: due.sequence,
          detail: "superseded within one step",
        });
      }
      due = record;
      replay.index += 1;
    }
    if (!due) return;
    const counters = this.metrics.counters;
    counters.requested += 1;
    counters.accepted += 1;
    this.metrics.onFrame(due.frame);
    const record = this.recorder.record({
      ...due,
      timestamp: new Date().toISOString(),
      source: "replay",
      latencyMs: null,
      serverLatencyMs: null,
      actionStart: null,
      actionExpiry: null,
      actionEnd: null,
      endReason: null,
      execution: null,
      playerAfter: null,
      matchId: this.matchId,
    });
    this.telemetry.model = due.model;
    const sequence = this.lastExecutedSequence + 1;
    if (this.options.control === "precision" && due.frame.target !== "NONE") {
      // A replayed slot names the enemy in that slot of the view *now*: the
      // control stream replays, the world does not.
      this.perception.capture({
        sequence,
        previousFrame: null,
        previousOutcome: null,
        control: "precision",
        trackedId: this.motor.targetId,
        navigation: this.options.navigation,
        travel: this.navigator.target,
      });
      this.rememberSlots(sequence);
    }
    this.pending = {
      sequence,
      frame: due.frame,
      source: "replay",
      axes: due.axes,
      record,
      receivedAt: performance.now(),
    };
  }

  /* ---------------------------------------------------------------- */
  /* Statistics taps                                                    */
  /* ---------------------------------------------------------------- */

  /**
   * A round left the player's weapon. Called by the rig after `fire()`, for
   * every controller. The audit measures the aim the round actually left on;
   * in precision control the controller queues its learned counter to that
   * shot's recoil pattern.
   */
  onPlayerShot(): void {
    this.lifetime.shots += 1;
    this.metrics.onShot();
    const audit = this.auditNearest();
    if (audit) {
      this.metrics.onShotAudit(audit.errorDeg, audit.rangeM);
      this.debrief.onEngaged(audit.id);
    }
    const weapon = rigState.weapon;
    if (this.active && this.options.control === "precision" && weapon) {
      this.motor.onShot(weapon.lastPatternKickDeg);
    }
  }

  /** Damage the resolver applied that involved the player. */
  onDamage(
    attackerIsPlayer: boolean,
    victimIsPlayer: boolean,
    amount: number,
    region: HitRegion | null = null,
    victimId: EntityId | null = null,
    killed = false,
    eventTime: number | null = null,
  ): void {
    if (attackerIsPlayer && !victimIsPlayer) {
      // One round can strike two hitboxes (it passes through an arm into the
      // chest); it is still one round that hit. Damage and regions count every
      // strike, the hit count counts the round once.
      const newRound = eventTime === null || eventTime !== this.lastHitEventTime;
      this.lastHitEventTime = eventTime;
      if (newRound) this.lifetime.hits += 1;
      this.metrics.onHit(amount, region, newRound);
      if (killed && victimId !== null) {
        const victim = game.actorById.get(victimId);
        this.debrief.onKill(
          game.time,
          victimId,
          victim ? victim.position.distanceTo(game.player.position) : null,
        );
      }
      if (victimId !== null) {
        const seconds = this.motor.noteHit(victimId, game.time);
        if (seconds !== null) this.metrics.onFirstHit(seconds);
      }
    }
    if (victimIsPlayer) {
      this.lifetime.damageTaken += amount;
      this.metrics.onDamageTaken(amount);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Telemetry                                                          */
  /* ---------------------------------------------------------------- */

  private updateTelemetry(): void {
    const t = this.telemetry;
    const executing = this.executing;
    t.brain = this.brain;
    t.control = this.options.control;
    t.navigation = this.options.navigation;
    t.shots = this.metrics.shotsFired;
    t.hits = this.metrics.hits;
    t.kills = game.player.kills - this.metrics.killsAtStart;
    t.deaths = game.player.deaths - this.metrics.deathsAtStart;
    t.frame = this.executor.current;
    t.executingSequence = executing?.sequence ?? null;
    t.frameSource = executing?.source ?? null;
    t.axes = executing?.axes ?? null;
    t.inFlight = this.loop?.inFlight ?? false;
    t.target = this.perception.lastTarget;
    t.traceRecords = this.recorder.size;
    t.label =
      this.brain === "human"
        ? "HUMAN"
        : this.brain === "random"
          ? "RANDOM"
          : this.brain === "script"
            ? "SCRIPTED"
            : this.brain === "replay"
              ? "REPLAY"
              : this.fallbackActive || executing?.source === "fallback-random"
                ? "FALLBACK"
                : "LIVE JEV";
    t.status = this.status();
  }

  private status(): PilotStatus {
    if (this.brain === "human") return "OFF";
    const screen = useGameStore.getState().screen;
    if (screen === "results" || game.matchDirector?.phase === "post")
      return "MATCH_COMPLETE";
    if (screen === "paused") return "PAUSED";
    if (!game.player.alive) return "DEAD";
    if (performance.now() - this.respawnedAt < RESPAWN_BANNER_MS) return "RESPAWNING";
    if (this.failure) {
      return this.failure.kind === "timeout"
        ? "TIMEOUT"
        : this.failure.kind === "unavailable"
          ? "UNAVAILABLE"
          : "ERROR";
    }
    if (this.executor.current) return "EXECUTING";
    if (this.loop?.inFlight) return "DECIDING";
    if (this.brain === "jev" && this.metrics.counters.accepted === 0) return "CONNECTING";
    return "OBSERVING";
  }

  /** The trace as JSON Lines, for download or replay. */
  exportTrace(): string {
    return this.recorder.toJsonl();
  }

  describeFrame(): string | null {
    return this.executor.current ? frameLabel(this.executor.current) : null;
  }
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export const pilot = new Pilot();
