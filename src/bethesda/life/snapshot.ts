/**
 * A snapshot of everything a running simulation holds, and its restore.
 *
 * A living fly (and the city around it) keeps its state in many objects:
 * the body, the controller and its navigation memory, the senses' pending
 * frames, the self-model, the people, the city's agents, and the positions of
 * every random stream. Writing a serializer per class would leave out
 * whatever the next change adds. This walks the object graph instead, from a
 * root, and records every object it reaches once (so shared objects stay
 * shared and cycles stay cycles), in a fixed order.
 *
 * A restore never builds a simulation from the record alone. The caller
 * builds a fresh one from the same genesis (the plain-data description it
 * was made from), and the record is written into it in place: an object of
 * the fresh graph found where the record had one of the same class is
 * refilled, keeping its identity, so the closures the constructors made
 * (which point at those objects) still point at the right ones.
 *
 * - **Random streams** are `mulberry32` closures; their positions are read
 *   with `streamPosition` and put back with `seekStream` (src/lib/noise.ts).
 * - **Shared constants.** An object the live graph shares with a fresh
 *   genesis graph (by identity) is module data, not state: it is recorded by
 *   its path in the genesis graph and found there again on restore.
 * - **Other functions** are the constructors' closures: on restore the fresh
 *   graph must hold a function at the same place, and that one is kept.
 * - **Refused**, saying where: symbols, bigints, accessors, non-enumerable or
 *   symbol-keyed properties, sparse arrays, and objects that are not plain
 *   data, arrays, maps, sets, typed arrays or instances of a known class.
 *
 * What it cannot see is state held only inside a closure (other than a
 * stream's position). A restore is therefore never trusted on its own:
 * `continuity.ts` checks it by re-snapshotting, and by stepping a restored
 * copy beside the original and comparing (criterion 2 of
 * docs/BETHESDA_CONTINUOUS_LIFE.md).
 *
 * Pure: no I/O, no clock, no randomness. Browser-safe.
 */
import { mulberry32, seekStream, streamPosition } from "../../lib/noise";

export const GRAPH_SCHEMA = "life-graph/v1" as const;

/** A value in the record: inline JSON, a reference to a node, or a number JSON cannot hold. */
export type GraphValue =
  | string
  | boolean
  | null
  | number
  | { r: number }
  | { n: "-0" | "NaN" | "Infinity" | "-Infinity" }
  | { u: 1 };

/** A step from an object to one of its values, in a path through the genesis graph. */
export type PathStep = string | number;

export type GraphNode =
  /** An object: its class (null for a plain object) and its own properties, in order. */
  | { t: "o"; c: string | null; z?: 1; e: [string, GraphValue][] }
  | { t: "a"; z?: 1; e: GraphValue[] }
  | { t: "m"; e: [GraphValue, GraphValue][] }
  | { t: "s"; e: GraphValue[] }
  | { t: "ta"; c: TypedArrayName; e: GraphValue[] }
  /** A mulberry32 stream at position `p`. */
  | { t: "rng"; p: number }
  /** A constructor's closure: the fresh graph's function at the same place is kept. */
  | { t: "fn" }
  /** Module data shared with the genesis graph, at path `p` there. */
  | { t: "sh"; p: PathStep[] };

export interface GraphSnapshot {
  schema: typeof GRAPH_SCHEMA;
  root: GraphValue;
  nodes: GraphNode[];
}

const TYPED = {
  Float64Array,
  Float32Array,
  Int32Array,
  Int16Array,
  Int8Array,
  Uint32Array,
  Uint16Array,
  Uint8Array,
  Uint8ClampedArray,
} as const;
type TypedArrayName = keyof typeof TYPED;
type TypedArray = InstanceType<(typeof TYPED)[TypedArrayName]>;

function typedName(v: object): TypedArrayName | null {
  for (const name of Object.keys(TYPED) as TypedArrayName[])
    if (v instanceof TYPED[name]) return name;
  return null;
}

const where = (path: readonly PathStep[]) =>
  path.length
    ? path.map((s) => (typeof s === "number" ? `[${s}]` : `.${s}`)).join("")
    : "(root)";

/**
 * The objects and functions reachable from `root`, each with the first path
 * that reaches it, in the same order `snapshotGraph` walks.
 */
export function indexGraph(root: unknown): Map<object, PathStep[]> {
  const index = new Map<object, PathStep[]>();
  const visit = (v: unknown, path: PathStep[]) => {
    if ((typeof v !== "object" || v === null) && typeof v !== "function") return;
    const o = v;
    if (index.has(o)) return;
    index.set(o, path);
    for (const [step, child] of children(o)) visit(child, [...path, step]);
  };
  visit(root, []);
  return index;
}

/** An object's values with the step that reaches each, in walk order. Functions hold none. */
function children(o: object): [PathStep, unknown][] {
  if (typeof o === "function") return [];
  if (o instanceof Map) {
    const out: [PathStep, unknown][] = [];
    let i = 0;
    for (const [k, v] of o) {
      out.push([`key ${i}`, k], [`value ${i}`, v]);
      i++;
    }
    return out;
  }
  if (o instanceof Set)
    return [...o].map((v, i): [PathStep, unknown] => [`member ${i}`, v]);
  if (ArrayBuffer.isView(o)) return [];
  if (Array.isArray(o)) return o.map((v, i): [PathStep, unknown] => [i, v]);
  return Object.keys(o).map((k): [PathStep, unknown] => [
    k,
    (o as Record<string, unknown>)[k],
  ]);
}

function encodeNumber(x: number): GraphValue {
  if (Number.isNaN(x)) return { n: "NaN" };
  if (x === Infinity) return { n: "Infinity" };
  if (x === -Infinity) return { n: "-Infinity" };
  if (Object.is(x, -0)) return { n: "-0" };
  return x;
}

function decodeNumber(v: GraphValue): number {
  if (typeof v === "number") return v;
  if (typeof v === "object" && v !== null && "n" in v) {
    const n = v.n;
    return n === "NaN"
      ? NaN
      : n === "Infinity"
        ? Infinity
        : n === "-Infinity"
          ? -Infinity
          : -0;
  }
  throw new Error("expected a number in a typed array");
}

/** The class name an object is recorded under: null for a plain object. */
function className(o: object): string | null {
  const proto = Object.getPrototypeOf(o) as object | null;
  if (proto === Object.prototype) return null;
  if (proto === null) return "(null prototype)";
  const ctor = (proto as { constructor?: unknown }).constructor;
  const name = typeof ctor === "function" ? ctor.name : "";
  if (!name) throw new Error("an object of an unnamed class");
  return name;
}

/** Check that every own property of `o` is a plain, enumerable, string-keyed value. */
function checkProperties(o: object, path: PathStep[], isArray: boolean): void {
  if (Object.getOwnPropertySymbols(o).length)
    throw new Error(`${where(path)} has symbol-keyed properties`);
  for (const key of Object.getOwnPropertyNames(o)) {
    if (isArray && key === "length") continue;
    const d = Object.getOwnPropertyDescriptor(o, key)!;
    if (!("value" in d)) throw new Error(`${where(path)}.${key} is an accessor`);
    if (!d.enumerable) throw new Error(`${where(path)}.${key} is not enumerable`);
  }
  if (isArray) {
    const a = o as unknown[];
    if (Object.keys(a).length !== a.length)
      throw new Error(`${where(path)} is not a dense array`);
  }
}

/**
 * Record everything reachable from `root`. `shared` (from `indexGraph` of a
 * fresh genesis instance) names the module data not to record.
 */
export function snapshotGraph(
  root: unknown,
  shared: ReadonlyMap<object, PathStep[]> = new Map(),
): GraphSnapshot {
  const ids = new Map<object, number>();
  const nodes: GraphNode[] = [];
  const value = (v: unknown, path: PathStep[]): GraphValue => {
    switch (typeof v) {
      case "string":
      case "boolean":
        return v;
      case "number":
        return encodeNumber(v);
      case "undefined":
        return { u: 1 };
      case "symbol":
      case "bigint":
        throw new Error(`${where(path)} is a ${typeof v}`);
    }
    if (v === null) return null;
    const o = v as object;
    const seen = ids.get(o);
    if (seen !== undefined) return { r: seen };
    const id = nodes.length;
    ids.set(o, id);
    nodes.push({ t: "fn" }); // a placeholder, so a cycle back here finds its id
    nodes[id] = node(o, path);
    return { r: id };
  };
  const node = (o: object, path: PathStep[]): GraphNode => {
    const at = shared.get(o);
    if (at) return { t: "sh", p: at };
    if (typeof o === "function") {
      const p = streamPosition(o as () => number);
      return p === null ? { t: "fn" } : { t: "rng", p };
    }
    if (o instanceof Map) {
      if (className(o) !== "Map") throw new Error(`${where(path)} is a subclass of Map`);
      const e: [GraphValue, GraphValue][] = [];
      let i = 0;
      for (const [k, v] of o) {
        e.push([value(k, [...path, `key ${i}`]), value(v, [...path, `value ${i}`])]);
        i++;
      }
      return { t: "m", e };
    }
    if (o instanceof Set) {
      if (className(o) !== "Set") throw new Error(`${where(path)} is a subclass of Set`);
      return { t: "s", e: [...o].map((v, i) => value(v, [...path, `member ${i}`])) };
    }
    if (ArrayBuffer.isView(o)) {
      const c = typedName(o);
      if (!c || className(o) !== c)
        throw new Error(`${where(path)} is an unsupported buffer view`);
      return { t: "ta", c, e: Array.from(o as TypedArray, encodeNumber) };
    }
    if (Array.isArray(o)) {
      if (className(o) !== "Array")
        throw new Error(`${where(path)} is a subclass of Array`);
      checkProperties(o, path, true);
      const e = o.map((v, i) => value(v, [...path, i]));
      return Object.isFrozen(o) ? { t: "a", z: 1, e } : { t: "a", e };
    }
    const c = className(o);
    if (
      o instanceof Date ||
      o instanceof RegExp ||
      o instanceof Error ||
      o instanceof Promise ||
      o instanceof WeakMap ||
      o instanceof WeakSet ||
      o instanceof ArrayBuffer
    )
      throw new Error(`${where(path)} is a ${c}, which a snapshot cannot hold`);
    checkProperties(o, path, false);
    const e = Object.keys(o).map((k): [string, GraphValue] => [
      k,
      value((o as Record<string, unknown>)[k], [...path, k]),
    ]);
    return Object.isFrozen(o) ? { t: "o", c, z: 1, e } : { t: "o", c, e };
  };
  const root_ = value(root, []);
  return { schema: GRAPH_SCHEMA, root: root_, nodes };
}

/** The prototypes of every class instance reachable from `root`, by class name. */
function prototypesOf(root: unknown): Map<string, object> {
  const out = new Map<string, object>();
  for (const o of indexGraph(root).keys()) {
    if (
      typeof o === "function" ||
      Array.isArray(o) ||
      o instanceof Map ||
      o instanceof Set
    )
      continue;
    if (ArrayBuffer.isView(o)) continue;
    const c = className(o);
    if (c === null || c === "(null prototype)") continue;
    const proto = Object.getPrototypeOf(o) as object;
    const had = out.get(c);
    if (had && had !== proto) throw new Error(`two classes are both named ${c}`);
    out.set(c, proto);
  }
  return out;
}

/**
 * Write `snapshot` into `fresh`, a simulation built from the same genesis,
 * and return the restored root (`fresh` itself, refilled). `classes` adds
 * prototypes for classes the fresh graph holds no instance of yet.
 */
export function restoreGraph<T>(
  snapshot: GraphSnapshot,
  fresh: T,
  classes: readonly (abstract new (...args: never[]) => unknown)[] = [],
): T {
  if (snapshot.schema !== GRAPH_SCHEMA)
    throw new Error(`a ${String(snapshot.schema)} snapshot is not a ${GRAPH_SCHEMA} one`);
  // Read before anything is refilled: the genesis graph's module data, by path, and its classes.
  const genesisAt = new Map<string, object>();
  for (const [o, path] of indexGraph(fresh)) genesisAt.set(JSON.stringify(path), o);
  const protos = prototypesOf(fresh);
  for (const c of classes) protos.set(c.name, c.prototype as object);
  const built = new Map<number, unknown>();
  const claimed = new Set<unknown>();
  const { nodes } = snapshot;

  /** A fresh object to refill for node `id`, if `fresh` (found at the same place) fits. */
  const reuse = <O>(candidate: unknown, fits: (c: unknown) => c is O): O | null =>
    fits(candidate) && !claimed.has(candidate) && !Object.isFrozen(candidate)
      ? candidate
      : null;

  const value = (v: GraphValue, counterpart: unknown): unknown => {
    if (v === null || typeof v === "string" || typeof v === "boolean") return v;
    if (typeof v === "number") return v;
    if ("u" in v) return undefined;
    if ("n" in v) return decodeNumber(v);
    return ref(v.r, counterpart);
  };

  const ref = (id: number, counterpart: unknown): unknown => {
    if (built.has(id)) return built.get(id);
    const n = nodes[id];
    if (!n) throw new Error(`the snapshot refers to node ${id}, which it does not hold`);
    switch (n.t) {
      case "sh": {
        const o = genesisAt.get(JSON.stringify(n.p));
        if (!o) throw new Error(`the genesis graph has nothing at ${where(n.p)}`);
        built.set(id, o);
        return o;
      }
      case "rng": {
        const live =
          typeof counterpart === "function" &&
          streamPosition(counterpart as () => number) !== null &&
          !claimed.has(counterpart)
            ? (counterpart as () => number)
            : mulberry32(0);
        seekStream(live, n.p);
        claimed.add(live);
        built.set(id, live);
        return live;
      }
      case "fn": {
        if (
          typeof counterpart !== "function" ||
          streamPosition(counterpart as () => number) !== null
        )
          throw new Error(
            `node ${id}: the fresh simulation holds no function where the snapshot had one`,
          );
        claimed.add(counterpart);
        built.set(id, counterpart);
        return counterpart;
      }
      case "m": {
        const m =
          reuse(counterpart, (c): c is Map<unknown, unknown> => c instanceof Map) ??
          new Map();
        claimed.add(m);
        built.set(id, m);
        const old = new Map(m);
        m.clear();
        for (const [k, v] of n.e) {
          const key = value(k, undefined);
          m.set(key, value(v, old.get(key)));
        }
        return m;
      }
      case "s": {
        const s =
          reuse(counterpart, (c): c is Set<unknown> => c instanceof Set) ?? new Set();
        claimed.add(s);
        built.set(id, s);
        s.clear();
        for (const v of n.e) s.add(value(v, undefined));
        return s;
      }
      case "ta": {
        const Ctor = TYPED[n.c];
        if (!Ctor) throw new Error(`node ${id}: unknown buffer view ${String(n.c)}`);
        const fits = (c: unknown): c is TypedArray =>
          c instanceof Ctor && (c as TypedArray).length === n.e.length;
        const ta = reuse(counterpart, fits) ?? new Ctor(n.e.length);
        claimed.add(ta);
        built.set(id, ta);
        n.e.forEach((x, i) => (ta[i] = decodeNumber(x)));
        return ta;
      }
      case "a": {
        const a =
          (n.z ? null : reuse(counterpart, (c): c is unknown[] => Array.isArray(c))) ??
          [];
        claimed.add(a);
        built.set(id, a);
        const old = a.slice();
        a.length = 0;
        n.e.forEach((v, i) => a.push(value(v, old[i])));
        if (n.z) Object.freeze(a);
        return a;
      }
      case "o": {
        const proto =
          n.c === null
            ? Object.prototype
            : n.c === "(null prototype)"
              ? null
              : protos.get(n.c);
        if (proto === undefined)
          throw new Error(`node ${id}: no ${n.c} to restore into (pass its class)`);
        const fits = (c: unknown): c is Record<string, unknown> =>
          typeof c === "object" &&
          c !== null &&
          !Array.isArray(c) &&
          Object.getPrototypeOf(c) === proto;
        const o =
          (n.z ? null : reuse(counterpart, fits)) ??
          (Object.create(proto) as Record<string, unknown>);
        claimed.add(o);
        built.set(id, o);
        const old: Record<string, unknown> = { ...o };
        // Every key goes back in the snapshot's order, so iteration order is restored too.
        for (const k of Object.keys(o)) delete o[k];
        for (const [k, v] of n.e) o[k] = value(v, old[k]);
        if (n.z) Object.freeze(o);
        return o;
      }
    }
  };

  const root = snapshot.root;
  if (typeof root !== "object" || root === null || !("r" in root))
    throw new Error("a snapshot's root is an object");
  const out = ref(root.r, fresh);
  if (out !== fresh)
    throw new Error("the snapshot's root did not restore into the fresh simulation");
  return out as T;
}
