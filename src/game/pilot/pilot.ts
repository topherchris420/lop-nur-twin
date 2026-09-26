import {
  game,
  createInputState,
  clearInputEdges,
  type InputState,
} from "../core/gameState";
import { useGameStore, type BrainKind } from "../core/gameStore";
import { AXES, MOVE_INPUT, frameLabel, type Axis, type ControlFrame } from "./contract";
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
import { Perception } from "./perception";
import {
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
export type ControlLabel = "HUMAN" | "LIVE JEV" | "RANDOM" | "REPLAY" | "FALLBACK";

export interface PilotTelemetry {
  brain: BrainKind;
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
}

export interface BrainOptions {
  seed: number;
  fallback: "random" | null;
  trace: ParsedTrace | null;
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
}

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
  readonly perception = new Perception();
  readonly recorder = new TraceRecorder();
  readonly metrics = new PilotMetrics();
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
  };

  /** Set by the rig: grab the pointer for the human, inside the takeover gesture. */
  requestHumanLock: (() => void) | null = null;
  /** Set by the rig: drop anything the human's input manager still holds. */
  resetHumanInput: (() => void) | null = null;

  private brain: BrainKind = "human";
  private options: BrainOptions = { seed: 0, fallback: null, trace: null };
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
  private timer: number | null = null;
  private lastX = 0;
  private lastZ = 0;
  private matchId = "";
  private probe: AbortController | null = null;

  constructor() {
    this.executor.onFrameEnd = (frame, reason, simTime) =>
      this.finishFrame(frame, reason, simTime);
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
    if (
      brain === this.brain &&
      options.seed === this.options.seed &&
      options.fallback === this.options.fallback &&
      options.trace === this.options.trace
    ) {
      return;
    }
    this.release();
    this.brain = brain;
    this.options = options;
    this.failure = null;
    this.fallbackActive = false;
    this.telemetry.service = null;
    this.telemetry.lastError = null;
    this.telemetry.model = null;
    this.telemetry.seed = options.seed;
    this.telemetry.fallback = options.fallback;

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
      const primary =
        brain === "jev"
          ? new JevHttpProvider(this.session)
          : new RandomProvider(options.seed);
      const fallback =
        brain === "jev" && options.fallback === "random"
          ? new RandomProvider((options.seed ^ 0x9e3779b9) >>> 0)
          : null;
      this.loop = new DecisionLoop({
        primary,
        fallback,
        clock: browserClock,
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
    this.executor.clear(this.input, game.time);
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
    this.lastEnded = null;
    this.lastExecutedSequence = 0;
    this.perception.reset();
    if (this.brain !== "human") {
      this.recorder.begin({
        brain: this.brain,
        seed: this.options.seed,
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
  }

  /** Current metrics, from the player's own kill and death counters. */
  episode(): EpisodeMetrics {
    return this.metrics.snapshot(
      game.player.kills,
      game.player.deaths,
      performance.now(),
    );
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
      capture: (sequence) =>
        this.perception.capture({
          sequence,
          previousFrame: this.executor.current ?? this.lastEnded?.frame ?? null,
          previousOutcome: this.executing
            ? this.outcome(this.executing, game.time)
            : (this.lastEnded?.outcome ?? null),
        }),
    });
    this.telemetry.sequence = loop.lastSequence;
    this.updateTelemetry();
  }

  private accept(decision: AcceptedDecision): void {
    const source: DecisionSource = decision.fallback
      ? "fallback-random"
      : decision.provider === "jev"
        ? "jev"
        : "random";
    const counters = this.metrics.counters;
    counters.accepted += 1;
    this.fallbackActive = decision.fallback;
    if (decision.fallback) counters.fallback += 1;
    else this.failure = null;
    this.metrics.onFrame(decision.frame);
    const axes = decision.axes;
    const confidence: Partial<Record<Axis, number>> | null = axes
      ? Object.fromEntries(AXES.map((axis) => [axis, axes[axis].confidence]))
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
      this.loop?.abandon();
      this.pending = null;
      this.executor.clear(this.input, simTime);
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
    }
    this.lastX = player.position.x;
    this.lastZ = player.position.z;

    if (!this.active) return null;
    if (!playing || !player.alive) {
      if (this.executor.current) this.executor.clear(this.input, simTime);
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
    this.updateTelemetry();
    return this.input;
  }

  /** After the rig has consumed the step, clear one-shot edges and look deltas. */
  endFrame(): void {
    if (this.active) clearInputEdges(this.input);
  }

  private begin(next: Pending, simTime: number): void {
    const player = game.player;
    this.lastExecutedSequence = next.sequence;
    this.executor.start(next.frame, simTime);
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
    this.pending = {
      sequence: this.lastExecutedSequence + 1,
      frame: due.frame,
      source: "replay",
      axes: due.axes,
      record,
    };
  }

  /* ---------------------------------------------------------------- */
  /* Statistics taps                                                    */
  /* ---------------------------------------------------------------- */

  /** A round left the player's weapon. Called by the rig after `fire()`. */
  onPlayerShot(): void {
    this.lifetime.shots += 1;
    this.metrics.onShot();
  }

  /** Damage the resolver applied that involved the player. */
  onDamage(attackerIsPlayer: boolean, victimIsPlayer: boolean, amount: number): void {
    if (attackerIsPlayer && !victimIsPlayer) {
      this.lifetime.hits += 1;
      this.metrics.onHit(amount);
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
