// The events of each store record named after "-", one JSON line per event,
// prefixed with the record's sequence. Read from stdin: node - FILE...
const fs = require("fs");
for (const f of process.argv.slice(process.argv.indexOf("-") + 1)) {
  const c = JSON.parse(fs.readFileSync(f, "utf8")).checkpoint;
  for (const e of c.events ?? []) console.log(c.sequence, JSON.stringify(e));
}
