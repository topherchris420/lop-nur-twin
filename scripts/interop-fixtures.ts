/**
 * Writes the golden fixtures and the manifest of `agent-interop/v1`
 * (`docs/interop/agent-interop-v1/`), using the lab's own canonical JSON.
 *
 *   node scripts/run-ts.mjs scripts/interop-fixtures.ts           # write
 *   node scripts/run-ts.mjs scripts/interop-fixtures.ts --check   # compare
 *
 * Every value here is a fixed example: no clock, no randomness, no network.
 * The James repository vendors the resulting directory byte for byte and its
 * Rust implementation must reproduce every canonical text and digest.
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { canonicalJson, sha256, sha256Bytes, sha256Json } from "../src/rain/sha256.ts";
import { checkEventChain, checkRecord, seal } from "../src/rain/interop/contract.ts";

const ROOT = join(import.meta.dirname, "..", "docs", "interop", "agent-interop-v1");
const check = process.argv.includes("--check");

const CANONICAL_CASES: Array<{ name: string; value: unknown }> = [
  { name: "integers", value: [0, 1, -1, 42, 9007199254740991, -9007199254740991] },
  { name: "negative zero", value: -0 },
  { name: "fractions", value: [0.1, 0.5, 1.5, -2.25, 3.141592653589793, 2.5e-5] },
  { name: "exponent boundaries", value: [1e21, 1e20, 1e-7, 1e-6, 1.5e-7, 123e-20] },
  {
    name: "large and tiny",
    value: [1.7976931348623157e308, 5e-324, 1.2345678901234568e20],
  },
  { name: "float that is an integer", value: [1.0, 100.0, 1e15, 1e16] },
  {
    name: "key order is UTF-16",
    value: { b: 1, a: 2, B: 3, "\u{e000}": 4, "😀": 5, é: 6, "": 7 },
  },
  {
    name: "string escapes",
    value:
      'quote" backslash\\ nl\n cr\r tab\t bs\b ff\f nul\u0000 unit\u001f del\u007f ls\u2028 ps\u2029 é 😀',
  },
  { name: "nesting", value: { z: [null, true, false, { y: [], x: {} }], a: "" } },
];

const AT = "2026-11-16T12:00:00Z";

function fixtures(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  out["canonical.json"] = {
    schema: "agent-interop-canonical-fixtures/v1",
    cases: CANONICAL_CASES.map(({ name, value }) => ({
      name,
      value,
      canonical: canonicalJson(value),
      sha256: sha256Json(value),
    })),
  };
  out["agent-identity.json"] = seal({
    schema: "agent-identity/v1",
    system: "james-desktop",
    agent_id: "coordinator",
    display_name: "Coordinator",
    role: "Plans the work, delegates and assembles the result",
    kind: "model-seat",
    capabilities: ["delegate", "draft", "remember", "review"],
    revision: 1,
    created_at: AT,
  });
  out["agent-task.json"] = seal({
    schema: "agent-task/v1",
    system: "james-desktop",
    task_id: "T-000002",
    parent_task_id: "T-000001",
    root_task_id: "T-000001",
    depth: 1,
    created_by: "coordinator",
    assignee: "researcher",
    objective: "List the files under docs/ and quote the lines about setup.",
    budget: {
      max_depth: 1,
      max_steps: 8,
      max_model_calls: 4,
      max_tokens: null,
      deadline: null,
    },
    state: "queued",
    created_at: AT,
  });
  const chain: Array<Record<string, unknown>> = [];
  const push = (body: Record<string, unknown>) => {
    const prev = chain.at(-1)?.sha256 ?? null;
    chain.push(
      seal({
        schema: "agent-event/v1",
        system: "rain-lab",
        seq: chain.length + 1,
        prev,
        ...body,
      }),
    );
  };
  push({
    at: AT,
    actor: "host",
    kind: "episode.opened",
    task_id: null,
    generation: "host",
    data: { episode: "E-fixture" },
  });
  push({
    at: AT,
    actor: "james",
    kind: "message.hypothesis",
    task_id: "E-fixture",
    generation: "scripted",
    data: { text: "Peak response at 1.0 rad/s.", ratio: 0.995 },
  });
  push({
    at: AT,
    actor: "jasmine",
    kind: "message.challenge",
    task_id: "E-fixture",
    generation: "scripted",
    data: { text: "The window includes the transient.", decay_time_s: 12.5 },
  });
  out["agent-event-chain.json"] = {
    schema: "agent-interop-event-chain/v1",
    events: chain,
  };
  const content = "The user prefers summaries under 200 words.";
  out["agent-memory.json"] = seal({
    schema: "agent-memory/v1",
    system: "james-desktop",
    memory_id: "M-000001",
    scope: { kind: "agent", agent_id: "writer" },
    content_sha256: sha256(content),
    content_bytes: new TextEncoder().encode(content).length,
    provenance: {
      author: "person",
      task_id: null,
      generation: "person",
      sources: [{ kind: "person", ref: "Team page", sha256: null }],
    },
    supersedes: null,
    created_at: AT,
  });
  const action = {
    kind: "file_write",
    path: "notes/summary.md",
    content_sha256: sha256("# Summary\n"),
    previous_sha256: null,
  };
  const actionSha = sha256Json(action);
  out["agent-approval.json"] = seal({
    schema: "agent-approval/v1",
    system: "james-desktop",
    request_id: "A-000001",
    task_id: "T-000004",
    requested_by: "writer",
    effect: "file_write",
    action,
    action_sha256: actionSha,
    expires_at: "2026-11-16T12:10:00Z",
    decision: {
      by: "person",
      verdict: "approved",
      at: "2026-11-16T12:01:00Z",
      action_sha256: actionSha,
    },
  });
  const evidence = seal({
    schema: "rain-interop-evidence/v1",
    episode_id: "E-fixture",
    title: "Where does a damped oscillator respond most?",
    question: "At which drive frequency is RMS displacement largest?",
    outcome: "refuted",
    claims: [
      {
        claim_id: "C-1",
        statement: "Peak RMS displacement occurs at the undamped natural frequency.",
        author: "james",
        generation: "scripted",
        standing: "refuted",
        evidence_run_ids: ["NR-0123456789abcdef01234567"],
        open_challenges: 0,
        supersedes: null,
      },
      {
        claim_id: "C-2",
        statement: "Peak RMS displacement occurs below the natural frequency.",
        author: "jasmine",
        generation: "scripted",
        standing: "supported",
        evidence_run_ids: ["NR-0123456789abcdef01234567"],
        open_challenges: 0,
        supersedes: "C-1",
      },
    ],
    runs: [
      {
        run_id: "NR-0123456789abcdef01234567",
        purpose: "discriminating frequency pair",
        record_sha256: sha256("fixture run"),
        status: "failed",
        verdict: "not_supported",
        measurements: {
          rms_control_m: 0.012345678901234,
          rms_treatment_m: 1e-9,
          rms_displacement_delta_m: -0.012345677901234,
          reference_max_error_m: 2.5e-13,
          arms_completed: 2,
          missing: null,
        },
        replay_verified: true,
      },
    ],
    challenges: [
      {
        challenge_id: "X-1",
        by: "jasmine",
        target_claim_id: "C-1",
        text: "Displacement amplitude peaks at sqrt(w0^2 - 2 gamma^2), not w0.",
        generation: "scripted",
        resolution: "upheld",
        resolved_by_run: "NR-0123456789abcdef01234567",
      },
    ],
    limitations: ["Simulated oscillator only; no physical measurement."],
    provenance: {
      lab_commit: null,
      protocol_sha256: sha256("protocol"),
      journal_head_sha256: chain.at(-1)!.sha256 as string,
      roster_sha256: sha256("roster"),
      evidence_class: "simulated",
    },
  });
  out["rain-interop-evidence.json"] = evidence;
  out["rain-interop-status.json"] = {
    schema: "rain-interop-status/v1",
    system: "rain-lab",
    interop_version: "agent-interop/v1",
    lab: { commit: null, dirty: null },
    scopes_enabled: ["read"],
    episodes: [
      {
        episode_id: "E-fixture",
        title: evidence.title,
        outcome: "refuted",
        evidence_sha256: evidence.sha256,
      },
    ],
    proposals_pending: 0,
    limitations: ["Simulated evidence only."],
  };
  const proposal = seal({
    schema: "rain-interop-proposal/v1",
    from: { system: "james-desktop", agent_id: "researcher" },
    title: "Does damping shift the response peak?",
    question:
      "How far below the natural frequency is the RMS displacement peak as damping grows?",
    hypothesis: "The peak moves lower as the damping ratio increases.",
    rationale: "Seen in the fixture episode; untested beyond it.",
    generation: "person",
    approval: {
      request_id: "A-000002",
      action_sha256: sha256("approved proposal"),
      decided_at: AT,
    },
  });
  out["rain-interop-proposal.json"] = proposal;
  out["rain-interop-receipt.json"] = {
    schema: "rain-interop-receipt/v1",
    proposal_sha256: proposal.sha256,
    status: "queued_for_operator_review",
    authorizes_execution: false,
    queue_position: 1,
    note: "Queued for a lab operator. Nothing has been authorized or run.",
  };
  out["rain-interop-error.json"] = {
    schema: "rain-interop-error/v1",
    code: "unauthorized",
    message: "A valid read token is required.",
  };
  // Negative fixtures: both implementations must refuse each one.
  const tampered = structuredClone(evidence) as Record<string, unknown> & {
    runs: Array<{ measurements: Record<string, number | null> }>;
  };
  tampered.runs[0]!.measurements.rms_treatment_m = 2e-9;
  const forged = structuredClone(out["agent-approval.json"]) as Record<
    string,
    unknown
  > & { action: Record<string, unknown> };
  forged.action = { ...forged.action, path: "notes/other.md" };
  const resealedForgery = seal(forged);
  const broken = structuredClone(chain);
  broken[2] = seal({ ...broken[2]!, prev: broken[0]!.sha256 });
  out["negative.json"] = {
    schema: "agent-interop-negative-fixtures/v1",
    cases: [
      {
        name: "evidence measurement changed after sealing",
        kind: "rain-interop-evidence/v1",
        reason: "digest",
        value: tampered,
      },
      {
        name: "approval action changed and record resealed",
        kind: "agent-approval/v1",
        reason: "action digest",
        value: resealedForgery,
      },
      {
        name: "event chain with a skipped link",
        kind: "agent-event-chain",
        reason: "prev",
        value: broken,
      },
    ],
  };
  return out;
}

function text(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

function walk(dir: string): string[] {
  return readdirSync(dir)
    .flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    })
    .sort();
}

function manifest(files: Map<string, Buffer>): string {
  return (
    [...files.entries()]
      .filter(([path]) => path !== "MANIFEST.sha256")
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([path, bytes]) => `${sha256Bytes(bytes)}  ${path}`)
      .join("\n") + "\n"
  );
}

const generated = fixtures();
// Self-check before writing: every positive fixture must pass the lab's own checks.
for (const [file, value] of Object.entries(generated)) {
  const schema = (value as { schema?: string }).schema ?? "";
  if (schema === "agent-interop-event-chain/v1") {
    const errors = checkEventChain((value as { events: unknown[] }).events);
    if (errors.length) throw new Error(`${file}: ${errors.join("; ")}`);
  } else if (!schema.startsWith("agent-interop-")) {
    const errors = checkRecord(schema as Parameters<typeof checkRecord>[0], value);
    if (errors.length) throw new Error(`${file}: ${errors.join("; ")}`);
  }
}

const files = new Map<string, Buffer>();
for (const path of walk(ROOT)) {
  const rel = relative(ROOT, path).split("\\").join("/");
  if (!rel.startsWith("fixtures/") && rel !== "MANIFEST.sha256")
    files.set(rel, readFileSync(path));
}
for (const [name, value] of Object.entries(generated))
  files.set(`fixtures/${name}`, Buffer.from(text(value)));
const manifestText = manifest(files);

if (check) {
  const problems: string[] = [];
  for (const [name, value] of Object.entries(generated)) {
    let onDisk = "";
    try {
      onDisk = readFileSync(join(ROOT, "fixtures", name), "utf8");
    } catch {
      problems.push(`missing fixtures/${name}`);
      continue;
    }
    if (onDisk !== text(value)) problems.push(`fixtures/${name} differs`);
  }
  if (readFileSync(join(ROOT, "MANIFEST.sha256"), "utf8") !== manifestText)
    problems.push("MANIFEST.sha256 differs");
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log(
    `agent-interop/v1 fixtures reproduce; manifest sha256 ${sha256(manifestText)}`,
  );
} else {
  mkdirSync(join(ROOT, "fixtures"), { recursive: true });
  for (const [name, value] of Object.entries(generated))
    writeFileSync(join(ROOT, "fixtures", name), text(value));
  writeFileSync(join(ROOT, "MANIFEST.sha256"), manifestText);
  console.log(
    `wrote ${Object.keys(generated).length} fixtures; manifest sha256 ${sha256(manifestText)}`,
  );
}
