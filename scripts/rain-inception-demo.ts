/** Offline integration demonstration: scripted reasoning, real native simulator evidence. */
import { join } from "node:path";
import { ResearchStore } from "../src/rain/autonomy/store.js";
import { ResearchFixtureModel } from "../src/rain/research/fixtures.js";
import { runDiscovery } from "../src/rain/autonomy/discovery.js";
import { configureRuntime } from "../src/rain/runtime.js";
import { partnership } from "../src/bethesda/rain/inceptionProtocol.js";
import {
  researchScope,
  type ResearchSource,
} from "../src/bethesda/rain/researchProtocol.js";
import { DEFAULT_ENVELOPE } from "../src/bethesda/rain/discoveryProtocol.js";
import {
  buildDiscoveryCharter,
  authorizeCharter,
  charterSha256,
} from "../src/bethesda/rain/standing.js";
import { approveWorld, type ResearchWorld } from "../src/rain/research/worlds.js";
import { descendantCharter, runDescendant } from "../src/rain/autonomy/descendants.js";
import { createDiscoveryService } from "../src/rain/autonomy/discoveryService.js";
import { verifyRecordSync } from "../src/bethesda/rain/replay.js";
import { labRevision } from "../src/bethesda/rain/provenance.js";
import { execFileSync } from "node:child_process";

const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const dirty =
  execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().length > 0;
Object.assign(globalThis, { __LAB_REVISION__: { commit, dirty, source: "git" } });
if (!labRevision().commit) throw new Error("A producing revision is required");
const root = join(
  process.cwd(),
  ".rain-research",
  "inception-demo-" + new Date().toISOString().replace(/[^0-9TZ]/g, ""),
);
const store = new ResearchStore(root),
  model = new ResearchFixtureModel();
const question =
  "Can Dynamic Resonance Rooting motivate testable alternative interpretations of collective responses to simulated urban disruptions?";
const charter = buildDiscoveryCharter({
  model: { provider: model.provider, model: model.model, endpoint: model.endpoint },
  ceilings: {
    iterations: 2,
    experiments: 2,
    runtime_ms: 240000,
    failed_proposals: 2,
    model_calls: 40,
    model_tokens: null,
  },
  validHours: 1,
  envelope: DEFAULT_ENVELOPE,
  research: { ...researchScope(question, false), partnership: partnership() },
});
// A scripted operator attestation is confined to this explicitly invoked offline fixture.
function fixtureAuthorization(value: typeof charter) {
  const checked = authorizeCharter({
    charter: value,
    operator: "Scripted.Demo.Operator",
    reviewed: true,
    typedPrefix: charterSha256(value).slice(0, 8),
    now: new Date(),
  });
  if (!checked.ok) throw new Error(checked.errors.join("; "));
  return checked.value;
}
const runtime = await configureRuntime({
  env: { RAIN_REGISTRY_DIR: store.registryDir() },
  cwd: process.cwd(),
});
if (runtime.mode !== "local") throw new Error("Native runtime unavailable");
console.log("SCRIPTED OFFLINE INTEGRATION DEMONSTRATION — not autonomous discovery");
const parent = await runDiscovery({
  store,
  model,
  charter,
  authorization: fixtureAuthorization(charter),
  budgets: charter.ceilings,
  runtime: runtime.runtime,
  operator: "Scripted.Demo.Operator",
  question,
});
if (parent.executed !== 2 || !parent.ok) throw new Error(parent.ending);
const proposal = store.discoveryEntries().find((e) => e.kind === "world-proposed")
  ?.payload as { spec: ResearchWorld; digest: string } | undefined;
if (!proposal) throw new Error("No world proposal");
const sources = store
  .discoveryEntries()
  .filter((e) => e.kind === "research-source")
  .map((e) => {
    const s = e.payload as ResearchSource;
    return { id: s.id, sha256: s.sha256, status: "source-context" as const };
  });
approveWorld(store, proposal.spec, sources, {
  operator: "Scripted.Demo.Operator",
  reviewed: true,
  typedPrefix: proposal.digest.slice(0, 8),
  now: new Date(),
});
const childScope = descendantCharter(store, proposal.spec.id, model);
const child = await runDescendant({
  store,
  id: proposal.spec.id,
  model: new ResearchFixtureModel(),
  authorization: fixtureAuthorization(childScope.charter),
  cwd: process.cwd(),
});
if (child.executed !== 2 || !child.ok) throw new Error(child.ending);
const childStore = store.descendant(proposal.spec.id, proposal.spec.budget.storage_bytes);
for (const r of [...store.records(), ...childStore.records()])
  if (!r.record || !verifyRecordSync(r.record).ok) throw new Error("Replay failed");
const restarted = createDiscoveryService(
  { RAIN_AUTONOMY_DIR: root },
  process.cwd(),
).status();
if (restarted.active || store.lock()) throw new Error("Unsafe recovery");
console.log(
  JSON.stringify(
    {
      generation: "scripted",
      root,
      parent_experiments: parent.executed,
      child_experiments: child.executed,
      child: proposal.spec.id,
      restart_active: restarted.active,
      parent_report: parent.report,
      child_report: child.report,
      conclusions:
        "Simulator pipeline demonstrated; recursive scientific improvement not established",
    },
    null,
    2,
  ),
);
