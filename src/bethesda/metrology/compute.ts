/**
 * The bench's computational-cost measurement, kept apart from behaviour.
 *
 * One process, one run at a time, every controller on the same subjects with
 * the order rotated per seed and repetition so drift in the machine's speed
 * falls on all of them alike. Per run: CPU and wall time, decisions taken and
 * each decision's latency (the adapter's `decide`, timed from outside it),
 * the controller's serialized state size and the declared parameters it adds.
 * Overhead against the baseline is a paired ratio per (seed, repetition) with
 * a bootstrap interval.
 *
 * One machine's numbers: never hardware-independent, never in a verdict.
 */
import type { ControllerId } from "./controllers.js";
import type { Protocol } from "./protocol.js";
import { pairedInterval, type Interval } from "./statistics.js";

export const COMPUTE_SCHEMA = "eimb-compute/v1" as const;

export interface ComputeRow {
  controller: ControllerId;
  seed: number;
  rep: number;
  simulatedS: number;
  wallS: number;
  cpuS: number;
  decisions: number;
  decisionLatenciesMs: number[];
  heapDeltaMb: number;
  controllerStateBytes: number;
  plasticityStateBytes: number;
  addedParameters: number;
}

export interface ComputeReport {
  schema: typeof COMPUTE_SCHEMA;
  protocol: string;
  condition: string;
  machine: {
    commit: string;
    cleanSources: boolean;
    platform: string;
    arch: string;
    node: string;
    /** On mains or on battery while measured: a laptop on battery runs about half as fast. */
    power: "mains" | "battery" | "unknown";
    collectedAt: string;
  };
  design: { seeds: number[]; reps: number; simulatedS: number; order: string };
  rows: (Omit<ComputeRow, "decisionLatenciesMs"> & {
    latencyP50Ms: number;
    latencyP99Ms: number;
  })[];
  byController: Record<
    string,
    {
      runs: number;
      cpuSMedian: number;
      wallSMedian: number;
      simulatedSPerCpuS: number;
      decisionsPerRun: number;
      latencyP50Ms: number;
      latencyP95Ms: number;
      latencyP99Ms: number;
      controllerStateBytesMedian: number;
      plasticityStateBytesMedian: number;
      addedParameters: number;
      /** CPU time relative to the baseline on the same subject and repetition, minus one. */
      cpuOverhead: Interval | null;
    }
  >;
  note: string;
}

const quantile = (sorted: readonly number[], q: number): number =>
  sorted.length
    ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!
    : NaN;
const median = (xs: readonly number[]) =>
  quantile(
    [...xs].sort((a, b) => a - b),
    0.5,
  );

export function computeReport(
  p: Protocol,
  rows: readonly ComputeRow[],
  machine: ComputeReport["machine"] & { condition: string },
): ComputeReport {
  const byController: ComputeReport["byController"] = {};
  const ids = [...new Set(rows.map((r) => r.controller))];
  const base = rows.filter((r) => r.controller === p.baseline);
  for (const id of ids) {
    const rs = rows.filter((r) => r.controller === id);
    const lat = rs.flatMap((r) => r.decisionLatenciesMs).sort((a, b) => a - b);
    const ratios: number[] = [];
    for (const r of rs) {
      const b = base.find((x) => x.seed === r.seed && x.rep === r.rep);
      if (b && b.cpuS > 0) ratios.push(r.cpuS / b.cpuS - 1);
    }
    byController[id] = {
      runs: rs.length,
      cpuSMedian: median(rs.map((r) => r.cpuS)),
      wallSMedian: median(rs.map((r) => r.wallS)),
      simulatedSPerCpuS: median(rs.map((r) => r.simulatedS / r.cpuS)),
      decisionsPerRun: median(rs.map((r) => r.decisions)),
      latencyP50Ms: quantile(lat, 0.5),
      latencyP95Ms: quantile(lat, 0.95),
      latencyP99Ms: quantile(lat, 0.99),
      controllerStateBytesMedian: median(rs.map((r) => r.controllerStateBytes)),
      plasticityStateBytesMedian: median(rs.map((r) => r.plasticityStateBytes)),
      addedParameters: rs[0]!.addedParameters,
      cpuOverhead:
        id === p.baseline || !ratios.length
          ? null
          : pairedInterval(ratios, {
              resamples: p.analysis.resamples,
              seed: p.analysis.seed,
              label: `compute:${id}`,
              level: 0.95,
              direction: "lower",
            }),
    };
  }
  const { condition, ...m } = machine;
  return {
    schema: COMPUTE_SCHEMA,
    protocol: p.id,
    condition,
    machine: {
      commit: m.commit,
      cleanSources: m.cleanSources,
      platform: m.platform,
      arch: m.arch,
      node: m.node,
      power: m.power,
      collectedAt: m.collectedAt,
    },
    design: {
      seeds: [...new Set(rows.map((r) => r.seed))],
      reps: new Set(rows.map((r) => r.rep)).size,
      simulatedS: rows[0]?.simulatedS ?? 0,
      order:
        "controllers rotated per seed and repetition, one process, one run at a time",
    },
    rows: rows.map(({ decisionLatenciesMs, ...r }) => {
      const s = [...decisionLatenciesMs].sort((a, b) => a - b);
      return { ...r, latencyP50Ms: quantile(s, 0.5), latencyP99Ms: quantile(s, 0.99) };
    }),
    byController,
    note: "Measured on the one machine named here, with nothing else of the bench running. Not hardware-independent; never part of a behavioural verdict. Decision latency is the controller's `decide` alone; the body's physics between decisions is in CPU time.",
  };
}

const f = (x: number | null | undefined, d = 3) =>
  x === null || x === undefined || !Number.isFinite(x) ? "n/a" : x.toFixed(d);

export function renderCompute(r: ComputeReport): string {
  const L = [
    `# ECHO Intelligence Metrology Bench: compute, ${r.protocol}`,
    "",
    "Generated by `scripts/echo-metrology.ts compute`. Do not edit by hand.",
    "",
    `- Condition \`${r.condition}\`, ${r.design.simulatedS} simulated s per run, seeds ${r.design.seeds.join(", ")}, ${r.design.reps} repetition(s); ${r.design.order}.`,
    `- Machine: ${r.machine.platform} ${r.machine.arch}, Node ${r.machine.node}, on ${r.machine.power === "unknown" ? "unknown power" : r.machine.power}; code \`${r.machine.commit}\`${r.machine.cleanSources ? "" : " (sources not clean)"}; ${r.machine.collectedAt}.`,
    `- ${r.note}`,
    "",
    "| controller | runs | median CPU s | simulated s per CPU s | decisions per run | decision p50 ms | p95 ms | p99 ms | state bytes | plasticity state bytes | added parameters | CPU overhead vs baseline (95%) |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
  ];
  for (const [id, c] of Object.entries(r.byController))
    L.push(
      `| ${id} | ${c.runs} | ${f(c.cpuSMedian, 2)} | ${f(c.simulatedSPerCpuS, 0)} | ${f(c.decisionsPerRun, 0)} | ${f(c.latencyP50Ms, 4)} | ${f(c.latencyP95Ms, 4)} | ${f(c.latencyP99Ms, 4)} | ${f(c.controllerStateBytesMedian, 0)} | ${f(c.plasticityStateBytesMedian, 0)} | ${c.addedParameters} | ${c.cpuOverhead ? `${f(c.cpuOverhead.mean * 100, 1)}% (${f(c.cpuOverhead.low * 100, 1)}% to ${f(c.cpuOverhead.high * 100, 1)}%)` : "baseline"} |`,
    );
  L.push(
    "",
    "Performance gained per unit of added computation is defined only for an improvement the behavioural verdict demonstrates; where none is demonstrated the bench reports the cost and leaves the ratio undefined rather than divide by noise.",
    "",
  );
  return L.join("\n");
}
