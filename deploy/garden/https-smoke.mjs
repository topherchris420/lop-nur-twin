#!/usr/bin/env node
/** Read-only public HTTPS, asset integrity, HTTP fallback and life-continuity check. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { connect } from "node:tls";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : args[i + 1];
};
const origin = new URL(option("origin", "https://150-136-49-49.sslip.io"));
assert.equal(origin.protocol, "https:");
assert.equal(origin.pathname, "/");
assert(!origin.username && !origin.password && !origin.search && !origin.hash);
const http = option("http-origin", "http://150.136.49.49");
assert.equal(new URL(http).protocol, "http:");
const identity = {
  life_id: "5cf42cd6-fd0a-474d-882c-4cb70e0357e8",
  born_at: 1792908400.321717,
};
const digest = (data) => createHash("sha256").update(data).digest("hex");
const summary = (s) => {
  for (const k of ["life_id", "born_at"])
    assert.equal(s[k], identity[k], `${k} changed; STOP`);
  for (const k of ["ticks", "moments_count", "updated_at", "server_time"])
    assert(Number.isFinite(s[k]) && s[k] >= 0, `missing or invalid ${k}`);
  return Object.fromEntries(
    [...Object.keys(identity), "ticks", "moments_count", "updated_at", "server_time"].map(
      (k) => [k, s[k]],
    ),
  );
};
function continuity(before, after, advancing = false) {
  for (const k of ["life_id", "born_at"])
    assert.equal(after[k], before[k], `${k} changed; STOP`);
  for (const k of ["ticks", "moments_count", "updated_at"])
    assert(after[k] >= before[k], `${k} decreased; STOP`);
  if (advancing) assert(after.ticks > before.ticks, "simulation did not advance");
}
async function get(url, expected = 200) {
  const r = await fetch(url, {
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(r.status, expected, `${url}: HTTP ${r.status}`);
  return { body: Buffer.from(await r.arrayBuffer()), headers: r.headers };
}
async function state(base) {
  const r = await get(new URL("/api/state", base));
  assert.match(r.headers.get("content-type") ?? "", /application\/json/);
  if (new URL(base).protocol === "https:")
    assert.match(r.headers.get("cache-control") ?? "", /no-store/);
  return summary(JSON.parse(r.body));
}
const certificate = await new Promise((resolve, reject) => {
  const socket = connect({
    host: origin.hostname,
    port: Number(origin.port || 443),
    servername: origin.hostname,
    rejectUnauthorized: true,
  });
  socket.setTimeout(15_000, () => socket.destroy(new Error("TLS handshake timeout")));
  socket.once("error", reject);
  socket.once("secureConnect", () => {
    const cert = socket.getPeerCertificate();
    const result = {
      authorized: socket.authorized,
      protocol: socket.getProtocol(),
      subject: cert.subject,
      issuer: cert.issuer,
      subjectAltName: cert.subjectaltname,
      validFrom: cert.valid_from,
      validTo: cert.valid_to,
      fingerprint256: cert.fingerprint256,
    };
    socket.end();
    resolve(result);
  });
});
const first = await state(origin);
const baselinePath = option("before", null);
if (baselinePath) {
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  continuity(summary(baseline.state ?? baseline), first);
}
const page = await get(origin);
for (const [name, pattern] of Object.entries({
  "strict-transport-security": /max-age=[1-9]\d*/,
  "content-security-policy": /connect-src 'self'/,
  "x-content-type-options": /^nosniff$/,
  "x-frame-options": /^DENY$/,
  "referrer-policy": /^no-referrer$/,
  "permissions-policy": /camera=\(\)/,
}))
  assert.match(page.headers.get(name) ?? "", pattern, name);
const release = /\/(garden-\d{8}-[a-f0-9]{12})\//.exec(page.body.toString())?.[1];
assert(release, "page does not name a garden release");
const manifest = JSON.parse(
  (await get(new URL(`/${release}/manifest.json`, origin))).body,
);
assert.equal(manifest.release, release);
assert.equal(digest(page.body), manifest.sha256["index.html"]);
const assets = [];
for (const [file, hash] of Object.entries(manifest.sha256)) {
  assert(/^[A-Za-z0-9_./-]+$/.test(file) && !file.split("/").includes(".."));
  assert(/^[a-f0-9]{64}$/.test(hash));
  const r = await get(new URL(`/${release}/${file}`, origin));
  assert.equal(digest(r.body), hash, `${file}: bytes changed`);
  assets.push(file);
}
for (const route of [
  "/api/private",
  "/state",
  "/admin",
  "/metrics",
  "/config/",
  "/.env",
  "/.git/config",
  "/server.py",
  "/learning.py",
])
  await get(new URL(route, origin), 404);
const httpPage = await get(new URL("/", http));
assert.equal(digest(httpPage.body), digest(page.body), "HTTP frontend differs");
const httpState = await state(http);
continuity(first, httpState);
await new Promise((resolve) => setTimeout(resolve, 6500));
const last = await state(origin);
continuity(first, last, true);
continuity(httpState, last);
const report = {
  at: new Date().toISOString(),
  origin: origin.origin,
  certificate,
  release,
  indexSha256: digest(page.body),
  assetsVerified: assets,
  privateRoutesBlocked: true,
  http: { origin: http, samePage: true, state: httpState },
  first,
  last,
  ok: true,
};
const output = JSON.stringify(report, null, 2) + "\n";
if (option("out", null)) writeFileSync(option("out", null), output);
process.stdout.write(output);
