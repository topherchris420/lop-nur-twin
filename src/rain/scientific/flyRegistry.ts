/**
 * Registry adapter for digital-fly experiments, and the host that execution
 * needs: the preregistration check, the single-use authorization ledger and
 * admission. The registry evaluates; this file drafts, checks and submits.
 * Server only: it reads and writes the disk and asks git.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Registry, Json } from "../experiments/registry.js";
import { assembleDefinition } from "../experiments/registry.js";
import { evaluate } from "../experiments/evaluate.js";
import { recordSubmission, type RecordedBy } from "../experiments/runner.js";
import { canonicalJson, sha256, sha256Json } from "../sha256.js";
import {
  flyEngineText,
  flyRecordIntegrityErrors,
  verifyFlyPlan,
  verifyFlyRecord,
  type FlyContext,
  type FlyHost,
  type FlyVerification,
} from "./fly.js";
import { flySourceAtCommitErrors } from "./flySourceDigest.js";
import {
  FLY_ALPHA,
  FLY_BACKEND,
  FLY_METRICS,
  FLY_MIN_UNTIED_PAIRS,
  type FlyAuthorization,
  type FlyCodeState,
  type FlyPlan,
  type FlyPreregistration,
  type FlyRecord,
} from "./contracts.js";

export function flyRegistryDraft(plan: FlyPlan): Json {
  const errors = verifyFlyPlan(plan);
  if (errors.length) throw new Error(errors.join("; "));
  const primary = FLY_METRICS.find((m) => m.id === plan.design.analysis.metric)!;
  const blocks = plan.experiment.blocks.map((b) => b.id as string);
  const measured = FLY_METRICS.filter((m) => blocks.includes(m.block));
  const units: [string, string, string][] = [
    ["runs_completed", "count", "matched runs (seed x arm x block) that completed"],
    [
      "determinism_check",
      "1 if reproduced",
      "a second simulation reached every recorded state hash and measurement",
    ],
    ["seeds", "count", "matched seeds, drawn by the host after preregistration"],
    ["simulated_seconds", "s", "fly-seconds simulated across all runs"],
    ["gate_refusals", "count", "commands the fly's gate refused, over every run"],
    ["control_gate_refusals", "count", "commands the gate refused in the control arm"],
    [
      "treatment_gate_refusals",
      "count",
      "commands the gate refused in the treatment arm",
    ],
    [
      "control_mean",
      primary.unit,
      `mean ${primary.id} in the control arm, over seeds defined in both arms`,
    ],
    [
      "treatment_mean",
      primary.unit,
      `mean ${primary.id} in the treatment arm, over seeds defined in both arms`,
    ],
    [
      "mean_paired_delta",
      primary.unit,
      `treatment minus control ${primary.id}, averaged over seeds defined in both arms`,
    ],
    [
      "seeds_expected_direction",
      "count",
      "seeds whose difference lies in the expected direction",
    ],
    ["seeds_opposite", "count", "seeds whose difference lies in the opposite direction"],
    ["seeds_unchanged", "count", "seeds with no difference (ties)"],
    [
      "seeds_undefined",
      "count",
      "seeds where the metric is undefined in an arm; they drop out of the test",
    ],
    ["untied_pairs", "count", "seeds that differ between the arms"],
    [
      "sign_test_p_expected",
      "probability",
      "exact one-sided sign test p-value in the expected direction",
    ],
    [
      "sign_test_p_opposite",
      "probability",
      "exact one-sided sign test p-value in the opposite direction",
    ],
    [
      "control_informative",
      "1 if informative",
      "0 when the control arm sits at the metric's floor or ceiling in every seed",
    ],
    ...measured.flatMap((m): [string, string, string][] => [
      [`control_${m.id}`, m.unit, `control arm, mean over seeds: ${m.description}`],
      [`treatment_${m.id}`, m.unit, `treatment arm, mean over seeds: ${m.description}`],
    ]),
  ];
  return {
    title: "Matched-seed digital fly behaviour",
    question: plan.ir.question,
    hypothesis: plan.ir.hypothesis,
    rationale: `Bounded experiment on the digital fly's reduced-order controller in a closed arena: seeds drawn by the host after preregistration, an exact one-sided sign test at alpha ${FLY_ALPHA} on at least ${FLY_MIN_UNTIED_PAIRS} untied seeds, and independent re-simulation.`,
    subsystem: {
      repository: "topherchris420/lop-nur-twin",
      component: "digital-fly",
      paths: [],
    },
    created_by: "R.A.I.N.Host",
    evidence_class: "simulated",
    runner: {
      kind: "external",
      repository: "topherchris420/lop-nur-twin",
      adapter: FLY_BACKEND,
    },
    seed: null,
    parameters: { scientific_plan: structuredClone(plan) },
    procedure: [
      "Preregister the exact fly plan; the registry's receipt fixes when.",
      "A person at a terminal (or, for the host's demonstration designs, the demonstration script) authorizes the plan once; the authorization binds the receipt and draws a random nonce.",
      "Derive the seeds from SHA-256 of the receipt digest and the nonce, and refuse any this fly has already run.",
      "Run every seed in both arms on the host-built arenas and stimuli of the protocol, counting the gate's refusals.",
      "Simulate every run a second time and require each state hash and measurement.",
      "Recompile and re-simulate again before registry admission, from committed code only.",
    ],
    variables: {
      independent: plan.ir.independent_variables,
      dependent: plan.ir.dependent_variables,
      controls: plan.ir.controls,
    },
    metrics: units.map(([name, unit, description]) => ({
      name,
      unit,
      description,
      deterministic: true,
    })),
    criteria: plan.criteria,
    dependencies: [],
    data_policy: { classification: "internal", store_artifacts: false },
    limitations: [
      ...plan.ir.limitations,
      "Seeds are replicates of one model, not samples of real flies.",
    ],
  };
}

/** The plans a registry already holds, by digest. */
function registeredPlans(registry: Registry): Map<string, string> {
  const held = new Map<string, string>();
  for (const id of registry.experimentIds()) {
    try {
      const definition = registry.loadDefinition(id);
      const plan = (
        definition.parameters as { scientific_plan?: { definition_sha256?: unknown } }
      )?.scientific_plan;
      if (typeof plan?.definition_sha256 === "string")
        held.set(plan.definition_sha256, id);
    } catch {
      // Not a fly definition, or unreadable: it holds no fly plan.
    }
  }
  return held;
}

/**
 * Preregisters a plan once. A plan already in the registry is refused rather
 * than registered again: a second receipt would let its seeds be drawn again.
 */
export function preregisterFly(registry: Registry, plan: FlyPlan): FlyPreregistration {
  const earlier = registeredPlans(registry).get(plan.definition_sha256);
  if (earlier)
    throw new Error(
      `${plan.experiment_id} is already preregistered as ${earlier}; a plan is registered once`,
    );
  const definition = registry.create(flyRegistryDraft(plan));
  return {
    experiment_id: definition.experiment_id as string,
    registry_definition_sha256: sha256Json(definition),
    plan_sha256: plan.definition_sha256,
    created_at: definition.created_at as string,
  };
}

export function verifyFlyPreregistration(
  registry: Registry,
  plan: FlyPlan,
  receipt: FlyPreregistration,
): string[] {
  try {
    const stored = registry.loadDefinition(receipt.experiment_id);
    const expected = assembleDefinition(
      flyRegistryDraft(plan),
      receipt.experiment_id,
      stored.created_at as string,
    );
    return receipt.plan_sha256 === plan.definition_sha256 &&
      receipt.created_at === stored.created_at &&
      receipt.registry_definition_sha256 === sha256Json(stored) &&
      canonicalJson(stored) === canonicalJson(expected)
      ? []
      : ["fly registry snapshot does not bind the exact preregistered plan"];
  } catch {
    return [
      "fly plan is not preregistered here (its preregistration is unavailable or invalid)",
    ];
  }
}

/**
 * One authorization per plan, used once. Each is a file named by the plan's
 * digest and created exclusively, so a second authorization of the same plan,
 * or a second run of one, fails even from another process.
 */
export class FlyAuthorizationLedger {
  readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }
  private path(plan: string, kind: "issued" | "spent"): string {
    if (!/^[a-f0-9]{64}$/.test(plan)) throw new Error("not a plan digest");
    return join(this.root, `${plan}.${kind}.json`);
  }
  issue(authorization: FlyAuthorization): string[] {
    const path = this.path(authorization.definition_sha256, "issued");
    try {
      mkdirSync(this.root, { recursive: true });
      writeFileSync(path, canonicalJson(authorization) + "\n", { flag: "wx" });
      return [];
    } catch (e) {
      return existsSync(path)
        ? [
            `${authorization.experiment_id} was already authorized; a plan is authorized once, so its seeds are drawn once`,
          ]
        : [
            `the authorization could not be recorded: ${e instanceof Error ? e.message : String(e)}`,
          ];
    }
  }
  spend(authorization: FlyAuthorization): string[] {
    let issued: unknown;
    try {
      issued = JSON.parse(
        readFileSync(this.path(authorization.definition_sha256, "issued"), "utf8"),
      );
    } catch {
      return ["this authorization was never issued by this host"];
    }
    if (canonicalJson(issued) !== canonicalJson(authorization))
      return ["this is not the authorization issued for the plan"];
    try {
      writeFileSync(
        this.path(authorization.definition_sha256, "spent"),
        canonicalJson({
          authorization_sha256: authorization.authorization_sha256,
          spent_at: new Date().toISOString(),
        }) + "\n",
        { flag: "wx" },
      );
      return [];
    } catch {
      return ["this authorization was already used; an authorization runs once"];
    }
  }
}

/** The real host: a registry, a ledger, the archive's seeds and the source tree. */
export function registryFlyHost(options: {
  registry: Registry;
  ledger: FlyAuthorizationLedger;
  code: () => FlyCodeState;
  seen?: (flySha256: string, seed: number) => boolean;
  evidence?: FlyContext;
}): FlyHost {
  return {
    preregistrationErrors: (plan, receipt) =>
      verifyFlyPreregistration(options.registry, plan, receipt),
    issue: (a) => options.ledger.issue(a),
    spend: (a) => options.ledger.spend(a),
    seen: options.seen ?? (() => false),
    code: options.code,
    evidence: options.evidence,
  };
}

/** What the host's replay showed, in words that hold for this record. */
export function flyReplayObservation(
  record: FlyRecord,
  replaySha256: string | null,
): string {
  if (!record.result.completed)
    return `The fly simulation did not complete, so there was no full set of state hashes to reproduce; an independent re-simulation reached the same failure: ${replaySha256}`;
  if (record.result.measurements.determinism_check !== 1)
    return `The run's own determinism check failed (G2); an independent re-simulation reproduced the recorded result, failure included: ${replaySha256}`;
  return `Independent re-simulation reproduced every state hash and measurement: ${replaySha256}`;
}

/** Who authorized a record, in plain words. */
export function flyAuthorizedBy(a: FlyAuthorization): string {
  return a.channel === "script"
    ? `the demonstration script (${a.operator}), not a person`
    : `${a.operator} at a terminal (local operator attestation; identity not verified)`;
}

/**
 * The registry submission for an admitted record: a pure function of the
 * record and its replay digest, so a record's registry-run.json can be checked
 * against it later. (The registry masks any string under a key like
 * "authorization", so its copy of the authorization's own digest reads
 * [REDACTED]; the record's digest in the provenance still binds it.)
 */
export function flySubmission(record: FlyRecord, replaySha256: string | null) {
  const receipt = record.preregistration;
  const text = canonicalJson(record);
  const metric = record.plan.design.analysis.metric;
  const block = FLY_METRICS.find((m) => m.id === metric)!.block;
  const value = (arm: string, seed: number) => {
    const v = record.result.runs.find(
      (r) => r.arm === arm && r.seed === seed && r.block === block,
    )?.metrics[metric];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  // Seeds where the metric is undefined in either arm contribute no values.
  const pairs = record.seeds.flatMap((s) => {
    const c = value("control", s),
      t = value("treatment", s);
    return c === null || t === null ? [] : [[c, t] as const];
  });
  const series = pairs.length
    ? {
        control_primary: pairs.map(([c]) => c),
        treatment_primary: pairs.map(([, t]) => t),
        paired_delta: pairs.map(([c, t]) => t - c),
      }
    : {};
  return {
    schema_version: "rain-experiment-submission/v1",
    experiment_id: receipt.experiment_id,
    experiment_version: 1,
    evidence_class: "simulated",
    started_at: record.started_at,
    finished_at: record.finished_at,
    seed: null,
    parameters: { scientific_plan_sha256: record.plan.definition_sha256 },
    inputs: {
      scientific_plan: record.plan,
      preregistration: record.preregistration,
      authorization: record.authorization,
      seeds: record.seeds,
      engine: record.engine,
      replay_sha256: replaySha256,
      final_state_hashes: record.result.runs.map(
        (r) => `${r.block}/${r.arm}/${r.seed}/${sha256(r.final_hashes.join(","))}`,
      ),
    },
    measurements: record.result.measurements,
    series,
    observations: [
      "Every arm is an output of the digital fly simulator (a reduced-order controller that simulates no neurons) in a closed arena; no animal was observed.",
      `Seeds drawn by the host after preregistration; authorized by ${flyAuthorizedBy(record.authorization)}.`,
      flyReplayObservation(record, replaySha256),
    ],
    limitations: [
      "Matched seeds of one model; the sign test's p-values describe consistency across this simulator's seeds, not a population.",
    ],
    artifacts: [
      {
        name: "fly-record.json",
        sha256: sha256(text),
        bytes: new TextEncoder().encode(text).length,
        kind: "fly-simulation-record",
      },
    ],
    models: [],
    provenance: {
      producer: "R.A.I.N.FlyHost",
      repository: "topherchris420/lop-nur-twin",
      commit: record.code.commit,
      dirty: false,
      fly_record_sha256: record.sha256,
      fly_run_id: record.run_id,
      fly: record.plan.fly,
      fly_sha256: record.plan.fly_sha256,
      fly_source_sha256: record.plan.fly_source_sha256,
      engine: flyEngineText(record.engine),
      approval_channel: record.authorization.channel,
    },
    ...(record.result.error
      ? {
          error: {
            stage: "fly-execution",
            type: "IncompleteFlyRun",
            message: record.result.error,
          },
        }
      : {}),
  };
}

/**
 * Admits an independently re-simulated record against its exact
 * preregistration. Failed and inconclusive results are admitted like any
 * other: a negative result is a result. Refused before anything is written:
 * a record that does not re-simulate, one run before its preregistration, a
 * development record (uncommitted or unknown code), one whose commit does not
 * hold the code that ran, and one whose verdict the registry's own evaluation
 * would not reach.
 */
export function admitFlyRecord(
  registry: Registry,
  record: FlyRecord,
  options: {
    /** The repository root, where git is asked whether the commit holds the code. */
    root: string;
    /** Replaces the git check (tests); errors unless `commit` holds source `sha256`. */
    codeAtCommit?: (commit: string | null, sourceSha256: string) => string[];
    recordedBy?: RecordedBy;
    evidence?: FlyContext;
  },
): { registry_run: Json; replay: FlyVerification } {
  // The cheap checks first: a record refused for its seal, its times or its
  // code is not worth re-simulating.
  const integrity = flyRecordIntegrityErrors(record);
  if (integrity.length) throw new Error("Fly admission refused: " + integrity.join("; "));
  const receipt = record.preregistration;
  const errors = verifyFlyPreregistration(registry, record.plan, receipt);
  let created = Number.NaN;
  try {
    created = Date.parse(
      registry.loadDefinition(receipt.experiment_id).created_at as string,
    );
  } catch {
    // Reported by the preregistration check.
  }
  if (!(Date.parse(record.started_at) >= created))
    errors.push("the run started before its preregistration");
  if (record.development)
    errors.push(
      "a development record (run from uncommitted or unknown code) is kept but never admitted; commit the code and run the plan from that commit",
    );
  else
    errors.push(
      ...(
        options.codeAtCommit ?? ((c, s) => flySourceAtCommitErrors(options.root, c, s))
      )(record.code.commit, record.plan.fly_source_sha256),
    );
  if (errors.length) throw new Error("Fly admission refused: " + errors.join("; "));
  const replay = verifyFlyRecord(record, options.evidence);
  if (!replay.ok)
    throw new Error(
      "Fly admission refused: " +
        [...replay.errors, ...(replay.note ? [replay.note] : [])].join("; "),
    );
  // The registry decides the verdict with rain-criteria/v1. Reach it here
  // first, so a disagreement is refused before the registry writes a run.
  const expected = record.result.error
    ? { status: "error", verdict: "not_evaluated" }
    : evaluate(record.plan.criteria, record.result.measurements);
  if (
    expected.status !== record.result.status ||
    expected.verdict !== record.result.verdict
  )
    throw new Error(
      "Fly admission refused: the registry's evaluation of the frozen criteria differs from the record's",
    );
  const submission = flySubmission(record, replay.replay_sha256);
  const run = recordSubmission(registry, receipt.experiment_id, submission, {
    recordedBy: options.recordedBy,
  });
  if (
    run.status !== record.result.status ||
    run.hypothesis_verdict !== record.result.verdict
  )
    throw new Error(
      `Native registry evaluation differs from the fly preregistered criteria (${String(run.run_id)})`,
    );
  return { registry_run: run, replay };
}
