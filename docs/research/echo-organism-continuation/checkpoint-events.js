// Each store record named after "-": its header (not the graph) and its
// events, counted by kind. Read from stdin: node - FILE...
const fs = require("fs");
for (const f of process.argv.slice(process.argv.indexOf("-") + 1)) {
  const r = JSON.parse(fs.readFileSync(f, "utf8"));
  const c = r.checkpoint;
  const events = c.events ?? [];
  const kinds = {};
  for (const e of events) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
  console.log(
    JSON.stringify({
      sequence: c.sequence,
      epoch: r.epoch,
      committedUtc: r.committedUtc,
      tick: c.tick,
      individual: c.birth?.individual,
      parent: c.parent,
      digest: c.digest,
      graphDigest: c.graphDigest,
      graph: c.graph ? "present" : "absent",
      versions: c.versions,
      events: events.length,
      kinds,
      last: events.slice(-4).map((e) => e.kind + "@" + (e.tick ?? "?")),
    }),
  );
}
