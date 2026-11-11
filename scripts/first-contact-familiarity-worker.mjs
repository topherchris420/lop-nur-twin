/**
 * One worker of `first-contact-familiarity.ts`: runs the replicates it is
 * given and posts each record back. Every replicate is deterministic and
 * independent, so which worker runs it changes nothing.
 */
import { parentPort, workerData } from "node:worker_threads";

await import("./ts-hooks.mjs");
const { runReplicate } =
  await import("../src/bethesda/firstContact/commons/familiarity.ts");

const { protocol, phase, jobs } = workerData;
for (const job of jobs) {
  const record = runReplicate(protocol, phase, job.arm, job.condition, job.replicate);
  parentPort.postMessage({ record });
}
parentPort.postMessage({ done: true });
