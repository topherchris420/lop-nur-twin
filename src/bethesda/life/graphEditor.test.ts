/**
 * `Graph.import` and `Graph.canonical` (echoUpgrade.ts) are what every recorded
 * continuation hashes through: a migration's projection digest is compared
 * with digests sealed into checkpoints, so their bytes are not an
 * implementation detail. `referenceImport` is the definition they were first
 * written as — deep-clone each node, then rebase its entries — and these hold
 * the faster code to it, on hand-made edge cases and on a real city's graph.
 */
import { describe, expect, it } from "vitest";
import { Graph } from "./echoUpgrade";
import { BETHESDA_LIFE, headlessGenesis } from "./headless";
import {
  GRAPH_SCHEMA,
  indexGraph,
  snapshotGraph,
  type GraphNode,
  type GraphSnapshot,
  type GraphValue,
} from "./snapshot";

function referenceImport(
  target: GraphSnapshot,
  source: Graph,
  value: GraphValue,
): GraphValue {
  const ids = new Map<number, number>();
  const copy = (v: GraphValue): GraphValue => {
    if (typeof v !== "object" || v === null || !("r" in v)) return structuredClone(v);
    const seen = ids.get(v.r);
    if (seen !== undefined) return { r: seen };
    const id = target.nodes.length;
    ids.set(v.r, id);
    target.nodes.push({ t: "fn" });
    const n = structuredClone(source.node(v));
    if (n.t === "o") n.e = n.e.map(([k, x]) => [k, copy(x)]);
    if (n.t === "a" || n.t === "s" || n.t === "ta") n.e = n.e.map(copy);
    if (n.t === "m") n.e = n.e.map(([k, x]) => [copy(k), copy(x)]);
    target.nodes[id] = n;
    return { r: id };
  };
  return copy(value);
}

function referenceCanonical(g: Graph): GraphSnapshot {
  const out: GraphSnapshot = { schema: GRAPH_SCHEMA, root: null, nodes: [] };
  out.root = referenceImport(out, g, g.snapshot.root);
  return out;
}

/** Not shapes the snapshotter writes: what a hand-edited or damaged record could hold. */
const malformed = (n: object) => n as unknown as GraphNode;
const odd = (v: object) => v as unknown as GraphValue;

/**
 * Every node kind, out of walk order, with an alias, a cycle, a frozen object,
 * unreachable nodes, every non-JSON number, and malformed nodes carrying
 * fields and nesting the snapshotter never writes.
 */
function everyKind(): GraphSnapshot {
  return {
    schema: GRAPH_SCHEMA,
    root: { r: 5 },
    nodes: [
      { t: "a", e: [1, "x", true, null, { n: "NaN" }, { u: 1 }, { r: 5 }, { r: 2 }] },
      { t: "o", c: "Unreachable", e: [["back", { r: 5 }]] },
      {
        t: "m",
        e: [
          [{ r: 0 }, "by object"],
          ["by string", { r: 3 }],
        ],
      },
      { t: "s", e: [{ r: 4 }, 2, { r: 4 }] },
      { t: "ta", c: "Float64Array", e: [0.5, { n: "-0" }, { n: "Infinity" }, -3] },
      {
        t: "o",
        c: "Root",
        e: [
          ["list", { r: 0 }],
          ["sameList", { r: 0 }],
          ["map", { r: 2 }],
          ["rng", { r: 6 }],
          ["closure", { r: 7 }],
          ["module", { r: 8 }],
          ["frozen", { r: 9 }],
          ["odd", { r: 10 }],
          ["unknownKind", { r: 11 }],
          ["nestedLeaf", odd({ n: { deeper: [1, { x: true }] } })],
          ["minusInfinity", { n: "-Infinity" }],
          ["nothing", null],
        ],
      },
      { t: "rng", p: 42 },
      { t: "fn" },
      { t: "sh", p: ["cityFly", 3, "table"] },
      { t: "o", c: null, z: 1, e: [["k", 1]] },
      malformed({
        t: "o",
        extra: { nested: [1, { more: true }] },
        c: "Odd",
        e: [["v", { r: 9 }, "a third element"]],
      }),
      malformed({ t: "zz", e: [{ r: 5 }], p: [1, [2]] }),
      { t: "o", c: "AlsoUnreachable", e: [] },
    ],
  };
}

/** Change every object and array reachable from `root`, in place. */
function scribble(root: unknown): void {
  const seen = new Set<object>();
  const walk = (v: unknown) => {
    if (typeof v !== "object" || v === null || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) {
      for (const x of [...v]) walk(x);
      v.push("scribbled");
      return;
    }
    const o = v as Record<string, unknown>;
    for (const x of Object.values(o)) walk(x);
    o.scribbled = true;
  };
  walk(root);
}

describe("the graph editor's copy", () => {
  it("is byte for byte the deep-clone definition, malformed nodes included", () => {
    const g = new Graph(everyKind());
    expect(JSON.stringify(g.canonical())).toBe(JSON.stringify(referenceCanonical(g)));
  });

  it("rebases into a graph that already has nodes, and starts each import afresh", () => {
    const target = () => new Graph(everyKind());
    const source = new Graph(everyKind());
    const ours = target();
    const theirs = target();
    for (const path of [["map"], ["list"], ["map"], ["odd"], []] as const) {
      const value = source.get(path);
      expect(ours.import(source, value)).toEqual(
        referenceImport(theirs.snapshot, source, value),
      );
    }
    expect(JSON.stringify(ours.snapshot)).toBe(JSON.stringify(theirs.snapshot));
  });

  it("shares nothing with its source, in either direction", () => {
    const g = new Graph(everyKind());
    const before = JSON.stringify(g.snapshot);
    const out = g.canonical();
    const copied = JSON.stringify(out);
    scribble(out);
    expect(JSON.stringify(g.snapshot)).toBe(before);
    const again = g.canonical();
    scribble(g.snapshot);
    expect(JSON.stringify(again)).toBe(copied);
  });

  it("refuses a reference to a node that is not there, as it always did", () => {
    const s = everyKind();
    s.nodes[5] = { t: "o", c: "Root", e: [["gone", { r: 99 }]] };
    expect(() => new Graph(s).canonical()).toThrow("missing graph node");
  });

  it("is byte for byte the deep-clone definition on a living city's graph", () => {
    const genesis = headlessGenesis({
      seed: 193884,
      pedestrians: 1,
      vehicles: 0,
      buses: 0,
      statisticalPopulation: 4,
    });
    const life = BETHESDA_LIFE.build(genesis);
    life.advanceTicks(20);
    const g = new Graph(snapshotGraph(life, indexGraph(BETHESDA_LIFE.build(genesis))));
    expect(g.snapshot.nodes.length).toBeGreaterThan(10_000);
    expect(JSON.stringify(g.canonical())).toBe(JSON.stringify(referenceCanonical(g)));
  }, 60_000);
});
