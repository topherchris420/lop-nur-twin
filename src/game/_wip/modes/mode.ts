import * as THREE from "three";
import { mulberry32 } from "@/lib/noise";
import { game, respawnActorSafe, type Actor } from "./internal";
import { useGameStore, type ObituaryToast, type ScoreRow } from "../core/gameStore";
import type { KillReport } from "../core/combat";
import type {
  DamageEvent,
  EntityId,
  GameModeId,
  MatchPhase,
  Team,
} from "../core/types";
import type { CollisionWorld } from "../physics/collisionWorld";
import { SpawnSelector, type SpawnObjective, type SpawnPoint, type SpawnQuery } from "./spawns";
import { ScoringSystem } from "./scoring";
import { KillstreakManager, NULL_KILLSTREAK_VFX, type KillstreakVfxPort } from "./killstreaks";

/**
 * The mode contract and the match director.
 *
 * A `GameMode` owns *rules*: what scores, what the objective is, where people
 * come back. The `MatchDirector` owns *flow*: warmup → live → overtime → post,
 * the clock, respawn dispatch, the killfeed, the scoreboard and the hand-off
 * to the results screen. Splitting them this way means a new mode is one file
 * with no knowledge of phases, and the flow is written once.
 *
 * Frame-loop discipline (AGENTS.md): `update(dt)` writes only to the mutable
 * `game` singleton. Zustand is touched on discrete events — a kill, a capture,
 * a phase change — plus one throttled scoreboard sync at 4 Hz.
 *
 * Note on double-counting: `combat.ts::killActor` already adds 100/150 to the
 * attacker's `score` before the mode layer sees the report. `ScoringSystem`
 * subtracts that again so `SCORE_EVENTS` remains the only table of numbers.
 * If `combat.ts` ever stops scoring, delete the subtraction there — nothing
 * else depends on it.
 */

/* ------------------------------------------------------------------ */
/* HUD state                                                           */
/* ------------------------------------------------------------------ */

export interface HudObjective {
  /** Stable id, usually a `GROUND_ZONES` id. */
  id: string;
  /** Short marker label: "A", "B", "C", "HP". */
  label: string;
  /** Human name, from `GROUND_ZONES`. */
  name: string;
  /** World x/z, so the minimap and compass can place it. */
  x: number;
  z: number;
  radius: number;
  owner: Team | null;
  /** Team currently making progress, if any. */
  capturingTeam: Team | null;
  /** 0..1 capture/hold progress. */
  progress: number;
  contested: boolean;
  /** Live right now (the hardpoint that is up, a flag in play). */
  active: boolean;
  /** Bodies inside, per team, for the "3 vs 1" readout. */
  occupantsBlue: number;
  occupantsRed: number;
}

export interface ModeHudState {
  modeId: GameModeId;
  modeName: string;
  phase: MatchPhase;
  teamBased: boolean;
  scoreLimit: number;
  scoreBlue: number;
  scoreRed: number;
  /** FFA leader, for the top bar when there are no teams. */
  leaderName: string;
  leaderScore: number;
  playerScore: number;
  playerPlacement: number;
  timeRemaining: number;
  /** Objective banner text, e.g. "HARDPOINT MOVING" or "OVERTIME". */
  banner: string;
  bannerUrgent: boolean;
  objectives: HudObjective[];
  /** Round-based modes. */
  roundNumber: number;
  roundsBlue: number;
  roundsRed: number;
  roundTimeRemaining: number;
  overtime: boolean;
  /** Radar state, straight off the killstreak manager. */
  uavBlue: boolean;
  uavRed: boolean;
}

export function createModeHudState(
  modeId: GameModeId,
  modeName: string,
  scoreLimit: number,
  teamBased: boolean,
): ModeHudState {
  return {
    modeId,
    modeName,
    phase: "warmup",
    teamBased,
    scoreLimit,
    scoreBlue: 0,
    scoreRed: 0,
    leaderName: "",
    leaderScore: 0,
    playerScore: 0,
    playerPlacement: 1,
    timeRemaining: 0,
    banner: "",
    bannerUrgent: false,
    objectives: [],
    roundNumber: 0,
    roundsBlue: 0,
    roundsRed: 0,
    roundTimeRemaining: 0,
    overtime: false,
    uavBlue: false,
    uavRed: false,
  };
}

/**
 * The live mode HUD, published for the top bar. It is a plain mutable object
 * updated in place on the frame loop — React must sample it on a throttle, in
 * exactly the same way it already samples `game.hud`.
 */
let publishedHud: ModeHudState | null = null;

export function getModeHud(): ModeHudState | null {
  return publishedHud;
}

export function publishModeHud(state: ModeHudState | null): void {
  publishedHud = state;
}

/* ------------------------------------------------------------------ */
/* Mode contract                                                       */
/* ------------------------------------------------------------------ */

export interface ModeContext {
  readonly world: CollisionWorld;
  readonly spawns: SpawnSelector;
  readonly scoring: ScoringSystem;
  readonly killstreaks: KillstreakManager;
  /** Deterministic, seeded from `matchSeed`. */
  readonly rng: () => number;
  readonly seed: number;
  /** Match time in seconds; the director refreshes it before `update`. */
  time: number;
  /** Current phase; the director refreshes it on transitions. */
  phase: MatchPhase;
  announce(text: string, detail: string, kind: ObituaryToast["kind"]): void;
}

export interface MatchResult {
  modeId: GameModeId;
  /** Winning team, or null for a draw / a free-for-all. */
  winner: Team | null;
  draw: boolean;
  /** Winning individual (free-for-all). */
  winnerId: EntityId | null;
  winnerName: string;
  scoreBlue: number;
  scoreRed: number;
  reason: "score-limit" | "time-limit" | "round-limit" | "aborted";
  durationSec: number;
  playerWon: boolean;
  playerPlacement: number;
  playerKills: number;
  playerDeaths: number;
  playerScore: number;
  xpEarned: number;
  rows: readonly ScoreRow[];
}

export interface GameMode {
  readonly id: GameModeId;
  readonly name: string;
  readonly description: string;
  /** Score that ends the match. */
  readonly scoreLimit: number;
  /** Match clock in seconds; `0` means the mode drives its own clock. */
  readonly timeLimitSec: number;

  /** True when blue/red matter; false for free-for-all. */
  readonly teamBased: boolean;
  /** False for round modes that revive at the round boundary instead. */
  readonly respawns: boolean;
  /** Whether a tie at the final whistle goes to sudden death. */
  readonly allowsOvertime: boolean;

  onStart(ctx: ModeContext): void;
  update(dt: number): void;
  onKill(report: KillReport): void;
  onDamage(event: DamageEvent): void;
  /** A spawn for this actor, or `null` when everything is compromised. */
  getSpawn(actor: Actor): SpawnPoint | null;
  getHudState(): ModeHudState;
  isOver(): boolean;
  getResult(): MatchResult;
  /** Told about every phase change, including its own overtime. */
  onPhase(phase: MatchPhase): void;
}

/* ------------------------------------------------------------------ */
/* Base implementation                                                 */
/* ------------------------------------------------------------------ */

/**
 * Shared plumbing every mode wants: team scores, the HUD object, spawn
 * queries and a sensible default result. Concrete modes override the parts
 * that make them different.
 */
export abstract class BaseMode implements GameMode {
  abstract readonly id: GameModeId;
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly scoreLimit: number;
  abstract readonly timeLimitSec: number;

  readonly teamBased: boolean = true;
  readonly respawns: boolean = true;
  readonly allowsOvertime: boolean = true;

  protected ctx: ModeContext | null = null;
  protected hud: ModeHudState = createModeHudState("tdm", "", 0, true);
  protected readonly score: Record<Team, number> = { blue: 0, red: 0 };
  protected endReason: MatchResult["reason"] = "time-limit";
  protected finished = false;

  onStart(ctx: ModeContext): void {
    this.ctx = ctx;
    this.score.blue = 0;
    this.score.red = 0;
    this.finished = false;
    this.hud = createModeHudState(this.id, this.name, this.scoreLimit, this.teamBased);
    this.hud.timeRemaining = this.timeLimitSec;
  }

  update(_dt: number): void {
    this.refreshHud();
  }

  onKill(_report: KillReport): void {}

  onDamage(_event: DamageEvent): void {}

  onPhase(phase: MatchPhase): void {
    this.hud.phase = phase;
  }

  getHudState(): ModeHudState {
    return this.hud;
  }

  isOver(): boolean {
    if (this.finished) return true;
    return this.score.blue >= this.scoreLimit || this.score.red >= this.scoreLimit;
  }

  /* ---------------------------------------------------------------- */
  /* Spawning                                                          */
  /* ---------------------------------------------------------------- */

  /** Modes override this to bias the search; the base is a plain team spawn. */
  protected spawnQuery(actor: Actor): SpawnQuery {
    return {
      actor,
      time: this.ctx?.time ?? game.time,
      ffa: !this.teamBased,
      preferSide: this.teamBased ? homeSideFor(actor.team) : null,
    };
  }

  getSpawn(actor: Actor): SpawnPoint | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    return ctx.spawns.select(this.spawnQuery(actor));
  }

  /* ---------------------------------------------------------------- */
  /* Scoring helpers                                                   */
  /* ---------------------------------------------------------------- */

  protected addScore(team: Team, amount: number): void {
    this.score[team] = Math.max(0, this.score[team] + amount);
  }

  protected refreshHud(): void {
    this.hud.scoreBlue = this.score.blue;
    this.hud.scoreRed = this.score.red;
    const player = game.player;
    this.hud.playerScore = player.score;
    if (!this.teamBased) {
      let leader: Actor | null = null;
      let placement = 1;
      for (const actor of game.actors) {
        if (!leader || actor.score > leader.score) leader = actor;
        if (actor.id !== player.id && actor.score > player.score) placement += 1;
      }
      this.hud.leaderName = leader?.name ?? "";
      this.hud.leaderScore = leader?.score ?? 0;
      this.hud.playerPlacement = placement;
    }
    const ctx = this.ctx;
    if (ctx) {
      this.hud.uavBlue = ctx.killstreaks.isUavActive("blue");
      this.hud.uavRed = ctx.killstreaks.isUavActive("red");
    }
  }

  /* ---------------------------------------------------------------- */
  /* Result                                                            */
  /* ---------------------------------------------------------------- */

  getResult(): MatchResult {
    const rows = buildScoreRows();
    const player = game.player;
    let winner: Team | null = null;
    let draw = false;
    let winnerId: EntityId | null = null;
    let winnerName = "";

    if (this.teamBased) {
      if (this.score.blue > this.score.red) winner = "blue";
      else if (this.score.red > this.score.blue) winner = "red";
      else draw = true;
      winnerName = winner ? (winner === "blue" ? "Blue Team" : "Red Team") : "Draw";
    } else {
      const top = rows[0];
      if (top) {
        winnerId = top.id;
        winnerName = top.name;
      }
      draw = false;
    }

    let placement = 1;
    for (const row of rows) {
      if (row.id === player.id) break;
      placement += 1;
    }

    const playerWon = this.teamBased
      ? winner === player.team
      : winnerId === player.id;

    return {
      modeId: this.id,
      winner,
      draw,
      winnerId,
      winnerName,
      scoreBlue: this.score.blue,
      scoreRed: this.score.red,
      reason: this.endReason,
      durationSec: this.ctx?.time ?? game.time,
      playerWon,
      playerPlacement: Math.min(placement, rows.length || 1),
      playerKills: player.kills,
      playerDeaths: player.deaths,
      playerScore: player.score,
      xpEarned: this.ctx?.scoring.matchXp ?? 0,
      rows,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

/** Which half of the compound a team calls home by default. */
export function homeSideFor(team: Team): "north" | "south" {
  return team === "blue" ? "north" : "south";
}

/** Count the live bodies of each team inside a radius of a point. */
export function countOccupants(
  x: number,
  z: number,
  radius: number,
  out: { blue: number; red: number },
): { blue: number; red: number } {
  out.blue = 0;
  out.red = 0;
  const r2 = radius * radius;
  for (const actor of game.actors) {
    if (!actor.alive) continue;
    const dx = actor.position.x - x;
    const dz = actor.position.z - z;
    if (dx * dx + dz * dz > r2) continue;
    if (actor.team === "blue") out.blue += 1;
    else out.red += 1;
  }
  return out;
}

/** Actors inside a radius, appended to `out`. */
export function actorsInRadius(
  x: number,
  z: number,
  radius: number,
  out: Actor[],
): Actor[] {
  out.length = 0;
  const r2 = radius * radius;
  for (const actor of game.actors) {
    if (!actor.alive) continue;
    const dx = actor.position.x - x;
    const dz = actor.position.z - z;
    if (dx * dx + dz * dz <= r2) out.push(actor);
  }
  return out;
}

/** Deterministic fake ping so the scoreboard looks alive. */
function pingFor(actor: Actor): number {
  return actor.isPlayer ? 12 : 18 + (actor.seed % 74);
}

export function buildScoreRows(): ScoreRow[] {
  const rows: ScoreRow[] = game.actors.map((actor) => ({
    id: actor.id,
    name: actor.name,
    team: actor.team,
    kills: actor.kills,
    deaths: actor.deaths,
    assists: actor.assists,
    score: actor.score,
    streak: actor.streak,
    isPlayer: actor.isPlayer,
    alive: actor.alive,
    ping: pingFor(actor),
  }));
  rows.sort(
    (a, b) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths || a.id - b.id,
  );
  return rows;
}

/* ------------------------------------------------------------------ */
/* Match director                                                      */
/* ------------------------------------------------------------------ */

export interface MatchDirectorOptions {
  mode: GameMode;
  world: CollisionWorld;
  /** Defaults to `useGameStore.getState().matchSeed`. */
  seed?: number;
  warmupSec?: number;
  /** Sudden-death budget when a timed match ends level. */
  overtimeSec?: number;
  /** Seconds on the post-match scoreboard before the results screen. */
  postSec?: number;
  vfx?: KillstreakVfxPort;
  /** Set false in headless tests that must not touch the results screen. */
  navigateOnEnd?: boolean;
  onEnd?: (result: MatchResult) => void;
}

/** Scoreboard sync cadence, in seconds. 4 Hz, per AGENTS.md. */
const SCOREBOARD_SYNC_SEC = 0.25;

export class MatchDirector {
  readonly mode: GameMode;
  readonly spawns: SpawnSelector;
  readonly scoring: ScoringSystem;
  readonly killstreaks: KillstreakManager;
  readonly seed: number;

  phase: MatchPhase = "warmup";
  /** Seconds elapsed since the match went live. */
  matchTime = 0;
  /** Seconds remaining in the current timed phase. */
  timeRemaining = 0;

  private readonly world: CollisionWorld;
  private readonly ctx: ModeContext;
  private readonly warmupSec: number;
  private readonly overtimeSec: number;
  private readonly postSec: number;
  private readonly navigateOnEnd: boolean;
  private readonly onEnd: ((result: MatchResult) => void) | null;

  private syncAccum = 0;
  private postTimer = 0;
  private started = false;
  private result: MatchResult | null = null;
  private lastWarningBucket = -1;

  constructor(options: MatchDirectorOptions) {
    this.mode = options.mode;
    this.world = options.world;
    this.seed = (options.seed ?? useGameStore.getState().matchSeed) >>> 0;
    this.warmupSec = options.warmupSec ?? 8;
    this.overtimeSec = options.overtimeSec ?? 120;
    this.postSec = options.postSec ?? 6;
    this.navigateOnEnd = options.navigateOnEnd !== false;
    this.onEnd = options.onEnd ?? null;

    this.spawns = new SpawnSelector(this.world, this.seed);
    this.scoring = new ScoringSystem();
    this.killstreaks = new KillstreakManager({
      vfx: options.vfx ?? NULL_KILLSTREAK_VFX,
      world: this.world,
      seed: this.seed,
      scoring: this.scoring,
    });

    const rng = mulberry32((this.seed ^ 0x5f356495) >>> 0);
    const director = this;
    this.ctx = {
      world: this.world,
      spawns: this.spawns,
      scoring: this.scoring,
      killstreaks: this.killstreaks,
      rng,
      seed: this.seed,
      time: 0,
      phase: "warmup",
      announce(text, detail, kind) {
        useGameStore.getState().pushToast({ text, detail, kind, time: director.ctx.time });
      },
    };
  }

  /* ---------------------------------------------------------------- */
  /* Lifecycle                                                         */
  /* ---------------------------------------------------------------- */

  start(): void {
    this.started = true;
    this.result = null;
    this.matchTime = 0;
    this.postTimer = 0;
    this.syncAccum = 0;
    this.lastWarningBucket = -1;
    this.scoring.reset();
    this.killstreaks.reset();
    this.spawns.reset();

    this.ctx.time = game.time;
    this.mode.onStart(this.ctx);
    publishModeHud(this.mode.getHudState());

    this.setPhase("warmup");
    this.timeRemaining = this.warmupSec;
    this.spawnEveryone();
    this.syncScoreboard();
  }

  private setPhase(phase: MatchPhase): void {
    if (this.phase === phase && this.started) return;
    this.phase = phase;
    this.ctx.phase = phase;
    this.mode.onPhase(phase);
    useGameStore.getState().setPhase(phase);
  }

  /** Put every actor on a legal spawn, ignoring respawn timers. */
  spawnEveryone(): void {
    for (const actor of game.actors) {
      const spawn = this.mode.getSpawn(actor);
      if (!spawn) continue;
      respawnActorSafe(actor, spawn.position, spawn.yaw);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Damage observation                                                */
  /* ---------------------------------------------------------------- */

  /**
   * Forward the pending damage queue to the mode. Must be called *before*
   * `resolveDamage`, which drains the queue.
   */
  observeDamage(): void {
    if (this.phase === "warmup" || this.phase === "post") return;
    for (const event of game.damageQueue) this.mode.onDamage(event);
  }

  /* ---------------------------------------------------------------- */
  /* Frame                                                             */
  /* ---------------------------------------------------------------- */

  update(dt: number, kills: readonly KillReport[]): void {
    if (!this.started) return;
    this.ctx.time = game.time;
    this.scoring.setTime(game.time);

    switch (this.phase) {
      case "warmup":
        this.updateWarmup(dt, kills);
        break;
      case "live":
      case "overtime":
        this.updateLive(dt, kills);
        break;
      case "post":
        this.updatePost(dt);
        break;
    }

    this.mirrorHud();
    this.syncAccum += dt;
    if (this.syncAccum >= SCOREBOARD_SYNC_SEC) {
      this.syncAccum = 0;
      this.syncScoreboard();
    }
  }

  private updateWarmup(dt: number, kills: readonly KillReport[]): void {
    // Warmup kills feed the killfeed but never the scoreboard.
    for (const kill of kills) {
      this.pushKillfeed(kill);
      this.spawns.noteDeath(kill.victim.position, game.time);
    }
    this.killstreaks.update(dt, game.time);
    this.mode.update(dt);
    this.handleRespawns();

    this.timeRemaining -= dt;
    if (this.timeRemaining > 0) return;

    // Go live with a clean slate.
    for (const actor of game.actors) {
      actor.kills = 0;
      actor.deaths = 0;
      actor.assists = 0;
      actor.score = 0;
      actor.streak = 0;
    }
    this.scoring.reset();
    this.killstreaks.reset();
    this.spawns.reset();
    this.matchTime = 0;
    this.timeRemaining = this.mode.timeLimitSec;
    this.setPhase("live");
    this.ctx.announce("Match Start", this.mode.name, "objective");
  }

  private updateLive(dt: number, kills: readonly KillReport[]): void {
    this.matchTime += dt;

    for (const kill of kills) {
      this.pushKillfeed(kill);
      this.spawns.noteDeath(kill.victim.position, game.time);
      this.killstreaks.onDeath(kill.victim);
      this.scoring.onKill(kill);
      if (kill.attacker && kill.attacker.team !== kill.victim.team) {
        this.killstreaks.onKill(kill.attacker);
      }
      this.mode.onKill(kill);
    }

    this.mode.update(dt);
    this.killstreaks.update(dt, game.time);
    this.handleRespawns();

    if (this.mode.isOver()) {
      this.end("score-limit");
      return;
    }

    if (this.mode.timeLimitSec > 0) {
      this.timeRemaining -= dt;
      this.announceClock();
      if (this.timeRemaining <= 0) {
        const hud = this.mode.getHudState();
        const tied = hud.scoreBlue === hud.scoreRed;
        if (this.phase === "live" && tied && this.mode.allowsOvertime) {
          this.timeRemaining = this.overtimeSec;
          this.setPhase("overtime");
          this.ctx.announce("Overtime", "Next score wins", "objective");
          return;
        }
        this.end("time-limit");
      }
    } else {
      // Mode-driven clock (rounds); mirror whatever it publishes.
      this.timeRemaining = this.mode.getHudState().roundTimeRemaining;
    }
  }

  private updatePost(dt: number): void {
    this.postTimer -= dt;
    if (this.postTimer > 0) return;
    if (this.navigateOnEnd && useGameStore.getState().screen === "playing") {
      useGameStore.getState().setScreen("results");
    }
  }

  private announceClock(): void {
    const bucket =
      this.timeRemaining <= 10 ? 0 : this.timeRemaining <= 30 ? 1 : this.timeRemaining <= 60 ? 2 : -1;
    if (bucket === this.lastWarningBucket || bucket < 0) return;
    this.lastWarningBucket = bucket;
    const seconds = bucket === 0 ? 10 : bucket === 1 ? 30 : 60;
    this.ctx.announce(`${seconds} seconds`, this.mode.name, "objective");
  }

  /* ---------------------------------------------------------------- */
  /* Respawns                                                          */
  /* ---------------------------------------------------------------- */

  private handleRespawns(): void {
    if (!this.mode.respawns) return;
    for (const actor of game.actors) {
      if (actor.alive || actor.respawnTimer > 0) continue;
      const spawn = this.mode.getSpawn(actor);
      // `null` means every candidate is compromised right now. Leaving the
      // actor dead for another tick is strictly better than a bad spawn.
      if (!spawn) continue;
      respawnActorSafe(actor, spawn.position, spawn.yaw);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Store sync                                                        */
  /* ---------------------------------------------------------------- */

  private pushKillfeed(kill: KillReport): void {
    useGameStore.getState().pushKillfeed({
      attacker: kill.attacker?.name ?? "—",
      attackerTeam: kill.attacker?.team ?? kill.victim.team,
      victim: kill.victim.name,
      victimTeam: kill.victim.team,
      weapon: kill.weaponId,
      headshot: kill.headshot,
      penetrated: kill.penetrated,
      time: game.time,
    });
  }

  private syncScoreboard(): void {
    useGameStore.getState().setScoreboard(buildScoreRows());
  }

  /** Copy the mode's numbers into the per-frame HUD singleton. */
  private mirrorHud(): void {
    const hud = this.mode.getHudState();
    hud.phase = this.phase;
    hud.timeRemaining = Math.max(0, this.timeRemaining);
    publishModeHud(hud);

    game.hud.scoreBlue = hud.teamBased ? hud.scoreBlue : game.player.score;
    game.hud.scoreRed = hud.teamBased ? hud.scoreRed : hud.leaderScore;
    game.hud.timeRemaining = hud.timeRemaining;
    game.hud.streakProgress = this.killstreaks.streakProgress(game.player);
  }

  /* ---------------------------------------------------------------- */
  /* End of match                                                      */
  /* ---------------------------------------------------------------- */

  private end(reason: MatchResult["reason"]): void {
    if (this.result) return;
    this.setPhase("post");
    const result = this.mode.getResult();
    result.reason = reason;
    result.durationSec = this.matchTime;
    const award = this.scoring.finishMatch(result.playerWon);
    result.xpEarned = this.scoring.matchXp;
    this.result = result;
    this.postTimer = this.postSec;
    this.syncScoreboard();
    this.ctx.announce(
      result.playerWon ? "Victory" : result.draw ? "Draw" : "Defeat",
      `${result.winnerName} · +${award.xp} XP`,
      "objective",
    );
    this.onEnd?.(result);
  }

  /** Abort the match early (menu quit); still books the result. */
  abort(): void {
    if (this.result) return;
    this.end("aborted");
  }

  getResult(): MatchResult | null {
    return this.result;
  }

  isOver(): boolean {
    return this.result !== null;
  }

  /* ---------------------------------------------------------------- */
  /* Player actions                                                    */
  /* ---------------------------------------------------------------- */

  /** Wire the killstreak keys (1/2/3) through here. */
  activateKillstreak(index: number): boolean {
    if (this.phase === "post") return false;
    return this.killstreaks.activateSlot(game.player, index);
  }

  /** Objectives a mode wants the spawn system and the minimap to know about. */
  objectives(): readonly SpawnObjective[] {
    const hud = this.mode.getHudState();
    return hud.objectives.map((objective) => ({
      position: new THREE.Vector3(objective.x, 0, objective.z),
      weight: objective.active ? 1 : 0.4,
    }));
  }
}
