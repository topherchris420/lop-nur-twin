/** Native journal/registry orchestration. Execution is an injected, operator-owned capability. */
import { randomUUID } from "node:crypto";
import type { ResearchStore, DiscoveryEntry } from "../autonomy/store.js";
import { Registry } from "../experiments/registry.js";
import { recordSubmission } from "../experiments/runner.js";
import { verify } from "../experiments/verify.js";
import { sha256, sha256Json, canonicalJson } from "../sha256.js";
import { TEAM } from "../meeting/perspectives.js";
import {
  assessProbe,
  campaignSeeds,
  rankCpuDesigns,
  updateRivals,
  validateIntelligencePlan,
  type CpuDesign,
  type IntelligencePlan,
  type ProbeResult,
  type Assessment,
} from "./intelligence.js";
import {
  renderIntelligenceObservatory,
  INTELLIGENCE_OBSERVATORY_SCRIPT,
  type IntelligenceViewReport,
} from "./intelligenceView.js";

export interface CpuExecutor {
  /** Repository identities, source hashes and worker identity; never secrets or local home paths. */
  binding: Record<string, unknown>;
  run(
    design: CpuDesign,
    seeds: number[],
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<ProbeResult>;
}
interface Producer {
  commit: string;
  dirty: boolean;
  source_sha256: string;
}
interface Registration {
  schema: "rain-cpu-registration/v1";
  plan: IntelligencePlan;
  binding: Record<string, unknown>;
  producer: Producer;
  definitions: Record<string, { id: string; sha256: string }>;
}
interface PhaseResult {
  key: string;
  phase: "screen" | "confirmation";
  design_id: string;
  probe: ProbeResult;
  assessment: Assessment;
  registry_run: string;
  elapsed_ms: number;
}
const POLICY = "rain-cpu-campaign/v1";
const LIMITATIONS = [
  "All observations are seeded simulations of the imported code, not measurements of physical quantum devices or biological causality.",
  "Intervals assume independent simulated sessions and one frozen endpoint per seed panel; family alpha covers all declared designs and both panels by union bound.",
  "Screening and confirmation use disjoint seeds but the same implementation. This is replication on new simulations, not an independent implementation replication.",
  "Rival probabilities and information scores are conditional on declared predictive models. Misspecified predictions can make selection ineffective.",
  "Work units are operator-declared computational limits, not measured joules, dollars or CPU-seconds. Worker wall time is measured separately.",
  "The worker runs explicitly trusted local source with a timeout. It is not an operating-system sandbox for hostile code, and has no cloud adapter.",
  "Hashes detect inconsistency, not forgery by a writer able to replace the entire journal. Preserve source revisions and external timestamps for stronger audit.",
];
const keyOf = (id: string, phase: string) => `${id}:${phase}`;
const payload = <T>(e: DiscoveryEntry): T => e.payload as T;

function definition(
  plan: IntelligencePlan,
  design: CpuDesign,
  phase: "screen" | "confirmation",
) {
  const n = phase === "screen" ? plan.screen_seeds.length : plan.confirm_seeds.length;
  return {
    title: `CPU ${design.id} ${phase}`,
    question: `Does ${design.adapter} correctly handle at least ${design.minimum_rate} of the registered simulated sessions?`,
    hypothesis: `The correct-session probability is at least ${design.minimum_rate}; both fixed panels must support it before a campaign claim is supported.`,
    rationale:
      "Host-derived operational hypothesis. Narrative hypotheses and rival predictions remain attributed plan data.",
    subsystem: {
      repository: "topherchris420/lop-nur-twin",
      component: "bounded-cpu-research",
      paths: [],
    },
    created_by: "R.A.I.N.Operator",
    evidence_class: "simulated",
    runner: {
      kind: "external",
      repository: "topherchris420/lop-nur-twin",
      adapter: design.adapter,
    },
    seed: null,
    parameters: {
      design_id: design.id,
      phase,
      adapter: design.adapter,
      parameters: design.parameters,
      seeds: campaignSeeds(plan, design, phase),
      seed_rule: "cpu-seeds/v1",
      endpoint_alpha: plan.family_alpha / (2 * plan.designs.length),
      plan_sha256: sha256Json(plan),
      policy: POLICY,
    },
    procedure: [
      "Run the fixed allowlisted CPU probe on every registered seed.",
      "Check independent controls, derive fixed-n bounds, and submit measurements to the existing registry.",
    ],
    variables: {
      independent: ["registered method"],
      dependent: ["correct-session proportion"],
      controls: [
        "known simulated truth",
        "independent analytical or numeric reference",
        "disjoint confirmation seeds",
      ],
    },
    metrics: ["mean", "lower", "upper", "samples_completed", "checks_passed"].map(
      (name) => ({
        name,
        unit: name === "samples_completed" ? "count" : "ratio",
        description: name.replaceAll("_", " "),
        deterministic: true,
      }),
    ),
    criteria: {
      guards: [
        { id: "G1", metric: "samples_completed", op: ">=", value: n },
        { id: "G2", metric: "checks_passed", op: ">=", value: 1 },
      ],
      success: [{ id: "S1", metric: "lower", op: ">=", value: design.minimum_rate }],
      failure: [{ id: "F1", metric: "upper", op: "<", value: design.minimum_rate }],
    },
    dependencies: ["numpy", "scipy"],
    data_policy: { classification: "public", store_artifacts: true },
    limitations: LIMITATIONS,
  };
}

/** Prepare every definition before measurements; exact envelope digest is the approval target. */
export function prepareCpuCampaign(
  store: ResearchStore,
  value: unknown,
  executor: CpuExecutor,
  producer: Producer,
) {
  const plan = validateIntelligencePlan(value);
  if (
    !/^[a-f0-9]{40,64}$/.test(producer.commit) ||
    !/^[a-f0-9]{64}$/.test(producer.source_sha256)
  )
    throw new Error("Producing revision and exact source fingerprint required");
  const release = store.acquireLock("cpu-prepare");
  try {
    const entries = store.discoveryEntries();
    for (const parent of plan.parent_campaigns)
      if (
        !entries.some(
          (e) =>
            e.kind === "cpu-finished" &&
            payload<{ plan_sha256: string }>(e).plan_sha256 === parent,
        )
      )
        throw new Error("Parent campaign is absent or unfinished");
    if (
      entries.some(
        (e) =>
          e.kind === "cpu-registered" &&
          sha256Json(payload<Registration>(e).plan) === sha256Json(plan),
      )
    )
      throw new Error(
        "This plan is already registered; inspect its existing campaign instead of duplicating evidence",
      );
    const previouslyExposed = new Set(
      entries
        .filter((e) => e.kind === "cpu-registered")
        .flatMap((e) => {
          const previous = payload<Registration>(e).plan;
          return previous.designs.flatMap((d) => [
            ...campaignSeeds(previous, d, "screen"),
            ...campaignSeeds(previous, d, "confirmation"),
          ]);
        }),
    );
    if (
      plan.designs.some((d) =>
        [
          ...campaignSeeds(plan, d, "screen"),
          ...campaignSeeds(plan, d, "confirmation"),
        ].some((s) => previouslyExposed.has(s)),
      )
    )
      throw new Error(
        "A registered seed panel is already exposed; a new hypothesis requires new seeds. Replay cannot be confirmation.",
      );
    const id = `DS-${randomUUID()}`;
    store.checkWriteBudget(Buffer.byteLength(canonicalJson(executor.binding)) + 65536);
    const registry = new Registry(
      store.registryDir(),
      () => new Date(),
      (bytes) => store.checkWriteBudget(bytes + 65536),
    );
    const definitions: Registration["definitions"] = {};
    for (const d of plan.designs)
      for (const phase of ["screen", "confirmation"] as const) {
        const registered = registry.create(definition(plan, d, phase));
        definitions[keyOf(d.id, phase)] = {
          id: registered.experiment_id as string,
          sha256: sha256Json(registered),
        };
      }
    const registration: Registration = {
      schema: "rain-cpu-registration/v1",
      plan,
      binding: structuredClone(executor.binding),
      producer,
      definitions,
    };
    const entry = store.appendDiscovery(id, "cpu-registered", registration);
    return {
      id,
      approval_sha256: sha256Json(registration),
      plan_sha256: sha256Json(plan),
      entry_sha256: entry.sha256,
    };
  } finally {
    release();
  }
}

function registrationOf(store: ResearchStore, id: string): Registration {
  const entry = store
    .discoveryEntries()
    .find((e) => e.session === id && e.kind === "cpu-registered");
  if (!entry) throw new Error("Unknown CPU campaign");
  const registration = structuredClone(payload<Registration>(entry));
  validateIntelligencePlan(registration.plan);
  const registry = new Registry(store.registryDir());
  for (const d of Object.values(registration.definitions))
    if (sha256Json(registry.loadDefinition(d.id)) !== d.sha256)
      throw new Error("Registered definition changed");
  return registration;
}

/** Structural reviews are host code, never invented dialogue or model peer review. */
export function structuralReviews(
  plan: IntelligencePlan,
): IntelligenceViewReport["reviews"] {
  const instructions = [
    `Synthesis check: ${plan.designs.length} frozen operational hypotheses retain explicit falsification conditions. Scientific novelty has not been established.`,
    `Resource check: ${plan.budget_units} declared work units; each process has a ${plan.timeout_seconds}s wall-time ceiling. No paid resource is authorized.`,
    "Rival check: predictions must include every rival. Their expected information is conditional; an impossible outcome rejects the supplied model set.",
    `Formal check: alpha ${plan.family_alpha} is split across ${2 * plan.designs.length} fixed endpoints. Confirmation uses disjoint seeds; no optional stopping is permitted.`,
  ];
  return TEAM.map((member, i) => ({
    agent: member.name,
    role: member.role,
    generation: "scripted" as const,
    text: instructions[i]!,
  }));
}

/** Explicit continuation never reruns a reserved seed panel; an interrupted job remains spent. */
export async function runCpuCampaign(
  store: ResearchStore,
  id: string,
  approvedDigest: string,
  executor: CpuExecutor,
  options: { reviewed: boolean; continueReviewed?: boolean; signal?: AbortSignal } = {
    reviewed: false,
  },
) {
  const release = store.acquireLock("cpu-campaign");
  try {
    const registration = registrationOf(store, id),
      plan = registration.plan;
    if (!options.reviewed || approvedDigest !== sha256Json(registration))
      throw new Error("Exact reviewed CPU campaign digest required");
    if (sha256Json(executor.binding) !== sha256Json(registration.binding))
      throw new Error("Approved CPU execution binding changed");
    let entries = store.discoveryEntries().filter((e) => e.session === id);
    if (entries.some((e) => e.kind === "cpu-finished"))
      throw new Error("Campaign already finished");
    if (entries.some((e) => e.kind === "cpu-authorized") && !options.continueReviewed)
      throw new Error(
        "Interrupted campaign requires explicit reviewed continuation; it never resumes automatically",
      );
    store.appendDiscovery(id, "cpu-authorized", {
      digest: approvedDigest,
      reviewed: true,
      identity_verified: false,
      scope: POLICY,
      continuation: options.continueReviewed === true,
    });
    store.appendDiscovery(id, "cpu-structural-reviews", structuralReviews(plan));
    let priors: Record<string, number> | null = { ...plan.rivals };
    for (const e of entries.filter((e) => e.kind === "cpu-result")) {
      const r = payload<PhaseResult>(e),
        d = plan.designs.find((x) => x.id === r.design_id)!;
      if (r.phase === "screen" && priors && r.assessment.verdict !== "invalid")
        priors = updateRivals(priors, d.predictions, r.probe.samples);
    }
    const registry = new Registry(
      store.registryDir(),
      () => new Date(),
      (bytes) => store.checkWriteBudget(bytes + 65536),
    );
    let status = "complete";
    const previousReservations = entries.filter((e) => e.kind === "cpu-reserved");
    const remaining = plan.designs.filter((d) => {
      const reserved = previousReservations.filter(
        (e) => payload<{ design_id: string }>(e).design_id === d.id,
      );
      const completed = entries.filter(
        (e) => e.kind === "cpu-result" && payload<PhaseResult>(e).design_id === d.id,
      );
      return completed.length < 2 && reserved.length === completed.length;
    });
    if (
      previousReservations.some(
        (e) =>
          !entries.some(
            (r) =>
              r.kind === "cpu-result" &&
              payload<{ key: string }>(r).key === payload<{ key: string }>(e).key,
          ),
      )
    )
      status = "incomplete";
    while (remaining.length) {
      if (options.signal?.aborted) {
        status = "cancelled";
        break;
      }
      entries = store.discoveryEntries().filter((e) => e.session === id);
      const reserved = entries.filter((e) => e.kind === "cpu-reserved");
      const spent = reserved.reduce((n, e) => n + payload<{ units: number }>(e).units, 0);
      const ranking = rankCpuDesigns(remaining, priors ?? plan.rivals, plan.policy);
      const selected = ranking.find((row) => {
        const cost = (["screen", "confirmation"] as const).reduce(
          (n, phase) =>
            n +
            (reserved.some(
              (e) => payload<{ key: string }>(e).key === keyOf(row.design.id, phase),
            )
              ? 0
              : row.design.cost_units * campaignSeeds(plan, row.design, phase).length),
          0,
        );
        return cost <= plan.budget_units - spent;
      });
      if (!selected) {
        status = "budget_exhausted";
        break;
      }
      const design = selected.design;
      remaining.splice(
        remaining.findIndex((d) => d.id === design.id),
        1,
      );
      store.appendDiscovery(id, "cpu-selected", {
        design_id: design.id,
        ranking: ranking.map(({ design: d, ...score }) => ({
          design_id: d.id,
          ...score,
        })),
        priors,
        basis: priors ? "declared-bernoulli-model" : "model-set-rejected-prior-fallback",
      });
      for (const phase of ["screen", "confirmation"] as const) {
        if (options.signal?.aborted) {
          status = "cancelled";
          break;
        }
        if (
          entries.some(
            (e) =>
              e.kind === "cpu-result" &&
              payload<{ key: string }>(e).key === keyOf(design.id, phase),
          )
        )
          continue;
        const seeds = campaignSeeds(plan, design, phase);
        const key = keyOf(design.id, phase),
          units = seeds.length * design.cost_units;
        store.appendDiscovery(id, "cpu-reserved", {
          key,
          design_id: design.id,
          phase,
          units,
          seeds_sha256: sha256Json(seeds),
        });
        const started = new Date().toISOString(),
          clock = performance.now();
        let raw: ProbeResult | null = null,
          assessment: Assessment | null = null,
          error: string | null = null;
        try {
          raw = await executor.run(
            structuredClone(design),
            [...seeds],
            plan.timeout_seconds * 1000,
            options.signal,
          );
          assessment = assessProbe(
            raw,
            seeds.length,
            plan.family_alpha / (2 * plan.designs.length),
            design.minimum_rate,
          );
        } catch {
          // Worker errors are intentionally generic: upstream diagnostics can contain private paths.
          error = options.signal?.aborted
            ? "CPU probe cancelled; reserved work remains spent"
            : "CPU probe failed or exceeded its approved limit; hypothesis not evaluated";
        }
        const finished = new Date().toISOString(),
          definitionId = registration.definitions[key]!.id;
        const artifactText = canonicalJson({ key, seeds, probe: raw, assessment, error });
        const run = recordSubmission(
          registry,
          definitionId,
          {
            schema_version: "rain-experiment-submission/v1",
            experiment_id: definitionId,
            experiment_version: 1,
            evidence_class: "simulated",
            started_at: started,
            finished_at: finished,
            seed: null,
            parameters: registry.loadDefinition(definitionId).parameters,
            inputs: { registration_sha256: approvedDigest, key },
            measurements: assessment
              ? {
                  mean: assessment.mean,
                  lower: assessment.lower,
                  upper: assessment.upper,
                  samples_completed: assessment.n,
                  checks_passed: Object.values(assessment.checks).every(Boolean) ? 1 : 0,
                }
              : {},
            series: raw ? { correct_sessions: raw.samples } : {},
            observations: [
              "Host-operated CPU probe; no model assigned this run's verdict.",
            ],
            limitations: LIMITATIONS,
            artifacts: [
              {
                name: "probe.json",
                sha256: sha256(artifactText),
                bytes: Buffer.byteLength(artifactText),
                kind: "raw-simulation-evidence",
              },
            ],
            models: [],
            provenance: {
              producer: POLICY,
              repository: "topherchris420/lop-nur-twin",
              ...registration.producer,
              execution_binding_sha256: sha256Json(executor.binding),
              upstream: raw?.provenance ?? null,
            },
            ...(error
              ? {
                  error: {
                    stage: "cpu-worker",
                    type: "ExecutionFailure",
                    message: error,
                  },
                }
              : {}),
          },
          { artifacts: { "probe.json": artifactText } },
        );
        const elapsed = performance.now() - clock;
        if (error || !raw || !assessment) {
          store.appendDiscovery(id, "cpu-error", {
            key,
            design_id: design.id,
            phase,
            registry_run: run.run_id,
            elapsed_ms: elapsed,
            error,
          });
          status = options.signal?.aborted ? "cancelled" : "incomplete";
          break;
        }
        const result: PhaseResult = {
          key,
          phase,
          design_id: design.id,
          probe: raw,
          assessment,
          registry_run: run.run_id as string,
          elapsed_ms: elapsed,
        };
        store.appendDiscovery(id, "cpu-result", result);
        if (phase === "screen" && priors && assessment.verdict !== "invalid") {
          priors = updateRivals(priors, design.predictions, raw.samples);
          if (!priors)
            store.appendDiscovery(id, "cpu-model-set-rejected", {
              key,
              reason:
                "Every declared rival assigned zero probability to the observed outcome",
            });
        }
      }
      if (status === "cancelled") break;
    }
    store.appendDiscovery(id, "cpu-finished", {
      status,
      plan_sha256: sha256Json(plan),
      policy: POLICY,
    });
    return cpuCampaignReport(store, id);
  } finally {
    release();
  }
}

/** Read-only projection; stored assessments are independently re-derived before display. */
export function cpuCampaignReport(
  store: ResearchStore,
  id: string,
): IntelligenceViewReport {
  const registration = registrationOf(store, id),
    plan = registration.plan;
  const entries = store.discoveryEntries().filter((e) => e.session === id);
  const registry = new Registry(store.registryDir());
  const checked = verify(
    registry,
    Object.values(registration.definitions).map((d) => d.id),
  );
  if (!checked.valid)
    throw new Error("CPU registry verification failed: " + checked.problems.join("; "));
  const results = entries
    .filter((e) => e.kind === "cpu-result")
    .map((e) => payload<PhaseResult>(e));
  const reservations = entries
    .filter((e) => e.kind === "cpu-reserved")
    .map((e) =>
      payload<{
        key: string;
        units: number;
        design_id: string;
        phase: string;
        seeds_sha256: string;
      }>(e),
    );
  if (
    new Set(reservations.map((r) => r.key)).size !== reservations.length ||
    new Set(results.map((r) => r.key)).size !== results.length
  )
    throw new Error(
      "Duplicate panel execution; evidence independence cannot be established",
    );
  let priors: Record<string, number> | null = { ...plan.rivals };
  for (const result of results) {
    const d = plan.designs.find((d) => d.id === result.design_id);
    if (
      !d ||
      !["screen", "confirmation"].includes(result.phase) ||
      result.key !== keyOf(d.id, result.phase)
    )
      throw new Error("Unknown result panel");
    const seeds = campaignSeeds(plan, d, result.phase);
    const reservation = reservations.find((r) => r.key === result.key);
    if (
      !reservation ||
      reservation.units !== d.cost_units * seeds.length ||
      reservation.seeds_sha256 !== sha256Json(seeds)
    )
      throw new Error("Panel has no matching frozen work reservation");
    const assessment = assessProbe(
      result.probe,
      seeds.length,
      plan.family_alpha / (2 * plan.designs.length),
      d.minimum_rate,
    );
    if (sha256Json(assessment) !== sha256Json(result.assessment))
      throw new Error("Stored assessment disagrees with raw observations");
    const defId = registration.definitions[result.key]!.id;
    const run = registry.runs(defId).find((r) => r.run_id === result.registry_run);
    const measurements = run?.measurements as Record<string, number> | undefined;
    if (
      !measurements ||
      measurements.mean !== assessment.mean ||
      measurements.lower !== assessment.lower ||
      measurements.upper !== assessment.upper
    )
      throw new Error("CPU journal differs from admitted registry measurements");
    const rawText = canonicalJson({
      key: result.key,
      seeds,
      probe: result.probe,
      assessment,
      error: null,
    });
    const artifact = (
      run?.artifacts as Array<{ name: string; sha256: string; bytes: number }> | undefined
    )?.find((a) => a.name === "probe.json");
    if (
      !artifact ||
      artifact.sha256 !== sha256(rawText) ||
      artifact.bytes !== Buffer.byteLength(rawText)
    )
      throw new Error("CPU journal raw evidence differs from its admitted artifact");
    if (result.phase === "screen" && priors && assessment.verdict !== "invalid")
      priors = updateRivals(priors, d.predictions, result.probe.samples);
  }
  const reservedUnits = reservations.reduce((n, r) => n + r.units, 0);
  if (reservedUnits > plan.budget_units)
    throw new Error("Campaign exceeded its frozen resource budget");
  const authorization = entries.find((e) => e.kind === "cpu-authorized");
  if (
    reservations.length &&
    (!authorization ||
      payload<{ digest: string }>(authorization).digest !== sha256Json(registration))
  )
    throw new Error("CPU measurements lack exact envelope authorization");
  const end = [...entries].reverse().find((e) => e.kind === "cpu-finished");
  const errors = entries
    .filter((e) => e.kind === "cpu-error")
    .map((e) => payload<{ key: string; elapsed_ms: number }>(e));
  const runtimeUnknown = reservations.some(
    (r) => !results.some((x) => x.key === r.key) && !errors.some((x) => x.key === r.key),
  );
  return {
    schema: "rain-intelligence-report/v1",
    study_id: id,
    plan_sha256: sha256Json(plan),
    question: plan.question,
    policy: plan.policy,
    status: end ? payload<{ status: string }>(end).status : "incomplete",
    budget: {
      ceiling_units: plan.budget_units,
      reserved_units: reservedUnits,
      completed_units: results.reduce(
        (n, r) => n + reservations.find((x) => x.key === r.key)!.units,
        0,
      ),
      runtime_ms: runtimeUnknown
        ? null
        : [...results, ...errors].reduce((n, r) => n + r.elapsed_ms, 0),
      model_calls: 0,
    },
    rivals: Object.entries(plan.rivals).map(([id, prior]) => ({
      id,
      prior,
      posterior: priors?.[id] ?? null,
    })),
    designs: plan.designs.map((d) => {
      const screen = results.find((r) => r.key === keyOf(d.id, "screen"));
      const confirm = results.find((r) => r.key === keyOf(d.id, "confirmation"));
      const error = entries.find(
        (e) =>
          e.kind === "cpu-error" && payload<{ design_id: string }>(e).design_id === d.id,
      );
      return {
        id: d.id,
        hypothesis: d.hypothesis,
        falsification: d.falsification,
        adapter: d.adapter,
        cost_units: d.cost_units,
        minimum_rate: d.minimum_rate,
        expected_bits: rankCpuDesigns([d], plan.rivals, "information")[0]!.expected_bits,
        screen: screen?.assessment ?? null,
        confirmation: confirm?.assessment ?? null,
        registry_run: confirm?.registry_run ?? screen?.registry_run ?? null,
        state: error
          ? "error"
          : screen && confirm
            ? "completed"
            : reservations.some((r) => r.design_id === d.id)
              ? "interrupted"
              : "pending",
        error: error ? payload<{ error: string }>(error).error : null,
      };
    }),
    reviews: structuralReviews(plan),
    events: entries.map(({ sequence, kind, sha256 }) => ({ sequence, kind, sha256 })),
    limitations: LIMITATIONS,
  };
}

export function exportCpuCampaign(store: ResearchStore, id: string) {
  const release = store.acquireLock("cpu-export");
  try {
    const report = cpuCampaignReport(store, id),
      snapshot = `DS-${randomUUID()}`;
    const evidence = store.saveResearchArtifact(
      snapshot,
      "evidence.json",
      canonicalJson(report),
    );
    const observatory = store.saveResearchArtifact(
      snapshot,
      "observatory.html",
      renderIntelligenceObservatory(report),
    );
    const script = store.saveResearchArtifact(
      snapshot,
      "observatory.js",
      INTELLIGENCE_OBSERVATORY_SCRIPT,
    );
    store.appendDiscovery(id, "cpu-exported", {
      snapshot,
      evidence,
      observatory,
      script,
    });
    return { report, evidence, observatory, script };
  } finally {
    release();
  }
}
