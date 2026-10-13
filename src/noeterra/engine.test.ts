import { describe, expect, it, vi } from "vitest";
import { BrowserEngine, EngineStopped } from "./engine";

/**
 * The real module is built from noeterra/ and is not committed, and nothing in
 * it traps on purpose. This stand-in, assembled here byte by byte, has the
 * same three exports and answers every request with one version. A request
 * longer than 64 bytes "panics" (traps) mid-call, and like the real engine,
 * whose session table stays borrowed after a panic, it then traps on every
 * call: its busy flag is never cleared.
 */
function standIn(): string {
  const uleb = (n: number) => {
    const out: number[] = [];
    do {
      const b = n & 0x7f;
      n >>>= 7;
      out.push(n ? b | 0x80 : b);
    } while (n);
    return out;
  };
  const sleb = (v: bigint) => {
    const out: number[] = [];
    for (;;) {
      const b = Number(v & 0x7fn);
      v >>= 7n;
      const done = (v === 0n && !(b & 0x40)) || (v === -1n && b & 0x40);
      out.push(done ? b : b | 0x80);
      if (done) return out;
    }
  };
  const vec = (items: number[][]) => [...uleb(items.length), ...items.flat()];
  const name = (s: string) => [...uleb(s.length), ...new TextEncoder().encode(s)];
  const section = (id: number, body: number[]) => [id, ...uleb(body.length), ...body];
  const fn = (code: number[]) => {
    const body = [0, ...code, 0x0b]; // no locals
    return [...uleb(body.length), ...body];
  };
  const [I32, I64, END, UNREACHABLE] = [0x7f, 0x7e, 0x0b, 0x00];
  const answer = new TextEncoder().encode('{"ok":true,"result":{"engine":"stand-in"}}');
  const at = 2048n;
  const call = [
    ...[0x23, 0, 0x04, 0x40, UNREACHABLE, END], // busy? trap
    ...[0x41, 1, 0x24, 0], // busy = 1
    ...[0x20, 1, 0x41, ...sleb(64n), 0x4b, 0x04, 0x40, UNREACHABLE, END], // long? trap
    ...[0x41, 0, 0x24, 0], // busy = 0
    ...[0x42, ...sleb((at << 32n) | BigInt(answer.length))],
  ];
  const bytes = [
    ...[0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0],
    ...section(
      1,
      vec([
        [0x60, 1, I32, 1, I32],
        [0x60, 2, I32, I32, 0],
        [0x60, 2, I32, I32, 1, I64],
      ]),
    ),
    ...section(3, vec([[0], [1], [2]])),
    ...section(5, vec([[0, 1]])),
    ...section(6, vec([[I32, 1, 0x41, 0, END]])),
    ...section(
      7,
      vec([
        [...name("memory"), 2, 0],
        [...name("noeterra_alloc"), 0, 0],
        [...name("noeterra_free"), 0, 1],
        [...name("noeterra_call"), 0, 2],
      ]),
    ),
    ...section(10, [...uleb(3), ...fn([0x41, ...sleb(1024n)]), ...fn([]), ...fn(call)]),
    ...section(11, vec([[0, 0x41, ...sleb(at), END, ...uleb(answer.length), ...answer]])),
  ];
  return `data:application/wasm;base64,${Buffer.from(bytes).toString("base64")}`;
}

describe("BrowserEngine", () => {
  it("replaces an instance that trapped, and says it stopped until then", async () => {
    const engine = await BrowserEngine.load(standIn());
    expect(engine.version).toBe("stand-in");
    expect(() => engine.call({ op: "version", pad: "x".repeat(64) })).toThrow(
      EngineStopped,
    );
    // The trapped instance would trap again; the engine says so plainly instead.
    expect(() => engine.call({ op: "version" })).toThrow(EngineStopped);
    await vi.waitFor(() =>
      expect(engine.call<{ engine: string }>({ op: "version" }).engine).toBe("stand-in"),
    );
    // Its sessions are numbered afresh, so the page tells them apart by instance.
    expect(engine.instance).toBe(2);
  });
});
