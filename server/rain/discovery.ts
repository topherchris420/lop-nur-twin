/** Local-only discovery workbench; never deployed as a stateless cloud function. */
import { createDiscoveryService } from "../../src/rain/autonomy/discoveryService.js";
export function createDiscoveryHandler(
  env: Record<string, string | undefined>,
  cwd: string,
) {
  let service: ReturnType<typeof createDiscoveryService> | null = null;
  return async (request: Request): Promise<Response> => {
    const reply = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), {
        status,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    const url = new URL(request.url);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
      return reply({ error: "Local workbench only" }, 403);
    if (request.method !== "GET" && request.headers.get("origin") !== url.origin)
      return reply({ error: "Same-origin operator control required" }, 403);
    try {
      service ??= createDiscoveryService(env, cwd);
      if (request.method === "GET") return reply(service.status());
      if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405);
      const text = await request.text();
      if (text.length > 2048) return reply({ error: "Request too large" }, 413);
      const data = JSON.parse(text) as Record<string, unknown>;
      if (!data || Array.isArray(data) || typeof data !== "object")
        throw new Error("Closed control object required");
      const fields: Record<string, string[]> = {
        prepare: ["action"],
        authorize: ["action", "prefix", "reviewed"],
        start: ["action", "question"],
        pause: ["action"],
        stop: ["action"],
        recover: ["action", "digest", "reviewed"],
      };
      const action = typeof data.action === "string" ? data.action : "";
      const keys = fields[action];
      if (
        !keys ||
        Object.keys(data).length !== keys.length ||
        keys.some((k) => !Object.hasOwn(data, k))
      )
        throw new Error("Unknown action or fields");
      switch (action) {
        case "prepare":
          return reply(await service.prepare());
        case "authorize":
          if (typeof data.prefix !== "string" || data.reviewed !== true)
            throw new Error("Explicit review and prefix required");
          return reply(service.authorize(data.prefix, true));
        case "start":
          if (typeof data.question !== "string") throw new Error("Question required");
          return reply(await service.start(data.question));
        case "pause":
          return reply(service.pause());
        case "stop":
          return reply(service.stop());
        case "recover":
          if (typeof data.digest !== "string" || data.reviewed !== true)
            throw new Error("Review the interrupted lock first");
          return reply(service.recover(data.digest));
        default:
          throw new Error("Unsupported action");
      }
    } catch (error) {
      console.error(
        "Discovery handler request failed:",
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      );
      return reply({ error: "Request failed" }, 409);
    }
  };
}
