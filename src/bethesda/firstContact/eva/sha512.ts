/**
 * SHA-512 (FIPS 180-4) in plain TypeScript, for `pyRandom.ts`: CPython seeds
 * `random.Random(str)` from the string's UTF-8 bytes followed by their
 * SHA-512 digest. Pure so the port runs anywhere (no `node:crypto`); the
 * tests compare it with Node's.
 *
 * 64-bit words are kept as (hi, lo) pairs of unsigned 32-bit integers. The
 * round constants and initial hash are derived exactly as the standard
 * defines them (fractional parts of the cube and square roots of the first
 * primes), with integer roots in BigInt, instead of being typed in.
 */

function primes(count: number): number[] {
  const out: number[] = [];
  for (let n = 2; out.length < count; n++) if (out.every((p) => n % p !== 0)) out.push(n);
  return out;
}

/** The largest x with x^k <= n (Newton's method from an overestimate). */
function iroot(n: bigint, k: bigint): bigint {
  if (n < 2n) return n;
  let x = 1n << (BigInt(n.toString(2).length) / k + 1n);
  for (;;) {
    const y = ((k - 1n) * x + n / x ** (k - 1n)) / k;
    if (y >= x) return x;
    x = y;
  }
}

const MASK64 = (1n << 64n) - 1n;

function words(values: bigint[]): Uint32Array {
  const out = new Uint32Array(values.length * 2);
  values.forEach((v, i) => {
    out[2 * i] = Number((v >> 32n) & 0xffffffffn);
    out[2 * i + 1] = Number(v & 0xffffffffn);
  });
  return out;
}

const PRIMES = primes(80);
const K = words(PRIMES.map((p) => iroot(BigInt(p) << 192n, 3n) & MASK64));
const H0 = words(PRIMES.slice(0, 8).map((p) => iroot(BigInt(p) << 128n, 2n) & MASK64));

// 64-bit rotate right / shift right of (hi, lo), returning one half each.
const rotrHi = (hi: number, lo: number, n: number) =>
  n < 32 ? (hi >>> n) | (lo << (32 - n)) : (lo >>> (n - 32)) | (hi << (64 - n));
const rotrLo = (hi: number, lo: number, n: number) =>
  n < 32 ? (lo >>> n) | (hi << (32 - n)) : (hi >>> (n - 32)) | (lo << (64 - n));
const shrHi = (hi: number, n: number) => hi >>> n;
const shrLo = (hi: number, lo: number, n: number) => (lo >>> n) | (hi << (32 - n));

const TWO32 = 4294967296;

/** SHA-512 digest of `bytes`. */
export function sha512(bytes: Uint8Array): Uint8Array {
  const length = bytes.length;
  const total = Math.ceil((length + 17) / 128) * 128;
  const buf = new Uint8Array(total);
  buf.set(bytes);
  buf[length] = 0x80;
  const view = new DataView(buf.buffer);
  const bits = length * 8;
  view.setUint32(total - 8, Math.floor(bits / TWO32));
  view.setUint32(total - 4, bits >>> 0);

  const h = H0.slice();
  const w = new Uint32Array(160);
  for (let offset = 0; offset < total; offset += 128) {
    for (let i = 0; i < 32; i++) w[i] = view.getUint32(offset + 4 * i);
    for (let i = 16; i < 80; i++) {
      const ah = w[2 * (i - 15)]!,
        al = w[2 * (i - 15) + 1]!;
      const bh = w[2 * (i - 2)]!,
        bl = w[2 * (i - 2) + 1]!;
      const s0h = rotrHi(ah, al, 1) ^ rotrHi(ah, al, 8) ^ shrHi(ah, 7);
      const s0l = rotrLo(ah, al, 1) ^ rotrLo(ah, al, 8) ^ shrLo(ah, al, 7);
      const s1h = rotrHi(bh, bl, 19) ^ rotrHi(bh, bl, 61) ^ shrHi(bh, 6);
      const s1l = rotrLo(bh, bl, 19) ^ rotrLo(bh, bl, 61) ^ shrLo(bh, bl, 6);
      const lo = w[2 * (i - 16) + 1]! + (s0l >>> 0) + w[2 * (i - 7) + 1]! + (s1l >>> 0);
      const hi =
        w[2 * (i - 16)]! +
        (s0h >>> 0) +
        w[2 * (i - 7)]! +
        (s1h >>> 0) +
        Math.floor(lo / TWO32);
      w[2 * i] = hi >>> 0;
      w[2 * i + 1] = lo >>> 0;
    }
    let ah = h[0]!,
      al = h[1]!,
      bh = h[2]!,
      bl = h[3]!,
      ch = h[4]!,
      cl = h[5]!,
      dh = h[6]!,
      dl = h[7]!;
    let eh = h[8]!,
      el = h[9]!,
      fh = h[10]!,
      fl = h[11]!,
      gh = h[12]!,
      gl = h[13]!,
      hh = h[14]!,
      hl = h[15]!;
    for (let i = 0; i < 80; i++) {
      const S1h = rotrHi(eh, el, 14) ^ rotrHi(eh, el, 18) ^ rotrHi(eh, el, 41);
      const S1l = rotrLo(eh, el, 14) ^ rotrLo(eh, el, 18) ^ rotrLo(eh, el, 41);
      const chh = (eh & fh) ^ (~eh & gh);
      const chl = (el & fl) ^ (~el & gl);
      const t1l = hl + (S1l >>> 0) + (chl >>> 0) + K[2 * i + 1]! + w[2 * i + 1]!;
      const t1h =
        hh + (S1h >>> 0) + (chh >>> 0) + K[2 * i]! + w[2 * i]! + Math.floor(t1l / TWO32);
      const S0h = rotrHi(ah, al, 28) ^ rotrHi(ah, al, 34) ^ rotrHi(ah, al, 39);
      const S0l = rotrLo(ah, al, 28) ^ rotrLo(ah, al, 34) ^ rotrLo(ah, al, 39);
      const mjh = (ah & bh) ^ (ah & ch) ^ (bh & ch);
      const mjl = (al & bl) ^ (al & cl) ^ (bl & cl);
      const t2l = (S0l >>> 0) + (mjl >>> 0);
      const t2h = (S0h >>> 0) + (mjh >>> 0) + Math.floor(t2l / TWO32);
      hh = gh;
      hl = gl;
      gh = fh;
      gl = fl;
      fh = eh;
      fl = el;
      const nel = dl + (t1l >>> 0);
      eh = (dh + (t1h >>> 0) + Math.floor(nel / TWO32)) >>> 0;
      el = nel >>> 0;
      dh = ch;
      dl = cl;
      ch = bh;
      cl = bl;
      bh = ah;
      bl = al;
      const nal = (t1l >>> 0) + (t2l >>> 0);
      ah = ((t1h >>> 0) + (t2h >>> 0) + Math.floor(nal / TWO32)) >>> 0;
      al = nal >>> 0;
    }
    const add = [ah, al, bh, bl, ch, cl, dh, dl, eh, el, fh, fl, gh, gl, hh, hl];
    for (let i = 0; i < 16; i += 2) {
      const lo = h[i + 1]! + add[i + 1]!;
      h[i] = (h[i]! + add[i]! + Math.floor(lo / TWO32)) >>> 0;
      h[i + 1] = lo >>> 0;
    }
  }
  const out = new Uint8Array(64);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 16; i++) outView.setUint32(4 * i, h[i]!);
  return out;
}
