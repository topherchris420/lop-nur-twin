# How long a commit takes as the chain grows

A measurement made for the change to `LifeStore` compaction on 2026-11-05
(`src/bethesda/life/store.ts`). Nothing here read, copied or wrote a real
individual's store: every store was synthetic, in a temporary directory, and
deleted after its run.

## The question

[`BETHESDA_CONTINUOUS_LIFE.md`](../../BETHESDA_CONTINUOUS_LIFE.md#known-limits)
listed it as a known limit, not yet measured: each commit re-read every older
checkpoint's header to drop graphs, 288 more files for every simulated day. A
commit runs while the life's clock waits, and the writer must renew its 60 s
lease after it, so a cost that grows with the life's age is a cost against both.

## Method

[`bench.ts`](bench.ts) builds a store with a real birth (sequence 0, made by
`LifeStore.create`), N − 1 compacted headers padded to 1,024 bytes (the size the
continuous-life record gives for a header with its events), and a real, sealed
head at sequence N. It then times five consecutive commits by one writer under
one lease and reports the first and the median of the other four.

```sh
git worktree add --detach /tmp/before 78654a0        # the commit before the change
ln -s "$PWD/node_modules" /tmp/before/node_modules
LABEL=before REPO=/tmp/before node scripts/run-ts.mjs docs/research/life-store/bench.ts 100 1000 3000 10000 30000 100000
LABEL=after node scripts/run-ts.mjs docs/research/life-store/bench.ts 100 1000 3000 10000 30000 100000
```

Run once, on a cloud container: Linux x86_64, 4 vCPU, Node 22.23.4, a local
filesystem. [`results.jsonl`](results.jsonl) holds the lines as printed.

## Results

| Checkpoints | About a life of | First commit, before | First commit, after | Later commits, before | Later commits, after |
| ----------: | --------------- | -------------------: | ------------------: | --------------------: | -------------------: |
|         100 | 8 hours         |               4.2 ms |              5.9 ms |                3.6 ms |               3.8 ms |
|       1,000 | 3.5 days        |              14.5 ms |             16.6 ms |               12.7 ms |               5.4 ms |
|       3,000 | 10 days         |              35.0 ms |             40.2 ms |               29.8 ms |               9.9 ms |
|      10,000 | 35 days         |              98.2 ms |            103.2 ms |               93.8 ms |              17.3 ms |
|      30,000 | 104 days        |             308.7 ms |            297.9 ms |              287.5 ms |              47.9 ms |
|     100,000 | 347 days        |               1.04 s |              1.05 s |                1.00 s |             171.5 ms |

- **Before,** every commit cost about 10 µs for every checkpoint the life had
  ever committed: reading and parsing each header again.
- **After,** a writer's first commit under a lease still looks at every older
  checkpoint, by design: it is what drops a graph that an interrupted compaction
  left behind. Each later commit reads only the checkpoint leaving the window.
  What still grows, about 1.7 µs a checkpoint, is listing the directory, which
  `head` and `compact` each do once.

## What this does not show

- **Anything about the VM.** It has one Arm core and a network block volume, so
  its numbers will be larger. They were not measured.
- **Real headers.** The headers here are padding of the documented size. A
  header with more events costs more to parse, which only widens the gap.
- **The rest of a commit.** Serializing, hashing and verifying a full-grown
  84 MB checkpoint dominates a real commit; this measures only what grows with
  the chain.

The deployed release (`e458f7c`) predates the change. It reaches the deployed
fly only through an ordinary upgrade, which needs the owner's approval.
