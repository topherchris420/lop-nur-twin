/**
 * Runs and verifies experiments off the main thread, so neither the live city
 * nor the lab's rendering waits on them. The worker re-checks everything the
 * runner checks — it is handed a definition and an authorization, not a
 * licence — and posts progress for presentation only.
 */
import { runExperiment, RunRefused } from "./runner";
import { verifyRecord } from "./replay";

export type WorkerRequest =
  | {
      type: "run";
      definition: Parameters<typeof runExperiment>[0];
      definitionSha256: string;
      experimentId: string;
      authorization: Parameters<typeof runExperiment>[3];
    }
  | { type: "verify"; record: unknown };

const post = (message: unknown) => (self as unknown as Worker).postMessage(message);

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  // A dedicated worker hears only the page that created it, and such a message
  // carries no origin (HTML: a worker's messages are MessagePort messages). One
  // that names an origin is not that page's: it is refused, out loud, so a run
  // fails visibly instead of waiting on a worker that will not answer.
  if (event.origin !== "") {
    post({ type: "error", name: "Refused", message: "a message the page did not send" });
    return;
  }
  const msg = event.data;
  try {
    if (msg.type === "run") {
      const steps = runExperiment(
        msg.definition,
        msg.definitionSha256,
        msg.experimentId,
        msg.authorization,
      );
      let last = 0;
      for (;;) {
        const next = steps.next();
        if (next.done) {
          post({ type: "done", result: next.value });
          return;
        }
        const now = Date.now();
        if (now - last > 100 || next.value.packet) {
          post({ type: "progress", progress: next.value });
          last = now;
        }
      }
    }
    if (msg.type === "verify") {
      const steps = verifyRecord(msg.record);
      for (;;) {
        const next = steps.next();
        if (next.done) {
          post({ type: "verified", verification: next.value });
          return;
        }
      }
    }
  } catch (error) {
    post({
      type: "error",
      name: error instanceof Error ? error.name : "Error",
      message: error instanceof Error ? error.message : String(error),
      refused: error instanceof RunRefused ? error.reasons : null,
    });
  }
};
