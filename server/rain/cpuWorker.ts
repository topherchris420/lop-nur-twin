/** Explicit local CPU capability. No model chooses executables, repositories or source paths. */
import { execFile, execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { sha256, sha256Bytes, sha256Json } from "../../src/rain/sha256.js";
import { validateProbe, type CpuDesign } from "../../src/rain/research/intelligence.js";
import type { CpuExecutor } from "../../src/rain/research/intelligenceCampaign.js";

const REPOSITORIES = new Set(["quantum-noise-profiler", "dynamic-resonance-rooting"]);
const SOURCE_DIRS: Record<string, string> = {
  "quantum-noise-profiler": "src/qnp",
  "dynamic-resonance-rooting": "src/drr_framework",
};
function git(root: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["--no-optional-locks", "-c", "core.fsmonitor=false", "-C", root, ...args],
    { encoding: "utf8", windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024 },
  ).trim();
}
function sourceFiles(
  root: string,
  dir: string,
): Array<{ path: string; sha256: string; text: string }> {
  const files = readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink())
      throw new Error("CPU source cannot contain symbolic links");
    return entry.isDirectory()
      ? sourceFiles(root, path)
      : entry.name.endsWith(".py")
        ? [snapshot(root, path)]
        : [];
  });
  return files;
}
function snapshot(root: string, path: string) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024)
    throw new Error("Invalid CPU source file");
  const text = readFileSync(path, "utf8");
  return { path: relative(root, path).replaceAll("\\", "/"), sha256: sha256(text), text };
}
/** Source receipts are taken BEFORE approval and compared before/after every worker. */
export function cpuBinding(repositoryRoot: string, repositories: Record<string, string>) {
  const repo = realpathSync(repositoryRoot);
  const bridge = join(repo, "scripts", "research-validation");
  const worker = [
    snapshot(repo, join(bridge, "worker.py")),
    snapshot(repo, join(bridge, "validation.py")),
    snapshot(repo, join(bridge, "requirements.txt")),
  ];
  const upstream = Object.keys(repositories)
    .sort()
    .map((name) => {
      if (!REPOSITORIES.has(name)) throw new Error("Unknown CPU repository capability");
      const root = realpathSync(repositories[name]!);
      if (resolve(git(root, "rev-parse", "--show-toplevel")) !== resolve(root))
        throw new Error("CPU mapping must name a repository root");
      const origin = git(root, "remote", "get-url", "origin").replace(/\.git$/, "");
      if (
        ![
          `https://github.com/topherchris420/${name}`,
          `git@github.com:topherchris420/${name}`,
          `ssh://git@github.com/topherchris420/${name}`,
        ].includes(origin)
      )
        throw new Error("CPU source origin is not allowlisted");
      const sources = [
        snapshot(root, join(root, "LICENSE")),
        snapshot(root, join(root, "pyproject.toml")),
        ...sourceFiles(root, join(root, SOURCE_DIRS[name]!)),
      ].sort((a, b) => a.path.localeCompare(b.path));
      if (sources.length > 512 || JSON.stringify(sources).length > 2 * 1024 * 1024)
        throw new Error("CPU source inventory exceeded");
      return {
        repository: `topherchris420/${name}`,
        commit: git(root, "rev-parse", "HEAD"),
        dirty: git(root, "status", "--porcelain", "--untracked-files=normal").length > 0,
        sources,
      };
    });
  const controller = [
    "src/rain/research/intelligence.ts",
    "src/rain/research/intelligenceCampaign.ts",
    "server/rain/cpuWorker.ts",
  ].map((path) => snapshot(repo, join(repo, path)));
  return { schema: "rain-cpu-source-binding/v1", worker, controller, upstream };
}

export function createCpuExecutor(options: {
  repositoryRoot: string;
  python: string;
  repositories: Record<string, string>;
}): CpuExecutor {
  const root = realpathSync(options.repositoryRoot),
    python = realpathSync(options.python);
  const repositories = Object.fromEntries(
    Object.entries(options.repositories).map(([key, path]) => [key, realpathSync(path)]),
  );
  const binding = cpuBinding(root, repositories);
  // Bind executable bytes too: replacing the interpreter requires a new reviewed envelope.
  const environment = () => {
    const executable = readFileSync(python);
    if (executable.length > 100 * 1024 * 1024)
      throw new Error("Unexpected CPU interpreter size");
    const versions = JSON.parse(
      execFileSync(
        python,
        [
          "-c",
          "import sys,json,importlib.metadata as m; print(json.dumps({'python':sys.version,'numpy':m.version('numpy'),'scipy':m.version('scipy')}))",
        ],
        {
          cwd: root,
          encoding: "utf8",
          windowsHide: true,
          timeout: 10000,
          maxBuffer: 8192,
        },
      ),
    ) as Record<string, string>;
    return { interpreter_sha256: sha256Bytes(new Uint8Array(executable)), versions };
  };
  const approvedEnvironment = environment();
  const approvedBinding = {
    ...binding,
    ...approvedEnvironment,
    protocol: "json-stdin/v1",
  };
  const worker = join(root, "scripts", "research-validation", "worker.py");
  return {
    binding: approvedBinding,
    async run(
      design: CpuDesign,
      seeds: number[],
      timeoutMs: number,
      signal?: AbortSignal,
    ) {
      if (!Number.isFinite(timeoutMs) || timeoutMs < 50 || timeoutMs > 300000)
        throw new Error("CPU timeout outside capability");
      if (signal?.aborted) throw new Error("CPU execution cancelled");
      if (sha256Json(environment()) !== sha256Json(approvedEnvironment))
        throw new Error("Approved CPU interpreter or dependency versions changed");
      if (sha256Json(cpuBinding(root, repositories)) !== sha256Json(binding))
        throw new Error("Approved CPU source changed");
      const request = JSON.stringify({
        adapter: design.adapter,
        parameters: design.parameters,
        seeds,
        repositories,
      });
      if (Buffer.byteLength(request) > 65536)
        throw new Error("CPU worker input too large");
      const output = await new Promise<string>((resolveOutput, reject) => {
        const child = execFile(
          python,
          [worker],
          {
            cwd: root,
            windowsHide: true,
            timeout: timeoutMs,
            maxBuffer: 200000,
            signal,
            killSignal: "SIGKILL",
            encoding: "utf8",
          },
          (error, stdout) => {
            if (error) reject(new Error("Bounded CPU worker failed"));
            else resolveOutput(stdout);
          },
        );
        child.stdin?.on("error", () => {
          /* process failure is reported by the completion callback */
        });
        child.stdin?.end(request);
      });
      if (sha256Json(cpuBinding(root, repositories)) !== sha256Json(binding))
        throw new Error("CPU source changed during execution");
      if (sha256Json(environment()) !== sha256Json(approvedEnvironment))
        throw new Error(
          "CPU interpreter or dependency versions changed during execution",
        );
      return validateProbe(JSON.parse(output), seeds.length);
    },
  };
}
