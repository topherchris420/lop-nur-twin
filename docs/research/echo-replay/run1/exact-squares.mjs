// Diagnostic only, never evidence: at load time, rewrite `<operand> ** 2` to
// `__sq(<operand>)`, i.e. x * x, in src/bethesda and src/rain. The files on
// disk (and so every source digest) are unchanged. Where Math.pow(x, 2) is
// always x * x (as measured on Windows) this changes nothing; where the C
// library's pow can round a square differently (glibc), it removes exactly
// that difference and nothing else.
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

globalThis.__sq = (x) => x * x;
const IDENT = /[\w$.!]/;

function operandStart(src, end) {
  let i = end;
  for (;;) {
    const c = src[i - 1];
    if (c === ")" || c === "]") {
      const open = c === ")" ? "(" : "[";
      let depth = 0;
      for (i = i - 1; i >= 0; i--) {
        if (src[i] === c) depth++;
        else if (src[i] === open && --depth === 0) break;
      }
      if (i < 0) throw new Error("unbalanced operand");
    } else if (c !== undefined && IDENT.test(c)) i--;
    else return i;
  }
}

export function rewrite(src, file, log = () => {}) {
  const hits = [...src.matchAll(/\s\*\*\s*2(?![\w.])/g)];
  for (const m of hits.reverse()) {
    const lineStart = src.lastIndexOf("\n", m.index) + 1;
    const line = src.slice(lineStart, src.indexOf("\n", m.index) >>> 0 || undefined);
    const t = line.trimStart();
    if (t.startsWith("*") || t.startsWith("//") || t.startsWith("/*")) continue;
    let e = m.index + 1;
    while (/\s/.test(src[e - 1])) e--;
    const s = operandStart(src, e);
    const end = m.index + m[0].length;
    const operand = src.slice(s, e);
    if (!operand) continue;
    log(`${file}:${src.slice(0, s).split("\n").length}: ${operand} ** 2`);
    src = src.slice(0, s) + `__sq(${operand})` + src.slice(end);
  }
  return src;
}

const verbose = process.env.EXACT_SQUARES_LOG === "1";
registerHooks({
  load(url, context, nextLoad) {
    const r = nextLoad(url, context);
    if (!url.startsWith("file:") || !/\.(ts|tsx)$/.test(url)) return r;
    const file = fileURLToPath(url).replaceAll("\\", "/");
    if (!/\/src\/(bethesda|rain)\//.test(file)) return r;
    const source = rewrite(String(r.source), file.replace(/^.*\/src\//, "src/"), verbose ? (s) => process.stderr.write(`[exact-squares] ${s}\n`) : undefined);
    return { ...r, source };
  },
});
