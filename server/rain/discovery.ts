/** Local-only discovery workbench; never deployed as a stateless cloud function. */
import { createDiscoveryService } from "../../src/rain/autonomy/discoveryService.js";
import {
  PARTNERSHIP_SCHEMA,
  type Partnership,
} from "../../src/bethesda/rain/inceptionProtocol.js";
import { checkData } from "../../src/bethesda/rain/discoveryProtocol.js";
import {
  SESSION_POLICY_SCHEMA,
  type SessionPolicy,
} from "../../src/bethesda/rain/scheduleProtocol.js";
import {
  ASSESSMENT_SCHEMA,
  type InstitutionAssessment,
} from "../../src/bethesda/rain/institutionProtocol.js";
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
      if (request.method === "GET") {
        const verify = url.searchParams.get("verify"),
          run = url.searchParams.get("run");
        if (verify !== null) {
          if (
            [...url.searchParams.keys()].length !== 2 ||
            !/^[a-z][a-z0-9-]{0,63}$/.test(verify) ||
            !run ||
            !/^[A-Za-z0-9-]{1,100}$/.test(run)
          )
            throw new Error("Invalid host replay request");
          return reply(await service.verifyDescendant(verify, run, request.signal));
        }
        const archive = url.searchParams.get("archive");
        if (archive !== null) {
          if (
            [...url.searchParams.keys()].length !== 1 ||
            !/^[a-z][a-z0-9-]{0,63}$/.test(archive)
          )
            throw new Error("Invalid archive namespace");
          return new Response(service.archive(archive), {
            headers: {
              "Content-Type": "application/json",
              "Content-Disposition":
                'attachment; filename="rain-inception-' + archive + '.json"',
              "Cache-Control": "no-store",
              "X-Content-Type-Options": "nosniff",
            },
          });
        }
        const lab = url.searchParams.get("lab");
        if (lab !== null) {
          if (
            [...url.searchParams.keys()].length !== 1 ||
            !/^[a-z][a-z0-9-]{0,63}$/.test(lab)
          )
            throw new Error("Invalid descendant inspection");
          return reply(service.descendant(lab));
        }
        const artifact = url.searchParams.get("artifact");
        if (artifact !== null) {
          if ([...url.searchParams.keys()].length !== 1)
            throw new Error("Invalid artifact request");
          const text = service.artifact(artifact);
          return new Response(text, {
            headers: {
              "Content-Type": "application/octet-stream",
              "Content-Disposition":
                'attachment; filename="' + artifact.split("/").at(-1) + '"',
              "Cache-Control": "no-store",
              "X-Content-Type-Options": "nosniff",
            },
          });
        }
        return reply(service.status());
      }
      if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405);
      const text = await request.text();
      if (text.length > 8192) return reply({ error: "Request too large" }, 413);
      const data = JSON.parse(text) as Record<string, unknown>;
      if (!data || Array.isArray(data) || typeof data !== "object")
        throw new Error("Closed control object required");
      const fields: Record<string, string[]> = {
        prepare: ["action"],
        research: ["action", "question", "online"],
        partnership: ["action", "question", "online", "partnership"],
        "approve-world": ["action", "digest", "prefix", "reviewed"],
        "prepare-world": ["action", "id"],
        authorize: ["action", "prefix", "reviewed"],
        start: ["action", "question"],
        pause: ["action"],
        stop: ["action"],
        recover: ["action", "digest", "reviewed"],
        schedule: ["action", "policy", "prefix", "reviewed"],
        "schedule-control": ["action", "command"],
        "forget-memory": ["action", "id"],
        intervene: ["action", "text"],
        assess: ["action", "assessment", "reviewed"],
        source: ["action", "title", "text", "reviewed"],
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
        case "source":
          if (
            typeof data.title !== "string" ||
            typeof data.text !== "string" ||
            data.reviewed !== true
          )
            throw new Error("Explicit source approval required");
          return reply(service.registerSource(data.title, data.text));
        case "assess": {
          const checked = checkData<InstitutionAssessment>(
            data.assessment,
            ASSESSMENT_SCHEMA,
          );
          if (!checked.ok || data.reviewed !== true)
            throw new Error("Explicit human assessment required");
          return reply(service.assessInstitution(checked.value));
        }
        case "intervene":
          if (typeof data.text !== "string") throw new Error("Operator comment required");
          return reply(service.intervene(data.text));
        case "forget-memory":
          if (typeof data.id !== "string" || data.id.length > 200)
            throw new Error("Memory identity required");
          return reply(service.forgetMemory(data.id));
        case "schedule": {
          const checked = checkData<SessionPolicy>(data.policy, SESSION_POLICY_SCHEMA);
          if (!checked.ok || typeof data.prefix !== "string" || data.reviewed !== true)
            throw new Error("Explicit schedule review required");
          return reply(service.approveSchedule(checked.value, data.prefix, true));
        }
        case "schedule-control":
          if (
            data.command !== "paused" &&
            data.command !== "armed" &&
            data.command !== "cancelled"
          )
            throw new Error("Unknown schedule control");
          return reply(service.scheduleControl(data.command));
        case "approve-world":
          if (
            typeof data.digest !== "string" ||
            typeof data.prefix !== "string" ||
            data.reviewed !== true
          )
            throw new Error("Explicit world review required");
          return reply(service.approveDescendant(data.digest, data.prefix, true));
        case "prepare-world":
          if (typeof data.id !== "string") throw new Error("Descendant id required");
          return reply(service.prepareDescendant(data.id));
        case "partnership": {
          const checked = checkData<Partnership>(data.partnership, PARTNERSHIP_SCHEMA);
          if (
            !checked.ok ||
            typeof data.question !== "string" ||
            typeof data.online !== "boolean"
          )
            throw new Error("Invalid partnership scope");
          return reply(
            await service.preparePartnership(data.question, data.online, checked.value),
          );
        }
        case "prepare":
          return reply(await service.prepare());
        case "research":
          if (typeof data.question !== "string" || typeof data.online !== "boolean")
            throw new Error(
              "A research question and explicit literature preference are required",
            );
          return reply(await service.prepareResearch(data.question, data.online));
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
