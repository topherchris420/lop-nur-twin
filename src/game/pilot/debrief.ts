import type { EntityId } from "../core/types";

/**
 * The debrief: what the seat perceived, set against what actually happened.
 *
 * Every seat gets one — the human's included — and it is kept by the same
 * rules for all of them, which is the point. A kill/death ratio says who won;
 * it does not say whether a death was a failure to *see*, a failure to *act*
 * on what was seen, or an exchange that was simply lost. Those are different
 * failures for a person and for a model, and they call for different fixes.
 *
 * Two things are sampled a few times a second for every living enemy:
 *
 *  - **in view** — the rule perception uses for a brain's observation: inside
 *    the camera's field of view and within sight range, with a clear line
 *    from the eye to its head or chest. What the seat *could* perceive.
 *  - **exposed to it** — a clear line from that enemy's eye to the seat's
 *    chest within sight range, whichever way either is facing. What the
 *    ground *allowed*: the seat stood where that enemy could have seen it.
 *
 * And a few events: a round fired while an enemy was near the crosshair (the
 * seat *engaged* it), a kill, a death with its killer. From those each death
 * is classed once, when it happens:
 *
 *  - `unseen` — the killer was never in view during that life;
 *  - `seen_not_engaged` — it was in view, and no round was fired at it;
 *  - `engaged` — the seat fired at it and lost the exchange;
 *  - `other` — no living attacker (a fall, a weapon with no owner).
 *
 * This is after-action analysis. It is computed from the authoritative
 * simulation — that is what "actually happened" means — and it is never fed
 * back into an observation: a brain learns nothing from it during a match.
 * It is also fiction about fiction; nothing here is evidence about the real
 * site, and nothing is written to the analytical ledger.
 *
 * Pure bookkeeping: no three.js, no game state. `pilot.ts` does the sampling.
 */

export const DEATH_CLASSES = ["unseen", "seen_not_engaged", "engaged", "other"] as const;
export type DeathClass = (typeof DEATH_CLASSES)[number];

export const DEATH_CLASS_TEXT: Readonly<Record<DeathClass, string>> = {
  unseen: "never seen",
  seen_not_engaged: "seen, not engaged",
  engaged: "engaged, exchange lost",
  other: "no attacker",
};

export interface EnemySample {
  id: EntityId;
  inView: boolean;
  exposedTo: boolean;
}

export interface DeathRecord {
  /** Simulation seconds. */
  time: number;
  killer: string | null;
  cls: DeathClass;
  rangeM: number | null;
  /** Seconds the killer had been in view this life; 0 when never. */
  seenForS: number;
  /** Seconds this life the seat stood in the killer's sight line. */
  exposedToKillerS: number;
  /** No cover within reach: nothing stood within 10 m at waist height. */
  openGround: boolean;
  /** Nearest named ground zone, for saying where. */
  place: string | null;
}

export interface KillRecord {
  time: number;
  rangeM: number | null;
  /** Seconds from first sight this life to the kill; null if never in view. */
  sightToKillS: number | null;
}

export interface DebriefSummary {
  aliveSeconds: number;
  /** Seconds alive with at least one living enemy holding a sight line. */
  exposedSeconds: number;
  exposedFraction: number | null;
  /** Longest unbroken stretch in some enemy's sight line. */
  longestExposedS: number;
  /** Seconds alive with at least one enemy in view. */
  seeingSeconds: number;
  deaths: Record<DeathClass, number> & { total: number; onOpenGround: number };
  kills: {
    total: number;
    meanSightToKillS: number | null;
    /** Kills of an enemy that was never in view: through walls, or blind fire. */
    unseenVictims: number;
  };
  /** The last few deaths, newest last. */
  recentDeaths: DeathRecord[];
}

interface EnemyLife {
  firstSeen: number | null;
  seenS: number;
  exposedS: number;
  engaged: boolean;
}

const RECENT = 8;

export class Debrief {
  private lifeEnemies = new Map<EntityId, EnemyLife>();
  private aliveSeconds = 0;
  private exposedSeconds = 0;
  private seeingSeconds = 0;
  private runExposed = 0;
  private longestExposed = 0;
  private deaths: DeathRecord[] = [];
  private kills: KillRecord[] = [];

  reset(): void {
    this.lifeEnemies.clear();
    this.aliveSeconds = 0;
    this.exposedSeconds = 0;
    this.seeingSeconds = 0;
    this.runExposed = 0;
    this.longestExposed = 0;
    this.deaths = [];
    this.kills = [];
  }

  private enemy(id: EntityId): EnemyLife {
    let life = this.lifeEnemies.get(id);
    if (!life) {
      life = { firstSeen: null, seenS: 0, exposedS: 0, engaged: false };
      this.lifeEnemies.set(id, life);
    }
    return life;
  }

  /**
   * One sample, covering `dt` seconds of a living seat. Enemies not listed
   * were dead or out of range; they contribute nothing for that span.
   */
  sample(time: number, dt: number, enemies: readonly EnemySample[]): void {
    this.aliveSeconds += dt;
    let exposed = false;
    let seeing = false;
    for (const sample of enemies) {
      const life = this.enemy(sample.id);
      if (sample.inView) {
        seeing = true;
        life.seenS += dt;
        if (life.firstSeen === null) life.firstSeen = time;
      }
      if (sample.exposedTo) {
        exposed = true;
        life.exposedS += dt;
      }
    }
    if (seeing) this.seeingSeconds += dt;
    if (exposed) {
      this.exposedSeconds += dt;
      this.runExposed += dt;
      this.longestExposed = Math.max(this.longestExposed, this.runExposed);
    } else {
      this.runExposed = 0;
    }
  }

  /** A round left the seat's weapon with this enemy nearest the crosshair. */
  onEngaged(id: EntityId): void {
    this.enemy(id).engaged = true;
  }

  onKill(time: number, victim: EntityId, rangeM: number | null): void {
    const life = this.lifeEnemies.get(victim);
    const firstSeen = life?.firstSeen ?? null;
    this.kills.push({
      time,
      rangeM,
      sightToKillS: firstSeen === null ? null : Math.max(0, time - firstSeen),
    });
    // A new body will come back with the same id; its sightings start over.
    this.lifeEnemies.delete(victim);
  }

  onDeath(
    time: number,
    killer: { id: EntityId; name: string } | null,
    detail: { rangeM: number | null; openGround: boolean; place: string | null },
  ): DeathRecord {
    const life = killer ? this.lifeEnemies.get(killer.id) : undefined;
    const seenForS = life?.seenS ?? 0;
    const cls: DeathClass = !killer
      ? "other"
      : !life || life.firstSeen === null
        ? "unseen"
        : life.engaged
          ? "engaged"
          : "seen_not_engaged";
    const record: DeathRecord = {
      time,
      killer: killer?.name ?? null,
      cls,
      rangeM: detail.rangeM,
      seenForS,
      exposedToKillerS: life?.exposedS ?? 0,
      openGround: detail.openGround,
      place: detail.place,
    };
    this.deaths.push(record);
    this.lifeEnemies.clear();
    this.runExposed = 0;
    return record;
  }

  summary(): DebriefSummary {
    const deaths = {
      total: this.deaths.length,
      onOpenGround: this.deaths.filter((d) => d.openGround).length,
      unseen: 0,
      seen_not_engaged: 0,
      engaged: 0,
      other: 0,
    };
    for (const death of this.deaths) deaths[death.cls] += 1;
    const timed = this.kills
      .map((k) => k.sightToKillS)
      .filter((s): s is number => s !== null);
    return {
      aliveSeconds: this.aliveSeconds,
      exposedSeconds: this.exposedSeconds,
      exposedFraction:
        this.aliveSeconds > 0 ? this.exposedSeconds / this.aliveSeconds : null,
      longestExposedS: this.longestExposed,
      seeingSeconds: this.seeingSeconds,
      deaths,
      kills: {
        total: this.kills.length,
        meanSightToKillS:
          timed.length > 0 ? timed.reduce((a, b) => a + b, 0) / timed.length : null,
        unseenVictims: this.kills.length - timed.length,
      },
      recentDeaths: this.deaths.slice(-RECENT),
    };
  }
}

/** Pool several episodes' debriefs: sums, and a kill-weighted mean. */
export function mergeDebriefs(parts: readonly DebriefSummary[]): DebriefSummary {
  const out = new Debrief().summary();
  let timedKills = 0;
  let timedSum = 0;
  for (const part of parts) {
    out.aliveSeconds += part.aliveSeconds;
    out.exposedSeconds += part.exposedSeconds;
    out.seeingSeconds += part.seeingSeconds;
    out.longestExposedS = Math.max(out.longestExposedS, part.longestExposedS);
    for (const key of ["total", "onOpenGround", ...DEATH_CLASSES] as const) {
      out.deaths[key] += part.deaths[key];
    }
    out.kills.total += part.kills.total;
    out.kills.unseenVictims += part.kills.unseenVictims;
    const timed = part.kills.total - part.kills.unseenVictims;
    if (part.kills.meanSightToKillS !== null && timed > 0) {
      timedKills += timed;
      timedSum += part.kills.meanSightToKillS * timed;
    }
    out.recentDeaths = [...out.recentDeaths, ...part.recentDeaths].slice(-RECENT);
  }
  out.exposedFraction =
    out.aliveSeconds > 0 ? out.exposedSeconds / out.aliveSeconds : null;
  out.kills.meanSightToKillS = timedKills > 0 ? timedSum / timedKills : null;
  return out;
}
