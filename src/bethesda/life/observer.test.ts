import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HeadlessBethesdaLife } from "./headless.js";
import { parseWitness } from "./observation.js";
import { removeObservation, writeObservation } from "./observationFile.js";
import { Observer } from "./observer.js";

const AT = Date.parse("2026-10-26T15:00:00.000Z");
const life = new HeadlessBethesdaLife({
  seed: 393977,
  pedestrians: 12,
  vehicles: 2,
  buses: 1,
  statisticalPopulation: 30,
});
const observation = life.observation({
  individual: "b".repeat(64),
  epoch: 1,
  checkpoint: { sequence: 0, tick: 0, committedUtc: "2026-10-26T14:59:00.000Z" },
  checkpointing: false,
  observedUtc: new Date(AT).toISOString(),
});

describe("the observer", () => {
  let dir: string, file: string, now: number, observer: Observer, base: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "observer-"));
    file = join(dir, "observation.json");
    now = AT;
    observer = new Observer({
      file,
      now: () => now,
      burst: 4,
      ratePerS: 1,
      streamsPerAddress: 1,
    });
    await new Promise<void>((done) => observer.server.listen(0, "127.0.0.1", done));
    base = `http://127.0.0.1:${(observer.server.address() as AddressInfo).port}`;
  });
  afterEach(() => {
    observer.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const get = async (path: string, init?: RequestInit) => fetch(base + path, init);

  it("says unavailable without an observation, live with one, stale when it stops", async () => {
    let w = parseWitness(await (await get("/v1/now")).json());
    expect(w.status).toBe("unavailable");
    expect((await get("/v1/health")).status).toBe(503);

    writeObservation(file, observation);
    now = AT + 1000;
    observer.refresh();
    const res = await get("/v1/now");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    w = parseWitness(await res.json());
    expect(w.status).toBe("live");
    expect(w.observation).toEqual(observation);
    expect((await get("/v1/health")).status).toBe(200);

    now = AT + 10_000;
    observer.refresh();
    expect(parseWitness(await (await get("/v1/now")).json()).status).toBe("stale");

    removeObservation(file);
    observer.refresh();
    expect(parseWitness(await (await get("/v1/now")).json()).status).toBe("unavailable");
  });

  it("never serves an observation it cannot validate", async () => {
    writeFileSync(file, JSON.stringify({ ...observation, fly: "a fly" }));
    observer.refresh();
    const w = parseWitness(await (await get("/v1/now")).json());
    expect(w.status).toBe("unavailable");
    expect(w.reason).toMatch(/the observation is invalid/);
  });

  it("only reads: other methods are refused, and unknown paths are not found", async () => {
    expect((await get("/v1/now", { method: "POST" })).status).toBe(405);
    expect((await get("/v1/now", { method: "OPTIONS" })).status).toBe(204);
    expect((await get("/v1/tick")).status).toBe(404);
  });

  it("limits each address's requests", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await get("/v1/now")).status);
    expect(codes).toEqual([200, 200, 200, 200, 429]);
    now += 2000;
    expect((await get("/v1/now")).status).toBe(200);
  });

  it("streams the witness every refresh, one stream per address here", async () => {
    writeObservation(file, observation);
    observer.refresh();
    const controller = new AbortController();
    const res = await get("/v1/stream", { signal: controller.signal });
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const reader = res.body!.getReader();
    const events: string[] = [];
    let text = "";
    const decoder = new TextDecoder();
    while (events.length < 2) {
      const { value } = await reader.read();
      text += decoder.decode(value);
      const parts = text.split("\n\n");
      text = parts.pop()!;
      for (const p of parts) {
        const data = p.split("\n").find((l) => l.startsWith("data: "));
        if (data) events.push(data.slice(6));
      }
      if (events.length === 1) {
        now = AT + 2000;
        observer.refresh();
      }
    }
    expect(events.map((e) => parseWitness(JSON.parse(e)).status)).toEqual([
      "live",
      "live",
    ]);
    expect((await get("/v1/stream")).status).toBe(429);
    controller.abort();
  });
});
