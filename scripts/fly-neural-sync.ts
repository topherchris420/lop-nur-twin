/**
 * `python -m fly_neural serve` as a synchronous function, for a decision
 * maker that must answer inside the fly's own step: first-contact sessions
 * step both flies synchronously, so a research subject's brain cannot be
 * awaited between steps the way `runShadow` awaits it.
 *
 * A worker thread owns the process and its pipes; the caller posts a request
 * and blocks on a shared buffer (`Atomics.wait`) until the worker writes the
 * reply there, or a timeout passes. Nothing else crosses: the requests are
 * the same JSON lines `neuralServer` sends, and `serve` checks the header
 * (a research subject, neural-experimental) exactly as it does for it.
 */
import { Worker } from "node:worker_threads";

// CommonJS, run by the worker with `eval: true`. Every reply, including a
// failure, goes through the shared buffer, so the caller never waits forever.
const WORKER_SOURCE = `
const { workerData, parentPort } = require("node:worker_threads");
const { spawn } = require("node:child_process");
const { createInterface } = require("node:readline");
const { sab, command, args, cwd, header } = workerData;
const ctl = new Int32Array(sab, 0, 2);
const data = new Uint8Array(sab, 8);
const enc = new TextEncoder();
let closing = false;
function reply(text) {
  let bytes = enc.encode(text);
  if (bytes.length > data.length)
    bytes = enc.encode(JSON.stringify({ error: "the reply is larger than the shared buffer" }));
  data.set(bytes);
  Atomics.store(ctl, 1, bytes.length);
  Atomics.store(ctl, 0, 1);
  Atomics.notify(ctl, 0);
}
const child = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
child.stderr.on("data", (d) => process.stderr.write(d));
child.on("error", (e) => reply(JSON.stringify({ error: "could not start the brain: " + e.message })));
child.on("exit", (code) => {
  if (!closing) reply(JSON.stringify({ error: "the brain process exited (code " + code + ")" }));
  parentPort.close();
});
createInterface({ input: child.stdout }).on("line", (line) => reply(line));
child.stdin.write(JSON.stringify(header) + "\\n");
parentPort.on("message", (m) => {
  if (m === "bye") {
    closing = true;
    child.stdin.write(JSON.stringify({ bye: true }) + "\\n");
    child.stdin.end();
    return;
  }
  child.stdin.write(m + "\\n");
});
`;

export interface SyncBrainOptions {
  /** The executable (a Python with fly_neural importable from `cwd`). */
  command: string;
  args?: string[];
  cwd: string;
  /** The recording header `serve` checks first (schema, mode, subject, seed, mapping). */
  header: Record<string, unknown>;
  timeoutMs?: number;
  bufferBytes?: number;
}

export class SyncBrain {
  readonly ready: Record<string, unknown>;
  private readonly worker: Worker;
  private readonly ctl: Int32Array;
  private readonly data: Uint8Array;
  private readonly timeoutMs: number;
  private closed = false;

  constructor(o: SyncBrainOptions) {
    const sab = new SharedArrayBuffer(8 + (o.bufferBytes ?? 1 << 20));
    this.ctl = new Int32Array(sab, 0, 2);
    this.data = new Uint8Array(sab, 8);
    this.timeoutMs = o.timeoutMs ?? 300_000;
    this.worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: {
        sab,
        command: o.command,
        args: o.args ?? ["-m", "fly_neural", "serve"],
        cwd: o.cwd,
        header: o.header,
      },
    });
    this.worker.unref();
    // `serve` loads the whole connectome before it answers, so the first wait is the long one.
    this.ready = this.wait();
    if (this.ready.ready !== true)
      throw new Error(
        `the brain did not start: ${JSON.stringify(this.ready).slice(0, 300)}`,
      );
  }

  private wait(): Record<string, unknown> {
    const r = Atomics.wait(this.ctl, 0, 0, this.timeoutMs);
    if (r === "timed-out")
      throw new Error(`the brain did not answer within ${this.timeoutMs} ms`);
    const text = new TextDecoder().decode(this.data.slice(0, Atomics.load(this.ctl, 1)));
    Atomics.store(this.ctl, 0, 0);
    const msg = JSON.parse(text) as Record<string, unknown>;
    if (typeof msg.error === "string") throw new Error(msg.error);
    return msg;
  }

  /** The readouts for the window since the previous request, with `obs` held over it. */
  ask<R = unknown>(
    t: number,
    obs: unknown,
    windowMs = 10,
  ): { readouts: R; computeMs: number } {
    if (this.closed) throw new Error("the brain was closed");
    this.worker.postMessage(JSON.stringify({ t, obs, window_ms: windowMs }));
    const msg = this.wait();
    return { readouts: msg.readouts as R, computeMs: Number(msg.compute_ms ?? 0) };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.worker.postMessage("bye");
  }
}
