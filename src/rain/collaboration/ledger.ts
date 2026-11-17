/**
 * The collaboration journal and the claim ledger.
 *
 * Every message between seats is one `agent-event/v1` record (system
 * `rain-lab`), hash-chained by `prev`, in a closed vocabulary. The claim
 * ledger is derived from those messages and the runs they cite, never
 * written around them:
 *
 * - a claim's standing comes from admitted evidence and open challenges,
 *   never from agreement or a count of voices;
 * - any seat may challenge any claim at any time, including a supported one;
 * - only a run (evidence) resolves a challenge; a challenge with no run stays
 *   open and the claim stays `contested`;
 * - a revision supersedes a claim with an explicit parent; nothing is deleted.
 */
import { checkEventChain, seal } from "../interop/contract.js";

export const MESSAGE_KINDS = [
  "episode.opened",
  "message.hypothesis",
  "message.design",
  "message.challenge",
  "message.falsification",
  "message.replication",
  "message.verification",
  "message.revision",
  "message.concession",
  "run.recorded",
  "claim.standing",
  "episode.closed",
] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];
export type Generation = "model" | "scripted" | "person" | "host";

export interface CollabEvent {
  schema: "agent-event/v1";
  system: "rain-lab";
  seq: number;
  at: string;
  actor: string;
  kind: MessageKind;
  task_id: string | null;
  generation: Generation;
  data: Record<string, unknown>;
  prev: string | null;
  sha256: string;
}

export class CollabJournal {
  readonly events: CollabEvent[] = [];
  readonly episodeId: string;
  private readonly clock: () => string;
  constructor(episodeId: string, clock: () => string) {
    this.episodeId = episodeId;
    this.clock = clock;
  }

  append(
    actor: string,
    kind: MessageKind,
    generation: Generation,
    data: Record<string, unknown>,
  ): CollabEvent {
    const event = seal({
      schema: "agent-event/v1" as const,
      system: "rain-lab" as const,
      seq: this.events.length + 1,
      at: this.clock(),
      actor,
      kind,
      task_id: this.episodeId,
      generation,
      data,
      prev: this.events.at(-1)?.sha256 ?? null,
    });
    this.events.push(event);
    return event;
  }

  head(): string {
    const last = this.events.at(-1);
    if (!last) throw new Error("empty journal");
    return last.sha256;
  }

  verify(): string[] {
    return checkEventChain(this.events);
  }
}

export type Standing =
  "proposed" | "supported" | "refuted" | "contested" | "insufficient" | "superseded";

export interface Claim {
  claim_id: string;
  statement: string;
  author: string;
  generation: Generation;
  supersedes: string | null;
  superseded_by: string | null;
  /** Runs that bear on the claim and how the preregistered criteria judged them for it. */
  evidence: Array<{ run_id: string; bears: "supports" | "refutes" | "insufficient" }>;
}

export interface Challenge {
  challenge_id: string;
  by: string;
  target_claim_id: string;
  text: string;
  generation: Generation;
  resolution: "open" | "upheld" | "rejected";
  resolved_by_run: string | null;
}

export class ClaimLedger {
  readonly claims = new Map<string, Claim>();
  readonly challenges = new Map<string, Challenge>();

  propose(
    c: Omit<Claim, "superseded_by" | "evidence" | "supersedes"> & {
      supersedes?: string | null;
    },
  ): Claim {
    if (this.claims.has(c.claim_id)) throw new Error(`claim ${c.claim_id} exists`);
    if (c.supersedes) {
      const parent = this.claims.get(c.supersedes);
      if (!parent) throw new Error(`revision names unknown claim ${c.supersedes}`);
      if (parent.superseded_by) throw new Error(`${c.supersedes} was already revised`);
      parent.superseded_by = c.claim_id;
    }
    const claim: Claim = {
      ...c,
      supersedes: c.supersedes ?? null,
      superseded_by: null,
      evidence: [],
    };
    this.claims.set(claim.claim_id, claim);
    return claim;
  }

  challenge(ch: Omit<Challenge, "resolution" | "resolved_by_run">): Challenge {
    if (!this.claims.has(ch.target_claim_id))
      throw new Error(`challenge targets unknown claim ${ch.target_claim_id}`);
    const challenge: Challenge = { ...ch, resolution: "open", resolved_by_run: null };
    this.challenges.set(challenge.challenge_id, challenge);
    return challenge;
  }

  /** Attaches a run's bearing, as the preregistered criteria judged it. */
  cite(claimId: string, runId: string, bears: Claim["evidence"][number]["bears"]): void {
    const claim = this.claims.get(claimId);
    if (!claim) throw new Error(`unknown claim ${claimId}`);
    claim.evidence.push({ run_id: runId, bears });
  }

  /** Only evidence resolves a challenge. */
  resolve(challengeId: string, resolution: "upheld" | "rejected", runId: string): void {
    const ch = this.challenges.get(challengeId);
    if (!ch) throw new Error(`unknown challenge ${challengeId}`);
    if (!runId) throw new Error("a challenge is resolved only by a run");
    ch.resolution = resolution;
    ch.resolved_by_run = runId;
  }

  openChallenges(claimId: string): number {
    return [...this.challenges.values()].filter(
      (c) => c.target_claim_id === claimId && c.resolution === "open",
    ).length;
  }

  standing(claimId: string): Standing {
    const claim = this.claims.get(claimId);
    if (!claim) throw new Error(`unknown claim ${claimId}`);
    if (claim.superseded_by) return "superseded";
    if (this.openChallenges(claimId) > 0) return "contested";
    if (!claim.evidence.length) return "proposed";
    // The most recent admitted bearing decides; earlier runs stay cited.
    const last = claim.evidence.at(-1)!.bears;
    return last === "supports"
      ? "supported"
      : last === "refutes"
        ? "refuted"
        : "insufficient";
  }
}
