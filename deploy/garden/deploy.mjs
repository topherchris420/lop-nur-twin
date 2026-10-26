#!/usr/bin/env node
/**
 * Puts a garden release (`bun run garden:build`) on the live garden's server
 * and checks it from outside, without touching the fly. The server and its
 * credentials come from the environment, never from the repository:
 *
 *   GARDEN_SSH          user@host of the garden's server
 *   GARDEN_SSH_KEY      the private key for it
 *   GARDEN_KNOWN_HOSTS  a known_hosts file that pins the server's host key
 *   GARDEN_BACKUP_DIR   where `backup` keeps its copies of the life (outside the repository)
 *   GARDEN_ORIGIN       the public site, for `verify` (default http://<host>)
 *
 *   node deploy/garden/deploy.mjs inspect                     read only
 *   node deploy/garden/deploy.mjs backup                      the garden's own backup, copied here
 *   node deploy/garden/deploy.mjs publish <release-dir> --expect-index <sha256>
 *   node deploy/garden/deploy.mjs verify <release-dir>        read only, from outside
 *   node deploy/garden/deploy.mjs rollback <release>
 *
 * `publish` runs `publish.py` on the server, which refuses without a fresh
 * backup and puts the previous page back if any check after the swap fails.
 * docs/LIVE_GARDEN.md has the order and what each step proves.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const RELEASE = /^garden-\d{8}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SNAPSHOT = /^day-[0-6]\.sqlite3$/;
const LIFE_BACKUPS = "/var/lib/bethesda-fly/backups";
const STATE = String.raw`python3 -c 'import json,urllib.request;s=json.load(urllib.request.urlopen("http://127.0.0.1:8765/state",timeout=5));print(json.dumps({k:s.get(k) for k in ("life_id","born_at","ticks","moments_count")}))'`;

const [command, ...rest] = process.argv.slice(2);
const positional = rest.filter(
  (a, i) => !a.startsWith("--") && !rest[i - 1]?.startsWith("--"),
);
const opt = (name) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
function die(message) {
  console.error(`deploy: ${message}`);
  process.exit(2);
}
function env(name) {
  const value = process.env[name];
  if (!value) die(`${name} is not set (see the top of deploy/garden/deploy.mjs)`);
  return value;
}

// --------------------------------------------------------------- the server

function target() {
  const t = env("GARDEN_SSH");
  if (!/^[a-z_][a-z0-9_-]*@[A-Za-z0-9.-]+$/.test(t)) die("GARDEN_SSH must be user@host");
  return t;
}
const sshOptions = () => [
  "-i",
  env("GARDEN_SSH_KEY"),
  "-o",
  "IdentitiesOnly=yes",
  "-o",
  `UserKnownHostsFile=${env("GARDEN_KNOWN_HOSTS")}`,
  "-o",
  "StrictHostKeyChecking=yes",
  "-o",
  "BatchMode=yes",
  "-o",
  "ConnectTimeout=15",
];
/** Runs a command on the server; its output as text, or bytes with `binary`. */
function ssh(remote, { input, binary = false, quiet = false } = {}) {
  if (!quiet) console.error(`  $ ssh ${target()} ${remote.split("\n")[0]}`);
  return execFileSync("ssh", [...sshOptions(), target(), remote], {
    input,
    encoding: binary ? "buffer" : "utf8",
    maxBuffer: 1 << 30,
    stdio: ["pipe", "pipe", "inherit"],
  });
}
function scp(sources, remote, recursive = false) {
  console.error(`  $ scp ${recursive ? "-r " : ""}… ${target()}:${remote}`);
  execFileSync(
    "scp",
    [...sshOptions(), ...(recursive ? ["-r"] : []), ...sources, `${target()}:${remote}`],
    { stdio: ["ignore", "inherit", "inherit"] },
  );
}
const liveLife = () => JSON.parse(ssh(STATE, { quiet: true }));

/** A fresh directory in the login user's home, for this run's files. */
function stageDir() {
  const dir = `garden-stage/${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`;
  ssh(`mkdir -p ${dir}`);
  scp([path.join(HERE, "publish.py")], `${dir}/`);
  return dir;
}
/** Runs publish.py on the server and prints its result, exiting as it did. */
function runPublish(dir, args, record) {
  let out;
  let code = 0;
  try {
    out = ssh(`sudo python3 ${dir}/publish.py ${args}`);
  } catch (e) {
    out = String(e.stdout ?? "");
    code = e.status ?? 1;
  }
  const result = JSON.parse(out.trim().split("\n").pop() || "{}");
  if (record) writeFileSync(record, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  process.exit(code);
}

/** The release in a directory, each file checked against its manifest. */
function release(dir) {
  if (!dir) die("give the release directory, e.g. dist-garden/garden-…");
  const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"));
  if (!RELEASE.test(manifest.release ?? "")) die(`not a garden release: ${dir}`);
  if (path.basename(path.resolve(dir)) !== manifest.release)
    die(`${dir} is not named for its release`);
  for (const [rel, digest] of Object.entries(manifest.sha256))
    if (sha256(readFileSync(path.join(dir, rel))) !== digest)
      die(`${rel} does not match the manifest: build again`);
  return manifest;
}

// ---------------------------------------------------------------- commands

if (command === "inspect") {
  const out = ssh("bash -s", {
    input: String.raw`set -eu
root=/var/www/bethesda-fly
echo "index_sha256 $(sha256sum $root/index.html | cut -d' ' -f1)"
echo "index_uses $(grep -oE '/(ui|garden)-[0-9]{8}-[0-9a-f]{12}/' $root/index.html | sort -u | tr -d / | tr '\n' ' ')"
echo "releases $(cd $root && ls -d ui-* garden-* 2>/dev/null | tr '\n' ' ')"
echo "service $(systemctl show bethesda-fly --property=ActiveState --value) pid $(systemctl show bethesda-fly --property=MainPID --value) restarts $(systemctl show bethesda-fly --property=NRestarts --value)"
echo "backup_unit $(systemctl show bethesda-fly-backup.service --property=Result --value)"
sudo find ${LIFE_BACKUPS} -maxdepth 1 -name 'day-*.sqlite3' -printf 'snapshot %f %s %T@\n' | sort
echo "life $(${STATE})"
echo "free $(df -h --output=avail /var/www | tail -1 | tr -d ' ')"
`,
  });
  const now = Date.now() / 1000;
  for (const line of out.trim().split("\n")) {
    const [key, ...v] = line.split(" ");
    if (key === "snapshot")
      console.log(
        `snapshot      ${v[0]}  ${v[1]} bytes  ${((now - Number(v[2])) / 3600).toFixed(1)} h old`,
      );
    else console.log(`${key.padEnd(13)} ${v.join(" ")}`);
  }
} else if (command === "backup") {
  const base = path.resolve(env("GARDEN_BACKUP_DIR"));
  if (!path.relative(REPO, base).startsWith(".."))
    die("GARDEN_BACKUP_DIR must be outside the repository: the life is not committed");
  const dir = path.join(
    base,
    `bethesda-fly-${new Date().toISOString().replace(/[:.]/g, "-")}`,
  );
  const snapshots = () =>
    ssh(
      `sudo find ${LIFE_BACKUPS} -maxdepth 1 -name 'day-*.sqlite3' -printf '%f %T@\\n'`,
      { quiet: true },
    )
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        const [name, mtime] = l.split(" ");
        if (!SNAPSHOT.test(name)) die(`unexpected file in ${LIFE_BACKUPS}: ${name}`);
        return { name, mtime: Number(mtime) };
      });
  /** Copies one snapshot here and checks it against the server's digest. */
  const copy = (name, into) => {
    mkdirSync(into, { recursive: true });
    const data = ssh(`sudo cat ${LIFE_BACKUPS}/${name}`, { binary: true });
    const remote = ssh(`sudo sha256sum ${LIFE_BACKUPS}/${name}`, { quiet: true }).split(
      " ",
    )[0];
    if (sha256(data) !== remote)
      die(`${name} changed while it was copied: run backup again`);
    writeFileSync(path.join(into, name), data);
    return { name, bytes: data.length, sha256: remote };
  };

  // The weekly slots the backup is about to overwrite one of, kept here first.
  const kept = snapshots().map((s) => copy(s.name, path.join(dir, "before")));
  // The garden's own, established backup.
  const result = ssh(
    "sudo systemctl start bethesda-fly-backup.service && systemctl show bethesda-fly-backup.service --property=Result --value",
  ).trim();
  if (result !== "success") die(`bethesda-fly-backup.service ended with ${result}`);
  const newest = snapshots().sort((a, b) => b.mtime - a.mtime)[0];
  if (!newest || Date.now() / 1000 - newest.mtime > 600)
    die("the backup ran but no snapshot is fresh");
  const fresh = copy(newest.name, path.join(dir, "after"));

  // Read the copy here: whole, and the same life the garden reports. SQLite
  // leaves -wal and -shm files beside a WAL database it opens, so it reads a
  // throwaway twin and the kept copy stays byte for byte the server's.
  const { DatabaseSync } = await import("node:sqlite");
  const probe = path.join(tmpdir(), `garden-probe-${process.pid}.sqlite3`);
  copyFileSync(path.join(dir, "after", fresh.name), probe);
  const db = new DatabaseSync(probe, { readOnly: true });
  const integrity = db.prepare("PRAGMA integrity_check").get();
  const world = JSON.parse(
    db.prepare("SELECT value FROM world WHERE id = 1").get().value,
  );
  const moments = db.prepare("SELECT COUNT(*) AS n FROM moments").get().n;
  db.close();
  for (const f of [probe, `${probe}-wal`, `${probe}-shm`]) rmSync(f, { force: true });
  const live = liveLife();
  const record = {
    at: new Date().toISOString(),
    server: target(),
    kept_before: kept,
    ran: "bethesda-fly-backup.service",
    snapshot: {
      ...fresh,
      integrity: Object.values(integrity)[0],
      life_id: world.life_id,
      born_at: world.born_at,
      moments,
    },
    live,
  };
  writeFileSync(path.join(dir, "record.json"), `${JSON.stringify(record, null, 2)}\n`);
  console.log(JSON.stringify(record, null, 2));
  if (
    record.snapshot.integrity !== "ok" ||
    world.life_id !== live.life_id ||
    world.born_at !== live.born_at
  )
    die("the saved life does not check out: do not publish");
  console.error(`backup: kept in ${dir}`);
} else if (command === "publish") {
  const dir = positional[0];
  const manifest = release(dir);
  const expect = opt("expect-index") ?? "";
  if (!SHA256.test(expect))
    die("--expect-index <sha256 of the live index.html, from inspect> is required");
  const stage = stageDir();
  scp([path.resolve(dir)], `${stage}/`, true);
  runPublish(
    stage,
    `${stage}/${manifest.release} --expect-index ${expect}`,
    path.join(path.dirname(path.resolve(dir)), `${manifest.release}.deployment.json`),
  );
} else if (command === "rollback") {
  const name = positional[0] ?? "";
  if (!RELEASE.test(name)) die("give the release whose publication to undo, garden-…");
  runPublish(stageDir(), `--rollback ${name}`);
} else if (command === "verify") {
  const dir = positional[0];
  const manifest = release(dir);
  const origin = (
    process.env.GARDEN_ORIGIN ?? `http://${target().split("@")[1]}`
  ).replace(/\/$/, "");
  const get = async (p) => {
    const r = await fetch(origin + p, {
      headers: { "accept-encoding": "identity" },
      signal: AbortSignal.timeout(15_000),
    });
    return {
      status: r.status,
      headers: r.headers,
      body: Buffer.from(await r.arrayBuffer()),
    };
  };
  const checks = [];
  const page = await get("/");
  checks.push({
    path: "/",
    ok: page.status === 200 && sha256(page.body) === manifest.sha256["index.html"],
  });
  for (const [rel, digest] of Object.entries(manifest.sha256)) {
    const r = await get(`/${manifest.release}/${rel}`);
    checks.push({
      path: `/${manifest.release}/${rel}`,
      ok: r.status === 200 && sha256(r.body) === digest,
    });
  }
  const state = async () => JSON.parse((await get("/api/state")).body.toString("utf8"));
  const a = await state();
  await new Promise((r) => setTimeout(r, 6000));
  const b = await state();
  const life = {
    life_id: b.life_id,
    born_at: b.born_at,
    same: a.life_id === b.life_id && a.born_at === b.born_at,
    ticks: [a.ticks, b.ticks],
    advancing: b.ticks >= a.ticks,
  };
  const result = {
    origin,
    release: manifest.release,
    served: checks.filter((c) => c.ok).length,
    of: checks.length,
    wrong: checks.filter((c) => !c.ok).map((c) => c.path),
    content_security_policy: page.headers.get("content-security-policy"),
    life,
    ok: checks.every((c) => c.ok) && life.same && life.advancing,
  };
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
} else {
  die(
    "usage: inspect | backup | publish <release-dir> --expect-index <sha256> | verify <release-dir> | rollback <release>",
  );
}
