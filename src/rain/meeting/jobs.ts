/**
 * Model meetings as jobs the lab checks on: one at a time, started by a
 * request, reported as pending with the turns begun so far, then as the
 * meeting record or the reason there is none; stoppable from the lab.
 *
 * A port of the bridge's `ModelMeetings` (lop-nur-twin's own, 2026), now
 * holding the meeting in-process instead of running R.A.I.N.'s script as a
 * subprocess. A job id is a 128-bit capability returned only to the request
 * that started the meeting. Finished jobs are kept fifteen minutes for the
 * lab to collect, then purged; a new meeting is refused while one runs.
 *
 * Server only.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CorpusDocument } from "../corpus.js";
import { Refused } from "../errors.js";
import {
  MeetingFailed,
  modelMeetingRecord,
  type MeetingRecord,
  type Revision,
} from "./record.js";
import {
  ModelUnavailable,
  holdMeeting,
  type MeetingHooks,
  type ModelMeetingSettings,
} from "./model.js";

export const KEEP_FINISHED_MS = 15 * 60 * 1000;
const MAX_JOBS = 8;
const SCHEMA = "rain-bethesda/v2" as const;

export interface MeetingPending {
  schema: typeof SCHEMA;
  kind: "meeting-pending";
  request_id: string;
  job_id: string;
  question: string;
  model: string;
  started_at: string;
  elapsed_s: number;
  turns_started: number;
  turns_planned: number;
}
export interface MeetingFailedAnswer {
  schema: typeof SCHEMA;
  kind: "meeting-failed";
  request_id: string;
  job_id: string;
  reason: string;
}

interface Job {
  id: string;
  requestId: string;
  question: string;
  state: "running" | "done" | "failed";
  started: number;
  startedAt: string;
  ended: number | null;
  turnsStarted: number;
  record: MeetingRecord | null;
  reason: string | null;
  abort: AbortController;
  cancelled: boolean;
}

export interface ModelMeetingsOptions {
  settings: ModelMeetingSettings;
  /** Minutes an unfinished meeting may run before it is stopped. */
  timeoutMinutes: number;
  documents: readonly CorpusDocument[];
  revision: () => Revision;
  /** Where each meeting's session artifact is written, when configured. */
  archiveDir?: string | null;
  hooks?: Omit<MeetingHooks, "signal" | "onTurnStart" | "sessionId">;
  now?: () => Date;
  monotonic?: () => number;
  randomHex?: (bytes: number) => string;
}

const hex = (bytes: number) =>
  [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

export class ModelMeetings {
  readonly model: string;
  private readonly jobs = new Map<string, Job>();
  private readonly now: () => Date;
  private readonly monotonic: () => number;
  private readonly randomHex: (bytes: number) => string;
  private readonly options: ModelMeetingsOptions;
  constructor(options: ModelMeetingsOptions) {
    this.options = options;
    this.model = options.settings.model;
    this.now = options.now ?? (() => new Date());
    this.monotonic = options.monotonic ?? (() => performance.now());
    this.randomHex = options.randomHex ?? hex;
  }

  /** Start a meeting; refused while one runs. The answer is the pending job. */
  start(question: string, requestId: string): MeetingPending {
    this.purge();
    if ([...this.jobs.values()].some((j) => j.state === "running"))
      throw new Refused(
        422,
        "R.A.I.N. is already holding a meeting; wait for it or stop it",
      );
    const revision = this.options.revision();
    const job: Job = {
      id: this.randomHex(16),
      requestId,
      question,
      state: "running",
      started: this.monotonic(),
      startedAt: this.now().toISOString(),
      ended: null,
      turnsStarted: 0,
      record: null,
      reason: null,
      abort: new AbortController(),
      cancelled: false,
    };
    this.jobs.set(job.id, job);
    void this.run(job, revision);
    return this.pending(job);
  }

  status(
    jobId: string,
    requestId: string,
  ): MeetingPending | MeetingRecord | MeetingFailedAnswer {
    const job = this.jobs.get(jobId);
    if (!job || job.requestId !== requestId) throw new Refused(422, "no such meeting");
    if (job.state === "running") return this.pending(job);
    if (job.state === "done") return job.record!;
    return this.failed(job);
  }

  cancel(jobId: string, requestId: string): MeetingFailedAnswer {
    const job = this.jobs.get(jobId);
    if (!job || job.requestId !== requestId) throw new Refused(422, "no such meeting");
    if (job.state === "running") {
      job.cancelled = true;
      job.abort.abort();
      job.state = "failed";
      job.reason = "stopped at the lab's request";
      job.ended = this.monotonic();
    }
    return this.failed(job);
  }

  /** Whether any meeting is running: the runtime refuses to stop while one does, in tests. */
  get running(): boolean {
    return [...this.jobs.values()].some((j) => j.state === "running");
  }

  private pending(job: Job): MeetingPending {
    return {
      schema: SCHEMA,
      kind: "meeting-pending",
      request_id: job.requestId,
      job_id: job.id,
      question: job.question,
      model: this.model,
      started_at: job.startedAt,
      elapsed_s: Math.round(((this.monotonic() - job.started) / 1000) * 10) / 10,
      turns_started: Math.min(job.turnsStarted, 32),
      turns_planned: this.options.settings.maxTurns,
    };
  }
  private failed(job: Job): MeetingFailedAnswer {
    return {
      schema: SCHEMA,
      kind: "meeting-failed",
      request_id: job.requestId,
      job_id: job.id,
      reason: (job.reason ?? "the meeting ended without a record").slice(0, 300),
    };
  }
  private purge(): void {
    const now = this.monotonic();
    for (const [key, job] of [...this.jobs])
      if (job.ended !== null && now - job.ended > KEEP_FINISHED_MS) this.jobs.delete(key);
    while (this.jobs.size > MAX_JOBS) {
      const finished = [...this.jobs.values()].filter((j) => j.state !== "running");
      if (!finished.length) break;
      const oldest = finished.reduce((a, b) => (a.started <= b.started ? a : b));
      this.jobs.delete(oldest.id);
    }
  }

  private async run(job: Job, revision: Revision): Promise<void> {
    const timer = setTimeout(
      () => {
        if (job.state === "running") {
          job.abort.abort();
          job.reason = `R.A.I.N.'s meeting did not finish in ${this.options.timeoutMinutes} minutes`;
        }
      },
      this.options.timeoutMinutes * 60 * 1000,
    );
    try {
      const held = await holdMeeting(
        job.question,
        this.options.documents,
        this.options.settings,
        {
          ...this.options.hooks,
          signal: job.abort.signal,
          onTurnStart: (turn) => {
            job.turnsStarted = turn;
          },
        },
      );
      this.archive(held.artifact.session_id, held.text);
      if (job.cancelled) return;
      if (held.cancelled)
        throw new MeetingFailed(job.reason ?? "the meeting was stopped before it ended");
      try {
        job.record = modelMeetingRecord({
          artifact: held.artifact,
          artifactText: held.text,
          question: job.question,
          requestId: job.requestId,
          revision,
          documents: this.options.documents,
          modelStopped: held.modelStopped,
        });
      } catch (error) {
        if (!(error instanceof MeetingFailed) || !held.modelStopped) throw error;
        throw new MeetingFailed(
          `${error.message}: check that ${this.options.settings.baseUrl} is serving ${this.options.settings.model}, and that the model's context length is at least 16,384 tokens`,
        );
      }
      job.state = "done";
    } catch (error) {
      if (job.cancelled) return;
      job.state = "failed";
      if (error instanceof MeetingFailed || error instanceof ModelUnavailable)
        job.reason = job.reason ?? error.message;
      else job.reason = job.reason ?? "the runtime could not hold the meeting";
    } finally {
      clearTimeout(timer);
      if (job.ended === null) job.ended = this.monotonic();
    }
  }

  private archive(sessionId: string, text: string): void {
    const dir = this.options.archiveDir;
    if (!dir) return;
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `session_${sessionId}.json`), text, {
        encoding: "utf8",
        flag: "wx",
      });
    } catch {
      /* an archive that cannot be written loses nothing the record does not carry by hash */
    }
  }
}
