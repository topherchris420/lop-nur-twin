// Where a checkpoint's bytes are: each graph node is charged to the first
// path that reaches it from the root, cut to DEPTH steps; arrays report
// their length. Read-only: prints a JSON summary of one checkpoint file.
//   node sizes.mjs CHECKPOINT.json [DEPTH]
import { readFileSync } from "node:fs";

const [file, depthArg] = process.argv.slice(2);
const DEPTH = Number(depthArg ?? 4);
const read = JSON.parse(readFileSync(file, "utf8"));
// A store record wraps the checkpoint; an in-memory checkpoint is one.
const c = read.schema === "life-store/v1" ? read.checkpoint : read;
const nodes = c.graph.nodes;
const label = new Array(nodes.length).fill(null);
const queue = [];
const reach = (v, path) => {
  if (v && typeof v === "object" && typeof v.r === "number" && label[v.r] === null) {
    label[v.r] = path;
    queue.push(v.r);
  }
};
const cut = (path) => path.split(".").slice(0, DEPTH).join(".");
reach(c.graph.root, "root");
for (let q = 0; q < queue.length; q++) {
  const i = queue[q],
    n = nodes[i],
    at = label[i];
  if (n.t === "o") for (const [k, v] of n.e) reach(v, `${at}.${k}`);
  else if (n.t === "a" || n.t === "s" || n.t === "ta") for (const v of n.e) reach(v, `${at}.[]`);
  else if (n.t === "m")
    for (const [k, v] of n.e) {
      reach(k, `${at}.<key>`);
      reach(v, `${at}.<value>`);
    }
}
const bytes = {},
  lengths = {};
nodes.forEach((n, i) => {
  const at = label[i] === null ? "(unreached)" : cut(label[i]);
  bytes[at] = (bytes[at] ?? 0) + JSON.stringify(n).length;
  if ((n.t === "a" || n.t === "m" || n.t === "s") && label[i] !== null && label[i].split(".").length <= DEPTH)
    lengths[label[i]] = n.e.length;
});
const top = Object.entries(bytes)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 40);
process.stdout.write(
  `${JSON.stringify({
    file,
    sequence: c.sequence,
    tick: c.tick,
    fileBytes: readFileSync(file).length,
    graphNodes: nodes.length,
    top: Object.fromEntries(top),
    lengths: Object.fromEntries(
      Object.entries(lengths)
        .filter(([, n]) => n >= 100)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 30),
    ),
  })}\n`,
);
