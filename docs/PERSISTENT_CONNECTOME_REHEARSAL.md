# Continuing a garden or city fly with BANC v888

These finite, offline runners exercise the motor decisions and persistence formats used by Eva and ECHO. They take a body that already exists, preserve its individual ID and history, and attach a separately initialized spiking network to it. The two individuals can use the same anatomical wiring while accumulating independent neural states. The production services still run their deployed controllers.

## Model and inputs

The model integrates all 158,262 neurons of the reviewed BANC v888 Codex export at 0.1 ms, with 3,037,361 directed pairs and 23,556,214 counted synapses. The existing repository pin identifies the source files and attribution. Use the reviewed import documented in [the neural backend](../fly-neural/README.md). Both runners expect its data root, which contains the original pinned annotations and the compiled graph. The raw tables stay outside Git.

|               | Eva                                                                                                                                                                                                                     | ECHO                                                                                                                                                                                                                                 |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sensory input | The pre-decision garden geometry determines foot contact. A planar eye projects the existing midge trajectory, with a modelled food odour field and ambient wind proxy.                                                 | The body supplies food contact and the existing sensory frame supplies airflow, odour and looming. Changes in apparent bearing drive the small-object channel.                                                                       |
| Motor effects | Feeding and antennal grooming can change perch activity. A jump or escape readout can start a flight to shelter. The walking readout can change a travel step. The body executes travel using its learned capabilities. | Feeding and escape can change intentions. The existing descending readouts can request walking, turning, stopping, grooming and landing through the organism's motor path. The fast defensive reflex and physiology retain priority. |
| Continuity    | SQLite commits the body, existing plasticity memory, planar eye history and neural state together.                                                                                                                      | An exclusive output file binds the neural state, sensory history and decoder clock to the digest of the complete body checkpoint. The ordinary ECHO service cannot load this paired file.                                            |

The network can issue a motor request. Existing controllers still handle behaviors without a neural request. Simulated membrane potentials, delayed events, the random stream and the trailing spike-count window all survive a restart. Physical collision, flight dynamics and metabolism remain body models. Neither runner measures the activity of an individual biological fly.

## Rehearse

Use matching, restored source copies. Install the existing Python neural package and Node dependencies, then run from the repository root. Set `FLY_NEURAL_PYTHON` if the Python that can import the package is not the default `python`. Outputs are new files, and existing destinations are refused.

For Eva, supply her SQLite backup and the acquired plasticity sidecar for the same individual on the first attachment. Each tick exercises five seconds of garden time.

```sh
python scripts/eva_persistent_connectome.py --attach --db garden-copy.sqlite \
  --plasticity eva.plasticity.json --individual "$EVA_ID" --model-root "$FLY_NEURAL_DATA" \
  --ticks 1 --out garden-first.sqlite
python scripts/eva_persistent_connectome.py --db garden-first.sqlite \
  --individual "$EVA_ID" --model-root "$FLY_NEURAL_DATA" --ticks 1 --out garden-second.sqlite
```

For ECHO, start from a full plasticity-era checkpoint with its graph. A store record containing the checkpoint is also accepted. Subsequent runs resume the pair.

```sh
node scripts/run-ts.mjs scripts/echo-persistent-connectome.ts attach \
  echo-checkpoint.json echo-first.json "$ECHO_ID" "$FLY_NEURAL_DATA" 10
node scripts/run-ts.mjs scripts/echo-persistent-connectome.ts resume \
  echo-first.json echo-second.json "$ECHO_ID" "$FLY_NEURAL_DATA" 10
```

## Evidence and live activation

The regression tests in `fly-neural/tests/test_persistent.py` exercise an actual spiking path, feeding from an initially resting garden body, deterministic restore, corruption and incorrect body, individual and model bindings. A synthetic circuit is sufficient to run those tests in CI.

A controlled trial on the reviewed BANC graph used ten 20 ms windows and the same starting seed for each condition. An expanding visual target triggered the escape readout in 10/10 windows, and the unstimulated control triggered it in 0/10. Food contact activated six descending neurons in the last trailing window but did not reach the feeding threshold in this short trial. These results demonstrate a causal response in the model. They do not establish behavioral accuracy, sustained feeding or suitability for an always-on service.

A reset-and-resume comparison used a local garden life and a local ECHO plasticity-era checkpoint. After two garden ticks (100,000 neural steps) and twenty city ticks (19,900 neural steps through the last sensory sample), the split runs agreed with the uninterrupted runs on body state, sensory history, membrane and conductance arrays, pending deliveries, random stream, and readout history. These were short runs on local individuals.

On the test CPU, one 500 ms neural interval under food contact and 0.25 m/s airflow took 1.39 wall-clock seconds. This single measurement is slower than the live clock and does not establish performance on either original host.

For the originals, the remaining steps are a witnessed rehearsal against current restored backups, a sustained compute and behavior check on the intended hardware, integration with the single-writer service and observer on each host, and a forward migration with a verified recovery path. Keep the original births and durable histories. The existing [activation record](EVA_ECHO_ACTIVATION.md) describes the two services and their continuity checks.
