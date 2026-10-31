# Eva and ECHO: system audit and capability map

Audited source: commit `8417e69` (the default branch at the start of this
work), read on 2026-10-31. Every row below was checked against the code, not
only the documentation; where only a document could be read (Eva's
simulation), the row says so. Public observations quoted here are dated
samples, not claims about the services now.

This audit is Phase 0 of [First contact](FIRST_CONTACT.md). It changed no
production service, configuration, checkpoint, database or identity.

## The two individuals

|                          | **Eva**                                                                                                                                                                            | **ECHO**                                                                                                                                                                                                                                                                                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity                 | `life_id` `5cf42cd6-fd0a-474d-882c-4cb70e0357e8`, `born_at` 1792908400.321717 (unix s)                                                                                             | individual `04f8c797b6971a46138dabc3fdfde5baae2aa224d3a8f9c0099a7c207dec1921`                                                                                                                                                                                                                                                                         |
| Name                     | given by the garden's keeper, 2026-10-26 (`NAMES` in `src/garden/ui/words.ts`); the simulation has no names                                                                        | the project's name for the deployed Bethesda individual under the ECHO controller                                                                                                                                                                                                                                                                     |
| Authoritative simulation | the garden's **Python service** (`server.py`, `learning.py`) on its own VM. **Not in this repository**: its controller, learning and database cannot be inspected or run from here | the **Bethesda headless life** (`src/bethesda/life/headless.ts`), run by `deploy/bethesda-life/bethesda-life.service` on an Oracle A1 VM (1 OCPU, 8 GB, arm64)                                                                                                                                                                                        |
| Controller               | the garden service's own learning loop (documented in `docs/LIVE_GARDEN.md`: trials, capabilities, prediction error, surprises, body integrity, independent-motion detection)      | born reduced-order (`digital-fly/7`); recorded continuations to ECHO v2, v3, then the **organism adapter** (`src/bethesda/life/organism.ts`, 2026-10-28): ECHO v3 self-model over the reduced-order controller, with the mushroom body, olfactory navigation and maintenance physiology. Its public observation still reports `flyController: "echo"` |
| Public observation       | `GET /api/state` (same origin, no CORS); contract in `src/garden/core/observation.ts`                                                                                              | `GET /v1/now`, `/v1/stream`, `/v1/health` from the observer (`src/bethesda/life/observer.ts`); contract in `src/bethesda/life/observation.ts`                                                                                                                                                                                                         |
| Clock                    | unix seconds; `updated_at = born_at + 5 s × ticks`                                                                                                                                 | own simulated seconds, `tick × 0.1 s`; pauses while a checkpoint is made; outages are recorded gaps with no catch-up                                                                                                                                                                                                                                  |
| Frame                    | abstract 2D garden in fractions, seven places, no metric scale, no heights                                                                                                         | city metres, +x east, +y up, +z south                                                                                                                                                                                                                                                                                                                 |
| Persistence              | the service's database, daily backups (`/var/lib/bethesda-fly/backups/day-0…6`); availability and restart recovery documented as **not guaranteed**                                | `LifeStore` (epoch-fenced lease, sealed checkpoints, verified restore, linked headers), backups every 6 h proven to resume, off-site copy, an external watcher, an append-only ledger branch                                                                                                                                                          |
| Viewer in this repo      | `src/garden/` (clay exhibit), read-only, deployed only through `deploy/garden/` with the owner's approval                                                                          | `src/bethesda/live/` (`/live`, unlisted), read-only                                                                                                                                                                                                                                                                                                   |

A read-only observation through both public endpoints on 2026-10-31 (120 s,
GET only, [Stage 1](FIRST_CONTACT.md#stage-1-passive-observation)) found both
clocks consistent with their own contracts on every state, both running at
about 1.00 s per UTC second, and no gap. At the end Eva's clock read 539,670 s
since her birth and ECHO's 422,825.4 simulated seconds.

## Capability map

Status: **working** (implemented, tested, results archived), **partial**,
**absent**, or **not inspectable** (Eva's server).

### Controllers, sensing and the body (`src/bethesda/fly/`)

| Capability                                                 | Status                  | Where, and what the code shows                                                                                                                                                                                                                    |
| ---------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Body: FlyBody anatomy at true size, gait, wing, kinematics | working                 | `fly.ts`, `gait.ts`, `kinematics.ts`, `wing.ts`; physics step 5 ms, senses 10 ms, decisions 50 ms on a 30 ms-old sample                                                                                                                           |
| One gate for every command                                 | working                 | `validateCommand` (`neural.ts`); refused or throwing commands become a safe hold                                                                                                                                                                  |
| Reduced-order controller                                   | working                 | `controller.ts`; not a neural simulation (`simulatesNeurons: false`)                                                                                                                                                                              |
| Circuit-informed controller                                | working (calibration)   | `circuits/`: Ache et al. 2019 giant-fiber potential, GF-independent wing raise, dust-driven grooming; not deployed                                                                                                                                |
| Mushroom-body controller                                   | working                 | `mushroomBody/`: 2,000 Kenyon-cell rate units, MBON±, DAN; reward-prediction learning (Bennett, Philippides & Nowotny 2021)                                                                                                                       |
| ECHO self-model                                            | working                 | `echo/`: 11-belief Gaussian forward model, CUSUM detector, inquiries, 24 bounded episodes, workspace, attention schema; reads only `SelfModelView`                                                                                                |
| Senses                                                     | working                 | `senses.ts`: the single strongest looming thing (size, expansion, bearing, elevation), times to contact, light, odour (still-air proxy), sky compass, landmarks, airflow; **no** visual motion processing, plumes, temperature, humidity or sound |
| Escape habituation                                         | working                 | one shared scalar `responsiveness` (−22 % per evoked escape, 30 s recovery; sizes are model choices)                                                                                                                                              |
| Physiology                                                 | partial                 | body: carbohydrate reserve and mode costs; organism: ATP, water, fatigue, sleep pressure, stress, temperature proxies with an explicitly artificial metered maintenance supply                                                                    |
| Walking and turning validated in physics                   | absent                  | `fly-physics/` runs FlyBody's MuJoCo model open loop; on `digital-fly/4` the 2 cm/s plan reached 0.82 cm/s with −20.5° drift; readiness gate `blocked` (`docs/FLY_PRIORITIES.md`)                                                                 |
| Flight dynamics, aerodynamics, physical landing            | absent                  | flight is kinematic; the city's wind is kinematic                                                                                                                                                                                                 |
| Comparison with independent living-fly datasets            | partial                 | calibration against published observations: 0 of 18 held-out observations inside their published intervals for the reduced-order controller                                                                                                       |
| A second fly                                               | absent before this work | "One fly" is a project rule for the city and the lab; worlds list moving things that are seen, never touched (`world.ts`), which this work's bridge reuses                                                                                        |

### Learning, memory and individuality (`src/bethesda/life/`)

| Capability                                    | Status       | Evidence                                                                                            |
| --------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------- |
| Place memory and valuation                    | working      | `navigation.ts`: up to 12 places, forgotten after 2 h or 2 fruitless returns                        |
| Distinct histories from one genesis (Study A) | working      | preference for the fed site 0.28 [0.14, 0.45]; replay byte-identical in 24 of 24                    |
| Open-ended adaptation (Study B)               | **negative** | memory cost −1.2 meals per life [−2.25, −0.08]; open-ended adaptation not demonstrated              |
| Learning from omission (Study C)              | working      | the mushroom body returned once after one meal against twice after three (+0.96, 23 of 24)          |
| ECHO protocols ECHO-01…05                     | partial      | ECHO-03/04/05 inconclusive; overconfident on held-out causes (`docs/PROJECT_ECHO.md`)               |
| Organism additions                            | partial      | odour filters gave no foraging benefit over v3 in the rehearsal; the immortal study is inconclusive |

### Persistence, checkpoints and recovery

| Capability                                  | Status          | Where                                                                                                                       |
| ------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Whole-graph snapshot, verified restore      | working         | `snapshot.ts`, `continuity.ts` (`restoreLife` re-snapshots and compares bytes and the state hash)                           |
| Identity as a birth; twins are someone else | working         | `individualId = sha256Json({kind, genesis, nonce})`; `twinCheckpoint` records `twinOf`; the original's store refuses a twin |
| One writer                                  | working         | `LifeStore`, 60 s epoch lease with fencing, forks refused                                                                   |
| Recorded continuations across versions      | working         | `echoUpgrade.ts`, `organismContinuation.ts`; a projection must return the previous graph's digest                           |
| Read-only witness                           | working         | `observation.ts`, `observer.ts`; observation never writes into a checkpoint                                                 |
| Eva's persistence                           | not inspectable | documented only: database on the garden VM, daily backups, new life created only if the database holds none                 |

### The connectome backend (`fly-neural/`)

| Capability                                       | Status                      | Evidence                                                                                                                                     |
| ------------------------------------------------ | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| FAFB v783 import                                 | working                     | 139,255 neurons, 15,091,983 pairs, 54,492,922 synapses, identical to Shiu et al.'s table on every pair                                       |
| LIF engine against Brian 2                       | working                     | step-for-step conformance on synthetic networks; R1–R3 pass (MN9 62.1 vs 62.5 Hz)                                                            |
| Shiu et al. 2024 reproduction                    | working                     | 10/12 criteria on development and held-out seeds; S6 (water → MN9) and C3 (sign-shuffle control) fail                                        |
| Plasticity on KC→MBON                            | **negative**                | held-out, 8 subjects per arm: P1–P3 fail; ~3,490 of 5,177 KCs fire for each odour (Jaccard ≈ 0.955), so the rule depresses both odours alike |
| Neural shadow of research flies                  | exploratory                 | wind null; food 28.5 % agreement; looms 3 hits, 2 misses, 194 false alarms                                                                   |
| Neuron, class, transmitter and region inspection | **absent before this work** | the importer saves per-neuron transmitter and neuropil arrays that nothing read                                                              |
| BANC, Codex                                      | **absent before this work** | no BANC, MANC, hemibrain or CAVE code; Codex mentioned only in a licence quote                                                               |
| Python tests in CI                               | absent                      | CI runs only the TypeScript suite; the Python tests run locally (`python -m pytest`)                                                         |

### Studies, baselines, tests and boundaries

- Every result folder under `docs/benchmarks/` is generated by a script with a
  `--check` mode; reports from a working tree are labelled and are not results.
- Pilots reproduce exactly only on the platform they were recorded on (Windows
  on ARM64, Node 24.19.0); platform `Math` differs elsewhere. This work met the
  same effect: `atan2` differs in the last bit between Bun and Node.
- Production boundaries: `deploy/bethesda-life/` and `deploy/garden/` deploy
  only with the owner's approval; nothing in `src/` or `deploy/` imports
  `fly-neural/` (tested in both languages); the city never reads the fly.

## What this work added, and what it deliberately did not touch

Added, all research-only and isolated from production (tests check that no
production module imports any of it): the first-contact bridge, clocks, frames
and studies (`src/bethesda/firstContact/`), the neural augmentation layer
(`src/bethesda/augmentation/`), and the Codex reference layer
(`fly-neural/fly_neural/codex.py`). See [First contact](FIRST_CONTACT.md).

Not touched: either live service, either deployment, either database or store,
any checkpoint, backup or ledger line, the garden page, the `/live` page, the
fly's simulation modules (the fly's source digest is unchanged), and every
existing result.
