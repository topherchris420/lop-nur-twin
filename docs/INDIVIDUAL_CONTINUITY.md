# Individual continuity and a distinct history for the digital fly

The question: **can a simulated organism develop a distinctive behavioural
history that cannot be reproduced simply by starting another identical
copy?** Answering it needs two things this repository did not have: a fly
that stays the same individual across saves, restarts and machines, and a
controlled way to tell a history the fly carries from chance, from where it
happens to be, and from the copy it could have been.

The short answer, from the seeded report
([docs/benchmarks/fly-individuality/](benchmarks/fly-individuality/README.md)):

- **Yes, in the sense that can be tested.** Twenty-four flies built
  identically, each fed at one site for one drawn spell, then carried to the
  same empty yard and set down in the same way, went first to the site they
  had fed at in 29% of probes and to the opposite site in 1%. Where each had
  fed could be read from where it went in 69% of individuals [58%, 79%]
  (chance is 50%). Erasing the remembered places from the same mind, keeping
  everything else, took the preference to −0.01: it fell by 0.30
  [0.13, 0.47] (higher with memory in 10 individuals, lower in 1; exact sign
  test p = 0.012). An identical fly that had not lived did the same thing in
  every probe, whoever it stood in for.
- **No, in the strict sense.** A fly from the same genesis that re-lived the
  same recorded events had the same mind, byte for byte, in 24 of 24
  individuals, and every one of its probes was identical. The simulator is
  deterministic: a history cannot be reproduced by starting a copy, but it
  can always be reproduced by giving the copy the same life. What makes this
  fly this fly is not its genesis but its record, and only a lost record (or
  an input nobody recorded) makes its history unrepeatable.
- **Open-ended adaptation is not demonstrated.** In lives where food moved
  eight times, the fly kept finding food to the end of every life, but it
  did not get better at it, and its memory made it worse: it ate 1.2 fewer
  meals per life [0.08, 2.25] than the same lives lived with the memory lesion
  (fewer in 16 of 20 individuals that differed; p = 0.012), because places
  where food no longer was stayed remembered (1.4 per epoch on average). Its
  repertoire is fixed and its memory bounded; it adapts as long as it lives,
  within a capacity that does not grow.

Everything here is the reduced-order controller of
[the digital fly](DIGITAL_FLY.md), unchanged. It is not a neural simulation,
and a distinct history is not evidence of a self, of awareness or of
consciousness. The fly remembers where it fed and acts on it; that is all
these words claim.

## Part 1: durable individual continuity

Code: `src/bethesda/life/` (`snapshot.ts`, `continuity.ts`, `store.ts`, and
`headless.ts`'s `BETHESDA_LIFE`), the stream hooks in `src/lib/noise.ts`, and
`scripts/bethesda-life-headless.ts --store`. The production criteria it
answers, and those it does not, are in
[continuously living Bethesda](BETHESDA_CONTINUOUS_LIFE.md).

### The whole life, not a summary

A fly's future depends on far more than where it is: the body's clocks and
pending decisions, the senses' delayed frames, the controller's timers, its
path-integration estimate and remembered places, the self-model if it has
one, the people near it, the city's agents and the position of every random
stream. `snapshot.ts` walks the object graph from the life's root and records
every object once, in a fixed order, so shared objects stay shared and
cycles stay cycles. It needs no serializer per class, so state added later is
covered without anyone remembering to add it. Two things make that possible:

- **Random streams.** Every stream is a `mulberry32` closure. `noise.ts` now
  keeps each stream's position where a checkpoint can read it
  (`streamPosition`) and a restore can set it (`seekStream`), without drawing
  a number. The sequence is unchanged: all seven kept pilots reproduce exactly
  on the new source digest (`npm run rain:fly -- --pilot --check`).
- **Restore in place.** A life is never built from the record alone. It is
  rebuilt from its genesis (the plain data it was made from) and the record is
  written into the fresh objects, keeping their identity, so the closures the
  constructors made still point at the right objects. Objects the life shares
  with a fresh genesis graph (module data: geometry tables, constants) are
  recorded by path, not copied.

It refuses what it cannot hold (symbols, accessors, sparse arrays, dates,
unknown classes), saying where. What it cannot see is state kept only inside
a closure, other than a stream's position, which is why a restore is never
trusted on its own.

### A checkpoint, and a restore that is checked

`continuity.ts` seals a checkpoint: the graph, the versions of every engine
it ran on (city, fly, ECHO, headless schema, graph schema), its genesis and
the genesis digest, the individual, its sequence number, its parent's digest,
its tick, the life's own state hash, and the life events since its parent. A
restore refuses another schema, kind, version, genesis, individual or a
changed byte; rebuilds the life; writes the graph into it; re-snapshots it
and compares the bytes; and compares the state hash. Then the tests step the
restored life beside the uninterrupted one and compare at several intervals
(`divergence`):

- the fly in a yard, from checkpoints taken in flight, landing, grooming and
  feeding, compared at 1, 8, 58, 458 and 1958 ticks later;
- the whole city with its fly, under both the reduced-order and the ECHO
  controller, compared at 1, 11, 111 and 611 ticks later.

All match byte for byte. A city checkpoint grows from 8 MB at birth to 84 MB,
where it stops once the city's decision record holds its 60,000 decisions
(`REPLAY_LIMITS`), after about 41 simulated hours; most of it is that record
and the fly's per-instance copy of the city's geometry. A yard fly's is about
56 KB.

### Identity is a birth, and a copy is someone else

An individual's identity is the digest of its kind, its genesis and a birth
nonce the host draws when it is born. Two flies with one genesis are two
individuals: identical at birth, apart from then on. `twinCheckpoint` starts
a new individual from another's checkpoint with its parentage recorded; it
starts at sequence 0 because it has no past of its own, and its checkpoints
are refused by the original's store. ECHO's rule stands and extends: a
restored self-model is not the same fly, and now neither is any copy.

### One writer, an append-only chain

`store.ts` keeps one individual in one directory. Each checkpoint is written
to a temporary file, synced and published by a hard link that fails if the
name exists, so two processes continuing the same checkpoint cannot both
write the next one: the second is refused as a fork and never merged. A
writer holds an expiring lease, one file per epoch, created exclusively; a
writer whose epoch has been superseded is fenced and every commit it tries
is refused. Opening a store checks every seal and every parent link from
birth to the head; any break stops it with the reason, and nothing starts in
its place. Only the newest four checkpoints keep their graphs; older ones
keep their headers, so the chain and the life's events stay complete.

The headless runner uses it: `--store DIR --create` gives the city's fly a
birth; every later run takes the lease, restores the head, verifies it, lives
on and commits a verified checkpoint every five simulated minutes. Killed
with `SIGKILL` between checkpoints, the life resumed once the dead writer's
lease lapsed (60 s), from the last committed checkpoint, under the next
epoch, with a `gap` event recording the outage. Ticks that were not computed
are not claimed: the world is paused while no process runs it.

The city's headless life takes no exogenous input. From its genesis it is
therefore reproducible tick for tick by anyone: its individuality, so far,
is only its birth.

## Part 2: controlled experiments

Code: `src/bethesda/life/individuality.ts` (the yard, the lives, the probe),
`src/bethesda/life/individualityReport.ts` and
`scripts/individuality-evaluate.ts`, which writes
[docs/benchmarks/fly-individuality/](benchmarks/fly-individuality/README.md)
from a clean commit (`--check` reproduces it). These are seeded studies of
one deterministic simulator, not registered R.A.I.N. experiments: no
preregistration, no host-drawn seeds, no operator authorization. Their
intervals are 95% bootstrap intervals over 24 individuals of one genesis,
and say nothing about a population of flies.

### The apparatus

- **One genesis.** Every fly: seed 0x1d1e5, placed at the centre of the yard
  facing east, at half a full reserve (hungry), reduced-order controller.
- **The yard.** 16 m square, open sky (the sun holds the compass), four
  feeding sites 5.5 m out at the compass points, each with a 2 m pole beside
  it that the fly can see from the centre. One food patch at a time.
- **Lives are events.** Food is placed and removed by recorded life events,
  drawn for each individual from its own experience stream (a declared
  SHA-256 seed in the report, standing in for the host's entropy in a living
  fly). Nothing else differs between individuals.
- **The probe.** 300 s, no food anywhere, the fly set down at the centre at
  one of four headings, half fed. Only the mind is carried: the controller's
  whole state (timers, path integration, remembered places, its random
  streams). The body is placed fresh, as an experimenter's transfer would
  place it. The carried mind is not told it was moved; seeing a pole it
  remembers puts its estimate right, as recognizing a place does.

### Study A: distinct histories from one genesis

**Question.** After different lives, do flies built identically behave
differently in the same situation, because of what they lived, in a way a
fresh copy does not?

**Design.** 24 individuals. Each lives 0–60 s with no food, then food at its
site (east for even individuals, west for odd) within 0.3 m of the site's
mark, for 600–1200 s. Each mind is probed from four headings under five
arms, matched by individual:

| Arm       | The mind carried into the probe                                                                                       |
| --------- | --------------------------------------------------------------------------------------------------------------------- |
| `self`    | the fly's own, at the end of its life                                                                                 |
| `stored`  | the same, after the whole life was checkpointed to disk, read back by another store object and restored               |
| `replay`  | that of another fly from the same genesis that lived the same recorded events (read back from the store)              |
| `erased`  | the fly's own, with remembered places, visited cells, failed sites, blocked headings and goals removed; all else kept |
| `genesis` | that of an identical fly that has not lived                                                                           |

**Measures.** Preference for the fed site over the opposite one (time
within 1.5 m of each, (fed − opposite)/(fed + opposite), 0 when neither);
the first site reached; whether the fed site can be read from the probes
(east if more time near east than west, ties 0.5); and the mean distance
between two individuals' probe tracks from the same heading.

**Results.**

| Arm     | Preference for the fed site | First reached: fed / opposite / other / none | Fed site read correctly | Distance between twins |
| ------- | --------------------------- | -------------------------------------------- | ----------------------- | ---------------------- |
| self    | 0.28 [0.14, 0.45]           | 29% / 1% / 1% / 69%                          | 0.69 [0.58, 0.79]       | 4.0 m                  |
| stored  | identical to self           | identical                                    | identical               | identical              |
| replay  | identical to self           | identical                                    | identical               | identical              |
| erased  | −0.01 [−0.05, 0.01]         | 9% / 11% / 21% / 58%                         | 0.42 [0.33, 0.48]       | 6.4 m                  |
| genesis | 0                           | 0% / 0% / 0% / 100%                          | 0.50                    | 0 m                    |

What it shows, and what it does not:

- **The history is in the memory.** The lesion removes the preference
  entirely while keeping the fly's streams, timers and position estimate, so
  the effect is not chance divergence and not the fly's state in general: it
  is the remembered place. With memory erased the flies reached a site
  somewhat more often than before (42% of probes against 31%), just not
  theirs.
- **Different is not the same as distinct.** The erased twins were _more_
  different from each other (6.4 m apart) than the remembering ones (4.0 m):
  their random streams had diverged with their lives and they wandered
  apart. Remembering pulled flies with the same past toward the same place.
  Divergence alone is cheap in a chaotic simulation; what the remembering
  flies have is divergence that their history predicts.
- **A fresh copy carries nothing.** The never-lived mind behaved identically
  for all 24 individuals (every probe byte-identical), and in 300 s it
  reached no site. Starting an identical copy does not reproduce anyone's history.
- **The record reproduces everything.** Stored and replayed minds were the
  self mind byte for byte in 24 of 24, and so were all their probes.
  Continuity holds through the disk; and a copy given the same life becomes
  the same mind. The history is unrepeatable only without its record.
- **The effect is real but partial.** In 69% of `self` probes the fly
  reached no site within 300 s; when it did reach one, it was its own site 28
  times in 30. A longer probe was tried in development and added only
  wandering after the first flight, so 300 s was kept.

### Study B: open-ended adaptation

**Question.** Does the fly keep adapting when the world keeps changing, and
does what it learns accumulate into better adaptation?

**Design.** 24 individuals (the same genesis), each a life in which food
moves eight times among the four sites, never to the site it just left,
each stay 600–900 s. Every life is lived twice on the same events: with
memory (`full`), and with the memory lesion applied after every tick
(`amnesic`). After each move, the remembering fly's mind is also probed.

**Results** (per individual; full against amnesic):

| Measure                                                | Full              | Amnesic           |
| ------------------------------------------------------ | ----------------- | ----------------- |
| meals per epoch                                        | 1.33 [1.20, 1.46] | 1.48 [1.37, 1.61] |
| epochs without a meal (of 8)                           | 2.92 [2.42, 3.38] | 2.54 [2.21, 2.92] |
| latency to the first meal at the new site (s)          | 309 [261, 355]    | 324 [293, 355]    |
| arrivals at the site the food just left, per move      | 1.66 [1.24, 2.16] | 2.05 [1.67, 2.46] |
| remembered places where food no longer is, epoch's end | 1.44 [1.30, 1.57] | 0                 |

Meals per life, full minus amnesic: −1.2 [−2.25, −0.08] (fewer in 16
individuals, more in 4; p = 0.012). Latency after the first epoch stayed
between about 330 and 440 s through the eighth: no improvement with
experience. Probed after each move, the remembering fly went first to the
current site in 8% of 168 probes, the previous one in 6%, an earlier one in
11%, and nowhere in 72%.

What it shows:

- **Adaptation continues.** Through eight relocations the fly went on
  finding food, mostly by its odour, in about two epochs of three, with no
  sign of saturating or breaking down over two hours of life.
- **It is not open-ended learning.** Nothing improves across relocations:
  latency is flat, and there is no learning to learn. What the fly can learn
  is fixed by its controller: food places (at most 12, forgotten after two
  fruitless returns or two hours), visited cells, failed sites. It cannot
  learn that food moves.
- **Memory has a cost in a changing world.** A remembered place is
  forgotten only by returning to it and finding nothing, twice, so stale
  places accumulate, and probes show the fly drawn first to old sites (17%)
  twice as often as to the current one (8%). It is not that the remembering
  fly kept walking back to the site just emptied (the lesioned fly arrived
  there as often or more); the cost is in what it went looking for. In this
  world the lesioned fly ate more. Memory that
  helps a fly return to a place that stays put (Study A) is a liability when
  places do not.

### Assumptions and limitations

- One genesis, one yard, one controller. Whether other seeds, worlds or the
  ECHO controller (whose self-model also carries history, see ECHO-03) would
  show the same is not tested.
- The probe's transfer resets the body and keeps the mind. A real transfer
  would also disturb a fly; here the only thing the transfer changes is the
  body's state, and every arm is transferred alike.
- The history-carrying memory is the controller's bookkeeping
  (`navigation.ts`), a model choice with stated errors, not a model of the
  mushroom body or central complex.
- "Distinct" is measured against the copies this study can build: a fresh
  copy, a lesioned self and a replay. The strongest copy, the replay,
  reproduces the history exactly. In a deterministic simulator that is
  necessarily so; it is reported as a result, not hidden as a limitation.
- Study B's effects are modest; the difference in epochs without a meal
  (+0.38 [−0.17, 0.88], p = 0.12) includes no difference.

## Verification

```sh
npx vitest run src/bethesda/life
node scripts/run-ts.mjs scripts/individuality-evaluate.ts --check   # about 13 minutes
node scripts/run-ts.mjs scripts/bethesda-life-headless.ts --store /tmp/fly --create
node scripts/run-ts.mjs scripts/bethesda-life-headless.ts --store /tmp/fly --ticks 6000
node scripts/run-ts.mjs scripts/bethesda-life-headless.ts --store /tmp/fly --verify
npm run rain:fly -- --pilot --check                                  # the stream hook changes no outcome
```
