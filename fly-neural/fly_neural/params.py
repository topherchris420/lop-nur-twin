"""The leaky integrate-and-fire constants, each with where it comes from.

The values are the defaults of Shiu et al.'s published model
(``model.py`` of github.com/philshiu/Drosophila_brain_model at commit
91bdd1e7dcf193f3e7ca5a8933497fcef63b7960). That file cites a source for most
of them; the synaptic weight and the Poisson scaling are free parameters the
authors set by hand, and the time step is Brian 2's default because the model
never sets one. ``status`` says which kind each value is, so nothing here
reads as a measurement it is not.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

SHIU_COMMIT = "91bdd1e7dcf193f3e7ca5a8933497fcef63b7960"


@dataclass(frozen=True)
class LIFParams:
    """Network constants in ms and mV. Frozen: a run records the exact set."""

    dt_ms: float = 0.1
    v_0_mV: float = -52.0
    v_rst_mV: float = -52.0
    v_th_mV: float = -45.0
    t_mbr_ms: float = 20.0
    tau_ms: float = 5.0
    t_rfc_ms: float = 2.2
    t_dly_ms: float = 1.8
    w_syn_mV: float = 0.275
    f_poi: float = 250.0

    def as_dict(self) -> dict[str, float]:
        return asdict(self)

    @property
    def poisson_weight_mV(self) -> float:
        """The jump one Poisson event gives the membrane (w_syn * f_poi)."""
        return self.w_syn_mV * self.f_poi


# status: "cited" = a literature value the published model cites;
# "free" = a free parameter the published model set by hand;
# "simulator" = a simulator default the published model inherits;
# "assumption" = a modelling assumption with no measurement behind it.
PARAM_SOURCES: dict[str, dict[str, str]] = {
    "dt_ms": {
        "status": "simulator",
        "source": "Brian 2 defaultclock.dt; Shiu model.py sets no time step",
    },
    "v_0_mV": {
        "status": "cited",
        "source": "Kakaria & de Bivort 2017, doi:10.3389/fnbeh.2017.00008 (cited in Shiu model.py)",
    },
    "v_rst_mV": {
        "status": "cited",
        "source": "Kakaria & de Bivort 2017 (cited in Shiu model.py)",
    },
    "v_th_mV": {
        "status": "cited",
        "source": "Kakaria & de Bivort 2017 (cited in Shiu model.py)",
    },
    "t_mbr_ms": {
        "status": "cited",
        "source": "Kakaria & de Bivort 2017: C_m * R_m (cited in Shiu model.py)",
    },
    "tau_ms": {
        "status": "cited",
        "source": "Juergensen et al. 2021, doi:10.1088/2634-4386/ac3ba6 (cited in Shiu model.py)",
    },
    "t_rfc_ms": {
        "status": "cited",
        "source": "Lazar et al. 2021, doi:10.7554/eLife.62362 (cited in Shiu model.py)",
    },
    "t_dly_ms": {
        "status": "cited",
        "source": "Paul et al. 2015, doi:10.3389/fncel.2015.00029 (cited in Shiu model.py)",
    },
    "w_syn_mV": {
        "status": "free",
        "source": "Shiu model.py 'Free parameter' (weight per synapse, set by hand)",
    },
    "f_poi": {
        "status": "free",
        "source": "Shiu model.py: Poisson scaling, '250 is sufficient to cause spiking'",
    },
}

# Choices the published model makes that are not measurements of the fly. They
# are listed so every result can carry them.
MODEL_ASSUMPTIONS: tuple[str, ...] = (
    "Every neuron is a single-compartment leaky integrate-and-fire unit with identical constants.",
    "A connection's weight is its synapse count times w_syn, signed by the presynaptic neuron's "
    "predicted transmitter; synapse size, location and receptor type are ignored.",
    "Acetylcholine is excitatory; GABA and glutamate are inhibitory; dopamine, serotonin and "
    "octopamine are treated as excitatory (Shiu et al. 2024 Methods). Neuromodulation is not modelled.",
    "Synaptic input is an instantaneous jump in g that decays with tau; there is no short-term "
    "plasticity, no gap junctions, no neuropeptides and no glia.",
    "Every connection has the same 1.8 ms delay regardless of path length.",
    "Stimulated neurons fire as independent Poisson processes at a fixed rate (an optogenetic-style "
    "drive), with no refractory period.",
    "Silencing a neuron mutes its outgoing synapses (Shiu model.py silence()); it can still spike.",
    "The weights are fixed: the connectome is a structural snapshot of one female fly, not a "
    "record of synaptic efficacy or plasticity.",
)
