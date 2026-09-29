import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Crosshair, FileSearch, Upload } from "lucide-react";
import {
  validateEvaluation,
  type ArmEvaluation,
  type Evaluation,
} from "@/game/eval/evaluation";
import { decisionType } from "@/game/eval/outcomeContracts";
import { pct, usd } from "@/game/eval/report";
import type { SampleSummary } from "@/game/eval/stats";
import {
  LatencyHistogram,
  Legend,
  ReliabilityDiagram,
  StripPlot,
  SweepChart,
  formatValue,
} from "@/game/eval/ui/charts";
import {
  DecisionTrace,
  readRecordsFile,
  type EpisodeRecords,
} from "@/game/eval/ui/DecisionTrace";

/**
 * `/evaluation` — read a Blacksite evaluation (`blacksite-evaluation/v1`).
 *
 * It shows what an experiment declared, what each arm measured, how sure the
 * brains said they were and how that held up, what the decisions cost, what
 * was stale or refused, and every warning — and it always says where a number
 * came from: each episode names its run id, seed and artifact files, and an
 * episode's decision records can be opened here, row by row.
 *
 * This is part of the illustrative simulation, not the analytical model: it
 * says nothing about the real site. It renders no canvas. Evaluations archived
 * in the repository (`docs/benchmarks/**`) are bundled at build time; any other
 * file is opened from the user's machine. Nothing is fetched from anywhere.
 */

export const Route = createFileRoute("/evaluation")({
  component: EvaluationView,
});

const ARCHIVED = import.meta.glob<{ default: unknown }>(
  "/docs/benchmarks/**/evaluation.json",
);
const MAX_EVALUATION_BYTES = 32 * 1024 * 1024;

const button =
  "border-border hover:bg-accent focus-visible:ring-ring inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm focus-within:ring-2 focus-visible:ring-2 focus-visible:outline-none";

function Summary({
  s,
  digits = 2,
  unit = "",
}: {
  s: SampleSummary | undefined;
  digits?: number;
  unit?: string;
}) {
  if (!s || s.n === 0) return <span className="text-muted-foreground">n/a</span>;
  return (
    <span title={s.notes.join("; ") || undefined}>
      {formatValue(s.mean, digits)}
      {unit}
      {s.ci95 ? (
        <span className="text-muted-foreground">
          {" "}
          [{formatValue(s.ci95.lo, digits)}, {formatValue(s.ci95.hi, digits)}]
        </span>
      ) : null}
      <span className="text-muted-foreground"> n={s.n}</span>
    </span>
  );
}

function Section({
  id,
  title,
  children,
  intro,
}: {
  id: string;
  title: string;
  intro?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="mt-10">
      <h2 id={id} className="text-lg font-semibold">
        {title}
      </h2>
      {intro ? (
        <p className="text-muted-foreground mt-1 max-w-4xl text-sm leading-relaxed">
          {intro}
        </p>
      ) : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th scope="col" className="px-2 py-2 font-semibold whitespace-nowrap">
      {children}
    </th>
  );
}

function armLabel(arm: ArmEvaluation): string {
  return arm.brain.testDouble ? `${arm.id} (test double)` : arm.id;
}

function ArmsTable({ evaluation }: { evaluation: Evaluation }) {
  const primary = evaluation.experiment.primaryMetric;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[70rem] border-collapse text-left text-xs">
        <caption className="text-muted-foreground pb-2 text-left text-xs">
          One row per arm. Intervals are 95% over episodes; n is the number of episodes
          (or decisions, where marked). A pending arm was not run and has no numbers.
        </caption>
        <thead>
          <tr className="border-border border-b">
            <Th>Arm</Th>
            <Th>Brain · provider · model</Th>
            <Th>Seat configuration</Th>
            <Th>{primary.label}</Th>
            <Th>Decision success</Th>
            <Th>In a sight line</Th>
            <Th>Round trip p50 / p95</Th>
            <Th>Decisions</Th>
            <Th>Cost</Th>
          </tr>
        </thead>
        <tbody>
          {evaluation.arms.map((arm) => {
            const dm = arm.decisionMetrics;
            return (
              <tr key={arm.id} className="border-border border-b align-top">
                <th scope="row" className="px-2 py-2 text-left font-mono font-medium">
                  {armLabel(arm)}
                </th>
                {arm.status !== "complete" ? (
                  <td colSpan={8} className="px-2 py-2">
                    <strong>{arm.status.toUpperCase()}</strong> —{" "}
                    {arm.pendingReason ?? "no episodes"}
                  </td>
                ) : (
                  <>
                    <td className="px-2 py-2 font-mono">
                      {arm.brain.id} · {arm.brain.provider}
                      {arm.brain.models.length > 0
                        ? ` · ${arm.brain.models.join(", ")}`
                        : ""}
                      <div className="text-muted-foreground">
                        confidence: {arm.brain.confidenceSources.join(", ") || "none"}
                      </div>
                    </td>
                    <td className="max-w-[16rem] px-2 py-2 font-mono break-words">
                      {arm.config.query}
                    </td>
                    <td className="px-2 py-2 font-mono tabular-nums">
                      <Summary s={arm.aggregate[primary.id]} digits={3} />
                    </td>
                    <td className="px-2 py-2 font-mono tabular-nums">
                      {dm ? (
                        <>
                          {pct(dm.successRate)}
                          {dm.successInterval ? (
                            <span className="text-muted-foreground">
                              {" "}
                              [{pct(dm.successInterval.lo)}, {pct(dm.successInterval.hi)}]
                            </span>
                          ) : null}
                          <span className="text-muted-foreground">
                            {" "}
                            of {dm.scored} decisions
                          </span>
                        </>
                      ) : (
                        "n/a"
                      )}
                    </td>
                    <td className="px-2 py-2 font-mono tabular-nums">
                      <Summary s={arm.aggregate["exposure_fraction"]} />
                    </td>
                    <td className="px-2 py-2 font-mono tabular-nums">
                      {formatValue(arm.ledger.wallLatencyMs.median, 0)} /{" "}
                      {formatValue(arm.ledger.wallLatencyMs.p95, 0)} ms
                      <span className="text-muted-foreground">
                        {" "}
                        n={arm.ledger.wallLatencyMs.n}
                      </span>
                    </td>
                    <td className="px-2 py-2 font-mono tabular-nums">
                      {arm.ledger.decisions}
                    </td>
                    <td className="px-2 py-2 font-mono tabular-nums">
                      {usd(arm.ledger.cost.totalUsd)}
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EpisodesTable({
  evaluation,
  base,
}: {
  evaluation: Evaluation;
  base: string | null;
}) {
  const primary = evaluation.experiment.primaryMetric.id;
  return (
    <div className="max-h-[28rem] overflow-auto">
      <table className="w-full min-w-[60rem] border-collapse text-left text-xs">
        <caption className="text-muted-foreground pb-2 text-left text-xs">
          Every episode, with the files its numbers came from
          {base ? `, relative to ${base}` : ""}. Open a decision file below to see the
          episode decision by decision.
        </caption>
        <thead>
          <tr className="border-border border-b">
            <Th>Arm</Th>
            <Th>Seed</Th>
            <Th>Run id</Th>
            <Th>{primary}</Th>
            <Th>Sim s</Th>
            <Th>Decisions</Th>
            <Th>Paced</Th>
            <Th>Artifacts</Th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {evaluation.arms.flatMap((arm) =>
            arm.episodes.map((e) => (
              <tr key={e.runId} className="border-border border-b align-top">
                <th scope="row" className="px-2 py-1.5 text-left font-medium">
                  {arm.id}
                </th>
                <td className="px-2 py-1.5">{e.seed}</td>
                <td className="px-2 py-1.5">{e.runId}</td>
                <td className="px-2 py-1.5 tabular-nums">
                  {formatValue(e.metrics[primary], 3)}
                </td>
                <td className="px-2 py-1.5 tabular-nums">
                  {formatValue(e.simSeconds, 0)}
                </td>
                <td className="px-2 py-1.5 tabular-nums">{e.decisions}</td>
                <td className="px-2 py-1.5">{e.lagged ? "lagged" : "real time"}</td>
                <td className="px-2 py-1.5 break-all">
                  {[e.artifacts.report, e.artifacts.decisions, e.artifacts.trace]
                    .filter(Boolean)
                    .join(" · ")}
                </td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </div>
  );
}

function CalibrationPanel({ evaluation }: { evaluation: Evaluation }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {evaluation.arms
        .filter((arm) => arm.status === "complete")
        .map((arm) => {
          const c = arm.calibration;
          if (!c.available) {
            return (
              <div key={arm.id} className="border-border rounded-md border p-3 text-xs">
                <p className="font-mono font-medium">{armLabel(arm)}</p>
                <p className="text-muted-foreground mt-1">Not available: {c.reason}.</p>
              </div>
            );
          }
          return (
            <div key={arm.id} className="border-border rounded-md border p-3">
              <p className="font-mono text-xs font-medium">
                {armLabel(arm)} — {c.source}, {c.field} on {c.axis}
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                Brier {formatValue(c.brier, 4)} (base-rate predictor{" "}
                {formatValue(c.climatologyBrier, 4)}) · ECE {formatValue(c.ece, 4)} · n=
                {c.n} · adequacy: {c.adequacy}
              </p>
              <div className="mt-2 flex flex-wrap items-start gap-4">
                <ReliabilityDiagram bins={c.bins} label={arm.id} />
                <table className="border-collapse text-left text-[11px]">
                  <caption className="sr-only">Calibration bins for {arm.id}</caption>
                  <thead>
                    <tr className="border-border border-b">
                      <Th>Confidence</Th>
                      <Th>n</Th>
                      <Th>Stated</Th>
                      <Th>Observed</Th>
                    </tr>
                  </thead>
                  <tbody className="font-mono tabular-nums">
                    {c.bins.map((b) => (
                      <tr key={b.label} className="border-border border-b">
                        <th scope="row" className="px-2 py-1 font-medium">
                          {b.label}
                        </th>
                        <td className="px-2 py-1">
                          {b.n}
                          {b.n > 0 && !b.sufficient ? "*" : ""}
                        </td>
                        <td className="px-2 py-1">{formatValue(b.meanPredicted, 2)}</td>
                        <td className="px-2 py-1">
                          {pct(b.empirical)}
                          {b.interval ? (
                            <span className="text-muted-foreground">
                              {" "}
                              [{pct(b.interval.lo, 0)}, {pct(b.interval.hi, 0)}]
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {c.notes.length > 0 ? (
                <ul className="text-muted-foreground mt-2 list-disc pl-4 text-[11px]">
                  {c.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}
    </div>
  );
}

function LedgerTable({ evaluation }: { evaluation: Evaluation }) {
  const arms = evaluation.arms.filter((a) => a.status === "complete");
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[64rem] border-collapse text-left text-xs">
          <caption className="text-muted-foreground pb-2 text-left text-xs">
            The computational ledger. Unknown is printed as n/a, never as zero; a total is
            printed only when every call&rsquo;s cost is known. Prices come from the
            pricing configuration named in the provenance.
          </caption>
          <thead>
            <tr className="border-border border-b">
              <Th>Arm</Th>
              <Th>Calls (failed, timed out)</Th>
              <Th>Retries</Th>
              <Th>Round trip p50 / p90 / p95 / p99</Th>
              <Th>Provider latency p50</Th>
              <Th>Tokens in / out</Th>
              <Th>Decisions / min</Th>
              <Th>Cost, per min, per objective</Th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {arms.map((arm) => {
              const l = arm.ledger;
              return (
                <tr key={arm.id} className="border-border border-b align-top">
                  <th scope="row" className="px-2 py-1.5 text-left font-medium">
                    {armLabel(arm)}
                  </th>
                  <td className="px-2 py-1.5">
                    {l.calls} ({l.failures}, {l.timeouts})
                  </td>
                  <td className="px-2 py-1.5">{l.retries ?? "n/a"}</td>
                  <td className="px-2 py-1.5" title={l.wallLatencyMs.notes.join("; ")}>
                    {[
                      l.wallLatencyMs.median,
                      l.wallLatencyMs.p90,
                      l.wallLatencyMs.p95,
                      l.wallLatencyMs.p99,
                    ]
                      .map((v) => formatValue(v, 0))
                      .join(" / ")}{" "}
                    ms{" "}
                    <span className="text-muted-foreground">n={l.wallLatencyMs.n}</span>
                  </td>
                  <td className="px-2 py-1.5">
                    {formatValue(l.providerLatencyMs.median, 0)} ms
                  </td>
                  <td className="px-2 py-1.5">
                    {l.inputTokens.total ?? "n/a"} / {l.outputTokens.total ?? "n/a"}
                  </td>
                  <td className="px-2 py-1.5">{formatValue(l.decisionsPerMinute, 1)}</td>
                  <td className="px-2 py-1.5" title={l.cost.bases.join("; ")}>
                    {usd(l.cost.totalUsd)} · {usd(l.costPerMinuteUsd)} ·{" "}
                    {usd(l.costPerObjectiveUsd)}
                    {l.cost.unknownCalls > 0 ? (
                      <span className="text-muted-foreground">
                        {" "}
                        ({l.cost.unknownCalls} calls of unknown cost)
                      </span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {arms.map((arm) => (
          <figure key={arm.id} className="border-border rounded-md border p-3">
            <figcaption className="font-mono text-xs">
              {armLabel(arm)} — round trip, ms
            </figcaption>
            <LatencyHistogram
              edgesMs={arm.ledger.wallLatencyHistogram?.edgesMs ?? []}
              counts={arm.ledger.wallLatencyHistogram?.counts ?? []}
              label={arm.id}
            />
          </figure>
        ))}
      </div>
    </>
  );
}

function ValidationTable({ evaluation }: { evaluation: Evaluation }) {
  const arms = evaluation.arms.filter((a) => a.status === "complete");
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[64rem] border-collapse text-left text-xs">
        <caption className="text-muted-foreground pb-2 text-left text-xs">
          What happened to each accepted decision at execution, and why requests failed.
          &ldquo;World changed&rdquo; counts decisions that met a different world than
          they were shown; under the strict policy any whose choice had become illegal was
          refused.
        </caption>
        <thead>
          <tr className="border-border border-b">
            <Th>Arm</Th>
            <Th>Executed</Th>
            <Th>Refused stale</Th>
            <Th>Executed illegal</Th>
            <Th>Superseded / not run</Th>
            <Th>World changed</Th>
            <Th>Age at execution p50</Th>
            <Th>Recovery after refusal</Th>
            <Th>Failed requests</Th>
          </tr>
        </thead>
        <tbody className="font-mono tabular-nums">
          {arms.map((arm) => {
            const v = arm.validation;
            return (
              <tr key={arm.id} className="border-border border-b align-top">
                <th scope="row" className="px-2 py-1.5 text-left font-medium">
                  {armLabel(arm)}
                </th>
                <td className="px-2 py-1.5">{v.executed}</td>
                <td className="px-2 py-1.5">{v.rejectedStale}</td>
                <td className="px-2 py-1.5">{v.executedIllegal}</td>
                <td className="px-2 py-1.5">
                  {v.superseded} / {v.notExecuted}
                </td>
                <td className="px-2 py-1.5" title={JSON.stringify(v.worldChangeKinds)}>
                  {v.worldChanged}
                </td>
                <td className="px-2 py-1.5">
                  {formatValue(v.ageAtExecutionMs.median, 0)} ms
                </td>
                <td className="px-2 py-1.5">
                  <Summary s={v.recoveryAfterRejectionS} unit=" s" />
                </td>
                <td className="px-2 py-1.5">
                  {Object.entries(v.failures)
                    .map(([k, n]) => `${k} ${n}`)
                    .join(", ") || "none"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DecisionMetricsTable({ evaluation }: { evaluation: Evaluation }) {
  const arms = evaluation.arms.filter(
    (a) => a.status === "complete" && a.decisionMetrics,
  );
  if (arms.length === 0)
    return (
      <p className="text-muted-foreground text-sm">
        This experiment declared no decision type.
      </p>
    );
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[60rem] border-collapse text-left text-xs">
        <caption className="text-muted-foreground pb-2 text-left text-xs">
          Decisions the contract selected, and how their outcome windows were classed.
          Pooled over episodes; consecutive decisions share most of their window, so n
          overstates independent evidence.
        </caption>
        <thead>
          <tr className="border-border border-b">
            <Th>Arm</Th>
            <Th>Selected (scored)</Th>
            <Th>Beneficial / neutral / harmful</Th>
            <Th>Success</Th>
            <Th>Harm</Th>
            <Th>Measure</Th>
            <Th>By choice (n, success)</Th>
            <Th>Slot 0 chosen vs position-blind</Th>
          </tr>
        </thead>
        <tbody className="font-mono tabular-nums">
          {arms.map((arm) => {
            const d = arm.decisionMetrics!;
            return (
              <tr key={arm.id} className="border-border border-b align-top">
                <th scope="row" className="px-2 py-1.5 text-left font-medium">
                  {armLabel(arm)}
                </th>
                <td className="px-2 py-1.5">
                  {d.matched} ({d.scored})
                </td>
                <td className="px-2 py-1.5">
                  {d.classes.beneficial} / {d.classes.neutral} / {d.classes.harmful}
                </td>
                <td className="px-2 py-1.5">
                  {pct(d.successRate)}
                  {d.successInterval ? (
                    <span className="text-muted-foreground">
                      {" "}
                      [{pct(d.successInterval.lo, 0)}, {pct(d.successInterval.hi, 0)}]
                    </span>
                  ) : null}
                </td>
                <td className="px-2 py-1.5">{pct(d.harmfulRate)}</td>
                <td className="px-2 py-1.5">
                  {d.measure.name}: <Summary s={d.measure.summary} digits={3} />
                </td>
                <td className="max-w-[18rem] px-2 py-1.5 break-words">
                  {Object.entries(d.byChoice)
                    .slice(0, 6)
                    .map(([k, v]) => `${k} ${v.n}, ${pct(v.successRate, 0)}`)
                    .join(" · ")}
                </td>
                <td className="px-2 py-1.5">
                  {d.slotBias
                    ? `${pct(d.slotBias.firstShare)} vs ${pct(d.slotBias.expected)} (n=${d.slotBias.n})`
                    : "n/a"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EvaluationBody({
  evaluation,
  base,
}: {
  evaluation: Evaluation;
  base: string | null;
}) {
  const e = evaluation.experiment;
  const contract = e.decisionType ? decisionType(e.decisionType.id) : null;
  const [records, setRecords] = useState<EpisodeRecords | null>(null);
  const [recordsError, setRecordsError] = useState<string | null>(null);
  const strip = evaluation.arms.map((arm) => ({
    id: arm.id,
    label: armLabel(arm),
    values: arm.episodes
      .map((ep) => ({
        seed: ep.seed,
        runId: ep.runId,
        value: ep.metrics[e.primaryMetric.id],
      }))
      .filter(
        (v): v is { seed: number; runId: string; value: number } =>
          typeof v.value === "number",
      ),
    mean: arm.aggregate[e.primaryMetric.id]?.mean ?? null,
    ci: arm.aggregate[e.primaryMetric.id]?.ci95 ?? null,
    note: arm.status === "complete" ? null : `${arm.status}: ${arm.pendingReason ?? ""}`,
  }));
  return (
    <>
      <Section id="declared" title="What was declared before the run">
        <dl className="grid max-w-5xl gap-x-6 gap-y-2 text-sm md:grid-cols-[12rem_1fr]">
          <dt className="text-muted-foreground">Question</dt>
          <dd>{e.question}</dd>
          <dt className="text-muted-foreground">Hypothesis</dt>
          <dd>{e.hypothesis}</dd>
          <dt className="text-muted-foreground">Primary metric</dt>
          <dd>
            <span className="font-mono">{e.primaryMetric.id}</span> —{" "}
            {e.primaryMetric.description}
          </dd>
          <dt className="text-muted-foreground">Decision type</dt>
          <dd>
            {e.decisionType
              ? `${e.decisionType.id}: ${e.decisionType.rule}`
              : "none (episode metrics only)"}
          </dd>
          <dt className="text-muted-foreground">Design</dt>
          <dd>
            independent variable{" "}
            <span className="font-mono">{e.independentVariable}</span> · seeds{" "}
            {e.seeds.join(", ")}
            {e.seedPreset ? ` (preset ${e.seedPreset})` : ""} · {e.durationS} s per
            episode · {e.mode} · outcome window {e.outcomeWindowS} s
          </dd>
          <dt className="text-muted-foreground">Provenance</dt>
          <dd className="font-mono text-xs break-all">
            definition {e.definitionHash} · commit{" "}
            {String(evaluation.environment["gitCommit"] ?? "unknown")}
            {evaluation.environment["gitDirty"] ? " (+uncommitted)" : ""} · run{" "}
            {String(evaluation.provenance["runId"])} · overrides:{" "}
            {String(evaluation.provenance["overrides"])}
          </dd>
          <dt className="text-muted-foreground">Status</dt>
          <dd>
            <strong>{evaluation.status}</strong>
          </dd>
        </dl>
      </Section>

      <Section id="arms" title="Arms">
        <ArmsTable evaluation={evaluation} />
      </Section>

      <Section
        id="primary"
        title={`${e.primaryMetric.label}, per episode`}
        intro="Each dot is one episode; the bar is the arm's mean and the line its 95% interval. With three seeds the interval is wide on purpose."
      >
        <StripPlot
          rows={strip}
          unit={e.primaryMetric.unit}
          title={e.primaryMetric.label}
        />
        {evaluation.comparisons.length > 0 ? (
          <table className="mt-4 border-collapse text-left text-xs">
            <caption className="text-muted-foreground pb-2 text-left text-xs">
              Paired differences, arm minus reference, by seed.{" "}
              {evaluation.comparisons[0]!.difference.caveat}
            </caption>
            <thead>
              <tr className="border-border border-b">
                <Th>Metric</Th>
                <Th>Arm − reference</Th>
                <Th>Mean difference [95%]</Th>
                <Th>Seeds</Th>
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {evaluation.comparisons.map((c) => (
                <tr
                  key={`${c.metric}-${c.arm}-${c.reference}`}
                  className="border-border border-b"
                >
                  <td className="px-2 py-1">{c.metric}</td>
                  <th scope="row" className="px-2 py-1 text-left font-medium">
                    {c.arm} − {c.reference}
                  </th>
                  <td className="px-2 py-1">
                    {formatValue(c.difference.meanDifference, 3)}
                    {c.difference.ci95
                      ? ` [${formatValue(c.difference.ci95.lo, 3)}, ${formatValue(c.difference.ci95.hi, 3)}]`
                      : " (no interval)"}
                  </td>
                  <td className="px-2 py-1">{c.difference.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Section>

      <Section
        id="warnings"
        title="Warnings"
        intro="Patterns that have fooled this benchmark before, or could. A warning is a reason to look, not a verdict."
      >
        {evaluation.warnings.length === 0 ? (
          <p className="text-sm">None raised.</p>
        ) : (
          <ul className="space-y-2">
            {evaluation.warnings.map((w, i) => (
              <li
                key={`${w.id}-${w.arm}-${i}`}
                className="border-border rounded-md border px-3 py-2 text-sm"
              >
                <p>
                  <span aria-hidden="true">{w.severity === "warning" ? "⚠ " : "ⓘ "}</span>
                  <strong>{w.severity === "warning" ? "Warning" : "Note"}</strong> ·{" "}
                  <span className="font-mono">{w.id}</span>
                  {w.arm ? ` · ${w.arm}` : ""}: {w.message}
                </p>
                {w.possibleCauses.length > 0 ? (
                  <p className="text-muted-foreground mt-1 text-xs">
                    Possible causes: {w.possibleCauses.join("; ")}.
                  </p>
                ) : null}
                {w.suggestedRun ? (
                  <p className="text-muted-foreground mt-1 font-mono text-xs">
                    Run: {w.suggestedRun}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="decisions" title="Decisions under the declared contract">
        {e.decisionType ? (
          <p className="mb-2 max-w-4xl text-sm">{e.decisionType.rule}</p>
        ) : null}
        <DecisionMetricsTable evaluation={evaluation} />
      </Section>

      <Section
        id="calibration"
        title="Stated confidence against outcome"
        intro="Only for brains that state a number. The source is named: a provider's probability and a number an LLM wrote are different claims and are never pooled. Starred bins have fewer than 30 decisions."
      >
        <CalibrationPanel evaluation={evaluation} />
      </Section>

      {evaluation.sweeps.length > 0 ? (
        <Section id="sweep" title="Outcome against injected latency">
          {evaluation.sweeps.length >= 2 ? (
            <Legend items={evaluation.sweeps.map((s) => s.base)} />
          ) : null}
          <SweepChart
            metric={e.primaryMetric.label}
            unit={e.primaryMetric.unit}
            series={evaluation.sweeps.map((s) => ({
              id: s.base,
              points: s.points.map((p) => ({
                value: p.value,
                mean: p.primary.mean,
                lo: p.primary.ci95?.lo ?? null,
                hi: p.primary.ci95?.hi ?? null,
                n: p.primary.n,
              })),
            }))}
          />
          <ul className="mt-2 space-y-1 text-sm">
            {evaluation.sweeps.map((s) => (
              <li key={s.base}>
                <span className="font-mono">{s.base}</span>: {s.reading}
                {s.slopePer100ms ? (
                  <span className="text-muted-foreground">
                    {" "}
                    (slope {formatValue(s.slopePer100ms.estimate, 4)} per 100 ms
                    {s.slopePer100ms.interval
                      ? ` [${formatValue(s.slopePer100ms.interval.lo, 4)}, ${formatValue(s.slopePer100ms.interval.hi, 4)}]`
                      : ""}
                    , n={s.slopePer100ms.n})
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {evaluation.contribution ? (
        <Section
          id="contribution"
          title="Contribution: matched ablations"
          intro={evaluation.contribution.statement}
        >
          <table className="border-collapse text-left text-xs">
            <thead>
              <tr className="border-border border-b">
                <Th>Factor</Th>
                <Th>From → to</Th>
                <Th>Held fixed</Th>
                <Th>Paired difference [95%]</Th>
                <Th>Seeds</Th>
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {evaluation.contribution.contrasts.map((c) => (
                <tr key={`${c.from.arm}-${c.to.arm}`} className="border-border border-b">
                  <th scope="row" className="px-2 py-1 text-left font-medium">
                    {c.factor}
                  </th>
                  <td className="px-2 py-1">
                    {c.from.level} → {c.to.level}
                  </td>
                  <td className="px-2 py-1">
                    {Object.entries(c.heldFixed)
                      .filter(([k]) =>
                        evaluation.contribution!.factors.includes(k as never),
                      )
                      .map(([k, v]) => `${k}=${v}`)
                      .join(", ")}
                  </td>
                  <td className="px-2 py-1">
                    {formatValue(c.difference.meanDifference, 3)}
                    {c.difference.ci95
                      ? ` [${formatValue(c.difference.ci95.lo, 3)}, ${formatValue(c.difference.ci95.hi, 3)}]`
                      : ""}
                  </td>
                  <td className="px-2 py-1">{c.difference.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {evaluation.contribution.interactions.length > 0 ? (
            <ul className="mt-3 space-y-1 text-sm">
              {evaluation.contribution.interactions.map((i) => (
                <li key={i.factors.join("x")}>
                  Interaction {i.factors.join(" × ")}:{" "}
                  {formatValue(i.differenceOfDifferences, 3)} (n={i.seeds}).{" "}
                  <span className="text-muted-foreground">{i.note}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </Section>
      ) : null}

      <Section id="ledger" title="What the decisions cost">
        <LedgerTable evaluation={evaluation} />
      </Section>

      <Section id="validation" title="Staleness, refusals and failures">
        <ValidationTable evaluation={evaluation} />
      </Section>

      <Section id="episodes" title="Episodes and artifacts">
        <EpisodesTable evaluation={evaluation} base={base} />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className={button}>
            <FileSearch className="size-4" aria-hidden="true" />
            Open an episode&rsquo;s decision records (.eval.json or .eval.json.gz)
            <input
              type="file"
              accept=".json,.gz,application/json,application/gzip"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                readRecordsFile(file)
                  .then((r) => {
                    setRecords(r);
                    setRecordsError(null);
                  })
                  .catch((error: unknown) => {
                    setRecords(null);
                    setRecordsError(
                      error instanceof Error
                        ? error.message
                        : "The file could not be read.",
                    );
                  });
              }}
            />
          </label>
          {recordsError ? (
            <p role="alert" className="text-sm">
              {recordsError}
            </p>
          ) : null}
        </div>
        {records ? <DecisionTrace records={records} contract={contract} /> : null}
      </Section>

      <Section id="notes" title="Notes">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {evaluation.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </Section>
    </>
  );
}

function EvaluationView() {
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [label, setLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const archived = useMemo(() => Object.keys(ARCHIVED).sort().reverse(), []);

  useEffect(() => {
    document.title = "Blacksite evaluation — illustrative simulation";
  }, []);

  const accept = useCallback((value: unknown, from: string) => {
    const checked = validateEvaluation(value);
    if (!checked.ok) {
      setEvaluation(null);
      setError(`${from} is not a blacksite-evaluation/v1 file: ${checked.error}.`);
      return;
    }
    setError(null);
    setLabel(from);
    setEvaluation(checked.value);
  }, []);

  const loadArchived = useCallback(
    (path: string) => {
      const load = ARCHIVED[path];
      if (!load) return;
      load()
        .then((module) => accept(module.default, path))
        .catch(() => setError(`${path} could not be loaded.`));
    },
    [accept],
  );

  return (
    <div className="bg-background text-foreground h-full overflow-y-auto">
      <div className="mx-auto max-w-[100rem] px-4 py-8 sm:px-8">
        <header>
          <p className="font-mono text-[11px] tracking-[0.3em] text-amber-100 uppercase">
            Illustrative simulation — not operational data, not analysis of the site
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            Blacksite evaluation
          </h1>
          <p className="text-muted-foreground mt-3 max-w-4xl text-sm leading-relaxed">
            An evaluation asks what part of a result came from the decision model, and
            what came from the deterministic controllers, the environment, the observation
            and the scoring rule. This page reads one and shows its numbers next to the
            episodes and files they came from. It judges nothing: every rule it applies
            was declared in the experiment before it ran.
          </p>
          <nav aria-label="Related views" className="mt-5 flex flex-wrap gap-3">
            <Link to="/play" className={button}>
              <Crosshair className="size-4" aria-hidden="true" />
              Blacksite
            </Link>
          </nav>
        </header>

        <section
          aria-labelledby="open-heading"
          className="border-border mt-8 rounded-lg border p-4"
        >
          <h2 id="open-heading" className="text-lg font-semibold">
            Open an evaluation
          </h2>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className={button}>
              <Upload className="size-4" aria-hidden="true" />
              Load evaluation.json
              <input
                type="file"
                accept="application/json,.json"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  if (file.size > MAX_EVALUATION_BYTES) {
                    setError(`${file.name} is over 32 MB and was not read.`);
                    return;
                  }
                  file
                    .text()
                    .then((text) => accept(JSON.parse(text), file.name))
                    .catch(() => setError(`${file.name} is not JSON.`));
                }}
              />
            </label>
          </div>
          {archived.length > 0 ? (
            <>
              <p className="text-muted-foreground mt-4 text-xs">
                Archived in this repository, newest first (every one is a run that
                happened; none is an example):
              </p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {archived.map((path) => (
                  <li key={path}>
                    <button
                      type="button"
                      className={`${button} font-mono text-xs`}
                      onClick={() => loadArchived(path)}
                    >
                      {path
                        .replace("/docs/benchmarks/", "")
                        .replace("/evaluation.json", "")}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-muted-foreground mt-4 text-xs">
              No evaluation is archived in this build.
            </p>
          )}
          {error ? (
            <p
              role="alert"
              className="mt-3 rounded border border-amber-400/50 px-3 py-2 text-sm"
            >
              {error}
            </p>
          ) : null}
          {label ? (
            <p role="status" className="mt-3 font-mono text-xs">
              Showing {label}
            </p>
          ) : null}
        </section>

        {evaluation ? (
          <EvaluationBody
            evaluation={evaluation}
            base={
              label?.startsWith("/docs/")
                ? label.replace(/\/evaluation\.json$/, "").slice(1)
                : null
            }
          />
        ) : null}

        <footer className="border-border text-muted-foreground mt-12 border-t pt-6 text-xs leading-relaxed">
          <p>
            Blacksite is an illustrative simulation built on the Lop Nur Twin&rsquo;s
            public-source reconstruction. Nothing here is analysis of the real site, and a
            benchmark result here is a measurement of this build on the machine that ran
            it, not a ranking of models.
          </p>
        </footer>
      </div>
    </div>
  );
}
