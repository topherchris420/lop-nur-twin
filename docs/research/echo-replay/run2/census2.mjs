// V8 Math results on pow-free inputs: every input is built from random bits
// (exponent and mantissa), so no platform's pow can change what is measured.
import { createHash } from "node:crypto";
const N = Number(process.env.CENSUS_N ?? 1_000_000);
function u32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return (t ^ (t >>> 14)) >>> 0; }; }
const f64 = new Float64Array(1), u = new Uint32Array(f64.buffer);
// A double with a uniformly random mantissa and an exponent in [lo, hi] (unbiased exponents).
const bits = (r, lo, hi) => { u[0] = r(); u[1] = (((lo + (r() % (hi - lo + 1)) + 1023) & 0x7ff) << 20) | (r() & 0xfffff); return f64[0]; };
const lin = (r, lo, hi) => lo + (hi - lo) * (r() / 4294967296);
const F = {
  sin: [Math.sin, (r) => lin(r, -10, 10)], cos: [Math.cos, (r) => lin(r, -10, 10)], tan: [Math.tan, (r) => lin(r, -1.5, 1.5)],
  exp: [Math.exp, (r) => lin(r, -20, 5)], expm1: [Math.expm1, (r) => lin(r, -2, 2)], log: [Math.log, (r) => bits(r, -40, 40)],
  log1p: [Math.log1p, (r) => lin(r, -0.9, 3)], log2: [Math.log2, (r) => bits(r, -40, 40)], log10: [Math.log10, (r) => bits(r, -40, 40)],
  asin: [Math.asin, (r) => lin(r, -1, 1)], acos: [Math.acos, (r) => lin(r, -1, 1)], atan: [Math.atan, (r) => lin(r, -10, 10)],
  sinh: [Math.sinh, (r) => lin(r, -5, 5)], cosh: [Math.cosh, (r) => lin(r, -5, 5)], tanh: [Math.tanh, (r) => lin(r, -5, 5)],
  cbrt: [Math.cbrt, (r) => bits(r, -40, 40)], sqrt: [Math.sqrt, (r) => bits(r, -40, 40)],
  atan2: [(x) => Math.atan2(x, 0.7), (r) => lin(r, -10, 10)], pow: [(x) => Math.pow(x, 0.025), (r) => bits(r, -10, 10)],
  hypot: [(x) => Math.hypot(x, 0.3), (r) => lin(r, -10, 10)],
};
const out = { platform: `${process.platform} ${process.arch}`, node: process.version, n: N, fns: {}, differFromExpLog: null };
for (const [name, [f, gen]] of Object.entries(F)) {
  const r = u32(0x1234567 ^ name.length * 2654435761), o = new Float64Array(N);
  for (let i = 0; i < N; i++) o[i] = f(Math.abs(gen(r)) * (name === "pow" ? 1 : Math.sign(gen(r)) || 1));
  out.fns[name] = createHash("sha256").update(Buffer.from(o.buffer)).digest("hex").slice(0, 16);
}
// How often pow(x, 0.025) and exp(0.025 log x) disagree here (a property of this libm).
{ const r = u32(99); let d = 0; for (let i = 0; i < N; i++) { const x = bits(r, -10, 10); if (Math.pow(x, 0.025) !== Math.exp(0.025 * Math.log(x))) d++; } out.differFromExpLog = d; }
process.stdout.write(JSON.stringify(out, null, 1) + "\n");
