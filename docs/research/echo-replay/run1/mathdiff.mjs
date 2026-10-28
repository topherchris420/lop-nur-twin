// Cross-architecture differential for V8's Math functions.
// Evaluates each function over a fixed, seeded input set and prints, per
// function, a SHA-256 of the exact output bits. With --dump DIR it also writes
// every input/output pair as raw float64 so two platforms can be diffed bit
// for bit. Pure: no clock, no randomness beyond a fixed mulberry32 seed.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const N = Number(process.env.MATHDIFF_N ?? 2_000_000);
const dumpAt = process.argv.indexOf("--dump");
const dump = dumpAt >= 0 ? process.argv[dumpAt + 1] : null;
if (dump) mkdirSync(dump, { recursive: true });

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Input generators: ranges the fly's body and ECHO actually use, plus wide ones.
const R = (lo, hi) => (u) => lo + (hi - lo) * u();
const logU = (lo, hi) => (u) => Math.pow(10, lo + (hi - lo) * u()); // log-uniform magnitude
const unary = {
  sin: [Math.sin, [R(-4, 4), R(-100, 100), R(-1e4, 1e4)]],
  cos: [Math.cos, [R(-4, 4), R(-100, 100), R(-1e4, 1e4)]],
  tan: [Math.tan, [R(-1.5, 1.5), R(-100, 100)]],
  exp: [Math.exp, [R(-50, 0), R(-5, 5), R(-700, 700)]],
  expm1: [Math.expm1, [R(-5, 5), R(-1e-3, 1e-3)]],
  log: [Math.log, [R(1e-12, 1), logU(-300, 300), R(0.5, 2)]],
  log1p: [Math.log1p, [R(-0.999, 5), R(-1e-3, 1e-3)]],
  log2: [Math.log2, [logU(-300, 300)]],
  log10: [Math.log10, [logU(-300, 300)]],
  asin: [Math.asin, [R(-1, 1)]],
  acos: [Math.acos, [R(-1, 1)]],
  atan: [Math.atan, [R(-10, 10), logU(-10, 10)]],
  sinh: [Math.sinh, [R(-20, 20)]],
  cosh: [Math.cosh, [R(-20, 20)]],
  tanh: [Math.tanh, [R(-20, 20)]],
  cbrt: [Math.cbrt, [logU(-300, 300)]],
  sqrt: [Math.sqrt, [logU(-300, 300)]],
};
const binary = {
  atan2: [Math.atan2, [R(-10, 10), R(-10, 10)]],
  pow: [Math.pow, [R(0, 10), R(-10, 10)]],
  pow10: [(e) => Math.pow(10, e), null],
  hypot2: [Math.hypot, [R(-10, 10), R(-10, 10)]],
  hypot3: [(a, b, c) => Math.hypot(a, b, c), null],
};

const out = { platform: `${process.platform} ${process.arch}`, node: process.version, v8: process.versions.v8, n: N, fns: {} };
const record = (name, inputs, outputs) => {
  const h = createHash("sha256").update(Buffer.from(outputs.buffer)).digest("hex");
  out.fns[name] = h.slice(0, 16);
  if (dump) {
    writeFileSync(join(dump, `${name}.in`), Buffer.from(inputs.buffer));
    writeFileSync(join(dump, `${name}.out`), Buffer.from(outputs.buffer));
  }
};

for (const [name, [f, gens]] of Object.entries(unary)) {
  const u = mulberry32(0x9e3779b9 ^ name.length * 7919);
  const inputs = new Float64Array(N);
  for (let i = 0; i < N; i++) inputs[i] = gens[i % gens.length](u);
  const outputs = new Float64Array(N);
  for (let i = 0; i < N; i++) outputs[i] = f(inputs[i]);
  record(name, inputs, outputs);
}
for (const [name, [f, gens]] of Object.entries(binary)) {
  const u = mulberry32(0x85ebca6b ^ name.length * 104729);
  const arity = name === "hypot3" ? 3 : name === "pow10" ? 1 : 2;
  const inputs = new Float64Array(N * arity);
  for (let i = 0; i < N * arity; i++)
    inputs[i] = name === "pow10" ? -30 + 60 * u() : gens ? gens[i % arity](u) : -10 + 20 * u();
  const outputs = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = inputs[i * arity], b = inputs[i * arity + 1], c = inputs[i * arity + 2];
    outputs[i] = arity === 1 ? f(a) : arity === 2 ? f(a, b) : f(a, b, c);
  }
  record(name, inputs, outputs);
}
process.stdout.write(JSON.stringify(out, null, 1) + "\n");
