"""A leaky integrate-and-fire model on the FlyWire whole-brain connectome.

A research backend, separate from the browser and from the deployed fly. It
imports the public FlyWire FAFB v783 connection table (Dorkenwald et al. 2024)
into a sparse graph, runs the leaky integrate-and-fire model Shiu et al. (2024)
published for it, and offers that model as a *shadow* predictor beside ECHO's
existing controller: it reads the observations ECHO already reads and never
commands a body.

The connectome is a structural snapshot of one female fly's brain. A model
built on it is a hypothesis about dynamics, not a recording of the fly's
nervous system, and nothing here says anything about experience. Every result
names the data release, the code commit and every parameter that produced it.

No FlyWire data are kept in this repository. FlyWire's guidelines put the
public release under CC BY-NC 4.0 (the Zenodo deposit says CC BY 4.0); the
stricter terms are treated as binding, so the tables are fetched into a local
cache by ``python -m fly_neural acquire`` and never redistributed.
"""

CONNECTOME_SCHEMA = "fly-neural-connectome/v1"
RESULT_SCHEMA = "fly-neural-result/v1"
SHADOW_SCHEMA = "fly-neural-shadow/v1"
CHECKPOINT_SCHEMA = "fly-neural-checkpoint/v1"

EVIDENCE = (
    "simulated: a leaky integrate-and-fire model on a fixed connectome snapshot; "
    "it describes this model, never Drosophila, until compared with independent measurements"
)
