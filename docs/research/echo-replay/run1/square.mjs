// Does Math.pow(x, 2) (what `x ** 2` computes until V8 optimizes it to x * x)
// equal x * x here? x * x is always the correctly rounded square (IEEE 754);
// a C library's pow need not be. Prints the count and the first mismatches.
const pow = Math.pow;
function u32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const f64 = new Float64Array(1), u64 = new BigUint64Array(f64.buffer);
const hex = (x) => { f64[0] = x; return "0x" + u64[0].toString(16).padStart(16, "0"); };
const u = u32(12345);
let n = 0, diff = 0; const first = [];
for (let i = 0; i < 5_000_000; i++) {
  const x = (u() - 0.5) * pow(2, Math.floor(u() * 40) - 20);
  n++;
  const p = pow(x, 2), m = x * x;
  if (p !== m) { diff++; if (first.length < 8) first.push(`x=${x} (${hex(x)}): pow=${p} (${hex(p)}) x*x=${m} (${hex(m)})`); }
}
console.log(`${process.platform} ${process.arch} node ${process.version}: pow(x,2) !== x*x for ${diff} of ${n} random x`);
for (const line of first) console.log("  " + line);
for (const c of process.argv.slice(2).map(Number)) console.log(`  const ${c}: pow=${pow(c, 2)} x*x=${c * c} same=${pow(c, 2) === c * c}`);
