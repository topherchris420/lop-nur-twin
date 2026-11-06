/**
 * How long one LifeStore.commit takes as the chain grows.
 *
 * A synthetic store in a temporary directory: a real birth (sequence 0) made by
 * LifeStore.create, then N - 1 compacted headers padded to HEADER_BYTES (the
 * size docs/BETHESDA_CONTINUOUS_LIFE.md gives for a header with its events),
 * then a real, sealed head at sequence N. One commit is then timed. Nothing
 * here touches a real individual's store.
 *
 *   node scripts/run-ts.mjs docs/research/life-store/bench.ts [N ...]
 *   LABEL=before REPO=/path/to/worktree-of-older-commit node scripts/run-ts.mjs docs/research/life-store/bench.ts
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

// The repository whose store is measured: this checkout, or REPO (a worktree of an older commit).
const repo =
  process.env.REPO ?? new URL("../../..", import.meta.url).pathname.replace(/\/$/, "");
const { birth, checkpointLife } = await import(`${repo}/src/bethesda/life/continuity.ts`);
const { GENESIS, YARD_LIFE } = await import(`${repo}/src/bethesda/life/individuality.ts`);
const { LifeStore, LIFE_STORE_SCHEMA } = await import(
  `${repo}/src/bethesda/life/store.ts`
);

const HEADER_BYTES = Number(process.env.HEADER_BYTES ?? 1024);
const NONCE = "0123456789abcdef0123456789abcdef";
const pad = (n: number) => String(n).padStart(12, "0");

function run(n: number) {
  const root = mkdtempSync(join(tmpdir(), "bench-store-"));
  const dir = join(root, "fly");
  try {
    const life = YARD_LIFE.build(structuredClone(GENESIS));
    const b = birth(YARD_LIFE.id, GENESIS, NONCE);
    const c0 = checkpointLife(YARD_LIFE, life, {
      genesis: GENESIS,
      birth: b,
      previous: null,
    });
    LifeStore.create(dir, YARD_LIFE, c0, { holder: "bench" }).release();
    // Compacted headers 1 .. n-1, each padded to about HEADER_BYTES.
    const filler = "x".repeat(Math.max(0, HEADER_BYTES - 700));
    for (let s = 1; s < n; s++) {
      const stored = {
        schema: LIFE_STORE_SCHEMA,
        epoch: 1,
        committedUtc: "2026-11-05T00:00:00.000Z",
        checkpoint: {
          ...c0,
          sequence: s,
          parent: "0".repeat(64),
          graph: null,
          events: [{ tick: s, kind: "pad", data: { filler } }],
        },
      };
      writeFileSync(
        join(dir, "checkpoints", `${pad(s)}.json`),
        JSON.stringify(stored) + "\n",
      );
    }
    // A real, sealed head at sequence n, continuing a stand-in for n-1.
    life.step(10);
    const fakePrev = { ...c0, sequence: n - 1, digest: "f".repeat(64) };
    const head = checkpointLife(YARD_LIFE, life, {
      genesis: GENESIS,
      birth: b,
      previous: fakePrev,
    });
    writeFileSync(
      join(dir, "checkpoints", `${pad(n)}.json`),
      JSON.stringify({
        schema: LIFE_STORE_SCHEMA,
        epoch: 1,
        committedUtc: "2026-11-05T00:00:00.000Z",
        checkpoint: head,
      }) + "\n",
    );
    // Opened without `verify` (the synthetic headers are not a real chain), as a
    // writer. The class arrives untyped from a dynamic import, so its private
    // constructor can be called directly; nothing outside this benchmark does.
    const store = new LifeStore(dir, YARD_LIFE, { holder: "bench" });
    store.acquire();
    const times: number[] = [];
    let prev = head;
    for (let k = 0; k < 5; k++) {
      life.step(10);
      const next = checkpointLife(YARD_LIFE, life, {
        genesis: GENESIS,
        birth: b,
        previous: prev,
      });
      const t0 = performance.now();
      store.commit(next);
      times.push(performance.now() - t0);
      prev = next;
    }
    const firstMs = times[0]!;
    const rest = times.slice(1).sort((a, b) => a - b);
    return { firstMs, steadyMedianMs: (rest[1]! + rest[2]!) / 2 };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const sizes = process.argv
  .slice(2)
  .map(Number)
  .filter((x) => x > 1);
for (const n of sizes.length ? sizes : [100, 1_000, 3_000, 10_000, 30_000, 100_000]) {
  const { firstMs, steadyMedianMs } = run(n);
  process.stdout.write(
    `${JSON.stringify({ label: process.env.LABEL, checkpoints: n, headerBytes: HEADER_BYTES, firstCommitMs: +firstMs.toFixed(1), steadyCommitMs: +steadyMedianMs.toFixed(1) })}\n`,
  );
}
