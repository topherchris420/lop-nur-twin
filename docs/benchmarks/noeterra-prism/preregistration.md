# Sarvam-Prism ruling Rome: pilot preregistration

**Status: draft until merged.** The commit that merges this file into `main`
freezes it, together with the runner (`tools/noeterra-prism-pilot.mjs`) and the
engine (`noeterra/src`, `noeterra/Cargo.toml`, `noeterra/Cargo.lock`). That
commit's SHA also draws the study's seeds. Changing anything frozen after the
first priced call makes a new study, with a new preregistration.

**Evidence class: simulated.** Every number here describes Noeterra's
illustrative rules and its agents. None of it is evidence about history, and
none of it measures Sarvam-Prism outside this game.

## Question

In the built-in `mediterranean-264bc` scenario over 40 seasons, with the other
eight civilizations ruled by the rule-based agents, does Rome end the game with
more or fewer provinces when a Sarvam-Prism seat rules it than when the
rule-based agent does? And does a Prism seat work in a real game (answering
live, acting, replaying) well enough to justify a larger study?

This is a pilot. Six seeds can show only a large effect that points the same way
in every seed. Its main products are the feasibility bars, the measured tokens
and latency, and an effect estimate to size a later study.

## Design

| Item            | Choice                                                                                                                                                                                                                |
| :-------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scenario        | `mediterranean-264bc`, 40 seasons                                                                                                                                                                                     |
| Seat under test | Rome. The other eight civilizations play by the rules in every arm                                                                                                                                                    |
| Seeds           | Six, drawn by `node tools/noeterra-prism-pilot.mjs seeds <merge commit>` from the full SHA of the commit that merges this file. Seeds 1–12 (the lab's archived experiments) and 101–103 (the dry run) are skipped     |
| Runner          | `node tools/noeterra-prism-pilot.mjs study --merge <sha> --spend` plays every arm on each seed, in the order rules, random, passive, outage, prism                                                                    |
| Measurement     | `noeterra score` re-simulates each save without any model and reports the world's metrics, each civilization's end state, and per seat its labels, reported input tokens, latency, discarded parts and active seasons |

The study runs in three stages:

1. **Dry run (free, done before freezing).** Seeds 101–103, every arm, with the
   Prism seat answered by a loopback stand-in under a placeholder key. Its
   results are in [`dry-run/`](dry-run/).
2. **Priced check (3 calls).** Seed 101, seasons 1–3, against Sarvam's API. It
   needs `SARVAM_API_KEY` and `--spend`, and passes only if all three seasons
   are LIVE with nothing discarded. Season 1's request depends only on the
   starting world, so it is byte-identical to the dry run's. The check projects
   the study's tokens from season 1's tokens per byte and the dry run's request
   sizes.
3. **Study (240 calls).** The six seeds, 40 Prism calls each. It starts only
   after the check passes and the owner approves its projection.

## Arms

| Arm               | Rome's seat                                                                                                          | Calls Sarvam  | Per game                                                                                                                                                               |
| :---------------- | :------------------------------------------------------------------------------------------------------------------- | :------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| rules (control)   | `rules`                                                                                                              | no            | nothing                                                                                                                                                                |
| prism (treatment) | `prism`: model `sarvam-prism` at the seat's defaults, one request a season. The runner clears `NOETERRA_PRISM_MODEL` | yes, 40 calls | Dry-run requests were 8,959 to 15,823 bytes (mean 13,422). At 4 bytes a token that is about 3,400 tokens a call and 134,000 a game. The check measures the real figure |

gstack's price table has no row for `sarvam-prism` (`EVAL_PRICE_MISSING`), and
this repository keeps prices only in `config/pricing.json`, which prices
nothing. So the budget is counted in tokens, settled from the `input_tokens`
Sarvam reports for each call.

## Bars

The decoys' checks (below) come first. If any of them fails, the outcome is not
read.

| Bar               | Pass                                                                                                                                | Direction | What a miss means                                                                      |
| :---------------- | :---------------------------------------------------------------------------------------------------------------------------------- | :-------- | :------------------------------------------------------------------------------------- |
| replay            | All 30 saves re-simulate to their recorded state hashes                                                                             | all       | The engine, not the ruler, is in question. The study stops                             |
| live              | At least 5 of the 6 Prism games are valid: at most 2 of their 40 seasons are FALLBACK                                               | ≥         | A Prism seat is not usable yet. The outcome is not read: "not measured"                |
| acts              | In every valid game, Prism's Rome applies at least one action in at least half as many seasons as the rules' Rome does on that seed | ≥         | Prism plays as a passive ruler. The outcome is still read, and reported alongside this |
| outcome (primary) | Rome's provinces at season 40 (`provinces.rome`), prism minus rules, seed by seed                                                   | either    | See the verdicts below                                                                 |

The verdicts on the primary outcome are fixed now:

- **"Prism held more provinces"**: the mean paired difference is at least +1,
  and Prism's Rome is higher in every valid seed.
- **"Prism held fewer provinces"**: the mean is at most −1, and Prism's Rome is
  lower in every valid seed.
- Otherwise **"no difference shown"**, which is not evidence that there is no
  difference.

With six valid seeds all pointing one way, a two-sided sign test gives
p = 0.031; with five, p = 0.0625. The report prints the sign test, but the
verdict does not use it.

Descriptive only, with no verdict: Rome's treasury, stability and survival at
the end; wars declared in the world; and Prism's tokens per call, latency,
discarded parts and the model name Sarvam reports.

## Decoys

Three decoy arms run on every seed. None calls Sarvam: `passive` and `outage`
are Prism seats answered by the loopback stand-in under a placeholder key.

| Decoy   | Rome's seat                                                             | It must                                                                                                                                             | If it does not                                                                                    | Dry run (seeds 101–103)                               |
| :------ | :---------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------ | :---------------------------------------------------- |
| random  | `random`: uniformly random legal choices                                | Score lower on the primary metric: rules minus random is at least 1 province on average, and positive in at least 5 of 6 seeds ("random-separates") | Provinces cannot tell a ruler from chance on these seeds, and the outcome is not read             | Rules minus random: 1, 3, 7 (mean 3.67)               |
| passive | Prism seat; the stand-in answers hold, none and no to everything        | Fail the acts bar in every seed ("passive-caught")                                                                                                  | The acts bar cannot detect a ruler that does nothing, and the outcome is not read                 | 0 active seasons, against 18, 32 and 19 for the rules |
| outage  | Prism seat; the stand-in answers every call with 503 `model_overloaded` | Fall back in all 40 seasons and end in exactly the rules arm's final state hash ("outage-equals-rules")                                             | A FALLBACK season is not a rules season, so the live bar's cap no longer bounds the contamination | Identical final hashes on all three seeds             |

The outage decoy is why the live bar exists. A season Sarvam fails is played by
the rules, so a study with many failures would look like "Prism plays the same
as the rules" when Prism hardly played.

## Stop rules

1. **Budget.** At most 2,000,000 reported input tokens across the check and the
   study together, about 2.5 times the dry run's estimate. Before each Prism
   game, the runner admits it only if the tokens spent so far, plus 1.25 × 40 ×
   the largest per-call count seen, fit. Otherwise it stops with
   `budget_exhausted`. LIVE calls that report no tokens are counted and shown.
2. **Account.** Any 401, 402 or 403, or an insufficient-quota error, stops the
   study at once.
3. **Fallbacks.** A game with more than 2 FALLBACK seasons is invalid. A second
   invalid game stops the study, as "not measured".
4. **Check.** If any of the check's 3 calls falls back, discards a part or fails
   to replay, nothing further runs until the cause is understood.
5. **Replay.** Any save that does not re-simulate stops the study.
6. **Freeze.** The runner refuses the study if the plan, the runner or the
   engine differ from the merge commit, including uncommitted changes. It
   refuses the check and the study unless the runner and the engine have the
   fingerprint recorded in `dry-run/dry-run.json`: a SHA-256 over the git blob
   hashes of every frozen file except this plan. So the dry run checked the
   code the paid stages run.
7. **Approval.** The study needs the owner's go-ahead after the check, and the
   check's projection must be within the budget.

Nothing is retried. A failed call is a FALLBACK season, recorded with Sarvam's
reason.

## Held-out exposure

| Set                                   | Prior exposure                                                                                                        | Reservation                                       |
| :------------------------------------ | :-------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------ |
| Study seeds (six, from the merge SHA) | None. They do not exist until the merge, so no arm, model or person has run them                                      | Run only by `study`, once, after the check passes |
| Dry-run seeds 101–103                 | The dry run: all five arms, with Prism answered by the stand-in. The priced check replays seed 101's seasons 1–3 live | Development only. Never study seeds               |
| Lab seeds 1–12                        | The lab's archived experiments, rule-based seats                                                                      | Skipped                                           |

## Diagnostics

The report's counts are checked against synthetic records built to produce
known counts. They are not game output.

summarizer: `node tools/noeterra-prism-pilot.mjs report --scores {fixture} --stage study`
fixture: `docs/benchmarks/noeterra-prism/fixture-scores.jsonl`

| diagnostic             | expected |
| :--------------------- | :------- |
| seeds                  | 2        |
| games                  | 10       |
| replay_failures        | 1        |
| invalid_prism_games    | 1        |
| outage_mismatches      | 1        |
| random_separated_seeds | 1        |
| passive_caught_seeds   | 2        |
| prism_acting_seeds     | 1        |
| prism_more             | 1        |
| prism_fewer            | 0        |
| prism_same             | 0        |

## What Sarvam receives

Each request carries Rome's brief and its fog-of-war report of the simulated
game, and nothing about any person. Before the priced check, the account owner
sets the organization's data retention to 0 days and opts out of training:
Sarvam keeps inputs until a retention period is set, and its privacy policy
says inputs train its models unless the account opts out. Processing happens
in India.

## What is kept

- `dry-run/`: `dry-run.json`, `scores.jsonl` and `stand-in.jsonl` (size and
  SHA-256 of every stand-in request). The saves and chronicles are not kept,
  because the dry run re-runs identically: a second run reproduced every final
  hash and every request byte for byte. `dry-run.json` records the commit it
  ran on with `"dirty": true`, because the runner's last change was committed
  after the run. What ties the dry run to the code is its fingerprint, not the
  commit, and the paid stages check it.
- `results/`: `check.json`, `study.json`, `spend.jsonl`, `scores.jsonl` and the
  Prism saves, since Sarvam's answers cannot be regenerated. The other arms'
  saves re-run from their seeds.
- A report of the outcome, whatever it is, including a stopped or
  "not measured" study.
