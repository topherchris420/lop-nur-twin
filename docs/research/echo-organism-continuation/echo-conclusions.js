// For each store record named after "-": the ECHO self-model's conclusion
// counts (the life-graph node with numeric entries none, self, external,
// both and sensor), its path, and whether the fly carries an experimenter's
// perturbation schedule (the entry named "perturbation" on cityFly.fly).
// Read from stdin: node - FILE...
const fs = require("fs");
for (const f of process.argv.slice(process.argv.indexOf("-") + 1)) {
  const c = JSON.parse(fs.readFileSync(f, "utf8")).checkpoint;
  const g = c.graph;
  if (!g || !Array.isArray(g.nodes)) {
    console.log(c.sequence, c.tick, "no graph");
    continue;
  }
  const parent = new Map();
  const isRef = (v) => v !== null && typeof v === "object" && typeof v.r === "number" && Object.keys(v).length === 1;
  const refs = (v, from, key) => {
    if (v === null || typeof v !== "object") return;
    if (isRef(v)) {
      if (!parent.has(v.r)) parent.set(v.r, [from, key]);
      return;
    }
    if (Array.isArray(v)) v.forEach((x) => refs(x, from, key));
    else for (const x of Object.values(v)) refs(x, from, key);
  };
  const pairsOf = (n) => (n && Array.isArray(n.e) ? n.e.filter((p) => Array.isArray(p) && typeof p[0] === "string") : []);
  g.nodes.forEach((n, i) => {
    for (const p of pairsOf(n)) refs(p[1], i, p[0]);
  });
  const path = (i) => {
    const out = [];
    for (let at = i, guard = 0; parent.has(at) && guard < 64; guard++) {
      const [from, key] = parent.get(at);
      out.unshift(key);
      at = from;
    }
    return out.join(".");
  };
  const out = [];
  g.nodes.forEach((n, i) => {
    const pairs = pairsOf(n);
    const m = Object.fromEntries(pairs);
    if (["none", "self", "external", "both", "sensor"].every((k) => typeof m[k] === "number"))
      out.push(`${path(i)}: ${pairs.map((p) => `${p[0]}=${p[1]}`).join(" ")}`);
    if (path(i) === "cityFly.fly" && "perturbation" in m)
      out.push(`cityFly.fly.perturbation: ${isRef(m.perturbation) ? "a schedule" : JSON.stringify(m.perturbation)}`);
  });
  console.log(c.sequence, c.tick, out.join(" | ") || "nothing found");
}
