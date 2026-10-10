#!/usr/bin/env node
/** Local Qwen discovery; explicit start only. The old 44-design CLI remains unchanged. */
import { execFileSync } from "node:child_process";
import "../scripts/ts-hooks.mjs";
const { createDiscoveryService } =
  await import("../src/rain/autonomy/discoveryService.ts");
try {
  globalThis.__LAB_REVISION__ = {
    commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    dirty:
      execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().length >
      0,
    source: "git",
  };
  const args = process.argv.slice(2);
  const service = createDiscoveryService(process.env, process.cwd());
  if (args[0] === "--status") console.log(JSON.stringify(service.status(), null, 2));
  else if (args[0] === "--recover" && args[1] && args[2] === "--reviewed")
    console.log(service.recover(args[1]));
  else {
    const research = args.includes("--research");
    const at = args.indexOf("--question");
    const goal = at >= 0 ? args[at + 1] : undefined;
    const view = research
      ? await service.prepareResearch(
          goal ?? service.status().question,
          args.includes("--online"),
        )
      : await service.prepare();
    if (args[0] === "--charter" || !args.length)
      console.log(JSON.stringify(view, null, 2));
    else if (args[0] === "--authorize" && args[1] && args[2] === "--reviewed")
      console.log(JSON.stringify(service.authorize(args[1], true), null, 2));
    else if (args[0] === "--start") {
      process.once("SIGINT", () => service.stop());
      process.once("SIGTERM", () => service.stop());
      await service.start(research ? (goal ?? view.question) : args[1]);
      const timer = setInterval(() => {
        const s = service.status();
        console.log(`${s.stage}: ${s.detail}`);
      }, 5000);
      try {
        const result = await service.completion();
        console.log(JSON.stringify(result, null, 2));
        if (!result?.ok) process.exitCode = 1;
      } finally {
        clearInterval(timer);
      }
    } else
      throw new Error(
        "Usage: rain:discovery -- --charter | --authorize PREFIX --reviewed | --start [QUESTION] | --status | --recover DIGEST --reviewed. Add --research --question QUESTION [--online] for a full research program.",
      );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
