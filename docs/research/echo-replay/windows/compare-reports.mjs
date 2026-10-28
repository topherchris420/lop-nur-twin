// Compare two JSON files leaf by leaf: every non-number difference is listed;
// number differences are summarized by key with the largest absolute and
// relative difference.
import { readFileSync } from "node:fs";

const [a, b] = process.argv.slice(2).map((p) => JSON.parse(readFileSync(p, "utf8")));
const other = [];
const numbers = new Map();
let compared = 0;

function walk(x, y, path) {
  if (typeof x === "number" && typeof y === "number") {
    compared++;
    if (x === y) return;
    const key = path.replace(/\[\d+\]/g, "[]");
    const abs = Math.abs(x - y);
    const rel = abs / Math.max(Math.abs(x), Math.abs(y));
    const s = numbers.get(key) ?? { n: 0, abs: 0, rel: 0, example: "" };
    s.n++;
    if (rel > s.rel) s.example = `${path}: ${x} -> ${y}`;
    s.abs = Math.max(s.abs, abs);
    s.rel = Math.max(s.rel, rel);
    numbers.set(key, s);
    return;
  }
  if (x && y && typeof x === "object" && typeof y === "object") {
    if (Array.isArray(x) !== Array.isArray(y)) return other.push(`${path}: shape`);
    if (Array.isArray(x) && x.length !== y.length)
      other.push(`${path}: length ${x.length} -> ${y.length}`);
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
      const p = Array.isArray(x) ? `${path}[${k}]` : `${path}.${k}`;
      if (!(k in x) || !(k in y)) other.push(`${p}: only in ${k in x ? "first" : "second"}`);
      else walk(x[k], y[k], p);
    }
    return;
  }
  compared++;
  if (x !== y) other.push(`${path}: ${JSON.stringify(x)} -> ${JSON.stringify(y)}`);
}

walk(a, b, "$");
console.log(`leaves compared: ${compared}`);
console.log(`non-number differences: ${other.length}`);
for (const line of other) console.log(`  ${line}`);
console.log(`number differences by key (count, max abs, max rel, worst):`);
for (const [key, s] of [...numbers].sort((p, q) => q[1].rel - p[1].rel))
  console.log(`  ${key}: ${s.n}, ${s.abs.toExponential(2)}, ${s.rel.toExponential(2)}, ${s.example}`);
