import { afterAll, describe, expect, it, vi } from "vitest";

/**
 * The experiment worker hears only the page that created it. A dedicated
 * worker's messages carry no origin; one that names an origin is refused out
 * loud, and nothing runs or verifies.
 */
describe("the experiment worker hears only its page", () => {
  const posted: Record<string, unknown>[] = [];
  const scope: {
    postMessage: (m: Record<string, unknown>) => void;
    onmessage: ((e: { origin: string; data: unknown }) => void) | null;
  } = { postMessage: (m) => posted.push(m), onmessage: null };
  vi.stubGlobal("self", scope);
  afterAll(() => {
    vi.unstubAllGlobals();
  });
  const send = async (origin: string, data: unknown) => {
    if (!scope.onmessage) await import("./experimentWorker");
    posted.length = 0;
    scope.onmessage!({ origin, data });
    return posted.splice(0);
  };

  it("refuses a message that names an origin, and runs nothing", async () => {
    for (const origin of ["https://evil.example", "null", "http://127.0.0.1:4173"])
      expect(await send(origin, { type: "verify", record: {} })).toEqual([
        { type: "error", name: "Refused", message: "a message the page did not send" },
      ]);
  });
  it("answers its own page's message", async () => {
    const [answer] = await send("", {
      type: "verify",
      record: { schema: "not a record" },
    });
    expect(answer).toMatchObject({ type: "verified" });
    expect((answer!.verification as { ok: boolean }).ok).toBe(false);
  });
});
