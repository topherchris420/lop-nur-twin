/**
 * The read-only observer of the living Bethesda life (src/bethesda/life/observer.ts):
 * serves the witness of the observation file the life writes.
 *
 *   node scripts/run-ts.mjs scripts/bethesda-life-observer.ts --file PATH [--port 8790] [--host 127.0.0.1]
 *
 * As a service: deploy/bethesda-life/bethesda-life-observer.service, behind
 * Caddy for HTTPS (deploy/bethesda-life/public.sh). It never opens the store.
 */
import { Observer } from "../src/bethesda/life/observer.js";

function option(args: string[], flag: string, fallback?: string): string {
  const at = args.indexOf(flag);
  const v = at < 0 ? fallback : args[at + 1];
  if (v === undefined || v.startsWith("--")) throw new Error(`${flag} needs a value`);
  return v;
}

const self = process.argv.findIndex((a) => a.endsWith("bethesda-life-observer.ts"));
const args = process.argv.slice(self + 1);
const file = option(args, "--file");
const port = Number(option(args, "--port", "8790"));
const host = option(args, "--host", "127.0.0.1");
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("--port is 1–65535");

const observer = new Observer({ file });
const timer = setInterval(() => observer.refresh(), 1000);
observer.server.listen(port, host, () =>
  process.stdout.write(
    `observer: serving the witness of ${file} on http://${host}:${port}/v1/now (${observer.now.status})\n`,
  ),
);
let last = observer.now.status;
setInterval(() => {
  // One journal line whenever the life's status changes, not one a second.
  const { status, reason } = observer.now;
  if (status !== last)
    process.stdout.write(`observer: ${status}${reason ? ` (${reason})` : ""}\n`);
  last = status;
}, 1000).unref();
const stop = () => {
  clearInterval(timer);
  observer.close();
};
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
