// For each checkpoint file name, compare the backup's record with the live
// copy's: the record minus the checkpoint's graph must be identical, and
// say whether each still holds a graph.
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const [backupDir, liveDir, ...names] = process.argv.slice(2);
const strip = (record) => {
  const { graph, ...checkpoint } = record.checkpoint;
  return { ...record, checkpoint, hasGraph: graph !== undefined && graph !== null };
};
for (const name of names) {
  const [a, b] = [backupDir, liveDir].map((d) => {
    const path = join(d, "checkpoints", name);
    const s = strip(JSON.parse(readFileSync(path, "utf8")));
    return { s, bytes: statSync(path).size };
  });
  const { hasGraph: ga, ...ha } = a.s;
  const { hasGraph: gb, ...hb } = b.s;
  const same = JSON.stringify(ha) === JSON.stringify(hb);
  console.log(
    `${name}: everything but the graph ${same ? "identical" : "DIFFERENT"}; ` +
      `backup ${a.bytes} bytes, graph ${ga ? "present" : "absent"}; ` +
      `live ${b.bytes} bytes, graph ${gb ? "present" : "absent"}`,
  );
  if (!same)
    for (const k of new Set([...Object.keys(ha.checkpoint), ...Object.keys(hb.checkpoint)]))
      if (JSON.stringify(ha.checkpoint[k]) !== JSON.stringify(hb.checkpoint[k]))
        console.log(`  differs in checkpoint.${k}`);
}
