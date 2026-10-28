// The fly's rejected-command count in each store record named after "-":
// every node of the checkpoint's life graph (life-graph/v1: nodes whose
// entries are [key, value] pairs, references {"r": index}) with an entry
// named "rejected", its path from the root and its other plain entries.
// Read from stdin: node - FILE...
const fs = require("fs");
for (const f of process.argv.slice(process.argv.indexOf("-") + 1)) {
  const c = JSON.parse(fs.readFileSync(f, "utf8")).checkpoint;
  const g = c.graph;
  if (!g || !Array.isArray(g.nodes)) {
    console.log(c.sequence, c.tick, g ? `graph keys ${Object.keys(g)}` : "no graph");
    continue;
  }
  const parent = new Map();
  const refs = (v, from, key) => {
    if (v === null || typeof v !== "object") return;
    if (typeof v.r === "number" && Object.keys(v).length === 1) {
      if (!parent.has(v.r)) parent.set(v.r, [from, key]);
      return;
    }
    if (Array.isArray(v)) v.forEach((x, i) => refs(x, from, Array.isArray(x) ? key : `${key}[${i}]`));
    else for (const x of Object.values(v)) refs(x, from, key);
  };
  g.nodes.forEach((n, i) => {
    if (n && Array.isArray(n.e))
      for (const p of n.e) Array.isArray(p) && typeof p[0] === "string" ? refs(p[1], i, p[0]) : refs(p, i, "?");
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
  const found = [];
  g.nodes.forEach((n, i) => {
    if (!n || !Array.isArray(n.e)) return;
    const pairs = n.e.filter((p) => Array.isArray(p) && typeof p[0] === "string");
    if (!pairs.some((p) => p[0] === "rejected")) return;
    const plain = pairs.filter((p) => p[1] === null || typeof p[1] !== "object");
    found.push(`${path(i)}: ${plain.map((p) => `${p[0]}=${p[1]}`).join(" ")}`);
  });
  console.log(c.sequence, c.tick, `${g.nodes.length} nodes;`, found.join(" | ") || "no entry named rejected");
}
