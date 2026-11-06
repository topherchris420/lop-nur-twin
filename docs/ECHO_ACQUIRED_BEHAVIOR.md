# ECHO acquired search: a learned preference that transfers, with no benefit shown

**Status: research flies only, NOT DEPLOYED.** Nothing here has run on the original
individual, a copy of its archive, or the VM. The question this study sets out to
answer is whether a fly can acquire a persistent, useful behavior that was not
explicitly scripted and carry it into an unfamiliar situation under controlled
evaluation. **The sealed test's answer: acquired and carried over, yes; useful, not
shown.** The first-meal gain seen in development did not replicate, the real city
showed no detectable benefit, and the preference lasts only until later experience
changes it.

| Question                                  | Answer                                                                                                                                                                             |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does a preference form from experience?   | Yes. Same code and seed, opposite preferences depending only on where the fly ate.                                                                                                 |
| Does it transfer to unseen places?        | **Yes, on the sealed test.** +0.42 [0.30, 0.53] in foodless yards it had never met; flies fed with no pattern −0.04 [−0.19, 0.13].                                                 |
| Does carrying it cost much?               | **No, on the sealed test.** +0.03 J [0.02, 0.05] in a foodless hour.                                                                                                               |
| Does it help find food in an unseen yard? | **Not on the sealed test.** First meal −9 s [−174, 155] where food matched, and −56 s [−273, 163] matched less crossed. Development had suggested +362 s [34, 667] for the second. |
| Does it pay over a long stay?             | **Not on the sealed test.** +0.00 J [−0.17, 0.19] per 8 h stay where food matched, and −0.23 J [−0.43, −0.04] where it did not.                                                    |
| Can later experience change it?           | Yes, in development. Food by the opposite rule reversed it, +0.41 to −0.42 [−0.59, −0.24].                                                                                         |
| Does it last?                             | Partly, in development. After about 10 meals with no pattern it had faded to +0.11 [−0.00, 0.22].                                                                                  |
| Does it help in the real city?            | **Not shown**, in development, on physics that could trap a fly in a building ([Limits](#limits)). On day 2: −1.0 meals [−9.5, +6.4] on 20.1, −0.15 J [−1.09, +0.79] net.          |
| Is it the same individual?                | A continuation exists and passes its tests on small synthetic lives. Never run on a real archive.                                                                                  |

Intervals are 95%, from resampling seeds. The sealed test has 24 seeds, each
development comparison 12, and each no-pattern control 6. The
results are in [`docs/benchmarks/echo-acquired/2026-11-02/`](benchmarks/echo-acquired/2026-11-02/).

## What is scripted and what is not

The code names no situation as good or bad, and a fly starts with no opinions.
Which situations it comes to favor, and so what it does, is not written anywhere:
it comes from where that fly has eaten.

The mechanism is written: the senses it reads, the learning rule, and what it may
do with an opinion. This is a coded learning rule with a learned target, not a
behavior the fly invented, and nothing here is evidence of awareness. These are
functional claims about a computational model, which is not a complete fruit-fly
nervous system.

## The layer

`src/bethesda/life/acquired/search.ts`, in `AcquiredAdapter`.

**What it learns.** For six things its senses can tell apart (sunlit, sheltered,
near a landmark, breeze, people in view, on something raised), it counts the
seconds spent hungry and looking in and out of each, and the meals that followed,
then compares meals per hour as a log ratio. Odour is left out so it cannot just
relearn the innate odour following. A situation it has not spent ten minutes both
in and out of scores exactly zero: no comparison, no opinion. Counts fade only
with new meals, by 1/24 each, not with time.

**What it does with that.** Only when hungry, after three meals, with no food
odour to follow, no loom, and no return or local search under way:

- Leaving ground its counts favor, in flight, it usually turns back at the speed
  it was going (85% of the time, so it does eventually cross).
- On ground its counts disfavor, it stays in the air and sets off on one of the
  controller's own long flights, and a perched fly moves on.
- On favored ground it does nothing extra.

Its authority halves for every 30 minutes without a meal, so a fly whose opinions
stop paying goes back to behaving as the organism does. Every command passes the
fly's gate. The layer sits before the self-model's prediction, so ECHO predicts
from the command the body really gets.

## The test

A 2×2 crossover in open research yards (`acquired/yard.ts`, `acquired/study.ts`):
square cells of sun and canopy shade, with food placed only where the study's rule
says. A fly lives 8 h fed only in the sun or only in shade. Then, with learning
held, it meets yards with a different layout under a different sun, each with its
memory kept and with its counts erased:

- **Foodless, 1 h:** does its flight shift toward or away from sunlit ground?
- **Food by either rule, up to 1 h:** how soon is its first meal?
- **Food by either rule, 8 h stays:** meals and net energy.

Scripted behavior cannot produce the crossover: the two flies share code and seed
and differ only in where they have eaten. Flies fed with no pattern are the control.

`preference` is the sun-fed fly's shift (memory less erased, in share of flight
over sunlit ground) less the shade-fed fly's, by seed. `specific` is the gain where
food matches the fly's experience less the gain where it does not. Without it, a
gain means only a fly that searches harder, not one using what it learned.

## Results

### The first version failed, and why

Seeds 21–32 (`dev-v1`). The preference formed and transferred, +0.41 [0.27, 0.54],
control +0.06 [0.00, 0.12]. It was not useful and it cost energy:

| Measure                              | Food matched          | Food crossed           |
| ------------------------------------ | --------------------- | ---------------------- |
| First meal, seconds sooner           | −206 [−533, 104]      | +131 [−228, 528]       |
| Meals per 8 h stay, gain on about 17 | +3.2 [−0.0, 6.5]      | +1.7 [−0.3, 3.7]       |
| Net energy per 8 h stay, gain        | −0.35 J [−0.74, 0.01] | −0.28 J [−0.47, −0.10] |

On favored ground it ended fast long flights and searched slowly, and kept flying
past the end of its bouts. On the one seed measured (21), it flew 36–46% of the
time against 25%, at 0.54–0.62 m/s against 0.75, and reached no clearly more new
ground. Odour reaches about 23 m, so new ground is what finds food, and the layer
was paying for flight that did not buy any. This version's code is not in the
history; its results are kept as the negative finding they are.

### The version here

Seeds 41–52, which played no part in the redesign (`dev-v2`). The learning was
unchanged apart from the no-comparison rule; how it acts was rewritten as above.

| Measure                                  | Food matched          | Food crossed          |
| ---------------------------------------- | --------------------- | --------------------- |
| First meal, seconds sooner               | +257 [−0.5, 526]      | −104 [−326, 128]      |
| Share finding food within 1 h, sun-fed   | 0.61 vs 0.33 erased   | 0.42 vs 0.39 erased   |
| Share finding food within 1 h, shade-fed | 0.39 vs 0.33 erased   | 0.17 vs 0.42 erased   |
| Meals per 8 h stay, gain on about 18     | −0.5 [−2.3, 1.9]      | −0.8 [−4.2, 2.9]      |
| Net energy per 8 h stay, gain            | +0.02 J [−0.21, 0.27] | −0.11 J [−0.40, 0.17] |

- Preference +0.41 [0.24, 0.55]; control −0.11 [−0.34, 0.10].
- First meal, matched less crossed: **+362 s [34, 667]**, the first time this has
  gone the predicted way. Last version: −338 s [−809, 148].
- Extra energy in a foodless hour: +0.04 J [0.01, 0.06]; last version +0.18 J.

So on these flies it costs little and finds a first meal sooner where experience
predicts, but over long stays it only breaks even. The sealed test below confirmed
the low cost and the break-even, and not the first meal. One suspected reason for the
break-even, not verified: after
a meal, the innate return to remembered food takes over from the layer, and a yard's
food moves on after every meal, so those returns find nothing.

### Lasting and changing

Seeds 81–92 (`persist`). After its first 8 h a fly goes on living and learning for
16 h, then is asked again in foodless unseen yards.

| Later life                | Meals | Preference before  | Preference after         | Sunlit count, before → after |
| ------------------------- | ----- | ------------------ | ------------------------ | ---------------------------- |
| Food with no pattern      | 10.4  | +0.41 [0.31, 0.50] | +0.11 [−0.00, 0.22]      | +1.88 → +0.63 [0.24, 1.01]   |
| Food by the opposite rule | 12.1  | +0.41 [0.31, 0.50] | **−0.42 [−0.59, −0.24]** | +1.88 → −1.38 [−1.64, −1.08] |

The two rows share a "before" because they are the same flies up to that point.
Same code again: only later experience differs. This is a habit that tracks the
fly's recent life, not a permanent one. Through a checkpoint and restore it comes
back exactly (`acquired/life.test.ts`).

### The real city

Seeds 61–72 (`city`). Research flies on the real map for two simulated days, each
seed as the organism and with the layer. Nobody feeds them by a rule. The two arms
are the same fly until the layer first acts, which first showed in a 3 h report
between 3 and 39 h into a life.

| Day 2, layer less organism | Organism | Change                 |
| -------------------------- | -------- | ---------------------- |
| Meals                      | 20.1     | −1.0 [−9.5, +6.4]      |
| Net energy                 | −3.57 J  | −0.15 J [−1.09, +0.79] |
| Recovery bouts             | 9.0      | +0.4 [−1.9, +2.8]      |
| Mean reserve               | 0.38     | −0.00 [−0.07, +0.06]   |

**No detectable benefit or harm.** Flies range from 0 to 55 meals on day 2, so this
does not rule out a large effect either way: the meals interval runs from about 47%
fewer to 32% more.

They did learn something consistent. From their own meals, and with no rule feeding
them, all 12 flies came to favor being within 6 m of a landmark (mean +1.15, 12 of
12 positive) and to disfavor breeze (−0.83, 0 of 12 positive) and clearance under
2 m (−1.34, 0 of 12 positive). Sunlight was not consistent (+0.20, 8 of 12). No code
names any of these, but they are not simply a map of where food is. One earlier
6 h research fly (seed 4242, 14 meals, by that probe's own measures) agrees on two:
a landmark in view before 82% of meals against 26% of all its time, breeze 24%
against 48%. It disagrees on two: near a surface 56% against 28%, bright 8% against
41%. And 61% of the map's food patches are in shade, where only 25% of open ground
is. So some of these counts are probably side effects of where flies happen to be
while looking, which was not separated out here. Acting on them did not pay.

## Identity

`acquired/life.ts` holds how the same individual would take this on: one recorded
continuation of its exact organism checkpoint, at the same tick, adding one object
whose counts start at zero. No script calls it and it reaches no store.
`acquired/life.test.ts` shows, on small synthetic lives:

- With the addition taken back out, the graph's digest is its parent's exactly.
- A birth, a repeat, a forged parent, a changed graph and going back are all refused.
- Compared every 30 s for up to 20 simulated minutes, everything but the addition
  stays identical to the organism while it has fewer than three meals counted.
- What it has learned goes through a checkpoint and restore exactly.

The older full test suite passes with the one hook this adds to `organism.ts`, which
changes nothing unless a subclass uses it. **It has not been run on a real archive.**
That needs the release's platform, Linux arm64, on a disposable branch, and no
deployment follows from this study: any step on the live fly needs its own explicit
authorization, and these results would not justify one.

## Held-out plan, frozen before it is run

Fixed at commit `5cc4e1c`, before any held-out result existed. From
a clean commit, with no bundle: `--split heldout`, whose test yards have cell sizes,
canopy heights, sun heights and shaded shares no development yard has; seeds
1001–1024 fed both ways; seeds 1001–1006 fed with no pattern.
Judged from `analyse`:

| Bar | Claim                                           | Passes if                  |
| --- | ----------------------------------------------- | -------------------------- |
| H1  | The preference transfers                        | `preference.low` > 0       |
| H2  | It finds a first meal sooner where food matches | `usefulMatched.low` > 0    |
| H3  | That gain is specific to what it learned        | `specific.low` > 0         |
| H4  | It costs little                                 | `extraSpentJ.mean` < 0.1 J |
| H5  | It pays for itself over a long stay             | `stayNetMatched.low` > 0   |

H5 is expected to fail on what is known now. Results are reported whichever way
they go, and the set is spent by being looked at: any later change needs new yards
and seeds, and says so. No bar here can make up for the null in the real city.

## Held-out result

Run once, from commit `5cc4e1c` with no bundle, on 2026-11-02 (`heldout`, 54 flies).
Beforehand the held-out path ran once as a crash test, for a few simulated minutes on
an unrelated seed (9001), with its output discarded unread.

| Bar | Claim                                           | Result                | Verdict  |
| --- | ----------------------------------------------- | --------------------- | -------- |
| H1  | The preference transfers                        | +0.42 [0.30, 0.53]    | **Pass** |
| H2  | It finds a first meal sooner where food matches | −9 s [−174, 155]      | **Fail** |
| H3  | That gain is specific to what it learned        | −56 s [−273, 163]     | **Fail** |
| H4  | It costs little                                 | +0.03 J [0.02, 0.05]  | **Pass** |
| H5  | It pays for itself over a long stay             | +0.00 J [−0.17, 0.19] | **Fail** |

A fly reliably carries what it learned into places it has never seen, cheaply, and
that does not help it eat. The development first-meal gain did not replicate. Where
food did not match, a long stay cost it energy, −0.23 J [−0.43, −0.04], against a
baseline of −0.45 J and 19.1 meals. The no-pattern control stayed near zero, −0.04
[−0.19, 0.13].

**Not a bar, and decides nothing, chosen after seeing the results.** These yards were
harder to learn in: a median of 4 training meals against 6 in development, and 10 of
48 flies had fewer than the three the layer needs before it acts. That does not
explain the failure. On the 16 seeds where both flies reached three, the preference
was stronger, +0.55 [0.46, 0.64], but the first meal was still +13 s [−218, 241], and
−52 s [−352, 242] matched less crossed.

This set is now spent.

## Limits

- **Only one section is sealed.** Everything but the held-out result is development.
  The redesign came from looking at results, and the first-meal gain it seemed to
  bring, one of many intervals read, did not survive. Lasting, reversing and the city
  have no sealed test of their own.
- **The yards are invented.** Food follows a clean rule there; in the city the same
  patterns are much weaker. The city's result is the one that speaks to usefulness.
- **The city ran on physics that could trap a fly in a building** (added
  2026-11-05). These flies ran at `7b2627d`, on `digital-fly/8`, before
  [the collision repair](ECHO_COLLISION.md): on the real map that version let a
  body into a building's walls and not out, 9 of 12 research flies within 96 h on
  the repair's own seeds. The city records here hold no measure of it, so whether
  any of these lives was inside a solid was not recorded and cannot be read back.
  Looked at afterwards, 5 of the 24 lives (seeds 63, 66 and 72 with the layer,
  66 and 71 as the organism) end their 48 h with 30 to 36 h without a meal, each
  stretch running to the end of the life. That is what a trapped fly leaves, but
  not evidence of one: on the repaired physics a free fly's longest stretch without
  a meal reached 30 h. So the city's "not shown" cannot tell no benefit from a
  benefit hidden by trapped lives in either arm. A run on `digital-fly/9` with new
  seeds would separate them; none has been made. The yards hold only box canopies
  and no building walls, the one kind of solid the repair's survey found could
  hold a body from inside, so their results are not touched by this.
- **Not independent runs.** One fly meets every test in turn, with the order
  alternating; its physiology carries over, and only its reserve is reset.
- **The world is a proxy.** Odour is still air with a 5 m length, and all of this
  depends on it.
- **Platforms.** All reported results are x86_64. Three seeds of the first version
  also ran on Windows arm64: training summaries agreed, but only one of the six whole
  records was byte-identical apart from wall time.
- **Checks.** Run on the final code: the full `vitest` suite (2,310 passed, 11
  skipped), `tsc`, `eslint`, `prettier`, `npm run build` and `test:evidence`. The Rust
  crate, which this does not touch, was not run. The archived reports use the final
  code; the flies ran on the bundles named in `manifest.json`, kept in a private
  dataset. Against the `dev-v2`, `city` and `persist` bundles, the code here differs
  by one rename, comments, additions for the later experiments and one unused helper
  removed. The `dev-v1` bundle holds the first version.

## Reproducing it

```bash
E=scripts/echo-acquired-evaluate.ts
B=docs/benchmarks/echo-acquired/2026-11-02
# The reports, from the archived flies.
node scripts/run-ts.mjs $E analyse $B/heldout.jsonl
node scripts/run-ts.mjs $E analyse $B/dev-v2.jsonl
node scripts/run-ts.mjs $E analyse-persist $B/persist.jsonl
node scripts/run-ts.mjs $E analyse-city $B/city.jsonl --from 24
# New flies. Per fly, in a job running four: run 7.5 min, persist 3, city 18.
node scripts/run-ts.mjs $E run --seeds 41 --out flies.jsonl
node scripts/run-ts.mjs $E persist --seeds 81 --later reversed --out persist.jsonl
node scripts/run-ts.mjs $E city --seeds 61 --out city.jsonl
```

`scripts/echo-acquired-hf-job.py` runs these in a Hugging Face Job. Nothing in the
repository launches it or spends anything: a person sets `RESULTS_REPO` (a private
dataset), `RUN_PREFIX`, `JOB_PART`, `COMMIT` and `STREAMS_JSON`, a list of commands
with `@OUT@` for each one's results file, and copies the script to
`<RUN_PREFIX>/acquired_job.py` in that dataset, which is what the job fetches and
runs:

```bash
hf jobs run --detach --flavor cpu-upgrade --timeout 2h --secrets HF_TOKEN \
  -e RESULTS_REPO=<private dataset> -e RUN_PREFIX=<name> -e JOB_PART=1 \
  -e COMMIT=<full sha> -e STREAMS_JSON='[["node","scripts/run-ts.mjs","scripts/echo-acquired-evaluate.ts","run","--seeds","1001,1002","--split","heldout","--out","@OUT@"]]' \
  python:3.11 bash -c "pip install -q huggingface_hub && python -c \"import os, runpy; from huggingface_hub import hf_hub_download as d; runpy.run_path(d(os.environ['RESULTS_REPO'], os.environ['RUN_PREFIX'] + '/acquired_job.py', repo_type='dataset'), run_name='__main__')\""
```

Four streams fit one `cpu-upgrade` job. At its listed $0.03 an hour, the five sets
here came to about 19 cents of run time, estimated from their records and not read
from billing, and excluding each job's few minutes of setup.
