# Eva's controller in TypeScript (research gardens only)

A step-for-step port of Eva's garden service for research subjects: her patched
`server.py` step (`garden.ts`), `learning.py` (`learning.ts`) and
`eva_plasticity.py` in off, shadow and active mode (`plasticity.ts`), from
`deploy/garden/service/`. Given the same seed, birth time, clock times and
weather, a research garden here steps as her Python code does.

It never runs Eva. `birth` takes the seed and a `research-` id from the caller
and refuses an original's id (`../originals.ts`); nothing in production may
import it (AGENTS.md, first contact). It is a toy sensorimotor model of a
simulated fly; nothing it counts is a claim about real flies or experience.

## What is exact, and how

- `pyRandom.ts`: CPython's `random.Random` (MT19937, `str` seeding through
  SHA-512 as `random.seed` version 2 does, `random`, `uniform`, `getrandbits`,
  `choice`). Her server seeds a fresh stream every step with `f"{seed}:{ticks}"`.
- `pyMath.ts`: `round(x, n)` on the exact binary value (ties to even), and
  `math.hypot`/`math.dist` as CPython 3.12 to 3.15 compute them (`vector_norm`
  in `Modules/mathmodule.c`, with the `fma` error term done by Dekker's exact
  product). CI's Python is 3.12.
- `newYork.ts`: `ZoneInfo("America/New_York")` local time and `dst()` from
  `Intl`.
- `math.sin`/`math.cos` are the platform's: V8 and Python's libm differ by one
  unit in the last place on about 4% of her arguments (measured in the tests).
  That reaches only continuous fields, at about 1e-16.

## What differs by design

In-memory persistence (a bounded tail of moments plus their count; the
plasticity sidecar as an object), no HTTP server, weather fetcher, wall clock
or `uuid4`, and a `/state` snapshot without `server_time` or the weather's
`fetched_at` and `sun`. The plasticity port omits file writes, daily copies,
sidecar validation and the life-binding refusals (see `plasticity.ts`).

## Research seams (absent by default)

`perceive(now)` adds things her own object tracker follows; `obstruct(start,
end, action)` says where a motion stops (after her boundary); `onStep` observes
each step. With them absent, or inert, she is byte for byte unchanged (tests).

## Parity fixtures

`scripts/eva-parity.py` births research gardens with her original service,
runs them with her patched one and writes `fixtures/`:

```sh
python -m venv /tmp/evavenv && /tmp/evavenv/bin/pip install tzdata   # Windows has no tz database
/tmp/evavenv/bin/python scripts/eva-parity.py vectors src/bethesda/firstContact/eva/fixtures
/tmp/evavenv/bin/python scripts/eva-parity.py runs src/bethesda/firstContact/eva/fixtures
npx vitest run src/bethesda/firstContact/eva/eva.test.ts
```

Seven runs of 20,000 steps (off; shadow at night with a six-hour outage;
active across the 1 November fall-back; active in cold rain with fetched
sunrise and sunset; shadow in January; active and shadow with weakened wings,
where active swaps). The test requires every discrete field to match at every
step and every continuous field to be within 1e-9 at every step and at every
checkpoint (whole state, plasticity memory, snapshot). The fixtures were
written by Python 3.15.2 on Windows ARM64.
