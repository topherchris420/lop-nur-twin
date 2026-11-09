/**
 * `/metrology`: the ECHO Intelligence Metrology Bench's archives, read-only.
 * Shows a split only when `gateArchive` can check it in the browser; never
 * runs a simulation, never fetches anything but the committed files, and uses
 * green only for a criterion that passed.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  MinusCircle,
  TrendingDown,
  XCircle,
} from "lucide-react";
import type { Comparison, Summary } from "../analysis.js";
import { fmt, IntervalChart, type IntervalRow } from "./IntervalChart.js";
import { gateArchive, type Gate } from "./archiveGate.js";

const FILES = import.meta.glob<string>(
  "/docs/benchmarks/echo-metrology/*/*/{summary,manifest,verification,protocol}.json",
  { query: "?raw", import: "default" },
);

interface ArchiveRef {
  protocol: string;
  split: string;
  load: () => Promise<Gate>;
}

function archives(): ArchiveRef[] {
  const by = new Map<string, Record<string, () => Promise<string>>>();
  for (const [path, load] of Object.entries(FILES)) {
    const m =
      /\/echo-metrology\/([^/]+)\/([^/]+)\/(summary|manifest|verification|protocol)\.json$/.exec(
        path,
      );
    if (!m) continue;
    const key = `${m[1]}/${m[2]}`;
    const entry = by.get(key) ?? {};
    entry[m[3]!] = load;
    by.set(key, entry);
  }
  return [...by.entries()]
    .map(([key, f]) => {
      const [protocol, split] = key.split("/") as [string, string];
      return {
        protocol,
        split,
        load: async () =>
          gateArchive({
            summary: await f.summary?.(),
            manifest: await f.manifest?.(),
            verification: await f.verification?.(),
            protocol: await f.protocol?.(),
          }),
      };
    })
    .sort((a, b) =>
      a.protocol === b.protocol
        ? a.split === "heldout"
          ? -1
          : 1
        : a.protocol < b.protocol
          ? -1
          : 1,
    );
}

/** Status colours from the data-viz palette: always with an icon and a word, never alone. */
const GOOD = "#0ca30c",
  WARNING = "#fab219",
  CRITICAL = "#d03b3b";

const VERDICT: Record<
  string,
  { word: string; color: string | null; Icon: typeof CheckCircle2 }
> = {
  IMPROVEMENT: { word: "Improvement demonstrated", color: GOOD, Icon: CheckCircle2 },
  NO_DEMONSTRATED_IMPROVEMENT: {
    word: "No demonstrated improvement",
    color: null,
    Icon: MinusCircle,
  },
  INCONCLUSIVE: { word: "Inconclusive evidence", color: WARNING, Icon: AlertTriangle },
  REGRESSION: { word: "Performance regression", color: CRITICAL, Icon: TrendingDown },
  INVALID: { word: "Invalid experiment", color: CRITICAL, Icon: Ban },
};

function Verdict({ v, big = false }: { v: string; big?: boolean }) {
  const s = VERDICT[v] ?? { word: v, color: null, Icon: MinusCircle };
  return (
    <span
      className={`inline-flex items-center gap-1.5 ${big ? "text-xl font-semibold" : "font-mono text-xs"}`}
    >
      <s.Icon
        aria-hidden="true"
        className={big ? "h-6 w-6" : "h-3.5 w-3.5"}
        style={{ color: s.color ?? "var(--muted-foreground)" }}
      />
      {big ? `${s.word} (${v})` : v}
    </span>
  );
}

function Passed({ ok }: { ok: boolean }) {
  return ok ? (
    <span className="inline-flex items-center gap-1">
      <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" style={{ color: GOOD }} />{" "}
      passed
    </span>
  ) : (
    <span className="inline-flex items-center gap-1">
      <XCircle aria-hidden="true" className="h-3.5 w-3.5" style={{ color: CRITICAL }} />{" "}
      failed
    </span>
  );
}

function Section({
  id,
  title,
  intro,
  children,
}: {
  id: string;
  title: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="mt-10">
      <h2 id={id} className="text-lg font-semibold">
        {title}
      </h2>
      {intro ? (
        <p className="text-muted-foreground mt-1 max-w-3xl text-sm leading-relaxed">
          {intro}
        </p>
      ) : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Table({
  caption,
  head,
  rows,
}: {
  caption: string;
  head: string[];
  rows: ReactNode[][];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] border-collapse text-left text-xs">
        <caption className="text-muted-foreground pb-2 text-left">{caption}</caption>
        <thead>
          <tr className="border-border border-b">
            {head.map((h) => (
              <th
                key={h}
                scope="col"
                className="px-2 py-1.5 font-semibold whitespace-nowrap"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-border border-b align-top">
              {r.map((c, j) =>
                j === 0 ? (
                  <th key={j} scope="row" className="px-2 py-1.5 text-left font-normal">
                    {c}
                  </th>
                ) : (
                  <td key={j} className="px-2 py-1.5 font-mono tabular-nums">
                    {c}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const interval = (c: { interval: { level: number; low: number; high: number } }) =>
  `${fmt(c.interval.level * 100, 1)}% ${fmt(c.interval.low)} to ${fmt(c.interval.high)}`;

function comparisonRows(
  cs: Comparison[],
  candidate: string,
  novel: readonly string[],
): IntervalRow[] {
  return cs.map((c) => ({
    key: c.id,
    label: c.condition,
    detail: `${c.contrast.join(" − ")}${novel.includes(c.condition) ? " · unseen by the candidate" : ""}`,
    note: c.verdict === "NO_DEMONSTRATED_IMPROVEMENT" ? undefined : c.verdict,
    series: c.contrast[0] === candidate ? 0 : 1,
    mean: c.interval.mean,
    low: c.interval.low,
    high: c.interval.high,
    level: c.interval.level,
    verdict: c.verdict,
  }));
}

function SplitView({ s, gate }: { s: Summary; gate: Extract<Gate, { shown: true }> }) {
  const candidate = s.confirmatory[0]?.contrast[0] ?? "";
  const baseline = s.confirmatory[0]?.contrast[1] ?? "";
  const boundaryMme = s.boundary[0]?.mme ?? 0;
  const control = s.boundary.find((b) => b.contrast[0] !== candidate)?.contrast[0];
  const v = gate.verification;
  return (
    <>
      <Section id="verification" title="Verification">
        <p className="text-sm">
          <Passed ok={v.status === "VERIFIED"} />{" "}
          <span className="font-mono">{v.status}</span>: {v.replay.detail}.
        </p>
        <p className="text-muted-foreground mt-1 font-mono text-xs">
          manifest <span className="break-all">{gate.manifestDigest}</span> · verifier{" "}
          {v.verifier.commit.slice(0, 12)} ({v.verifier.platform}, Node {v.verifier.node})
          · summary and protocol re-hashed in this browser
        </p>
      </Section>

      <Section
        id="verdict"
        title="Verdict"
        intro="Fixed by the protocol's decision rules before the run; a verdict is not a score."
      >
        <Verdict v={s.verdict.overall} big />
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
          {s.verdict.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </Section>

      <Section
        id="confirmatory"
        title="Confirmatory endpoints"
        intro={`${candidate} − ${baseline} under the confirmatory impairment, per research subject, Bonferroni-corrected.`}
      >
        {s.confirmatory.map((c) => (
          <IntervalChart
            key={c.id}
            rows={comparisonRows([c], candidate, gate.novel)}
            mme={c.mme}
            unit={c.metric === "fedJ" ? "J" : c.metric}
            legend={[{ series: 0, label: `${c.contrast.join(" − ")}` }]}
            caption={`${c.id}: ${c.metric}, n = ${c.interval.n} subjects; ${c.interval.better} better, ${c.interval.worse} worse, ${c.interval.tied} tied.`}
          />
        ))}
      </Section>

      <Section
        id="boundary"
        title="Where an effect holds"
        intro={`The boundary family: energy taken in, in every condition, corrected over the whole family. ${gate.novel.length} of the ${s.design.conditions.length} conditions were never met by the candidate's development. A regression here means the interval lies wholly on the worse side of zero, even when it is smaller than δ.`}
      >
        <IntervalChart
          rows={comparisonRows(s.boundary, candidate, gate.novel)}
          mme={boundaryMme}
          unit="J"
          legend={[
            { series: 0, label: `${candidate} − ${baseline}` },
            ...(control
              ? [{ series: 1 as const, label: `${control} − ${baseline}` }]
              : []),
          ]}
          caption={`fedJ difference per condition, ${s.boundary[0] ? fmt(s.boundary[0].interval.level * 100, 1) : ""}% intervals.`}
        />
      </Section>

      <Section id="mechanism" title="Which part of the mechanism">
        <Table
          caption="Contrasts that separate acting on what was learned (against the shadow, which learns but never acts) from simply walking slower (fixed-slow), in the confirmatory condition."
          head={["contrast", "mean diff (J)", "interval", "δ", "verdict"]}
          rows={s.mechanism.map((m) => [
            m.contrast.join(" − "),
            fmt(m.interval.mean),
            interval(m),
            m.mme,
            <Verdict key="v" v={m.verdict} />,
          ])}
        />
      </Section>

      <Section
        id="guardrails"
        title="Guardrails"
        intro="Harm the candidate must not cause; a regression turns an improvement into a trade-off."
      >
        <Table
          caption="95% intervals, uncorrected, to stay sensitive to harm."
          head={["metric", "mean diff", "interval", "regressed"]}
          rows={s.guardrails.map((g) => [
            g.metric,
            fmt(g.interval.mean),
            interval(g),
            g.regression ? "yes" : "no",
          ])}
        />
      </Section>

      <Section
        id="sensitivity"
        title="Assay sensitivity"
        intro="Did each impairment cost the baseline anything? Where it did not, no controller could have shown compensation, and a null result there says nothing about it."
      >
        <Table
          caption="Baseline in each condition minus baseline unimpaired, energy taken in (J)."
          head={["condition", "mean diff", "interval", "reading"]}
          rows={s.impairmentCost.map((c) => [
            c.condition,
            fmt(c.interval.mean),
            interval(c),
            c.sensitive ? "cost detected" : `cost not detected (${c.reading})`,
          ])}
        />
      </Section>

      <Section id="validity" title="Validity checks">
        <Table
          caption="Any failed check makes the experiment INVALID."
          head={["check", "result", "detail"]}
          rows={s.validity.checks.map((c) => [
            c.id,
            <Passed key="p" ok={c.passed} />,
            <span key="d" className="font-sans">
              {c.detail}
            </span>,
          ])}
        />
      </Section>

      <Section
        id="learning"
        title="What the candidate learned"
        intro="Internal measures. Whether they helped is decided by the behavioural tables above, never by these."
      >
        <Table
          caption={`${candidate} per condition.`}
          head={[
            "condition",
            "detected",
            "mean detection s",
            "false alarms",
            "walking decisions slowed / run",
            "released",
          ]}
          rows={s.learning
            .filter((l) => l.controller === candidate && l.plasticity)
            .map((l) => [
              l.condition,
              `${fmt(l.plasticity!.detectedShare * 100, 0)}%`,
              fmt(l.plasticity!.detectionMeanS, 0),
              `${fmt(l.plasticity!.falseAlarmShare * 100, 0)}%`,
              fmt(l.plasticity!.adaptationsMean, 0),
              l.plasticity!.releasedShare === null
                ? "—"
                : `${fmt(l.plasticity!.releasedShare * 100, 0)}%`,
            ])}
        />
      </Section>

      <Section id="questions" title="The six questions">
        <dl className="space-y-4 text-sm">
          {s.answers.map((a) => (
            <div key={a.id}>
              <dt className="font-semibold">
                {a.id}. {a.question}
              </dt>
              <dd className="text-muted-foreground mt-1 leading-relaxed">{a.answer}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </>
  );
}

export default function MetrologyView() {
  const list = useMemo(archives, []);
  const [chosen, setChosen] = useState(0);
  const [gate, setGate] = useState<Gate | null>(null);
  const ref = list[chosen];
  useEffect(() => {
    let live = true;
    setGate(null);
    ref?.load().then(
      (g) => live && setGate(g),
      (e: unknown) => live && setGate({ shown: false, reasons: [String(e)] }),
    );
    return () => {
      live = false;
    };
  }, [ref]);

  return (
    <main className="bg-background text-foreground h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <p className="text-muted-foreground font-mono text-[11px] tracking-widest uppercase">
          ECHO Intelligence Metrology Bench · research subjects only
        </p>
        <h1 className="mt-2 text-2xl font-semibold">
          {gate?.shown ? gate.summary.protocol.title : "Measured adaptive behaviour"}
        </h1>
        <p className="text-muted-foreground mt-2 max-w-3xl text-sm leading-relaxed">
          Paired, pre-registered comparisons of real controllers on separately
          instantiated research flies. No universal intelligence score, no result from the
          two original individuals, and nothing here is promoted to either living
          simulation.
        </p>

        {list.length > 1 ? (
          <div
            role="radiogroup"
            aria-label="Archive"
            className="mt-6 flex flex-wrap gap-2"
          >
            {list.map((a, i) => (
              <button
                key={`${a.protocol}/${a.split}`}
                role="radio"
                aria-checked={i === chosen}
                onClick={() => setChosen(i)}
                className={`border-border rounded-full border px-3 py-1 font-mono text-xs ${i === chosen ? "bg-secondary" : ""}`}
              >
                {a.protocol} · {a.split === "heldout" ? "held-out" : a.split}
              </button>
            ))}
          </div>
        ) : null}

        {!ref ? (
          <p className="mt-8 text-sm">No archive is committed yet.</p>
        ) : !gate ? (
          <p className="text-muted-foreground mt-8 text-sm" aria-live="polite">
            Checking the archive…
          </p>
        ) : !gate.shown ? (
          <div className="border-border mt-8 rounded-md border p-4 text-sm" role="alert">
            <p className="flex items-center gap-2 font-semibold">
              <XCircle
                aria-hidden="true"
                className="h-4 w-4"
                style={{ color: CRITICAL }}
              />
              Not shown: this archive could not be verified in the browser.
            </p>
            <ul className="mt-2 list-disc pl-5">
              {gate.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        ) : (
          <>
            <p className="text-muted-foreground mt-6 font-mono text-xs break-all">
              {gate.summary.protocol.id} · {gate.summary.split} · protocol{" "}
              {gate.summary.protocol.digest.slice(0, 16)}… ·{" "}
              {gate.summary.design.seeds.length} subjects ×{" "}
              {gate.summary.design.conditions.length} conditions ·{" "}
              {gate.summary.design.recordsPresent} runs
            </p>
            <SplitView s={gate.summary} gate={gate} />
          </>
        )}

        <p className="text-muted-foreground mt-12 text-xs">
          Method, controls and limits:{" "}
          <span className="font-mono">docs/ECHO_INTELLIGENCE_METROLOGY.md</span>. Raw
          records, reports and manifests:{" "}
          <span className="font-mono">docs/benchmarks/echo-metrology/</span>.
        </p>
      </div>
    </main>
  );
}
