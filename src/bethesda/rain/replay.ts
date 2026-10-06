/**
 * Replaying a R.A.I.N.-initiated experiment without any model.
 *
 * Verification trusts nothing in the file it reads. It re-derives the
 * definition's digest and that this build simulates it identically; re-checks
 * that the authorization binds to it; requires every arm's recorded commands
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
  verifyDefinition,
  type ExperimentDefinition,
} from "./experiments";
import { verifyAuthorization } from "./authorization";
import { aggregate, cohortAt, observeWorld } from "./observations";
import {
  armId,
  expectedCommands,
  regionOf,
  summarize,
  type ArmName,
  type ArmRecord,
} from "./runner";
import { recordDigestOK, type ExperimentRecord } from "./record";
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

/** The standard `bethesda-replay/v3` trace of one arm, for the city's own verifier. */
export function armTrace(recorded: ArmRecord): Trace {
  const steps = CitySimulation.execute(recorded.config, recorded.commands, recorded.tick);
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value.export();
  }
}

export function* verifyRecord(raw: unknown): Generator<number, Verification> {
  const checks: VerificationCheck[] = [];
  const check = (id: string, ok: boolean, detail: string) => {
    checks.push({ id, ok, detail });
    return ok;
  };
  const r = raw as ExperimentRecord | null;
  if (!r || typeof r !== "object" || r.schema !== RECORD_SCHEMA) {
    check("schema", false, "not a bethesda-rain-experiment-record/v1 record");
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
  if (r.kind === "rejection" || !r.run) {
    check(
      "no-run",
      !r.run && (r.outcome?.state === "REJECTED" || r.outcome?.state === "FAILED"),
      "nothing to re-simulate: the experiment never produced measurements",
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
  const authErrors = verifyAuthorization(r.authorization, r.experiment_id ?? "", sha);
  check(
    "authorization",
    !authErrors.length,
    authErrors.join("; ") || "binds to this definition",
  );
  if (!checks.every((c) => c.ok)) return { ok: false, checks };
  const expected = d.seeds.flatMap((seed) =>
    (["control", "treatment"] as const).map((arm) => armId(r.experiment_id!, arm, seed)),
  );
  if (
    !check(
      "arms",
      same(
        r.run.arms.map((a) => a.id),
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
  check(
    "evaluation",
    same(summary.evaluation, r.run.evaluation) && summary.status === r.run.status,
    `rain-criteria/v1 → ${summary.status}`,
  );
  check(
    "outcome",
    r.outcome.state === terminalFor(summary.status) &&
      r.outcome.rain_status === summary.status &&
      r.outcome.verdict === summary.verdict,
    `${r.outcome.state} · ${summary.verdict.replaceAll("_", " ")}`,
  );
  return { ok: checks.every((c) => c.ok), checks };
}

export function verifyRecordSync(raw: unknown): Verification {
  const steps = verifyRecord(raw);
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}
