/**
 * The Noeterra engine in the visitor's browser: Rust compiled to a
 * WebAssembly module that imports nothing, so it can compute and nothing else
 * — no network, files, clock or storage. One instance lives for the page,
 * because a running history is kept in its memory; only a call that traps
 * replaces it, and the histories with it.
 *
 * The module is built from noeterra/ at deploy time and served from this
 * origin; it is never committed. A host that rewrites unknown paths to the
 * app shell answers a missing module with HTML, so the bytes are checked
 * before anything is instantiated.
 */
import type { GameState, Mind, ReplayReport, ScenarioCard, Terms } from "./types";

export const ENGINE_URL = "/noeterra/noeterra.wasm";

interface Exports {
  memory: WebAssembly.Memory;
  noeterra_alloc(len: number): number;
  noeterra_free(ptr: number, len: number): void;
  noeterra_call(ptr: number, len: number): bigint;
}

function isExports(x: WebAssembly.Exports): x is WebAssembly.Exports & Exports {
  return (
    x.memory instanceof WebAssembly.Memory &&
    typeof x.noeterra_alloc === "function" &&
    typeof x.noeterra_free === "function" &&
    typeof x.noeterra_call === "function"
  );
}

export class EngineUnavailable extends Error {}

/** A call trapped inside the engine; the games it held are gone with it. */
export class EngineStopped extends Error {}

const STOPPED =
  "The Noeterra engine stopped on an internal error, and the game in progress went with it. Go back to the worlds to start again; if this happens again, reload the page.";

export class BrowserEngine {
  private x: Exports;
  private readonly module: WebAssembly.Module;
  /** Set while a fresh instance replaces one that trapped. */
  private restarting: Promise<void> | null = null;
  /** Counts instances: a fresh one numbers its sessions from 1 again. */
  private instances = 1;
  readonly version: string;

  private constructor(module: WebAssembly.Module, x: Exports) {
    this.module = module;
    this.x = x;
    this.version = this.call<{ engine: string }>({ op: "version" }).engine;
  }

  static async load(url: string = ENGINE_URL): Promise<BrowserEngine> {
    let res: Response;
    try {
      res = await fetch(url, { cache: "no-cache" });
    } catch {
      throw new EngineUnavailable("The Noeterra engine could not be fetched.");
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const magic =
      bytes[0] === 0 && bytes[1] === 0x61 && bytes[2] === 0x73 && bytes[3] === 0x6d;
    if (!res.ok || !magic)
      throw new EngineUnavailable(
        "The Noeterra engine is not part of this build. It is compiled from noeterra/ with `npm run noeterra:wasm`.",
      );
    const module = await WebAssembly.compile(bytes);
    if (WebAssembly.Module.imports(module).length)
      throw new EngineUnavailable("Refused: the engine module must import nothing.");
    const { exports } = await WebAssembly.instantiate(module, {});
    if (!isExports(exports))
      throw new EngineUnavailable("The engine module lacks its exports.");
    return new BrowserEngine(module, exports);
  }

  call<T>(request: Record<string, unknown>): T {
    if (this.restarting) throw new EngineStopped(STOPPED);
    let text: string;
    try {
      text = this.exchange(JSON.stringify(request));
    } catch (e) {
      if (!(e instanceof WebAssembly.RuntimeError)) throw e;
      // A trap (a Rust panic) unwinds nothing: the engine's session table stays
      // borrowed, so every later call would trap too, a new game included. The
      // instance is dropped with its memory, and a fresh one from the same
      // module serves the next game.
      this.restart();
      throw new EngineStopped(STOPPED);
    }
    const answer = JSON.parse(text) as { ok: boolean; result?: T; error?: string };
    if (!answer.ok || answer.result === undefined)
      throw new Error(answer.error ?? "The engine refused.");
    return answer.result;
  }

  /** One request through the module's memory. The request buffer is freed
   * however the call ends. */
  private exchange(json: string): string {
    const x = this.x;
    const bytes = new TextEncoder().encode(json);
    // Pointers are unsigned, but JavaScript reads an i32 or i64 result as
    // signed: past 2 GiB of memory they would turn negative.
    const ptr = x.noeterra_alloc(bytes.length) >>> 0;
    try {
      new Uint8Array(x.memory.buffer, ptr, bytes.length).set(bytes);
      const packed = BigInt.asUintN(64, x.noeterra_call(ptr, bytes.length));
      const at = Number(packed >> 32n),
        len = Number(packed & 0xffffffffn);
      const text = new TextDecoder().decode(new Uint8Array(x.memory.buffer, at, len));
      x.noeterra_free(at, len);
      return text;
    } finally {
      x.noeterra_free(ptr, bytes.length);
    }
  }

  /** Replaces a trapped instance; until it is ready, or if it fails, every call
   * reports that the engine stopped. */
  private restart(): void {
    this.restarting ??= WebAssembly.instantiate(this.module, {}).then(
      (instance) => {
        if (!isExports(instance.exports)) return;
        this.x = instance.exports;
        this.instances += 1;
        this.restarting = null;
      },
      () => undefined,
    );
  }

  /** Which instance holds the sessions now; a session id is unique within one. */
  get instance(): number {
    return this.instances;
  }

  scenarios(): ScenarioCard[] {
    return this.call({ op: "scenarios" });
  }
  start(scenario: string, seed: number, seats: Record<string, string>): number {
    return this.call<{ session: number }>({ op: "session_new", scenario, seed, seats })
      .session;
  }
  state(session: number, since: number, geometry: boolean): GameState {
    return this.call({ op: "session_state", session, since, geometry });
  }
  orders(
    session: number,
    civ: number,
    actions: number[],
    responses: { proposal: number; accept: boolean }[],
    messages: { to: number; text: string }[],
  ): string[] {
    return this.call<{ queued: string[] }>({
      op: "session_orders",
      session,
      civ,
      actions,
      responses,
      messages,
    }).queued;
  }
  advance(session: number, turns: number): { turn: number; first_event: number } {
    return this.call({ op: "session_advance", session, turns });
  }
  mind(session: number, civ: number): Mind {
    return this.call({ op: "session_mind", session, civ });
  }
  save(session: number): unknown {
    return this.call({ op: "session_save", session });
  }
  load(save: unknown): { session: number; replay: ReplayReport } {
    return this.call({ op: "session_load", save });
  }
  verify(session: number): ReplayReport {
    return this.call({ op: "session_verify", session });
  }
}

export function describeTerms(t: Terms): string {
  switch (t.type) {
    case "alliance":
      return "an alliance";
    case "non_aggression":
      return "a non-aggression pact";
    case "trade":
      return "a trade agreement";
    case "tribute":
      return `tribute of ${t.amount} gold`;
    case "join_war":
      return `joining war #${t.war}`;
    case "peace":
      return `peace in war #${t.war}`;
  }
}
