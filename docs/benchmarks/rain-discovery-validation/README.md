# R.A.I.N. discovery validation — 10 October 2026

This archive contains **two actually executed Bethesda simulator experiments**,
with native preregistration, registry evaluation and successful deterministic replay.
Designs and critiques came from the explicitly named scripted integration fixture.
**No live Qwen inference was available or executed.**

The producing source commit is `acd1b97647e98c89167d748cb5121cae55f4b583`,
recorded with a clean working tree in both sealed records. That local commit could not be pushed because the shell had no GitHub credentials.
The connected GitHub integration published the **identical source tree** at
`f9f2939cfb77a6c4fa52f9151f65cfe84c7f3aca`. Both trees are
`860ea1a1683a0fddb2e204fe346686bfe8ed7556`; only commit metadata differs.
The sealed records retain their original producing commit and were not rewritten.
See [source-publication.json](source-publication.json) for that mapping. The simulator is `bethesda-city/4`; each record
also binds the map, streetscape and terrain hashes.

## Executed investigation

The question was how simulated urban disruptions alter collective movement and
whether one intervention can have different outcomes under different conditions.
The fixture tested one supported disruption: a minor fire at Bethesda Row.
Both studies used eight cars, two buses, 100 warm-up ticks, a 300-tick fire and
300 observation ticks. Each study had three matched control/treatment seed pairs;
only treatment received the fire. One tick is 0.1 simulated seconds. The native
minor-fire radius was 22 m. The primary outcome was the mean count of outdoor pedestrians watching or
recording within 300 m, sampled every 100 ticks.

| Study                     | Pedestrians | Mean control | Mean treatment | Mean paired difference | Paired differences | Native verdict |
| ------------------------- | ----------: | -----------: | -------------: | ---------------------: | ------------------ | -------------- |
| First protocol            |          40 |            0 |           2.22 |                  +2.22 | 2, 2, 2.67         | supported      |
| Evidence-linked follow-up |          60 |            0 |           7.33 |                  +7.33 | 7, 4.67, 10.33     | supported      |

Each preregistration predicted an increase of at least 0.01 count on average,
with all three seed differences in the expected direction. Both passed those
**descriptive criteria**. The recorded first result was +2.22; the fixture then
chose the 60-pedestrian branch, inserted that measured value in its rationale,
and cited the first run and design as the follow-up's evidence and parent.
Neither generated population protocol is one of the legacy 44 designs.

This verifies a result-driven revision through the native pipeline. It does not
establish a causal population interaction: the studies use different seed panels,
absolute counts naturally depend on population, and no factorial interaction test
or significance test was preregistered. Both studies had the same outcome direction.
The archive does not demonstrate a behavioral reversal, other disruption kinds,
confirmatory replication, or scientific reasoning by Qwen. No measurements describe
real Bethesda residents. Scripted critique text is retained verbatim, including its
limitations; it is not an independent scientific assessment.

## Reproduce and inspect

From this checkout with Node 22.18+ and installed dependencies:

```sh
npm run rain:discovery-demo -- --verify docs/benchmarks/rain-discovery-validation
```

This rechecks the immutable journal chain and re-simulates both sealed records.
The separate verification invocation completed successfully for both records.
For producing-source reproduction, check out the published, byte-identical source
commit listed above in another worktree and pass this archive's absolute path to
`--verify`. Creating a new demo
with `--out <new-directory>` selects fresh host seeds and session IDs; it need not
produce these same aggregate numbers. Replay uses the archived exact seeds.

- [REPORT.md](REPORT.md): generated report with each seed, protocol and lineage.
- [summary.json](summary.json): machine-readable session and source provenance.
- `records/`: two immutable sealed native run records.
- `discovery/`: 32 hash-chained entries covering requests, answers, validation,
  admission, preregistration, replay, results and criticism.
- `registry/`: native registered protocols and evaluated results.
- `charters/`: the scoped fixture charter and host-invoked fixture authorization.
  This does not authorize live-model research.

## Implementation validation

- Full Vitest suite: 122 files, 1,621 tests passed with `--maxWorkers=2` before
  the final intensity-equivalence regression was added. A default-worker run had
  one existing runtime test exceed its five-second timeout under contention;
  the bounded-worker rerun passed.
- Final discovery/compiler/operator tests: 4 files, 29 tests passed, including
  the added intensity-equivalence check and actual local HTTP adapter integration
  against a clearly labeled test server.
- Legacy Bethesda/R.A.I.N. suites, evidence validation and native R.A.I.N.
  conformance passed; the 44-design catalogue and manual path remain available.
- Formatting, ESLint, strict TypeScript checking, production build and the
  built-asset secret scan passed. Existing large-bundle warnings remain.
- Browser verification was attempted but could not run: Chrome was absent and
  its download failed at the network proxy. The local operator HTTP service was
  exercised through automated tests; visual/browser behavior remains unverified.
- LM Studio at `127.0.0.1:1234` was unavailable. The live Qwen success criterion
  remains to be demonstrated on the machine hosting LM Studio, using the documented
  workbench or CLI authorization flow.
