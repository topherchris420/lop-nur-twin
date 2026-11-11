/**
 * The few CPython float operations whose results JavaScript does not give
 * bit for bit:
 *
 * - `round(x, n)`: CPython rounds the exact binary value of `x` to `n`
 *   decimal places, ties to even (`_Py_dg_dtoa` mode 3), and reads the
 *   decimal string back (`_Py_dg_strtod`). Done here with BigInt arithmetic
 *   on the exact value and V8's correctly rounded string-to-double.
 * - `round(x)`: ties to even, as a whole number.
 * - `math.hypot` and `math.dist`: CPython >= 3.12 (identical through 3.15)
 *   computes both with `vector_norm` in `Modules/mathmodule.c`: lossless
 *   power-of-two scaling, exact squares (`dl_mul`, which uses `fma`), a
 *   compensated sum, a square root and one differential correction. JS's
 *   `Math.hypot` is a different algorithm. The `fma` error term is computed
 *   here with Dekker's exact product (Veltkamp split), which equals
 *   `fma(x, y, -x*y)` whenever the product neither overflows nor underflows,
 *   true for every value a garden step can produce. CPython 3.10 and 3.11
 *   used an earlier `vector_norm` that agrees except in rare last-bit cases.
 *
 * `math.sin`, `math.cos` and friends come from the platform's C library in
 * CPython and from V8's fdlibm port here; they can differ in the last bit.
 */

const DBL_MIN = 2.2250738585072014e-308;
const view = new DataView(new ArrayBuffer(8));

function bitsOf(x: number): { hi: number; lo: number } {
  view.setFloat64(0, x);
  return { hi: view.getUint32(0), lo: view.getUint32(4) };
}

/** frexp's exponent: x = f * 2^e with f in [0.5, 1), for finite x > 0. */
function frexpExponent(x: number): number {
  const { hi, lo } = bitsOf(x);
  const biased = (hi >>> 20) & 0x7ff;
  if (biased !== 0) return biased - 1022;
  // Subnormal: x = m * 2^-1074 with m < 2^52 of bit length L, so e = L - 1074.
  const top = hi & 0xfffff;
  const length = top ? 64 - Math.clz32(top) : 32 - Math.clz32(lo);
  return length - 1074;
}

/** 2^k exactly, for integer k in [-1074, 1023]. */
function pow2(k: number): number {
  if (k >= -1022) {
    view.setUint32(0, ((k + 1023) << 20) >>> 0);
    view.setUint32(4, 0);
    return view.getFloat64(0);
  }
  return pow2(k + 1022) * DBL_MIN;
}

const SPLIT = 134217729.0; // 2^27 + 1

/** The exact error of the rounded product a*b (Dekker), i.e. fma(a, b, -(a*b)). */
function productError(a: number, b: number, p: number): number {
  let t = SPLIT * a;
  const ah = t - (t - a);
  const al = a - ah;
  t = SPLIT * b;
  const bh = t - (t - b);
  const bl = b - bh;
  return al * bl - (p - ah * bh - al * bh - ah * bl);
}

/** CPython's `vector_norm` for two non-negative coordinates. */
function vectorNorm2(a: number, b: number): number {
  let max = 0.0;
  if (a > max) max = a;
  if (b > max) max = b;
  if (max === Infinity) return max;
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
  if (max === 0.0) return max;
  const maxE = frexpExponent(max);
  if (maxE < -1023) return DBL_MIN * vectorNorm2(a / DBL_MIN, b / DBL_MIN);
  const scale = pow2(-maxE);
  let csum = 1.0;
  let frac1 = 0.0;
  let frac2 = 0.0;
  for (const v of [a, b]) {
    const x = v * scale;
    const hi = x * x;
    const lo = productError(x, x, hi);
    const sum = csum + hi;
    frac2 += csum - sum + hi;
    csum = sum;
    frac1 += lo;
  }
  let h = Math.sqrt(csum - 1.0 + (frac1 + frac2));
  const hi = -h * h;
  const lo = productError(-h, h, hi);
  const sum = csum + hi;
  frac2 += csum - sum + hi;
  csum = sum;
  frac1 += lo;
  const x = csum - 1.0 + (frac1 + frac2);
  h += x / (2.0 * h);
  return h / scale;
}

/** `math.hypot(x, y)` as CPython >= 3.12 computes it. */
export function pyHypot(x: number, y: number): number {
  return vectorNorm2(Math.abs(x), Math.abs(y));
}

/** `math.dist(p, q)` for two 2-D points, as CPython >= 3.12 computes it. */
export function pyDist(p: readonly number[], q: readonly number[]): number {
  if (p.length !== 2 || q.length !== 2)
    throw new RangeError("pyDist takes two 2-D points");
  return vectorNorm2(Math.abs(p[0]! - q[0]!), Math.abs(p[1]! - q[1]!));
}

/** `round(x)` for a float: the nearest whole number, ties to even. */
export function pyRoundInt(x: number): number {
  if (!Number.isFinite(x))
    throw new RangeError("cannot round a non-finite float to an integer");
  const f = Math.floor(x);
  const diff = x - f; // exact for every finite double
  const r = diff < 0.5 ? f : diff > 0.5 ? f + 1 : f % 2 === 0 ? f : f + 1;
  return r === 0 ? 0 : r; // a Python int has no negative zero
}

/** `round(x, ndigits)` for a float, exactly as CPython does it. */
export function pyRound(x: number, ndigits: number): number {
  if (!Number.isInteger(ndigits)) throw new RangeError("ndigits must be an integer");
  if (!Number.isFinite(x) || x === 0) return x;
  if (ndigits > 323) return x;
  if (ndigits < -308) return 0.0 * x;
  const { hi, lo } = bitsOf(x);
  const negative = hi >>> 31 === 1;
  const biased = (hi >>> 20) & 0x7ff;
  let mantissa = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let exponent: number;
  if (biased === 0) exponent = -1074;
  else {
    mantissa |= 1n << 52n;
    exponent = biased - 1075;
  }
  // |x| * 10^ndigits = num / den exactly.
  let num = mantissa;
  let den = 1n;
  if (exponent >= 0) num <<= BigInt(exponent);
  else den <<= BigInt(-exponent);
  if (ndigits >= 0) num *= 10n ** BigInt(ndigits);
  else den *= 10n ** BigInt(-ndigits);
  let q = num / den;
  const twice = 2n * (num - q * den);
  if (twice > den || (twice === den && (q & 1n) === 1n)) q += 1n;
  const magnitude = Number.parseFloat(`${q}e${-ndigits}`);
  return negative ? -magnitude : magnitude;
}
