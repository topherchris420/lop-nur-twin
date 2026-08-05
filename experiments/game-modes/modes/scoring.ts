import { tryGetWeapon } from "../weapons/arsenal";
import { game, type Actor } from "../core/gameState";
import { useGameStore } from "../core/gameStore";
import type { KillReport } from "../core/combat";
import type { EntityId, Team } from "../core/types";

/**
 * Score, medals and progression.
 *
 * Three layers sit on top of each other:
 *
 *   1. **Score events** — the per-action numbers that drive the scoreboard and
 *      the killstreak meter. One table, `SCORE_EVENTS`, is the only place a
 *      number lives.
 *   2. **Medals** — pattern detection over those events (multi-kills, revenge,
 *      buzzkill, objective play). Medals are announced as toasts and counted
 *      in the player's profile.
 *   3. **Progression** — account XP → level, plus per-weapon XP → attachment
 *      unlocks, persisted to `localStorage`. Persistence is wrapped so a
 *      private-mode / disabled-storage browser degrades to an in-memory
 *      profile instead of throwing on the first kill.
 *
 * Only the local player earns XP; every actor earns score, because the
 * scoreboard has to be honest about the bots.
 */

/* ------------------------------------------------------------------ */
/* Score events                                                        */
/* ------------------------------------------------------------------ */

export type ScoreEventId =
  | "kill"
  | "assist"
  | "headshot"
  | "longshot"
  | "point-blank"
  | "penetration-kill"
  | "first-blood"
  | "revenge"
  | "payback"
  | "buzzkill"
  | "comeback"
  | "double-kill"
  | "triple-kill"
  | "quad-kill"
  | "chain-kill"
  | "frenzy-kill"
  | "merciless-kill"
  | "capture"
  | "assault"
  | "defend"
  | "neutralise"
  | "hold"
  | "objective-kill"
  | "round-win"
  | "streak-milestone"
  | "killstreak-kill"
  | "match-win"
  | "match-loss";

export interface ScoreEventDef {
  readonly id: ScoreEventId;
  readonly label: string;
  /** Added to `Actor.score` and the killstreak meter. */
  readonly score: number;
  /** Added to account XP (local player only). */
  readonly xp: number;
  /** Announce as a medal toast when it fires. */
  readonly medal: boolean;
}

function ev(
  id: ScoreEventId,
  label: string,
  score: number,
  xp: number,
  medal = false,
): ScoreEventDef {
  return { id, label, score, xp, medal };
}

export const SCORE_EVENTS: Readonly<Record<ScoreEventId, ScoreEventDef>> = {
  kill: ev("kill", "Kill", 100, 100),
  assist: ev("assist", "Assist", 50, 50),
  headshot: ev("headshot", "Headshot", 50, 50, true),
  longshot: ev("longshot", "Longshot", 50, 50, true),
  "point-blank": ev("point-blank", "Point Blank", 25, 25, true),
  "penetration-kill": ev("penetration-kill", "Penetration Kill", 50, 50, true),
  "first-blood": ev("first-blood", "First Blood", 100, 150, true),
  revenge: ev("revenge", "Revenge", 50, 75, true),
  payback: ev("payback", "Payback", 50, 75, true),
  buzzkill: ev("buzzkill", "Buzzkill", 75, 100, true),
  comeback: ev("comeback", "Comeback", 50, 75, true),
  "double-kill": ev("double-kill", "Double Kill", 50, 100, true),
  "triple-kill": ev("triple-kill", "Triple Kill", 100, 200, true),
  "quad-kill": ev("quad-kill", "Quad Kill", 150, 300, true),
  "chain-kill": ev("chain-kill", "Chain Kill", 200, 400, true),
  "frenzy-kill": ev("frenzy-kill", "Frenzy Kill", 250, 500, true),
  "merciless-kill": ev("merciless-kill", "Merciless Kill", 300, 600, true),
  capture: ev("capture", "Capture", 200, 200, true),
  assault: ev("assault", "Assault", 50, 50),
  defend: ev("defend", "Defend", 100, 100, true),
  neutralise: ev("neutralise", "Neutralised", 100, 100, true),
  hold: ev("hold", "Hardpoint Hold", 25, 25),
  "objective-kill": ev("objective-kill", "Objective Kill", 50, 50),
  "round-win": ev("round-win", "Round Win", 250, 250, true),
  "streak-milestone": ev("streak-milestone", "Killstreak", 0, 0, true),
  "killstreak-kill": ev("killstreak-kill", "Killstreak Kill", 100, 100),
  "match-win": ev("match-win", "Victory", 0, 750, true),
  "match-loss": ev("match-loss", "Defeat", 0, 250),
};

/** Streak milestones that pay a bonus and announce themselves. */
export const STREAK_MILESTONES: readonly { streak: number; label: string; score: number }[] = [
  { streak: 3, label: "Triple Threat", score: 75 },
  { streak: 5, label: "Rampage", score: 150 },
  { streak: 7, label: "Unstoppable", score: 250 },
  { streak: 10, label: "Untouchable", score: 400 },
  { streak: 15, label: "Godlike", score: 750 },
];

/** Multi-kill ladder, indexed by (count - 2). */
const MULTI_KILL_EVENTS: readonly ScoreEventId[] = [
  "double-kill",
  "triple-kill",
  "quad-kill",
  "chain-kill",
  "frenzy-kill",
  "merciless-kill",
];

/** Seconds between kills that still counts as the same multi-kill. */
export const MULTI_KILL_WINDOW_SEC = 4;
/** Seconds a teammate's death still counts as something to avenge. */
export const PAYBACK_WINDOW_SEC = 6;
/** Streak an enemy must be on for the kill to count as a buzzkill. */
export const BUZZKILL_STREAK = 5;
/** Deaths without a kill before the next kill is a comeback. */
export const COMEBACK_DEATHS = 4;

/** Longshot distance threshold, in metres, by weapon class. */
function longshotRange(weaponId: string): number {
  const def = tryGetWeapon(weaponId);
  switch (def?.weaponClass) {
    case "sniper":
    case "marksman":
      return 110;
    case "lmg":
      return 70;
    case "assault":
      return 55;
    case "smg":
    case "shotgun":
      return 32;
    case "pistol":
      return 30;
    default:
      return 48;
  }
}

/* ------------------------------------------------------------------ */
/* Progression storage                                                 */
/* ------------------------------------------------------------------ */

export const PROGRESSION_STORAGE_KEY = "lopnur.fps.progression.v1";
export const MAX_LEVEL = 55;

export interface WeaponProgress {
  xp: number;
  kills: number;
  headshots: number;
  /** Attachment ids unlocked so far, in unlock order. */
  unlocked: string[];
}

export interface Progression {
  version: 1;
  xp: number;
  level: number;
  prestige: number;
  weapons: Record<string, WeaponProgress>;
  medals: Record<string, number>;
  matches: number;
  wins: number;
  kills: number;
  deaths: number;
  score: number;
  /** Epoch millis of the last write; useful for "welcome back" copy. */
  updated: number;
}

export interface AttachmentUnlock {
  readonly id: string;
  readonly name: string;
  readonly slot:
    | "optic"
    | "muzzle"
    | "barrel"
    | "underbarrel"
    | "magazine"
    | "stock"
    | "laser"
    | "rear-grip";
  /** Weapon XP required. */
  readonly xp: number;
}

/**
 * One shared unlock ladder. Every weapon walks the same thresholds, which is
 * how the genre does it — the variety comes from the weapon, not the order.
 */
export const ATTACHMENT_TRACK: readonly AttachmentUnlock[] = [
  { id: "reflex", name: "Reflex Sight", slot: "optic", xp: 600 },
  { id: "vertical-grip", name: "Vertical Grip", slot: "underbarrel", xp: 1500 },
  { id: "flash-hider", name: "Flash Hider", slot: "muzzle", xp: 2800 },
  { id: "extended-mag", name: "Extended Magazine", slot: "magazine", xp: 4500 },
  { id: "tac-laser", name: "Tac Laser", slot: "laser", xp: 6600 },
  { id: "heavy-stock", name: "Heavy Stock", slot: "stock", xp: 9200 },
  { id: "long-barrel", name: "Long Barrel", slot: "barrel", xp: 12400 },
  { id: "suppressor", name: "Monolithic Suppressor", slot: "muzzle", xp: 16500 },
  { id: "hybrid-optic", name: "Hybrid Optic", slot: "optic", xp: 21000 },
  { id: "commando-grip", name: "Commando Foregrip", slot: "rear-grip", xp: 26000 },
];

/** Cumulative account XP required to *reach* a level. */
export function xpForLevel(level: number): number {
  const n = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level))) - 1;
  // Gentle quadratic: level 2 at 1.4k, level 10 at ~20k, level 55 at ~430k.
  return Math.round(n * 1200 + n * n * 130);
}

export function levelForXp(xp: number): number {
  let level = 1;
  while (level < MAX_LEVEL && xp >= xpForLevel(level + 1)) level += 1;
  return level;
}

function emptyProgression(): Progression {
  return {
    version: 1,
    xp: 0,
    level: 1,
    prestige: 0,
    weapons: {},
    medals: {},
    matches: 0,
    wins: 0,
    kills: 0,
    deaths: 0,
    score: 0,
    updated: 0,
  };
}

/**
 * `localStorage` throws in Safari private mode, in sandboxed iframes and when
 * the quota is exhausted. Every access goes through these two helpers, and a
 * single failure permanently downgrades to memory so we do not throw once per
 * kill for the rest of the match.
 */
let storageUsable = true;

function readStorage(key: string): string | null {
  if (!storageUsable) return null;
  try {
    if (typeof localStorage === "undefined") {
      storageUsable = false;
      return null;
    }
    return localStorage.getItem(key);
  } catch {
    storageUsable = false;
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  if (!storageUsable) return;
  try {
    if (typeof localStorage === "undefined") {
      storageUsable = false;
      return;
    }
    localStorage.setItem(key, value);
  } catch {
    storageUsable = false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function parseProgression(raw: string): Progression {
  const base = emptyProgression();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return base;
  }
  if (!isRecord(parsed)) return base;
  base.xp = Math.max(0, num(parsed["xp"]));
  base.prestige = Math.max(0, num(parsed["prestige"]));
  base.matches = Math.max(0, num(parsed["matches"]));
  base.wins = Math.max(0, num(parsed["wins"]));
  base.kills = Math.max(0, num(parsed["kills"]));
  base.deaths = Math.max(0, num(parsed["deaths"]));
  base.score = Math.max(0, num(parsed["score"]));
  base.updated = Math.max(0, num(parsed["updated"]));
  base.level = levelForXp(base.xp);

  const weapons = parsed["weapons"];
  if (isRecord(weapons)) {
    for (const [id, value] of Object.entries(weapons)) {
      if (!isRecord(value)) continue;
      const unlockedRaw = value["unlocked"];
      base.weapons[id] = {
        xp: Math.max(0, num(value["xp"])),
        kills: Math.max(0, num(value["kills"])),
        headshots: Math.max(0, num(value["headshots"])),
        unlocked: Array.isArray(unlockedRaw)
          ? unlockedRaw.filter((entry): entry is string => typeof entry === "string")
          : [],
      };
    }
  }
  const medals = parsed["medals"];
  if (isRecord(medals)) {
    for (const [id, value] of Object.entries(medals)) {
      base.medals[id] = Math.max(0, num(value));
    }
  }
  return base;
}

let cached: Progression | null = null;

/** The player's persistent profile. Read it as often as you like; it is cached. */
export function getProgression(): Progression {
  if (cached) return cached;
  const raw = readStorage(PROGRESSION_STORAGE_KEY);
  cached = raw ? parseProgression(raw) : emptyProgression();
  return cached;
}

function persist(): void {
  if (!cached) return;
  cached.updated = Date.now();
  writeStorage(PROGRESSION_STORAGE_KEY, JSON.stringify(cached));
}

/** Wipe the profile — used by the settings screen and by tests. */
export function resetProgression(): void {
  cached = emptyProgression();
  persist();
}

/** True when the profile is memory-only because storage refused us. */
export function isProgressionPersisted(): boolean {
  return storageUsable;
}

export interface XpAward {
  xp: number;
  totalXp: number;
  level: number;
  leveledUp: boolean;
  /** Attachments that crossed their threshold on this award. */
  unlocked: readonly AttachmentUnlock[];
}

/**
 * Grant account XP (and, when a weapon is named, weapon XP). Returns what
 * changed so the caller can announce level-ups and unlocks.
 */
export function awardXp(
  amount: number,
  options: { weaponId?: string; reason?: string } = {},
): XpAward {
  const progression = getProgression();
  const gain = Math.max(0, Math.round(amount));
  const beforeLevel = progression.level;
  progression.xp += gain;
  progression.level = levelForXp(progression.xp);

  const unlocked: AttachmentUnlock[] = [];
  const weaponId = options.weaponId;
  if (weaponId && gain > 0) {
    let entry = progression.weapons[weaponId];
    if (!entry) {
      entry = { xp: 0, kills: 0, headshots: 0, unlocked: [] };
      progression.weapons[weaponId] = entry;
    }
    entry.xp += gain;
    for (const attachment of ATTACHMENT_TRACK) {
      if (entry.xp < attachment.xp) continue;
      if (entry.unlocked.includes(attachment.id)) continue;
      entry.unlocked.push(attachment.id);
      unlocked.push(attachment);
    }
  }

  persist();
  return {
    xp: gain,
    totalXp: progression.xp,
    level: progression.level,
    leveledUp: progression.level > beforeLevel,
    unlocked,
  };
}

/** Attachments already unlocked for a weapon. */
export function unlockedAttachments(weaponId: string): readonly string[] {
  return getProgression().weapons[weaponId]?.unlocked ?? [];
}

/** The next attachment this weapon is working toward, with progress 0..1. */
export function nextAttachment(
  weaponId: string,
): { attachment: AttachmentUnlock; progress: number } | null {
  const entry = getProgression().weapons[weaponId];
  const xp = entry?.xp ?? 0;
  for (const attachment of ATTACHMENT_TRACK) {
    if (xp >= attachment.xp) continue;
    const previous =
      ATTACHMENT_TRACK[ATTACHMENT_TRACK.indexOf(attachment) - 1]?.xp ?? 0;
    const span = Math.max(1, attachment.xp - previous);
    return { attachment, progress: Math.min(1, (xp - previous) / span) };
  }
  return null;
}

/** Record a weapon kill against the profile without granting XP twice. */
export function noteWeaponKill(weaponId: string, headshot: boolean): void {
  const progression = getProgression();
  let entry = progression.weapons[weaponId];
  if (!entry) {
    entry = { xp: 0, kills: 0, headshots: 0, unlocked: [] };
    progression.weapons[weaponId] = entry;
  }
  entry.kills += 1;
  if (headshot) entry.headshots += 1;
}

/* ------------------------------------------------------------------ */
/* Live match scoring                                                  */
/* ------------------------------------------------------------------ */

interface ActorScoreState {
  lastKillTime: number;
  multiKill: number;
  /** Who killed this actor most recently. */
  lastKillerId: EntityId | null;
  deathsSinceKill: number;
  headshotsThisLife: number;
  bestStreak: number;
}

interface RecentDeath {
  victimId: EntityId;
  victimTeam: Team;
  attackerId: EntityId;
  time: number;
}

export interface ScoreAward {
  readonly actor: Actor;
  readonly event: ScoreEventDef;
  readonly score: number;
  readonly label: string;
}

export interface KillScoreSummary {
  /** Total score added to the attacker for this kill. */
  score: number;
  events: ScoreEventId[];
  /** 1 for a normal kill, 2+ inside the multi-kill window. */
  multiKill: number;
  xp: number;
}

export interface ScoringHooks {
  /** Announce a medal. Defaults to a zustand toast. */
  announce?: (title: string, detail: string) => void;
}

/**
 * Per-match scoring. One instance lives on the `MatchDirector`; modes call
 * `objective()` for capture/defend/assault and the director calls `onKill()`.
 */
export class ScoringSystem {
  private readonly states = new Map<EntityId, ActorScoreState>();
  private readonly recentDeaths: RecentDeath[] = [];
  private firstBloodTaken = false;
  private time = 0;
  private readonly announce: (title: string, detail: string) => void;
  /** XP the local player banked this match, for the results screen. */
  matchXp = 0;

  constructor(hooks: ScoringHooks = {}) {
    this.announce =
      hooks.announce ??
      ((title, detail) => {
        useGameStore.getState().pushToast({
          text: title,
          detail,
          kind: "medal",
          time: game.time,
        });
      });
  }

  reset(): void {
    this.states.clear();
    this.recentDeaths.length = 0;
    this.firstBloodTaken = false;
    this.matchXp = 0;
    this.time = 0;
  }

  setTime(time: number): void {
    this.time = time;
  }

  private state(id: EntityId): ActorScoreState {
    let entry = this.states.get(id);
    if (!entry) {
      entry = {
        lastKillTime: -99,
        multiKill: 0,
        lastKillerId: null,
        deathsSinceKill: 0,
        headshotsThisLife: 0,
        bestStreak: 0,
      };
      this.states.set(id, entry);
    }
    return entry;
  }

  /** Award a single event. Returns the score added. */
  award(actor: Actor, id: ScoreEventId, detail = ""): number {
    const def = SCORE_EVENTS[id];
    actor.score += def.score;
    if (actor.isPlayer) {
      if (def.xp > 0) {
        const result = awardXp(def.xp, { weaponId: actor.weaponId, reason: id });
        this.matchXp += def.xp;
        for (const unlock of result.unlocked) {
          this.announce("Unlocked", `${unlock.name} · ${unlock.slot}`);
        }
        if (result.leveledUp) {
          this.announce("Rank Up", `Level ${result.level}`);
        }
      }
      const profile = getProgression();
      profile.medals[id] = (profile.medals[id] ?? 0) + 1;
      if (def.medal) this.announce(def.label, detail || `+${def.score}`);
    }
    return def.score;
  }

  /** Award an arbitrary bonus (killstreak milestones, hold ticks). */
  awardRaw(actor: Actor, score: number, label: string, xp = score): number {
    actor.score += score;
    if (actor.isPlayer && xp > 0) {
      awardXp(xp, { weaponId: actor.weaponId, reason: label });
      this.matchXp += xp;
    }
    return score;
  }

  /** Objective play: capture / assault / defend / neutralise / hold. */
  objective(actor: Actor, id: ScoreEventId, detail = ""): number {
    return this.award(actor, id, detail);
  }

  /**
   * Score a resolved kill.
   *
   * `combat.ts` already pays a flat 100 (150 on a headshot) inside
   * `killActor`, before the mode layer ever sees the report. That is undone
   * here so `SCORE_EVENTS` stays the single source of truth for every number
   * on the scoreboard — see the note in the module header of `mode.ts`.
   */
  onKill(
    report: KillReport,
    options: { onObjective?: boolean; killstreakKill?: boolean } = {},
  ): KillScoreSummary {
    const summary: KillScoreSummary = { score: 0, events: [], multiKill: 1, xp: 0 };
    const victim = report.victim;
    const attacker = report.attacker;

    const victimState = this.state(victim.id);
    victimState.deathsSinceKill += 1;
    victimState.headshotsThisLife = 0;
    victimState.multiKill = 0;
    victimState.lastKillerId = attacker && attacker.id !== victim.id ? attacker.id : null;

    this.recentDeaths.push({
      victimId: victim.id,
      victimTeam: victim.team,
      attackerId: attacker?.id ?? victim.id,
      time: this.time,
    });
    if (this.recentDeaths.length > 32) this.recentDeaths.shift();

    for (const helper of report.assists) {
      summary.score += this.award(helper, "assist");
    }

    if (!attacker || attacker.id === victim.id || attacker.team === victim.team) {
      return summary;
    }

    // Undo `combat.ts`'s built-in award so the event table owns every number.
    attacker.score -= report.headshot ? 150 : 100;

    const state = this.state(attacker.id);
    const before = summary.score;

    summary.score += this.award(attacker, "kill");
    summary.events.push("kill");

    if (report.headshot) {
      summary.score += this.award(attacker, "headshot");
      summary.events.push("headshot");
      state.headshotsThisLife += 1;
    }
    if (report.penetrated) {
      summary.score += this.award(attacker, "penetration-kill");
      summary.events.push("penetration-kill");
    }
    if (report.distanceM >= longshotRange(report.weaponId)) {
      summary.score += this.award(attacker, "longshot", `${report.distanceM.toFixed(0)} m`);
      summary.events.push("longshot");
    } else if (report.distanceM <= 3.5) {
      summary.score += this.award(attacker, "point-blank");
      summary.events.push("point-blank");
    }
    if (!this.firstBloodTaken) {
      this.firstBloodTaken = true;
      summary.score += this.award(attacker, "first-blood");
      summary.events.push("first-blood");
    }
    if (state.lastKillerId === victim.id) {
      state.lastKillerId = null;
      summary.score += this.award(attacker, "revenge", victim.name);
      summary.events.push("revenge");
    } else if (this.avengedTeammate(attacker, victim)) {
      summary.score += this.award(attacker, "payback", victim.name);
      summary.events.push("payback");
    }
    if (victimState.bestStreak >= BUZZKILL_STREAK) {
      summary.score += this.award(attacker, "buzzkill", `${victimState.bestStreak} streak`);
      summary.events.push("buzzkill");
    }
    if (state.deathsSinceKill >= COMEBACK_DEATHS) {
      summary.score += this.award(attacker, "comeback");
      summary.events.push("comeback");
    }
    if (options.onObjective) {
      summary.score += this.award(attacker, "objective-kill");
      summary.events.push("objective-kill");
    }
    if (options.killstreakKill) {
      summary.score += this.award(attacker, "killstreak-kill");
      summary.events.push("killstreak-kill");
    }

    // Multi-kill window.
    state.multiKill =
      this.time - state.lastKillTime <= MULTI_KILL_WINDOW_SEC ? state.multiKill + 1 : 1;
    state.lastKillTime = this.time;
    state.deathsSinceKill = 0;
    summary.multiKill = state.multiKill;
    if (state.multiKill >= 2) {
      const index = Math.min(MULTI_KILL_EVENTS.length - 1, state.multiKill - 2);
      const id = MULTI_KILL_EVENTS[index]!;
      summary.score += this.award(attacker, id, `${state.multiKill} kills`);
      summary.events.push(id);
    }

    // Killstreak milestones.
    state.bestStreak = Math.max(state.bestStreak, attacker.streak);
    for (const milestone of STREAK_MILESTONES) {
      if (attacker.streak !== milestone.streak) continue;
      summary.score += this.awardRaw(attacker, milestone.score, milestone.label);
      summary.events.push("streak-milestone");
      if (attacker.isPlayer) this.announce(milestone.label, `${milestone.streak} kill streak`);
    }

    if (attacker.isPlayer) noteWeaponKill(report.weaponId, report.headshot);

    summary.xp = summary.score - before;
    return summary;
  }

  /** True when the victim recently killed one of the attacker's teammates. */
  private avengedTeammate(attacker: Actor, victim: Actor): boolean {
    for (let i = this.recentDeaths.length - 1; i >= 0; i -= 1) {
      const entry = this.recentDeaths[i]!;
      if (this.time - entry.time > PAYBACK_WINDOW_SEC) break;
      if (entry.attackerId !== victim.id) continue;
      if (entry.victimId === attacker.id) continue;
      if (entry.victimTeam !== attacker.team) continue;
      return true;
    }
    return false;
  }

  /** Roll the match into the persistent profile. */
  finishMatch(won: boolean): XpAward {
    const player = game.player;
    const profile = getProgression();
    profile.matches += 1;
    if (won) profile.wins += 1;
    profile.kills += player.kills;
    profile.deaths += player.deaths;
    profile.score += player.score;
    const def = SCORE_EVENTS[won ? "match-win" : "match-loss"];
    this.matchXp += def.xp;
    const award = awardXp(def.xp, { reason: won ? "match-win" : "match-loss" });
    if (def.medal) this.announce(def.label, `+${def.xp} XP`);
    return award;
  }
}
