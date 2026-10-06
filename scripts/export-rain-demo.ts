/**
 * Record the R.A.I.N. Lab's DEMO meeting with the research runtime's own engine.
 *
 * DEMO mode replays one prerecorded meeting. It is recorded here by running
 * the runtime's offline engine (`src/rain/meeting/offline.ts`) through the
 * same `offlineMeetingRecord` the LIVE route serves, so the fixture is what a
 * LIVE session returns for this question at this commit. Like the other
 * Bethesda importers it runs the repository's formatter before hashing,
 * writes a source manifest with the real recording time, and refuses a
 * checkout whose revision it cannot name or that has uncommitted changes.
 *
 *   node scripts/run-ts.mjs scripts/export-rain-demo.ts      (bun run rain:demo)
 *
 * The meeting id is a hash of the meeting's content, so re-recording the
 * same question over the same corpus with the same engine gives the same id.
 * The manifest keeps the first recording's lineage: it was made from
 * R.A.I.N.'s own engine in james_library through the reference bridge, and
 * the unchanged id is the evidence that this engine reproduces it word for
 * word. If the id ever changes, the engine or the corpus changed; this script
 * then refuses unless `--allow-new-meeting` says that was intended.
 *
 * Never hand-edit the fixture or its manifest; re-record instead. The build
 * (`scripts/validate-bethesda.ts`) fails when they disagree.
 */
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { corpusFingerprint, hashCorpusDocuments } from "../src/rain/corpus.ts";
import { buildOfflineMeeting } from "../src/rain/meeting/offline.ts";
import { offlineMeetingRecord } from "../src/rain/meeting/record.ts";
import { corpusDocuments, labRevision } from "../src/rain/runtime.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = join(REPO, "src", "bethesda", "rain", "fixtures");
const QUESTION =
  "What evidence would distinguish coordinated crowd behavior from coincidental local responses after a Metro closure?";
const allowNewMeeting = process.argv.includes("--allow-new-meeting");

function writeFormatted(path: string, value: unknown): string {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", "utf8");
  execFileSync(join(REPO, "node_modules", ".bin", "prettier"), ["--write", path], {
    stdio: "ignore",
  });
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

interface PreviousManifest {
  recordedAt?: string;
  recorder?: string;
  engine?: string;
  rain?: { repository?: string; commit?: string | null; dirty?: boolean | null };
  meetingId?: string;
  lineage?: Record<string, unknown>;
}

const revision = labRevision({}, REPO);
if (revision.commit === null || revision.dirty !== false) {
  console.error(
    "refusing to record: commit everything first, so the recording names a clean, committed revision",
  );
  process.exit(1);
}

const documents = corpusDocuments();
const rows = hashCorpusDocuments(documents);
const meeting = buildOfflineMeeting(QUESTION, documents);
const record = offlineMeetingRecord(
  meeting,
  documents,
  randomBytes(16).toString("hex"),
  revision,
  new Date().toISOString(),
);

const manifestPath = join(FIXTURES, "demo-source.json");
const previous: PreviousManifest | null = existsSync(manifestPath)
  ? (JSON.parse(readFileSync(manifestPath, "utf8")) as PreviousManifest)
  : null;
// The first recording's lineage is kept, never retyped: it comes from the
// manifest that recorded it, or from the lineage an earlier re-recording kept.
const lineage: Record<string, unknown> | null =
  previous?.lineage ??
  (previous
    ? {
        note: "First recorded from R.A.I.N.'s own offline engine in james_library through the reference bridge, before the research runtime was consolidated into this repository. The meeting id is a hash of the meeting's content, so the unchanged id is the evidence that this repository's engine reproduces that meeting word for word.",
        firstRecording: {
          recordedAt: previous.recordedAt ?? null,
          recorder: previous.recorder ?? null,
          engine: previous.engine ?? null,
          rain: previous.rain ?? null,
          meetingId: previous.meetingId ?? null,
        },
      }
    : null);
const firstId = (lineage?.firstRecording as { meetingId?: string } | undefined)
  ?.meetingId;
if (firstId && firstId !== record.meeting_id) {
  if (!allowNewMeeting) {
    console.error(
      `refusing to record: the engine produced ${record.meeting_id}, not the first recording's ${firstId}; ` +
        "the engine or the corpus changed. Re-run with --allow-new-meeting if that was intended.",
    );
    process.exit(1);
  }
  if (lineage) lineage.sameMeetingAsFirstRecording = false;
} else if (lineage && firstId) lineage.sameMeetingAsFirstRecording = true;

mkdirSync(FIXTURES, { recursive: true });
const meetingPath = join(FIXTURES, "demo-meeting.json");
const digest = writeFormatted(meetingPath, record);
const manifest = {
  schema: "rain-bethesda-demo-source/v1",
  recordedAt: record.produced_at,
  recorder:
    "scripts/export-rain-demo.ts (src/rain/meeting/offline.ts buildOfflineMeeting; src/rain/meeting/record.ts offlineMeetingRecord)",
  engine: record.engine,
  generation: record.generation,
  rain: revision,
  corpus: { files: rows.length, sha256: corpusFingerprint(rows) },
  question: QUESTION,
  meetingId: record.meeting_id,
  snapshotSha256: digest,
  license:
    "The corpus is MIT-licensed james_library material bundled in src/rain/data (see its LICENSE.md and source.json). Quotes are verbatim spans of its papers, kept with their source path, line and character offsets.",
  ...(lineage ? { lineage } : {}),
  notes: [
    "Prerecorded: DEMO replays this one meeting and runs no process.",
    "Scripted: the offline engine's reasoning text is scripted; its evidence is retrieved and every quote was re-verified with the runtime's verifyQuote (src/rain/corpus.ts).",
    "The experiment proposal shipped beside it (demo-proposal.json) was written by hand for the demo. No model and no R.A.I.N. process produced it.",
  ],
};
writeFormatted(manifestPath, manifest);
console.log(
  `recorded ${record.meeting_id} at ${revision.repository} ${revision.commit} -> ${meetingPath}`,
);
