/**
 * R.A.I.N.'s session artifact (`rain-session-artifact/v1`): the replayable
 * record of one model meeting, turn by turn, with every verified quotation's
 * source and span. A port of `utilities/session_artifact.py` and the grounded
 * response envelope of `utilities/truth_layer.py` (james_library, MIT).
 *
 * The lab's meeting record names an artifact by its session id and the
 * SHA-256 of its text, so the text is produced here, once, and kept with the
 * job (and written to `RAIN_MEETING_ARCHIVE_DIR` when that is configured).
 *
 * Shared with the server: imports nothing.
 */

export const SESSION_ARTIFACT_SCHEMA = "rain-session-artifact/v1" as const;

export interface ArtifactEvidence {
  source: string;
  quote: string;
  span_start: number | null;
  span_end: number | null;
}
export interface GroundedResponse {
  answer: string;
  confidence: number;
  provenance: string[];
  evidence: ArtifactEvidence[];
  repro_steps: string[];
  grounded: boolean;
  red_badge: boolean;
}
export interface TurnMetadataIn {
  verified?: [string, string][];
  unverified?: string[];
  verified_spans?: {
    quote: string;
    source: string;
    span_start: number;
    span_end: number;
  }[];
  citation_rate?: number;
  citation_success?: boolean;
  require_quotes?: boolean;
  recovery?: { action: string; reason: string };
}
export interface ArtifactTurn {
  index: number;
  timestamp: string;
  agent: string;
  content: string;
  metadata: {
    verified_count: number;
    unverified_count: number;
    citation_rate: number;
    citation_success?: boolean;
    require_quotes?: boolean;
    recovery?: { action: string; reason: string };
  };
  grounded_response: GroundedResponse;
}
export type ArtifactStatus = "in_progress" | "completed" | "interrupted";
export interface SessionArtifact {
  schema_version: typeof SESSION_ARTIFACT_SCHEMA;
  session_id: string;
  status: ArtifactStatus;
  topic: string;
  model: string;
  recursive_depth: number;
  started_at: string;
  completed_at: string;
  library_path: string;
  log_path: string;
  loaded_papers_count: number;
  loaded_papers: string[];
  corpus_files: { path: string; sha256: string }[];
  metrics: Record<string, unknown>;
  summary: string;
  turns: ArtifactTurn[];
  judgments: unknown[];
  decisions: unknown[];
}

/** `%Y-%m-%dT%H:%M:%SZ`, as R.A.I.N. stamps its artifacts. */
export const artifactTime = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, "Z");

/** Grounding-first envelope: evidence and provenance, or a red badge. */
export function buildGroundedResponse(input: {
  answer: string;
  confidence: number;
  provenance: string[];
  evidence: ArtifactEvidence[];
  reproSteps: string[];
}): GroundedResponse {
  const bounded = Math.max(0.0, Math.min(1.0, input.confidence));
  const redBadge = input.evidence.length === 0 || input.provenance.length === 0;
  return {
    answer: input.answer,
    confidence: bounded,
    provenance: input.provenance,
    evidence: input.evidence,
    repro_steps: input.reproSteps,
    grounded: !redBadge,
    red_badge: redBadge,
  };
}

function confidenceFromMetadata(metadata: TurnMetadataIn): number {
  const verified = metadata.verified?.length ?? 0;
  const unverified = metadata.unverified?.length ?? 0;
  const total = verified + unverified;
  if (total <= 0) return 0.2;
  return Number(Math.max(0.2, Math.min(0.95, verified / total)).toFixed(2));
}

export interface SessionArtifactInput {
  sessionId: string;
  topic: string;
  model: string;
  recursiveDepth: number;
  libraryPath: string;
  logPath: string;
  loadedPapers: string[];
  corpusFiles: { path: string; sha256: string }[];
  now?: () => Date;
}

export class SessionArtifactWriter {
  readonly sessionId: string;
  readonly startedAt: string;
  private readonly turns: ArtifactTurn[] = [];
  private readonly now: () => Date;
  private readonly input: SessionArtifactInput;
  constructor(input: SessionArtifactInput) {
    this.input = input;
    this.sessionId = input.sessionId;
    this.now = input.now ?? (() => new Date());
    this.startedAt = artifactTime(this.now());
  }

  recordTurn(agentName: string, content: string, metadata: TurnMetadataIn = {}): void {
    const spans = new Map<string, { start: number | null; end: number | null }>();
    for (const item of metadata.verified_spans ?? [])
      spans.set(`${item.quote}\0${item.source}`, {
        start: item.span_start,
        end: item.span_end,
      });
    const provenance: string[] = [];
    const evidence: ArtifactEvidence[] = [];
    for (const [quote, source] of metadata.verified ?? []) {
      if (!provenance.includes(source)) provenance.push(source);
      const span = spans.get(`${quote}\0${source}`);
      evidence.push({
        source,
        quote,
        span_start: span?.start ?? null,
        span_end: span?.end ?? null,
      });
    }
    const turnMetadata: ArtifactTurn["metadata"] = {
      verified_count: metadata.verified?.length ?? 0,
      unverified_count: metadata.unverified?.length ?? 0,
      citation_rate: metadata.citation_rate ?? 0.0,
    };
    if (metadata.citation_success !== undefined)
      turnMetadata.citation_success = Boolean(metadata.citation_success);
    if (metadata.require_quotes !== undefined)
      turnMetadata.require_quotes = Boolean(metadata.require_quotes);
    if (metadata.recovery) turnMetadata.recovery = { ...metadata.recovery };
    this.turns.push({
      index: this.turns.length + 1,
      timestamp: artifactTime(this.now()),
      agent: agentName,
      content,
      metadata: turnMetadata,
      grounded_response: buildGroundedResponse({
        answer: content,
        confidence: confidenceFromMetadata(metadata),
        provenance,
        evidence,
        reproSteps: [
          `Load the paper corpus from ${this.input.libraryPath}`,
          `Review the transcript in ${this.input.logPath}`,
        ],
      }),
    });
  }

  payload(
    status: ArtifactStatus,
    metrics: Record<string, unknown> = {},
    summary = "",
  ): SessionArtifact {
    return {
      schema_version: SESSION_ARTIFACT_SCHEMA,
      session_id: this.sessionId,
      status,
      topic: this.input.topic,
      model: this.input.model,
      recursive_depth: this.input.recursiveDepth,
      started_at: this.startedAt,
      completed_at: status !== "in_progress" ? artifactTime(this.now()) : "",
      library_path: this.input.libraryPath,
      log_path: this.input.logPath,
      loaded_papers_count: this.input.loadedPapers.length,
      loaded_papers: [...this.input.loadedPapers],
      corpus_files: this.input.corpusFiles.map((f) => ({ ...f })),
      metrics,
      summary,
      turns: this.turns.map((t) => structuredClone(t)),
      judgments: [],
      decisions: [],
    };
  }

  /** The finished artifact and its text, exactly as it would be written to disk. */
  finalize(
    status: Exclude<ArtifactStatus, "in_progress">,
    metrics: Record<string, unknown> = {},
    summary = "",
  ) {
    const artifact = this.payload(status, metrics, summary);
    return { artifact, text: JSON.stringify(artifact, null, 2) };
  }
}
