// Print the header of each store record given: everything but the graph.
import { readFileSync } from "node:fs";

for (const file of process.argv.slice(2)) {
  const record = JSON.parse(readFileSync(file, "utf8"));
  const c = record.schema === "life-store/v1" ? record.checkpoint : record;
  const events = c.events ?? [];
  console.log(
    JSON.stringify({
      file: file.split(/[\\/]/).pop(),
      epoch: record.epoch,
      committedUtc: record.committedUtc,
      sequence: c.sequence,
      tick: c.tick,
      individual: c.birth?.individual,
      genesisDigest: c.genesisDigest,
      parent: c.parent,
      digest: c.digest,
      graphDigest: c.graphDigest,
      versions: c.versions,
      events: events.length,
      lastEvents: events.slice(-2).map((e) => `${e.kind}@${e.tick ?? "?"}`),
    }),
  );
}
