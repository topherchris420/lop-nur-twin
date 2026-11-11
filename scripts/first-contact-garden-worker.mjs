/** One worker of `first-contact-garden.ts`: one garden pair, deterministic. */
import { parentPort, workerData } from "node:worker_threads";

await import("./ts-hooks.mjs");
const { runGardenEncounter } =
  await import("../src/bethesda/firstContact/commons/gardenEncounter.ts");
parentPort.postMessage({ record: runGardenEncounter(workerData) });
