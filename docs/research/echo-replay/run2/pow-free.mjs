// Diagnostic only, never evidence: at load time, rewrite `<operand> ** <fractional
// literal>` (in the ECHO self-model, `ratio ** 0.025`) to exp(y * log(x)), so
// that no fractional power goes through the C library's pow. This changes the
// results on every platform (exp/log round differently from pow); the question
// is whether two platforms then agree. Files on disk are unchanged.
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

globalThis.__pw = (x, y) => (x > 0 ? Math.exp(y * Math.log(x)) : Math.pow(x, y));
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
  const hits = [...src.matchAll(/\s\*\*\s*(\d*\.\d+(?:e[-+]?\d+)?)(?![\w.])/g)];
  for (const m of hits.reverse()) {
    const lineStart = src.lastIndexOf("\n", m.index) + 1;
    const t = src.slice(lineStart, m.index).trimStart();
    if (t.startsWith("*") || t.startsWith("//") || t.startsWith("/*")) continue;
    let e = m.index + 1;
    while (/\s/.test(src[e - 1])) e--;
    const s = operandStart(src, e);
    const operand = src.slice(s, e);
    if (!operand) continue;
    log(`${file}:${src.slice(0, s).split("\n").length}: ${operand} ** ${m[1]}`);
    src = src.slice(0, s) + `__pw(${operand}, ${m[1]})` + src.slice(m.index + m[0].length);
  }
  return src;
}
const verbose = process.env.POW_FREE_LOG === "1";
registerHooks({
  load(url, context, nextLoad) {
    const r = nextLoad(url, context);
    if (!url.startsWith("file:") || !/\.(ts|tsx)$/.test(url)) return r;
    const file = fileURLToPath(url).replaceAll("\\", "/");
    if (!/\/src\/(bethesda|rain)\//.test(file)) return r;
    const log = verbose ? (s) => process.stderr.write(`[pow-free] ${s}\n`) : undefined;
    return { ...r, source: rewrite(String(r.source), file.replace(/^.*\/src\//, "src/"), log) };
  },
});
