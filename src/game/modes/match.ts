import {
  OPPOSING_TEAM,
  type GameModeId,
  type MatchPhase,
  type Team,
} from "../core/types";
import { game, type Actor } from "../core/gameState";
import type { KillReport } from "../core/combat";
import { COMBAT, respawnActor } from "../core/combat";

/**
 * Match flow: the clock, the score, respawns and the win condition.
 *
 * Deliberately small. The modes here differ only in what scores a point and
 * what ends the match, so they are described by data rather than by five
 * classes — which also means the HUD reads one shape no matter what is being
 * played.
 */

export interface ModeRules {
  id: GameModeId;
  name: string;
  /** Points that end the match, or 0 for time-only. */
  scoreLimit: number;
  timeLimitSec: number;
  /** True when every player is hostile to every other. */
  freeForAll: boolean;
  /** Seconds before a dead actor returns. */
  respawnDelay: number;
}

export const MODE_RULES: Readonly<Record<GameModeId, ModeRules>> = {
  tdm: {
    id: "tdm",
    name: "Team Deathmatch",
    scoreLimit: 75,
    timeLimitSec: 600,
    freeForAll: false,
    respawnDelay: 5,
  },
  ffa: {
    id: "ffa",
    name: "Free-for-All",
    scoreLimit: 30,
    timeLimitSec: 600,
    freeForAll: true,
    respawnDelay: 5,
  },
  domination: {
    id: "domination",
    name: "Domination",
    scoreLimit: 200,
    timeLimitSec: 900,
    freeForAll: false,
    respawnDelay: 6,
  },
  hardpoint: {
    id: "hardpoint",
    name: "Hardpoint",
    scoreLimit: 250,
    timeLimitSec: 900,
    freeForAll: false,
    respawnDelay: 6,
  },
  gunfight: {
    id: "gunfight",
    name: "Gunfight",
    scoreLimit: 6,
    timeLimitSec: 40,
    freeForAll: false,
    respawnDelay: 0,
  },
};

export interface MatchResult {
  winner: Team | "draw";
  scoreBlue: number;
  scoreRed: number;
  playerKills: number;
  playerDeaths: number;
  reason: "score" | "time";
}

export type SpawnRequest = (
  actor: Actor,
) => { position: [number, number, number]; yaw: number } | null;

export class MatchDirector {
  readonly rules: ModeRules;
  phase: MatchPhase = "warmup";
  timeRemaining: number;
  scoreBlue = 0;
  scoreRed = 0;
  private result: MatchResult | null = null;
  private warmup = 3;
  /** Supplied by the scene, so spawning stays the mode layer's business. */
  requestSpawn: SpawnRequest | null = null;
  /** Fired once when the match ends. */
  onEnd: ((result: MatchResult) => void) | null = null;

  constructor(mode: GameModeId) {
    this.rules = MODE_RULES[mode];
    this.timeRemaining = this.rules.timeLimitSec;
  }

  /** Award the score for a kill and check for a win. */
  onKill(report: KillReport): void {
    if (this.phase !== "live") return;
    const attacker = report.attacker;
    if (!attacker) return;
    if (!this.rules.freeForAll && attacker.team === report.victim.team) return;
    if (this.rules.freeForAll) {
      // In a free-for-all the "team" scores track the player against the field.
      if (attacker.isPlayer) this.scoreBlue += 1;
      else this.scoreRed = Math.max(this.scoreRed, attacker.kills);
    } else if (attacker.team === "blue") {
      this.scoreBlue += 1;
    } else {
      this.scoreRed += 1;
    }
  }

  update(dt: number): void {
    if (this.phase === "post") return;

    if (this.phase === "warmup") {
      this.warmup -= dt;
      if (this.warmup <= 0) this.phase = "live";
      this.publish();
      return;
    }

    this.timeRemaining = Math.max(0, this.timeRemaining - dt);

    // Respawns. The player and the bots go through the same path so the rules
    // cannot drift apart between them.
    for (const actor of game.actors) {
      if (actor.alive) continue;
      if (this.rules.respawnDelay <= 0) continue;
      if (actor.respawnTimer > 0) continue;
      const spawn = this.requestSpawn?.(actor);
      if (!spawn) continue;
      respawnActor(
        actor,
        // `respawnActor` copies, so a plain object would not do here.
        Object.assign(actor.position.clone(), {
          x: spawn.position[0],
          y: spawn.position[1],
          z: spawn.position[2],
        }),
        spawn.yaw,
      );
    }

    const limit = this.rules.scoreLimit;
    if (limit > 0 && (this.scoreBlue >= limit || this.scoreRed >= limit)) {
      this.end("score");
    } else if (this.timeRemaining <= 0) {
      this.end("time");
    }

    this.publish();
  }

  private end(reason: "score" | "time"): void {
    if (this.phase === "post") return;
    this.phase = "post";
    const winner: Team | "draw" =
      this.scoreBlue === this.scoreRed
        ? "draw"
        : this.scoreBlue > this.scoreRed
          ? "blue"
          : "red";
    this.result = {
      winner,
      scoreBlue: this.scoreBlue,
      scoreRed: this.scoreRed,
      playerKills: game.player.kills,
      playerDeaths: game.player.deaths,
      reason,
    };
    this.publish();
    this.onEnd?.(this.result);
  }

  /** Push the numbers the HUD reads. */
  private publish(): void {
    const hud = game.hud;
    hud.scoreBlue = this.scoreBlue;
    hud.scoreRed = this.scoreRed;
    hud.timeRemaining =
      this.phase === "warmup" ? this.rules.timeLimitSec : this.timeRemaining;
  }

  getResult(): MatchResult | null {
    return this.result;
  }

  /** Live standings, for the scoreboard. */
  standings(): { team: Team; kills: number; deaths: number }[] {
    const rows: { team: Team; kills: number; deaths: number }[] = [];
    for (const team of ["blue", "red"] as Team[]) {
      let kills = 0;
      let deaths = 0;
      for (const actor of game.actors) {
        if (actor.team !== team) continue;
        kills += actor.kills;
        deaths += actor.deaths;
      }
      rows.push({ team, kills, deaths });
    }
    return rows;
  }

  reset(): void {
    this.phase = "warmup";
    this.warmup = 3;
    this.timeRemaining = this.rules.timeLimitSec;
    this.scoreBlue = 0;
    this.scoreRed = 0;
    this.result = null;
    this.publish();
  }
}

/** Convenience for the HUD: who is winning, for the accent colour. */
export function leadingTeam(director: MatchDirector): Team | null {
  if (director.scoreBlue === director.scoreRed) return null;
  return director.scoreBlue > director.scoreRed ? "blue" : OPPOSING_TEAM.blue;
}

export { COMBAT };
