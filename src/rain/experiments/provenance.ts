/**
 * Run provenance capture and secret redaction.
 *
 * A port of R.A.I.N.'s `experiments/provenance.py` (james_library, MIT) for
 * a Node runtime. Captured: the recording checkout's git commit, branch and
 * dirty state, and the runtime's identity. Deliberately not captured:
 * environment variables, hostname, user name, absolute home paths.
 *
 * Server only: reads `git` through a subprocess and the platform through
 * `node:os`. Never imported by the browser.
 */
import { execFileSync } from "node:child_process";
import { arch, cpus, platform, release } from "node:os";

export const REDACTED = "[REDACTED]";

const CREDENTIAL_FIELD =
  /(secret|token|passw|api[_-]?key|apikey|authorization|cookie|credential|private[_-]?key|access[_-]?key)/i;
const CREDENTIAL_FORMATS: Record<string, RegExp> = {
  api_key: /\bsk-[A-Za-z0-9_-]{16,}/g,
  github_token: /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g,
  slack_token: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  aws_access_key: /\bAKIA[0-9A-Z]{16}\b/g,
  google_api_key: /\bAIza[0-9A-Za-z_-]{35}/g,
  huggingface_token: /\bhf_[A-Za-z0-9]{30,}/g,
  bearer_token: /\bbearer\s+[A-Za-z0-9._~+/=-]{16,}/gi,
  private_key: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  jwt: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
};

/** True when `text` contains something shaped like a known credential format. */
export function credentialFormatsIn(text: string): boolean {
  return Object.values(CREDENTIAL_FORMATS).some((pattern) => {
    pattern.lastIndex = 0;
    const hit = pattern.test(text);
    pattern.lastIndex = 0;
    return hit;
  });
}

/**
 * A copy with secret-looking strings masked. A string under a secret-like
 * key (`api_key`, `authorization` …) is masked entirely. Numbers are kept, so
 * `max_tokens: 512` survives. Any string matching a known credential format
 * is masked in place.
 */
export function redact<T>(value: T, key: string | null = null): T {
  if (Array.isArray(value)) return value.map((v) => redact(v, key)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redact(v, k);
    return out as T;
  }
  if (typeof value === "string") {
    if (key !== null && CREDENTIAL_FIELD.test(key) && value) return REDACTED as unknown as T;
    let text: string = value;
    for (const pattern of Object.values(CREDENTIAL_FORMATS)) text = text.replace(pattern, REDACTED);
    return text as unknown as T;
  }
  return value;
}

export interface GitState {
  commit: string | null;
  branch: string | null;
  dirty: boolean | null;
  changed_paths: number | null;
  note: string | null;
}

function git(cwd: string, ...args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Commit, branch and dirty state of the checkout at `cwd`. Registry data
 * (`excluded`, repository-relative) is ignored for the dirty check: recording
 * a run must not make the next run look like it came from modified code.
 */
export function gitState(cwd: string, excluded: readonly string[] = []): GitState {
  const commit = git(cwd, "rev-parse", "HEAD");
  if (commit === null || !/^[0-9a-f]{40}$/.test(commit))
    return {
      commit: null,
      branch: null,
      dirty: null,
      changed_paths: null,
      note: "git metadata unavailable; source revision unknown",
    };
  const pathspec = [".", ...excluded.map((path) => `:(exclude)${path}`)];
  const status = git(cwd, "status", "--porcelain", "--untracked-files=normal", "--", ...pathspec);
  const changed = (status ?? "").split("\n").filter((line) => line.trim());
  return {
    commit,
    branch: git(cwd, "rev-parse", "--abbrev-ref", "HEAD"),
    dirty: status !== null ? changed.length > 0 : null,
    changed_paths: status !== null ? changed.length : null,
    note: null,
  };
}

/** The runtime that recorded a run: the Node release and the platform, nothing identifying. */
export function environment(): Record<string, string | number | null> {
  return {
    runtime: "node",
    node: process.versions.node,
    os: platform(),
    os_release: release(),
    machine: arch(),
    cpu_count: cpus().length || null,
  };
}
