/**
 * Stage 1 of first contact: watch Eva and ECHO together, read-only.
 *
 *   node scripts/run-ts.mjs scripts/first-contact-observe.ts [--seconds 120] [--out .first-contact/observe]
 *
 * Makes only GET requests to the two public observation endpoints (Eva's
 * `GET /api/state`, once per five-second step as her own page does; ECHO's
 * `GET /v1/now`, once a second, the rate its stream sends), exactly as any
 * visitor's browser does. It sends nothing else, writes nothing to either
 * service, and runs neither fly. It writes beside itself:
 *
 * - `responses.jsonl`: every response, with the local receipt time (UTC),
 *   the endpoint, the HTTP status and the body's SHA-256 and text;
 * - `summary.json`: identities, both clocks checked against their own
 *   contracts and measured against UTC, how a 1 Hz joint view of the session
 *   divides into observed, interpolated, held and unavailable, every refusal,
 *   and the movement representation each would receive of the other
 *   (computed and recorded, delivered to neither).
 *
 * The output directory defaults to `.first-contact/` (gitignored). It refuses
 * to run on either production host.
 */
import { existsSync, mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { sha256 } from "../src/rain/sha256.js";
import {
  GARDEN_SCALE,
  JointObserver,
  representations,
  type JointView,
} from "../src/bethesda/firstContact/joint.js";
import {
  ECHO,
  EVA,
  refuseProductionHost,
} from "../src/bethesda/firstContact/originals.js";

const args = process.argv.slice(2);
const value = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
const seconds = Number(value("--seconds", "120"));
if (!(Number.isFinite(seconds) && seconds >= 10 && seconds <= 3600))
  throw new Error("--seconds must be between 10 and 3600");
const out = resolve(value("--out", join(".first-contact", "observe")));
refuseProductionHost(out, existsSync);
mkdirSync(out, { recursive: true });
const responses = join(out, "responses.jsonl");
writeFileSync(responses, "");

const log = (line: string) => console.log(`[first-contact observe] ${line}`);
const observer = new JointObserver();
const nowS = () => Date.now() / 1000;

async function get(endpoint: string): Promise<{ status: number; text: string } | null> {
  try {
    const res = await fetch(endpoint, {
      method: "GET",
      cache: "no-store",
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
    const text = (await res.text()).slice(0, 2_000_000);
    return { status: res.status, text };
  } catch (e) {
    log(`${endpoint}: ${(e as Error).message}`);
    return null;
  }
}

async function poll(stream: "eva" | "echo") {
  const endpoint =
    stream === "eva" ? EVA.observation.endpoint : ECHO.observation.endpoint;
  const r = await get(endpoint);
  const receivedUtcS = nowS();
  appendFileSync(
    responses,
    JSON.stringify({
      receivedUtc: new Date(receivedUtcS * 1000).toISOString(),
      stream,
      endpoint,
      status: r?.status ?? null,
      sha256: r ? sha256(r.text) : null,
      body: r?.text ?? null,
    }) + "\n",
  );
  if (!r || r.status !== 200) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(r.text);
  } catch {
    observer.refusals.push({ stream, receivedUtcS, reason: "not JSON" });
    return;
  }
  if (stream === "eva") observer.addEva(parsed, receivedUtcS);
  else observer.addEcho(parsed, receivedUtcS);
}

const started = nowS();
log(`watching both for ${seconds} s; GET only; writing ${out}`);
let nextEva = started,
  nextEcho = started;
while (nowS() - started < seconds) {
  const t = nowS();
  const due: Promise<void>[] = [];
  if (t >= nextEva) {
    due.push(poll("eva"));
    nextEva += 5;
  }
  if (t >= nextEcho) {
    due.push(poll("echo"));
    nextEcho += 1;
  }
  await Promise.all(due);
  const wait = Math.max(0, Math.min(nextEva, nextEcho) - nowS());
  await new Promise((r) => setTimeout(r, wait * 1000));
}

// A joint view every second over the span both streams cover.
const ev = observer.eva,
  ec = observer.echo;
const counts = { eva: {} as Record<string, number>, echo: {} as Record<string, number> };
let anchor: JointView | null = null,
  last: JointView | null = null;
if (ev.length && ec.length) {
  const from = Math.ceil(Math.max(ev[0]!.utcS, ec[0]!.utcS));
  const to = Math.floor(Math.min(nowS(), started + seconds));
  for (let t = from; t <= to; t++) {
    const v = observer.viewAt(t);
    counts.eva[v.eva.kind] = (counts.eva[v.eva.kind] ?? 0) + 1;
    counts.echo[v.echo.kind] = (counts.echo[v.echo.kind] ?? 0) + 1;
    if (!anchor && v.eva.kind !== "unavailable" && v.echo.kind !== "unavailable")
      anchor = v;
    if (v.eva.kind !== "unavailable" && v.echo.kind !== "unavailable") last = v;
  }
}
const clocks = observer.clocks();
const first = <T>(xs: readonly T[]) => xs[0] ?? null;
const summary = {
  schema: "first-contact-observation/v1",
  note: "Read-only observation of two separate production individuals through their public endpoints. Nothing was sent to either, and the representations below were computed here and delivered to neither.",
  startedUtc: new Date(started * 1000).toISOString(),
  seconds,
  eva: {
    id: EVA.id,
    endpoint: EVA.observation.endpoint,
    accepted: ev.length,
    first: first(ev),
    last: ev.at(-1) ?? null,
    clock: { ...clocks.eva, contract: EVA.clock },
  },
  echo: {
    id: ECHO.id,
    endpoint: ECHO.observation.endpoint,
    accepted: ec.length,
    first: first(ec),
    last: ec.at(-1) ?? null,
    clock: { ...clocks.echo, contract: ECHO.clock },
  },
  /** Their own clocks at the end, and how far each runs from UTC there (s). */
  clockOffsets:
    ev.length && ec.length
      ? {
          evaOwnS: ev.at(-1)!.ownS,
          echoOwnS: ec.at(-1)!.ownS,
          evaStateLagS: ev.at(-1)!.receivedUtcS - ev.at(-1)!.utcS,
          echoStateLagS: ec.at(-1)!.receivedUtcS - ec.at(-1)!.utcS,
        }
      : null,
  jointView: { perSecond: counts },
  representations: anchor && last ? representations(anchor, last) : null,
  gardenScale: GARDEN_SCALE,
  refusals: observer.refusals,
};
writeFileSync(join(out, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
log(
  `Eva: ${ev.length} states, clock consistent ${clocks.eva.consistent}/${ev.length}; ECHO: ${ec.length} observations, clock consistent ${clocks.echo.consistent}/${ec.length}; refusals ${observer.refusals.length}`,
);
log(
  `joint view per second: Eva ${JSON.stringify(counts.eva)}, ECHO ${JSON.stringify(counts.echo)}`,
);
