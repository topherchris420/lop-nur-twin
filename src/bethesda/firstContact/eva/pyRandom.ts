/**
 * CPython's `random.Random`, exactly as far as Eva's service uses it:
 * MT19937 (`Modules/_randommodule.c`), seeding from a `str` the way
 * `random.seed(a, version=2)` does, `random()`, `uniform(a, b)`,
 * `getrandbits(k)` and `choice(seq)` through `_randbelow_with_getrandbits`
 * (`Lib/random.py`). These have been stable from CPython 3.2 to 3.15; the
 * tests replay vectors written by real Python (`scripts/eva-parity.py`).
 *
 * Her server makes a fresh `random.Random(f"{seed}:{ticks}")` every tick, so
 * every draw of a step comes from that step's own stream.
 */
import { sha512 } from "./sha512.js";

const N = 624;
const M = 397;
const MATRIX_A = 0x9908b0df;
const UPPER_MASK = 0x80000000;
const LOWER_MASK = 0x7fffffff;

export class PyRandom {
  private readonly mt = new Uint32Array(N);
  private index = N + 1;

  constructor(seed?: string | bigint) {
    if (seed !== undefined) this.seed(seed);
  }

  /**
   * `random.seed(a)` for a `str` (version 2: the UTF-8 bytes, then their
   * SHA-512 digest, read as one big-endian integer) or a non-negative integer.
   */
  seed(a: string | bigint): void {
    if (typeof a === "string") {
      const bytes = new TextEncoder().encode(a);
      const all = new Uint8Array(bytes.length + 64);
      all.set(bytes);
      all.set(sha512(bytes), bytes.length);
      this.initByArray(keyFromBigEndian(all));
    } else {
      // CPython seeds with abs(n): its 32-bit words, least significant first.
      let n = a < 0n ? -a : a;
      const key: number[] = [];
      do {
        key.push(Number(n & 0xffffffffn));
        n >>= 32n;
      } while (n > 0n);
      this.initByArray(key);
    }
  }

  private initGenrand(s: number): void {
    const mt = this.mt;
    mt[0] = s >>> 0;
    for (let i = 1; i < N; i++) {
      const prev = mt[i - 1]!;
      mt[i] = (Math.imul(1812433253, prev ^ (prev >>> 30)) + i) >>> 0;
    }
    this.index = N;
  }

  private initByArray(key: readonly number[]): void {
    const mt = this.mt;
    this.initGenrand(19650218);
    let i = 1;
    let j = 0;
    for (let k = Math.max(N, key.length); k > 0; k--) {
      const prev = mt[i - 1]!;
      mt[i] = ((mt[i]! ^ Math.imul(prev ^ (prev >>> 30), 1664525)) + key[j]! + j) >>> 0;
      i++;
      j++;
      if (i >= N) {
        mt[0] = mt[N - 1]!;
        i = 1;
      }
      if (j >= key.length) j = 0;
    }
    for (let k = N - 1; k > 0; k--) {
      const prev = mt[i - 1]!;
      mt[i] = ((mt[i]! ^ Math.imul(prev ^ (prev >>> 30), 1566083941)) - i) >>> 0;
      i++;
      if (i >= N) {
        mt[0] = mt[N - 1]!;
        i = 1;
      }
    }
    mt[0] = 0x80000000;
  }

  /** `genrand_uint32`: the next 32 bits of the stream. */
  next32(): number {
    const mt = this.mt;
    if (this.index >= N) {
      if (this.index === N + 1) this.initGenrand(5489);
      let kk = 0;
      for (; kk < N - M; kk++) {
        const y = (mt[kk]! & UPPER_MASK) | (mt[kk + 1]! & LOWER_MASK);
        mt[kk] = mt[kk + M]! ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0);
      }
      for (; kk < N - 1; kk++) {
        const y = (mt[kk]! & UPPER_MASK) | (mt[kk + 1]! & LOWER_MASK);
        mt[kk] = mt[kk + (M - N)]! ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0);
      }
      const y = (mt[N - 1]! & UPPER_MASK) | (mt[0]! & LOWER_MASK);
      mt[N - 1] = mt[M - 1]! ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0);
      this.index = 0;
    }
    let y = mt[this.index++]!;
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  /** `random()`: 53 random bits from two outputs, in [0, 1). */
  random(): number {
    const a = this.next32() >>> 5;
    const b = this.next32() >>> 6;
    return (a * 67108864.0 + b) * (1.0 / 9007199254740992.0);
  }

  /** `uniform(a, b)` = `a + (b - a) * random()`. */
  uniform(a: number, b: number): number {
    return a + (b - a) * this.random();
  }

  /** `getrandbits(k)` for k <= 32, as a number. */
  private bits(k: number): number {
    return k === 0 ? 0 : this.next32() >>> (32 - k);
  }

  /** `getrandbits(k)`: k random bits (words drawn least significant first). */
  getrandbits(k: number): bigint {
    if (!Number.isInteger(k) || k < 0)
      throw new RangeError("number of bits must be >= 0");
    if (k <= 32) return BigInt(this.bits(k));
    let out = 0n;
    for (let i = 0, left = k; left > 0; i++, left -= 32) {
      let r = this.next32();
      if (left < 32) r >>>= 32 - left;
      out |= BigInt(r) << BigInt(32 * i);
    }
    return out;
  }

  /** `_randbelow_with_getrandbits(n)`: uniform in [0, n), for 0 < n < 2^32. */
  randbelow(n: number): number {
    if (!Number.isInteger(n) || n <= 0 || n >= 4294967296)
      throw new RangeError("randbelow needs 0 < n < 2^32");
    const k = 32 - Math.clz32(n);
    let r = this.bits(k);
    while (r >= n) r = this.bits(k);
    return r;
  }

  /** `choice(seq)`. */
  choice<T>(seq: readonly T[]): T {
    if (!seq.length) throw new RangeError("Cannot choose from an empty sequence");
    return seq[this.randbelow(seq.length)]!;
  }
}

/** The 32-bit words of a big-endian byte string's integer, least significant first. */
function keyFromBigEndian(bytes: Uint8Array): number[] {
  let start = 0;
  while (start < bytes.length && bytes[start] === 0) start++;
  const key: number[] = [];
  for (let end = bytes.length; end > start; end -= 4) {
    let word = 0;
    for (let b = Math.max(start, end - 4); b < end; b++) word = word * 256 + bytes[b]!;
    key.push(word >>> 0);
  }
  return key.length ? key : [0];
}
