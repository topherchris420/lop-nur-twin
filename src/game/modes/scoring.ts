import type { Actor } from "../core/gameState";
import type { KillReport } from "../core/combat";
import type { EntityId } from "../core/types";

export interface ScoreEvent {
  kind: string;
  label: string;
  points: number;
  detail?: string;
}

export const SCORE_VALUES = {
  kill: 100,
  headshotBonus: 50,
  longshotBonus: 25,
  penetrationBonus: 25,
  multiKillExtra: 25,
  revenge: 25,
  firstBlood: 100,
  assist: 50,
  capture: 150,
  defend: 75,
} as const;

export type Medal = "marksman" | "sharpshooter";

interface ActorScoreState {
  lastKillTime: number;
  multiKill: number;
  lastKillerId: EntityId | null;
  headshotsThisMatch: number;
  longshotsThisMatch: number;
}

export class ScoringEngine {
  private firstBloodTaken = false;
  private readonly states = new Map<EntityId, ActorScoreState>();

  private state(id: EntityId): ActorScoreState {
    let entry = this.states.get(id);
    if (!entry) {
      entry = {
        lastKillTime: -99,
        multiKill: 0,
        lastKillerId: null,
        headshotsThisMatch: 0,
        longshotsThisMatch: 0,
      };
      this.states.set(id, entry);
    }
    return entry;
  }

  reset(): void {
    this.states.clear();
    this.firstBloodTaken = false;
  }

  onKill(report: KillReport, time: number): ScoreEvent[] {
    const events: ScoreEvent[] = [];
    const victim = report.victim;
    const attacker = report.attacker;

    const victimState = this.state(victim.id);
    victimState.lastKillerId = attacker && attacker.id !== victim.id ? attacker.id : null;
    victimState.multiKill = 0;

    if (!attacker || attacker.id === victim.id || attacker.team === victim.team) {
      return events;
    }

    const attackerState = this.state(attacker.id);

    events.push({ kind: "kill", label: "Kill", points: SCORE_VALUES.kill });

    if (report.headshot) {
      events.push({ kind: "headshot", label: "Headshot Bonus", points: SCORE_VALUES.headshotBonus });
      attackerState.headshotsThisMatch += 1;
    }

    if (report.penetrated) {
      events.push({ kind: "penetration", label: "Penetration Bonus", points: SCORE_VALUES.penetrationBonus });
    }

    if (report.distanceM > 40) {
      events.push({ 
        kind: "longshot", 
        label: "Longshot Bonus", 
        points: SCORE_VALUES.longshotBonus, 
        detail: `${report.distanceM.toFixed(0)}m` 
      });
      attackerState.longshotsThisMatch += 1;
    }

    if (!this.firstBloodTaken) {
      this.firstBloodTaken = true;
      events.push({ kind: "first-blood", label: "First Blood", points: SCORE_VALUES.firstBlood });
    }

    if (attackerState.lastKillerId === victim.id) {
      attackerState.lastKillerId = null;
      events.push({ kind: "revenge", label: "Revenge", points: SCORE_VALUES.revenge, detail: victim.name });
    }

    if (time - attackerState.lastKillTime <= 4) {
      attackerState.multiKill += 1;
    } else {
      attackerState.multiKill = 1;
    }
    attackerState.lastKillTime = time;

    if (attackerState.multiKill >= 2) {
      const extra = attackerState.multiKill - 1;
      events.push({ 
        kind: "multi-kill", 
        label: "Multi-kill Bonus", 
        points: SCORE_VALUES.multiKillExtra * extra, 
        detail: `${attackerState.multiKill}x` 
      });
    }

    return events;
  }

  onAssist(_actor: Actor): ScoreEvent[] {
    return [{ kind: "assist", label: "Assist", points: SCORE_VALUES.assist }];
  }

  onObjective(kind: "capture" | "defend"): ScoreEvent[] {
    if (kind === "capture") {
      return [{ kind: "capture", label: "Objective Capture", points: SCORE_VALUES.capture }];
    } else {
      return [{ kind: "defend", label: "Objective Defend", points: SCORE_VALUES.defend }];
    }
  }

  getActorState(id: EntityId): Readonly<ActorScoreState> {
    return this.state(id);
  }
}

export function getMatchMedals(engine: ScoringEngine, actorId: EntityId = 0): Medal[] {
  const medals: Medal[] = [];
  const state = engine.getActorState(actorId);
  
  if (state.headshotsThisMatch >= 5) {
    medals.push("marksman");
  }
  if (state.longshotsThisMatch >= 3) {
    medals.push("sharpshooter");
  }

  return medals;
}
