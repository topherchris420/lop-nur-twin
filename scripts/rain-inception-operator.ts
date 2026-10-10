/** Optional live CLI. Review/authorization are explicit stages; no fixture or fallback. */
import { execFileSync } from "node:child_process";
import { createDiscoveryService } from "../src/rain/autonomy/discoveryService.js";
import {
  partnership,
  INCEPTION_MODES,
  type InceptionMode,
} from "../src/bethesda/rain/inceptionProtocol.js";
const scriptIndex = process.argv.findIndex((arg) =>
  arg.replaceAll("\\", "/").endsWith("/rain-inception-operator.ts"),
);
const args = process.argv
  .slice(scriptIndex < 0 ? 2 : scriptIndex + 1)
  .filter((arg) => arg !== "--");
const value = (flag: string) => {
  const i = args.indexOf(flag);
  return i < 0 ? undefined : args[i + 1];
};
const flags = new Set([
  "--status",
  "--prepare",
  "--authorize",
  "--reviewed",
  "--start",
  "--question",
  "--mode",
  "--online",
  "--approve-world",
  "--child",
  "--help",
]);
for (let i = 0; i < args.length; i++) {
  const flag = args[i]!;
  if (!flags.has(flag)) throw new Error("Unknown argument: " + flag);
  if (
    ["--authorize", "--question", "--mode", "--approve-world", "--child"].includes(flag)
  ) {
    if (!args[i + 1] || args[i + 1]!.startsWith("--"))
      throw new Error("Value required for " + flag);
    i++;
  }
}
if (args.includes("--help") || args.length === 0) {
  console.log(`LIVE Project Inception, using the operator's configured local model.
Set RAIN_AUTONOMY_ENABLED=true, RAIN_MODEL_PROVIDER=lmstudio, and RAIN_MODEL.
Prepare:   bun run rain:inception:operator -- --prepare --question "Your bounded question"
Authorize: bun run rain:inception:operator -- --authorize CHARTER_PREFIX --reviewed --question "Your bounded question"
Run:       bun run rain:inception:operator -- --start --question "Your bounded question"
Inspect:   bun run rain:inception:operator -- --status
Approve a proposed child: --approve-world WORLD_DIGEST --reviewed
Review its execution charter: --prepare --child LAB_ID
Authorize its execution: --authorize CHILD_CHARTER_PREFIX --reviewed --child LAB_ID
Run its investigation: --start --child LAB_ID
Keep question, mode and literature selection identical across parent stages.
No command auto-authorizes a live experiment. Ctrl+C requests emergency stop.`);
} else {
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const dirty =
    execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().length >
    0;
  Object.assign(globalThis, { __LAB_REVISION__: { commit, dirty, source: "git" } });
  const service = createDiscoveryService(process.env, process.cwd());
  const stop = () => {
    service.stop();
  };
  process.on("SIGINT", stop);
  try {
    if (args.includes("--status")) console.log(JSON.stringify(service.status(), null, 2));
    else {
      const mode = value("--mode") ?? "independent";
      if (!INCEPTION_MODES.includes(mode as InceptionMode))
        throw new Error("Unknown research mode");
      const config = partnership(mode as InceptionMode);
      if (process.env.RAIN_COLLABORATOR_PROVIDER === "openai") {
        const model = process.env.RAIN_COLLABORATOR_MODEL;
        if (!model) throw new Error("Explicit collaborator model required");
        config.collaborator_model = {
          provider: "openai",
          model,
          endpoint: "https://api.openai.com",
        };
      }
      const question =
        value("--question") ??
        "Can Dynamic Resonance Rooting motivate falsifiable alternatives for collective responses to simulated urban disruptions?";
      await service.preparePartnership(question, args.includes("--online"), config);
      const child = value("--child");
      if (child) service.prepareDescendant(child);
      const world = value("--approve-world");
      if (world)
        service.approveDescendant(world, world.slice(0, 8), args.includes("--reviewed"));
      const prefix = value("--authorize");
      if (prefix) service.authorize(prefix, args.includes("--reviewed"));
      if (args.includes("--start")) {
        await service.start(service.status().question);
        const result = await service.completion();
        console.log(JSON.stringify(result, null, 2));
        if (!result?.ok) process.exitCode = 1;
      } else {
        const status = service.status();
        console.log(
          JSON.stringify(
            {
              question: status.question,
              charter: status.charter,
              charter_sha256: status.charter_sha256,
              authorization: status.authorization,
              observatory: status.observatory,
              detail: status.detail,
            },
            null,
            2,
          ),
        );
      }
    }
  } finally {
    process.removeListener("SIGINT", stop);
    service.dispose();
  }
}
