/**
 * An episode, sealed as `rain-interop-evidence/v1` for the optional James
 * interface. Built only from the episode's ledger, journal and runs; the
 * standing of every claim is the ledger's, never re-judged here.
 */
import { seal } from "../interop/contract.js";
import type { EpisodeResult } from "./episode.js";
import {
  ASSUMPTION_PROTOCOL,
  ASSUMPTION_PROTOCOL_SHA256,
  EPISODE_ID,
} from "./episode.js";
import { rosterSha256 } from "./roster.js";

export const EVIDENCE_LIMITATIONS = [
  "Simulated evidence: a linear damped oscillator integrated by the lab's numerical backend, not a physical measurement.",
  "Every seat in this episode is a rule-based policy (scripted). No language model wrote these claims or challenges.",
  "The correction is textbook physics; the episode shows the lab's protocol catching and testing it, not a new discovery.",
  "Replication re-runs a deterministic simulator with perturbed numerics; it detects numerical sensitivity, not sampling variability.",
  "A digest shows a record is intact, not that it is true. The lab's authorizations here are scripted demonstration authorizations, not a person's review.",
];

export function episodeEvidence(result: EpisodeResult, labCommit: string | null) {
  const { ledger, journal } = result;
  const claims = [...ledger.claims.values()].map((c) => ({
    claim_id: c.claim_id,
    statement: c.statement,
    author: c.author,
    generation: c.generation,
    standing: ledger.standing(c.claim_id),
    evidence_run_ids: c.evidence.map((e) => e.run_id),
    open_challenges: ledger.openChallenges(c.claim_id),
    supersedes: c.supersedes,
  }));
  const challenges = [...ledger.challenges.values()].map((c) => ({ ...c }));
  return seal({
    schema: "rain-interop-evidence/v1" as const,
    episode_id: EPISODE_ID,
    title: ASSUMPTION_PROTOCOL.title,
    question:
      "Does driving at the undamped natural frequency maximize a damped oscillator's displacement, and does the lab's 10 s template window show where the response peaks?",
    outcome: result.outcome,
    claims,
    runs: result.runs,
    challenges,
    limitations: EVIDENCE_LIMITATIONS,
    provenance: {
      lab_commit: labCommit,
      protocol_sha256: ASSUMPTION_PROTOCOL_SHA256,
      journal_head_sha256: journal.head(),
      roster_sha256: rosterSha256(),
      evidence_class: "simulated" as const,
    },
  });
}
