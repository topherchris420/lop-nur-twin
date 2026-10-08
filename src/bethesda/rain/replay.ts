/**
 * Replaying a R.A.I.N.-initiated experiment without any model.
 *
 * Verification trusts nothing in the file it reads. It re-derives the
 * definition's digest and that this build simulates it identically; re-checks
 * that the authorization binds to it — a person's, or a standing authority:
 * the charter's authorization, the policy's admission and the design it lists;
 * requires every arm's recorded commands
 * to be exactly the ones the definition implies (a focus at tick 0, and the
 * compiled scenario at the end of warm-up for a treatment — any other command
 * is refused, so a record cannot smuggle a world mutation in); re-executes
 * those commands through `CitySimulation.execute`, the same gate the city's
 * own replay uses; recomputes every world observation, each arm's
 * checkpoints, final state and decision history, the per-seed differences,
 * the measurements and the rain-criteria/v1 evaluation; and compares each to
 * the record. Any difference fails.
 *
 * Saved meeting prose is replayed as recorded content elsewhere; nothing here
 * regenerates words. This module imports no client, no fetch and no provider,
 * and its test asserts that.
 */
import { CitySimulation, type Trace } from "../simulation";
import { canonicalHash } from "../../game/pilot/hash";
import { RECORD_SCHEMA } from "./contracts";
import {
  experimentIdOf,
  rejectedChecksOK,
  validateExperiment,
  verifyDefinition,
  type ExperimentDefinition,
} from "./experiments";
import { verifyAuthorization } from "./authorization";
import { verifyStanding } from "./standing";
import { aggregate, cohortAt, observeWorld } from "./observations";
import {
  armId,
  expectedCommands,
  regionOf,
  summarize,
  type ArmName,
  type ArmRecord,
} from "./runner";
import {
  attachmentErrors,
  recordDigestOK,
  unresolvedFor,
  type ExperimentRecord,
} from "./record";
import { canonicalJson } from "../../rain/sha256";
import { Lifecycle, terminalFor } from "./lifecycle";

export interface VerificationCheck {
  id: string;
  ok: boolean;
  detail: string;
}
export interface Verification {
  ok: boolean;
  checks: VerificationCheck[];
}

const same = (a: unknown, b: unknown) => {
  try {
    return canonicalJson(a) === canonicalJson(b);
  } catch {
    return false;
  }
};

/** Re-run one arm from its recorded commands and compare everything it produced. */
export function* replayArm(
  d: ExperimentDefinition,
  experimentId: string,
  recorded: ArmRecord,
): Generator<number, string[]> {
  const errors: string[] = [];
  const arm: ArmName = recorded.arm;
  if (recorded.id !== armId(experimentId, arm, recorded.seed))
    return ["arm id does not match its experiment"];
  if (!d.seeds.includes(recorded.seed)) return ["arm seed is not in the definition"];
  if (!same(recorded.config, { ...d.population, seed: recorded.seed }))
    return ["arm configuration differs from the definition"];
  if (!same(recorded.commands, expectedCommands(d, recorded.seed, arm)))
    return [
      "arm commands differ from what the definition implies; only the focus and the compiled scenario may be recorded",
    ];
  if (
    recorded.tick !== d.warmup_ticks + d.window_ticks ||
    recorded.t0_tick !== d.warmup_ticks
  )
    return ["arm duration differs from the definition"];
  const region = regionOf(d);
  const steps = CitySimulation.execute(recorded.config, recorded.commands, recorded.tick);
  let cohort: number[] | null = null,
    t0Hash = "";
  const observations = [];
  let baseline = null;
  let sim: CitySimulation;
  for (;;) {
    const next = steps.next();
    if (next.done) {
      sim = next.value;
      break;
    }
    const s = next.value;
    if (s.tick === d.warmup_ticks) {
      t0Hash = s.stateHash();
      cohort = cohortAt(s, d.center, d.radii.catchment);
      baseline = observeWorld(s, {
        subject: `${experimentId}/${arm}/seed-${recorded.seed}`,
        experimentId,
        arm,
        region,
        cohort,
        replayId: recorded.id,
      });
    } else if (s.tick > d.warmup_ticks && cohort)
      observations.push(
        observeWorld(s, {
          subject: `${experimentId}/${arm}/seed-${recorded.seed}`,
          experimentId,
          arm,
          region,
          cohort,
          replayId: recorded.id,
        }),
      );
    yield s.tick;
  }
  const trace: Trace = sim.export();
  if (t0Hash !== recorded.t0_hash) errors.push("state at the intervention differs");
  if (!same(cohort, recorded.cohort)) errors.push("cohort differs");
  if (!same(baseline, recorded.baseline)) errors.push("baseline observation differs");
  if (!same(observations, recorded.observations))
    errors.push("world observations differ from simulator state");
  if (!same(aggregate(observations), recorded.values)) errors.push("arm values differ");
  if (!same(trace.checkpoints, recorded.checkpoints)) errors.push("checkpoints differ");
  if (trace.finalHash !== recorded.final_hash) errors.push("final state differs");
  if (
    trace.decisions.length !== recorded.decisions ||
    canonicalHash(trace.decisions) !== recorded.decisions_hash
  )
    errors.push("decision history differs");
  return errors.map((e) => `${recorded.id}: ${e}`);
}

/** The city's standard replay trace (`REPLAY_SCHEMA`) of one arm, for its own verifier. */
export function armTrace(recorded: ArmRecord): Trace {
  const steps = CitySimulation.execute(recorded.config, recorded.commands, recorded.tick);
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value.export();
  }
}

/**
 * The definition, its digest, its id and the validation, re-derived from the
 * record's proposal by the same deterministic validation that made them. A
 * definition is never trusted for being self-consistent: anyone can edit one,
 * re-hash it and authorize the edit, so it must be the one its proposal
 * yields in this build. A record that holds no proposal can hold no
 * definition, and only the checks a rejected proposal can have produced.
 */
function derivationErrors(r: ExperimentRecord): string[] {
  if (r.proposal === null) {
    const errors: string[] = [];
    if (r.definition !== null || r.definition_sha256 !== null || r.experiment_id !== null)
      errors.push("a definition with no proposal to derive it from");
    if (r.kind !== "rejection") errors.push("a run with no proposal");
    if (typeof r.rejected_input !== "string")
      errors.push("a rejection that does not keep what was rejected");
    if (!rejectedChecksOK(r.validation))
      errors.push("the validation is not what validating a rejected proposal produces");
    return errors;
  }
  const derived = validateExperiment(r.proposal);
  if (!derived.ok)
    return [
      "the proposal does not validate in this build: " +
        derived.errors.slice(0, 2).join("; "),
    ];
  const v = derived.value;
  const errors: string[] = [];
  if (!same(v.proposal, r.proposal))
    errors.push("the proposal is not in the form validation keeps");
  if (!same(v.definition, r.definition)) {
    const d = (r.definition ?? {}) as unknown as Record<string, unknown>;
    const fresh = v.definition as unknown as Record<string, unknown>;
    const differ = Object.keys({ ...fresh, ...d }).filter((k) => !same(fresh[k], d[k]));
    errors.push(
      `the definition is not the one its proposal yields (differs in ${differ.join(", ") || "form"})`,
    );
  }
  if (v.definitionSha256 !== r.definition_sha256 || v.experimentId !== r.experiment_id)
    errors.push("the definition digest or id is not the one its proposal yields");
  if (!same(v.checks, r.validation))
    errors.push("the validation is not what validating the proposal produces");
  return errors;
}

/** Exactly one authority, binding this definition. */
function authorityErrors(r: ExperimentRecord, d: ExperimentDefinition, sha: string) {
  // A standing authority is judged as it stood when the policy admitted the
  // run: replay takes no clock, so a charter that has since expired still
  // verifies the runs it admitted while it stood.
  return r.authorization && r.standing
    ? ["the record carries both a person's authorization and a standing authority"]
    : r.standing
      ? verifyStanding(r.standing, r.experiment_id ?? "", d, sha)
      : verifyAuthorization(r.authorization, r.experiment_id ?? "", sha);
}

function* verifyUnguarded(raw: unknown): Generator<number, Verification> {
  const checks: VerificationCheck[] = [];
  const check = (id: string, ok: boolean, detail: string) => {
    checks.push({ id, ok, detail });
    return ok;
  };
  const r = raw as ExperimentRecord | null;
  if (!r || typeof r !== "object" || r.schema !== RECORD_SCHEMA) {
    check("schema", false, `not a ${RECORD_SCHEMA} record`);
    return { ok: false, checks };
  }
  check("digest", recordDigestOK(r), "record matches its SHA-256");
  let lifecycleOK = true;
  try {
    new Lifecycle(r.lifecycle);
  } catch (e) {
    lifecycleOK = false;
    check("lifecycle", false, e instanceof Error ? e.message : "invalid lifecycle");
  }
  if (lifecycleOK)
    check(
      "lifecycle",
      r.lifecycle.at(-1)?.state === r.outcome?.state,
      "lifecycle ends in the recorded outcome",
    );
  const attached = attachmentErrors(r);
  check(
    "attachments",
    !attached.length,
    attached.join("; ") ||
      "pre-registration, admission, reproduction report and error are well formed and bound to this record",
  );
  if (r.kind === "rejection" || !r.run) {
    check(
      "no-run",
      !r.run && (r.outcome?.state === "REJECTED" || r.outcome?.state === "FAILED"),
      "nothing to re-simulate: the experiment never produced measurements",
    );
    // What a record that never ran still shows (its proposal, definition,
    // checks, authority and outcome) must be what the lab would have written.
    const derivation = derivationErrors(r);
    check(
      "proposal",
      !derivation.length,
      derivation.join("; ") ||
        (r.proposal
          ? "the definition, its digest and the validation re-derive from the record's proposal"
          : "the validation is what a rejected proposal produces"),
    );
    if (r.authorization || r.standing) {
      const authErrors =
        r.definition && r.definition_sha256
          ? authorityErrors(r, r.definition, r.definition_sha256)
          : ["an authority with no definition to bind to"];
      check(
        "authorization",
        !authErrors.length,
        authErrors.join("; ") || "binds to this definition",
      );
    }
    const state = r.outcome?.state;
    check(
      "outcome",
      (state === "REJECTED"
        ? r.kind === "rejection" && r.error === null
        : state === "FAILED" && r.kind !== "rejection" && r.error !== null) &&
        r.outcome.rain_status === (state === "FAILED" ? "error" : null) &&
        r.outcome.verdict === "not_evaluated" &&
        r.outcome.summary === (r.lifecycle.at(-1)?.detail ?? "no outcome recorded") &&
        same(
          r.outcome.unresolved,
          unresolvedFor(state, "not_evaluated", r.definition?.seeds.length ?? 0),
        ),
      `${state ?? "no state"} · not evaluated`,
    );
    return { ok: checks.every((c) => c.ok), checks };
  }
  const d = r.definition;
  const sha = r.definition_sha256;
  if (!d || !sha) {
    check("definition", false, "a run without a definition");
    return { ok: false, checks };
  }
  const definitionErrors = verifyDefinition(d, sha);
  check(
    "definition",
    !definitionErrors.length && r.experiment_id === experimentIdOf(sha),
    definitionErrors.join("; ") ||
      "definition digest, versions and compiled scenario match",
  );
  // The definition is the one the record's proposal yields, so the criteria,
  // seeds, effect and mathematics a person authorized are the proposal's, and
  // the checks the record shows are the ones validation produced.
  const derivation = derivationErrors(r);
  check(
    "proposal",
    !derivation.length,
    derivation.join("; ") ||
      "the definition, its digest and the validation re-derive from the record's proposal",
  );
  const authErrors = authorityErrors(r, d, sha);
  check(
    "authorization",
    !authErrors.length,
    authErrors.join("; ") ||
      (r.standing
        ? `a standing authority binds it: design ${r.standing.admission.design_id} of a charter a local operator authorized, admitted by ${r.standing.admission.policy_version}`
        : "binds to this definition"),
  );
  if (!checks.every((c) => c.ok)) return { ok: false, checks };
  const expected = d.seeds.flatMap((seed) =>
    (["control", "treatment"] as const).map((arm) => armId(r.experiment_id!, arm, seed)),
  );
  if (
    !check(
      "arms",
      Array.isArray(r.run.arms) &&
        same(
          r.run.arms.map((a) => a?.id),
          expected,
        ),
      `${expected.length} arms, one control and one treatment per seed`,
    )
  )
    return { ok: false, checks };
  for (const arm of r.run.arms) {
    const errors = yield* replayArm(d, r.experiment_id!, arm);
    check(
      `arm:${arm.id}`,
      !errors.length,
      errors.join("; ") || "re-simulated identically",
    );
  }
  const summary = summarize(d, r.run.arms);
  check(
    "measurements",
    same(summary.measurements, r.run.measurements),
    "recomputed from the arms",
  );
  // What the Registry and the Evidence Library show of a run is recomputed
  // too: each seed's values and difference, and the series behind the charts.
  check(
    "per-seed",
    same(summary.per_seed, r.run.per_seed),
    "every seed's control, treatment and difference recomputed from the arms",
  );
  check("series", same(summary.series, r.run.series), "recomputed from the arms");
  check(
    "evaluation",
    same(summary.evaluation, r.run.evaluation) && summary.status === r.run.status,
    `rain-criteria/v1 → ${summary.status}`,
  );
  check(
    "outcome",
    r.outcome.state === terminalFor(summary.status) &&
      r.outcome.rain_status === summary.status &&
      r.outcome.verdict === summary.verdict &&
      r.run.verdict === summary.verdict &&
      r.outcome.summary === summary.evaluation.summary &&
      same(
        r.outcome.unresolved,
        unresolvedFor(r.outcome.state, summary.verdict, d.seeds.length),
      ),
    `${r.outcome.state} · ${summary.verdict.replaceAll("_", " ")}`,
  );
  return { ok: checks.every((c) => c.ok), checks };
}

/**
 * Verify a record by replay. Whatever the file holds, the answer is a
 * verification: a record malformed enough to throw is a failed one.
 */
export function* verifyRecord(raw: unknown): Generator<number, Verification> {
  try {
    return yield* verifyUnguarded(raw);
  } catch (e) {
    return {
      ok: false,
      checks: [
        {
          id: "shape",
          ok: false,
          detail:
            "the record is malformed: " +
            (e instanceof Error ? e.message : String(e)).slice(0, 300),
        },
      ],
    };
  }
}

export function verifyRecordSync(raw: unknown): Verification {
  const steps = verifyRecord(raw);
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}
