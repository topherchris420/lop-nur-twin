/**
 * A synthetic store with the deployed individual's lineage (legacy birth,
 * ECHO v2, the v3 continuation, a short v3 era) on the small test city, for
 * the rollback rehearsal. Never the deployed individual.
 *   node scripts/run-ts.mjs <this file> DIR
 */
import { pathToFileURL } from "node:url";

const REPO = pathToFileURL(`${process.env.REHEARSAL_REPO}/`).href;
const here = (f: string) => import(REPO + f);
const { sha256, sha256Json } = await here("src/rain/sha256.ts");
const { birth, checkpointLife } = await here("src/bethesda/life/continuity.ts");
const { continueEchoSelfModel, ECHO_UPGRADED_LIFE, ECHO_V2_VERSIONS, LEGACY_VERSIONS, upgradeToEcho } =
  await here("src/bethesda/life/echoUpgrade.ts");
const { BETHESDA_LIFE, headlessGenesis } = await here("src/bethesda/life/headless.ts");
const { indexGraph, restoreGraph, snapshotGraph } = await here("src/bethesda/life/snapshot.ts");
const { LifeStore } = await here("src/bethesda/life/store.ts");

const dir = process.argv.at(-1)!;
const genesis = headlessGenesis({ seed: 393977, pedestrians: 4, vehicles: 1, buses: 0, statisticalPopulation: 10 });
const born = birth(BETHESDA_LIFE.id, genesis, "fedcba9876543210fedcba9876543210");
const reseal = (c: any) => {
  if (c.graph) c.graphDigest = sha256(JSON.stringify(c.graph));
  const { digest: _d, graph: _g, ...header } = c;
  c.digest = sha256Json(header);
  return c;
};
// As echoUpgrade.test.ts shapes the deployed legacy checkpoint ...
const life0 = BETHESDA_LIFE.build(genesis);
life0.advanceTicks(20);
const legacy = checkpointLife(BETHESDA_LIFE, life0, { genesis, birth: born, previous: null });
legacy.versions = { ...LEGACY_VERSIONS, graph: "life-graph/v1" };
const wind = ["windFeltMS", "windTakeoffMS", "maxAirspeedCmS", "airflow", "airflowFrom"];
for (const node of legacy.graph.nodes) {
  if (node.t !== "o") continue;
  if (node.c === "BethesdaFlyWorld")
    node.e = node.e.filter(([k]: [string]) => !["windSeed", "clock0", "storms"].includes(k));
  node.e = node.e.filter(([k]: [string]) => !wind.includes(k));
}
legacy.graph = snapshotGraph(restoreGraph(legacy.graph, BETHESDA_LIFE.build(genesis)), indexGraph(BETHESDA_LIFE.build(genesis)));
reseal(legacy);
// ... its ECHO v2 shape ...
const up = upgradeToEcho(legacy, "2026-10-27T01:00:00.000Z");
const echo = up.life.cityFly.fly.adapter;
const S = echo.model.state;
for (const key of ["workspace", "attention", "airStep"]) delete S[key];
for (const key of ["confirmed", "revised", "doubted", "shielded", "held"]) delete S.counts[key];
if (S.inquiry) delete S.inquiry.check;
S.schema = "echo-state/v2";
S.version = ECHO_V2_VERSIONS.echo;
echo.descriptor.id = echo.descriptor.id.replace("echo-self-model/v3", ECHO_V2_VERSIONS.echo);
const v2 = checkpointLife(ECHO_UPGRADED_LIFE, up.life, { genesis, birth: born, previous: legacy, events: up.checkpoint.events });
v2.versions = { ...ECHO_V2_VERSIONS, graph: "life-graph/v1" };
reseal(v2);
// ... and the v3 continuation, then a short v3 era.
const v3up = continueEchoSelfModel(v2, "2026-10-27T02:00:00.000Z");
v3up.life.advanceTicks(600);
const v3 = checkpointLife(ECHO_UPGRADED_LIFE, v3up.life, { genesis, birth: born, previous: v3up.checkpoint });
LifeStore.create(dir, { ...BETHESDA_LIFE, versions: LEGACY_VERSIONS }, legacy).release();
const s2 = LifeStore.open(dir, { ...ECHO_UPGRADED_LIFE, versions: ECHO_V2_VERSIONS });
s2.acquire();
s2.commit(v2);
s2.release();
const s3 = LifeStore.open(dir, ECHO_UPGRADED_LIFE);
s3.acquire();
s3.commit(v3up.checkpoint);
s3.commit(v3);
s3.release();
process.stdout.write(`${JSON.stringify({ dir, individual: born.individual, head: v3.sequence, tick: v3.tick })}\n`);
