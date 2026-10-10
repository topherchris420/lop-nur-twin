import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDiscoveryHandler } from "./discovery.js";
const roots: string[] = [];
const handler = () => {
  const root = mkdtempSync(join(tmpdir(), "discovery-api-"));
  roots.push(root);
  return createDiscoveryHandler({ RAIN_AUTONOMY_DIR: root }, process.cwd());
};
const request = (
  body: unknown,
  origin: string | null = "http://localhost:5173",
  host = "localhost:5173",
) =>
  new Request(`http://${host}/api/rain/discovery`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(origin ? { Origin: origin } : {}),
    },
    body: JSON.stringify(body),
  });
afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});
describe("local discovery control boundary", () => {
  it("status is idle and does not connect or resume work", async () => {
    const h = handler();
    const r = await h(new Request("http://localhost:5173/api/rain/discovery"));
    expect(r.status).toBe(200);
    const v = await r.json();
    expect(v.active).toBe(false);
    expect(v.model).toBeNull();
    expect(v.history).toEqual([]);
  });
  it("refuses remote hosts, missing Origin, and cross-origin mutations", async () => {
    const h = handler();
    expect((await h(request({ action: "stop" }, null))).status).toBe(403);
    expect((await h(request({ action: "stop" }, "https://evil.example"))).status).toBe(
      403,
    );
    expect(
      (await h(request({ action: "stop" }, "http://evil.example", "evil.example")))
        .status,
    ).toBe(403);
  });
  it("rejects model-supplied commands, budget changes and starts without authority", async () => {
    const h = handler();
    for (const body of [
      { action: "exec", command: "hello" },
      { action: "start", question: "a", ceilings: {} },
      { action: "authorize", prefix: "12345678", reviewed: false },
      { action: "start", question: "a" },
    ])
      expect((await h(request(body))).status).toBe(409);
  });
});
