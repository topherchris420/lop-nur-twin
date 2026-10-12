/**
 * The Noeterra civilization engine, in process. The engine is Rust compiled to a
 * WebAssembly module that imports nothing: it cannot read a file, open a
 * socket, see a clock or start a process, so it can only compute. Every call
 * gets a fresh instance, so a trap in one call cannot leave state for the next.
 *
 * The module is built from noeterra/ (`npm run noeterra:wasm`) and is not
 * committed: the repository holds no binary assets. Callers that find it
 * missing report the civilization backend unavailable rather than guessing.
 */
import type {
  NoeterraExperimentResult,
  NoeterraPlan,
} from "../../bethesda/rain/scientificProtocol.js";

interface NoeterraExports {
  memory: WebAssembly.Memory;
  noeterra_alloc(len: number): number;
  noeterra_free(ptr: number, len: number): void;
  noeterra_call(ptr: number, len: number): bigint;
}

export interface NoeterraVersion {
  engine: string;
  plan_schema: string;
  result_schema: string;
  save_schema: string;
}
export interface NoeterraMetric {
  id: string;
  unit: string;
  description: string;
}
export interface NoeterraValidation {
  plan_sha256: string;
  scenario_sha256: string;
  civilizations: string[];
}
export interface NoeterraReplayReport {
  ok: boolean;
  turns_checked: number;
  first_divergence: number | null;
  reason: string | null;
  final_hash: string;
}

export class NoeterraEngineError extends Error {}

const isExports = (x: WebAssembly.Exports): x is WebAssembly.Exports & NoeterraExports =>
  x.memory instanceof WebAssembly.Memory &&
  typeof x.noeterra_alloc === "function" &&
  typeof x.noeterra_free === "function" &&
  typeof x.noeterra_call === "function";

export class NoeterraEngine {
  private readonly module: WebAssembly.Module;
  private constructor(module: WebAssembly.Module) {
    this.module = module;
  }

  static fromBytes(bytes: Uint8Array<ArrayBuffer>): NoeterraEngine {
    const module = new WebAssembly.Module(bytes);
    if (WebAssembly.Module.imports(module).length)
      throw new NoeterraEngineError("the Noeterra module must import nothing");
    return new NoeterraEngine(module);
  }

  call<T>(request: Record<string, unknown>): T {
    const exports = new WebAssembly.Instance(this.module, {}).exports;
    if (!isExports(exports))
      throw new NoeterraEngineError("the Noeterra module lacks its three exports");
    const bytes = new TextEncoder().encode(JSON.stringify(request));
    const ptr = exports.noeterra_alloc(bytes.length);
    new Uint8Array(exports.memory.buffer, ptr, bytes.length).set(bytes);
    let answer: string;
    try {
      const packed = exports.noeterra_call(ptr, bytes.length);
      const at = Number(packed >> 32n),
        len = Number(packed & 0xffffffffn);
      answer = new TextDecoder().decode(new Uint8Array(exports.memory.buffer, at, len));
    } catch (e) {
      throw new NoeterraEngineError(
        `the Noeterra engine trapped: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    const parsed = JSON.parse(answer) as { ok: boolean; result?: T; error?: string };
    if (!parsed.ok || parsed.result === undefined)
      throw new NoeterraEngineError(
        parsed.error ?? "the Noeterra engine refused the request",
      );
    return parsed.result;
  }

  version(): NoeterraVersion {
    return this.call({ op: "version" });
  }
  metrics(): NoeterraMetric[] {
    return this.call({ op: "metrics" });
  }
  validate(plan: NoeterraPlan): NoeterraValidation {
    return this.call({ op: "validate", plan });
  }
  experiment(plan: NoeterraPlan): NoeterraExperimentResult {
    return this.call({ op: "experiment", plan });
  }
  /** Re-simulates every run of `plan` and requires `result`'s hashes and metrics. */
  verify(plan: NoeterraPlan, result: NoeterraExperimentResult): void {
    this.call({ op: "verify", plan, result });
  }
  replay(save: unknown): NoeterraReplayReport {
    return this.call({ op: "replay", save });
  }
}
