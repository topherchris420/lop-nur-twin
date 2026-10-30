"""The leaky integrate-and-fire network of Shiu et al. (2024), on a compiled connectome.

Equations (Shiu model.py, integrated exactly over each step as Brian 2's
``linear`` method does)::

    dv/dt = (v_0 - v + g) / t_mbr      (frozen while refractory)
    dg/dt = -g / tau                   (frozen while refractory)

Each step of ``dt`` follows Brian 2's default schedule, so the two
implementations agree spike for spike on deterministic input (tests/test_lif.py
compares them with spike times Brian 2 recorded):

1. groups: a neuron is refractory while ``step - last_spike < t_rfc``; the
   others are integrated;
2. thresholds: a non-refractory neuron with ``v > v_th`` spikes;
3. synapses: this step's spikes are queued for delivery ``t_dly`` later, the
   spikes queued for this step add ``w_syn * signed_count`` to the target's
   ``g``, and each Poisson-driven neuron's draw adds ``w_syn * f_poi`` to its
   ``v`` — but only to a neuron that is not refractory. Brian 2 makes every
   ``(unless refractory)`` variable a conditional write, so input reaching a
   neuron during its refractory period (or in the step it spikes) is
   discarded, not accumulated;
4. resets: spiking neurons get ``v = v_rst`` and ``g = 0``.

Silencing mutes a neuron's outgoing synapses, as Shiu model.py ``silence()``
does (its README says "to and from"; the code mutes "from", and this follows
the code). Poisson-driven neurons have no refractory period, as in Shiu
``poi()``.

Only neurons whose state has left rest are integrated: a neuron at exactly
``v_0`` with ``g = 0`` stays there under the update, so skipping it is exact.
Spike recording is bounded (``max_logged_spikes``); counts are always kept.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from . import CHECKPOINT_SCHEMA
from .connectome import Connectome
from .params import LIFParams
from .resources import Budget


class NumericalInstability(RuntimeError):
    pass


def steps(ms: float, dt_ms: float) -> int:
    """Brian 2's ``timestep``: int((t + 1e-3 dt) / dt)."""
    return int((ms + 1e-3 * dt_ms) / dt_ms)


@dataclass
class Poisson:
    """Neurons driven at a rate, as Shiu ``poi()``: one Bernoulli draw per neuron per step.

    ``rate_hz`` is a constant or a per-bin schedule with bins of ``bin_ms``."""

    indices: np.ndarray
    rate_hz: float | np.ndarray
    bin_ms: float | None = None
    label: str = ""

    def rate_at(self, step: int, dt_ms: float) -> float:
        if np.isscalar(self.rate_hz):
            return float(self.rate_hz)
        b = min(int(step * dt_ms / self.bin_ms), len(self.rate_hz) - 1)
        return float(self.rate_hz[b])


@dataclass
class Stimulus:
    poisson: list[Poisson] = field(default_factory=list)
    silenced: np.ndarray = field(default_factory=lambda: np.zeros(0, dtype=np.int64))
    # Deterministic kicks for conformance tests: {step: neuron indices}, each
    # adding w_syn * f_poi to v in the synapses slot, like a Poisson event.
    kicks: dict[int, np.ndarray] = field(default_factory=dict)

    def describe(self) -> dict:
        return {
            "poisson": [
                {
                    "label": p.label,
                    "neurons": int(len(p.indices)),
                    "rate_hz": float(p.rate_hz) if np.isscalar(p.rate_hz) else [float(r) for r in p.rate_hz],
                    "bin_ms": p.bin_ms,
                }
                for p in self.poisson
            ],
            "silenced": int(len(self.silenced)),
            "kicks": int(sum(len(v) for v in self.kicks.values())),
        }


class Network:
    """A connectome's weights in the units the integrator needs (mV per spike)."""

    def __init__(
        self,
        c: Connectome,
        params: LIFParams = LIFParams(),
        *,
        sign: np.ndarray | None = None,
        wiring: tuple[np.ndarray, np.ndarray, np.ndarray] | None = None,
        label: str = "connectome",
    ):
        """``wiring`` = (indptr, indices, signed_count) replaces the connectome's
        edges with a control's (controls.py); neurons and indices stay the same."""
        self.c = c
        self.params = params
        self.n = c.n
        self.label = label
        if wiring is None:
            self.indptr = np.asarray(c.indptr)
            self.indices = np.asarray(c.indices)
            s = np.asarray(sign if sign is not None else c.sign).astype(np.int32)
            pre = np.repeat(np.arange(self.n, dtype=np.int32), np.diff(self.indptr))
            self.weight = (np.asarray(c.syn_count, dtype=np.float64) * s[pre]) * params.w_syn_mV
            del pre
        else:
            indptr, indices, signed = wiring
            if indptr.size != self.n + 1 or indices.size != signed.size or int(indptr[-1]) != indices.size:
                raise ValueError("control wiring does not fit the connectome's neurons")
            self.indptr, self.indices = indptr, indices
            self.weight = signed.astype(np.float64) * params.w_syn_mV
        p = params
        self.dt = p.dt_ms
        self.ev = math.exp(-p.dt_ms / p.t_mbr_ms)
        self.eg = math.exp(-p.dt_ms / p.tau_ms)
        # u(t+dt) = (u - A g) e^{-dt/t_mbr} + A g e^{-dt/tau}, with u = v - v_0.
        self.A = p.tau_ms / (p.tau_ms - p.t_mbr_ms) if p.tau_ms != p.t_mbr_ms else None
        self.ref_steps = steps(p.t_rfc_ms, p.dt_ms)
        self.delay_steps = steps(p.t_dly_ms, p.dt_ms)

    def describe(self) -> dict:
        return {
            "wiring": self.label,
            "neurons": self.n,
            "pairs": int(self.indices.size),
            "dt_ms": self.dt,
            "refractory_steps": self.ref_steps,
            "delay_steps": self.delay_steps,
        }


@dataclass
class Trial:
    counts: np.ndarray
    steps: int
    spikes_logged: np.ndarray  # (k, 2) int64: step, neuron
    spikes_dropped: int
    population_bins: dict[str, np.ndarray]
    bin_ms: float
    active_neurons: int
    total_spikes: int


class State:
    """Everything a run needs to continue bit for bit: membrane, conductance, timing, queue, RNG."""

    def __init__(self, net: Network, rng: np.random.Generator):
        n = net.n
        p = net.params
        self.step = 0
        self.v = np.full(n, p.v_0_mV, dtype=np.float64)
        self.g = np.zeros(n, dtype=np.float64)
        self.last = np.full(n, -(10**9), dtype=np.int64)
        self.ref = np.full(n, net.ref_steps, dtype=np.int64)
        self.touched = np.zeros(n, dtype=bool)
        self.active = np.zeros(0, dtype=np.int64)
        self.queue: list[list[tuple[np.ndarray, np.ndarray]]] = [[] for _ in range(net.delay_steps + 1)]
        self.rng = rng

    def to_arrays(self) -> dict:
        slots, tgts, ws = [], [], []
        for k, slot in enumerate(self.queue):
            for t, w in slot:
                slots.append(np.full(t.size, k, dtype=np.int64))
                tgts.append(t)
                ws.append(w)
        cat = lambda xs, dt: np.concatenate(xs) if xs else np.zeros(0, dtype=dt)  # noqa: E731
        return {
            "schema": np.array(CHECKPOINT_SCHEMA),
            "step": np.array(self.step),
            "v": self.v,
            "g": self.g,
            "last": self.last,
            "ref": self.ref,
            "touched": self.touched,
            "active": self.active,
            "queue_slot": cat(slots, np.int64),
            "queue_target": cat(tgts, np.int64),
            "queue_weight": cat(ws, np.float64),
            "rng_state": np.array(repr(self.rng.bit_generator.state)),
        }

    @classmethod
    def from_arrays(cls, net: Network, a: dict) -> "State":
        if str(a["schema"]) != CHECKPOINT_SCHEMA:
            raise ValueError(f"checkpoint is {a['schema']}, not {CHECKPOINT_SCHEMA}")
        rng = np.random.Generator(np.random.PCG64())
        import ast

        rng.bit_generator.state = ast.literal_eval(str(a["rng_state"]))
        s = cls(net, rng)
        s.step = int(a["step"])
        s.v[:] = a["v"]
        s.g[:] = a["g"]
        s.last[:] = a["last"]
        s.ref[:] = a["ref"]
        s.touched[:] = a["touched"]
        s.active = np.array(a["active"], dtype=np.int64)
        for k in np.unique(a["queue_slot"]):
            m = a["queue_slot"] == k
            s.queue[int(k)].append((np.array(a["queue_target"][m]), np.array(a["queue_weight"][m])))
        return s


def _touch(state: State, idx: np.ndarray) -> None:
    new = idx[~state.touched[idx]]
    if new.size:
        new = np.unique(new)
        state.touched[new] = True
        state.active = np.concatenate([state.active, new])


def _writable(state: State, idx: np.ndarray, step: int) -> np.ndarray:
    """Brian 2's ``not_refractory`` during the synapses slot: false in the step a
    neuron spikes (the thresholder clears it) and until its refractory period ends."""
    last = state.last[idx]
    return (last != step) & ((step - last) >= state.ref[idx])


def _gather(net: Network, spk: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    starts = net.indptr[spk]
    lens = net.indptr[spk + 1] - starts
    total = int(lens.sum())
    if total == 0:
        return np.zeros(0, dtype=np.int64), np.zeros(0)
    offs = np.repeat(starts - np.cumsum(lens) + lens, lens) + np.arange(total)
    return net.indices[offs].astype(np.int64), net.weight[offs]


def run(
    net: Network,
    stim: Stimulus,
    duration_ms: float,
    *,
    rng: np.random.Generator | None = None,
    state: State | None = None,
    populations: dict[str, np.ndarray] | None = None,
    bin_ms: float = 10.0,
    max_logged_spikes: int = 0,
    log_neurons: np.ndarray | None = None,
    budget: Budget | None = None,
    stop_at_step: int | None = None,
) -> tuple[Trial, State]:
    """Simulate ``duration_ms`` from ``state`` (or from rest). Returns the trial and the final state.

    ``stop_at_step`` ends early at that step (for checkpoint tests); the state
    returned then continues exactly where it stopped."""
    p = net.params
    n = net.n
    state = state or State(net, rng or np.random.default_rng())
    total_steps = steps(duration_ms, p.dt_ms)
    end = total_steps if stop_at_step is None else min(stop_at_step, total_steps)
    w_poi = p.poisson_weight_mV
    silenced = np.zeros(n, dtype=bool)
    silenced[np.asarray(stim.silenced, dtype=np.int64)] = True
    for pg in stim.poisson:
        state.ref[np.asarray(pg.indices, dtype=np.int64)] = 0
    for k in stim.kicks.values():
        state.ref[np.asarray(k, dtype=np.int64)] = 0
    counts = np.zeros(n, dtype=np.int64)
    populations = populations or {}
    n_bins = max(1, math.ceil(total_steps * p.dt_ms / bin_ms))
    pop_bins = {name: np.zeros(n_bins, dtype=np.int64) for name in populations}
    pop_member = {name: np.isin(np.arange(n), idx) for name, idx in populations.items()}
    log_mask = None
    if log_neurons is not None:
        log_mask = np.zeros(n, dtype=bool)
        log_mask[np.asarray(log_neurons, dtype=np.int64)] = True
    logged: list[np.ndarray] = []
    n_logged = 0
    dropped = 0
    L = len(state.queue)
    v0 = p.v_0_mV
    ev, eg, A = net.ev, net.eg, net.A
    dt_over_tau = p.dt_ms / p.tau_ms
    check_every = budget.check_every_steps if budget else 1000

    while state.step < end:
        step = state.step
        act = state.active
        # 1. groups: integrate the non-refractory active neurons.
        if act.size:
            free = (step - state.last[act]) >= state.ref[act]
            idx = act[free] if not free.all() else act
            g = state.g[idx]
            u = state.v[idx] - v0
            if A is not None:
                state.v[idx] = v0 + (u - A * g) * ev + A * g * eg
            else:  # tau == t_mbr: the degenerate solution
                state.v[idx] = v0 + (u + g * dt_over_tau) * ev
            state.g[idx] = g * eg
            # 2. thresholds
            fired = idx[state.v[idx] > p.v_th_mV]
        else:
            fired = np.zeros(0, dtype=np.int64)
        if fired.size:
            state.last[fired] = step
            counts[fired] += 1
            b = min(int(step * p.dt_ms / bin_ms), n_bins - 1)
            for name, member in pop_member.items():
                pop_bins[name][b] += int(member[fired].sum())
            if max_logged_spikes:
                sel = fired if log_mask is None else fired[log_mask[fired]]
                room = max_logged_spikes - n_logged
                if sel.size > room:
                    dropped += sel.size - room
                    sel = sel[:room]
                if sel.size:
                    logged.append(np.stack([np.full(sel.size, step, dtype=np.int64), sel.astype(np.int64)], axis=1))
                    n_logged += sel.size
            # 3a. queue this step's spikes for delivery t_dly later.
            src = fired[~silenced[fired]]
            if src.size:
                tgt, w = _gather(net, src)
                if tgt.size:
                    state.queue[(step + net.delay_steps) % L].append((tgt, w))
        # 3b. deliver what is due now, to neurons that are not refractory.
        slot = state.queue[step % L]
        if slot:
            for tgt, w in slot:
                ok = _writable(state, tgt, step)
                if not ok.all():
                    tgt, w = tgt[ok], w[ok]
                np.add.at(state.g, tgt, w)
                _touch(state, tgt)
            state.queue[step % L] = []
        # 3c. Poisson input and deterministic kicks (same conditional write on v).
        for pg in stim.poisson:
            r = pg.rate_at(step, p.dt_ms)
            if r > 0:
                hit = np.asarray(pg.indices, dtype=np.int64)[state.rng.random(len(pg.indices)) < r * p.dt_ms * 1e-3]
                hit = hit[_writable(state, hit, step)]
                if hit.size:
                    np.add.at(state.v, hit, w_poi)
                    _touch(state, hit)
        kick = stim.kicks.get(step)
        if kick is not None and len(kick):
            kick = np.asarray(kick, dtype=np.int64)
            kick = kick[_writable(state, kick, step)]
            np.add.at(state.v, kick, w_poi)
            _touch(state, kick)
        # 4. resets
        if fired.size:
            state.v[fired] = p.v_rst_mV
            state.g[fired] = 0.0
        state.step += 1
        if state.step % check_every == 0:
            if act.size and not (np.isfinite(state.v[act]).all() and np.isfinite(state.g[act]).all()):
                raise NumericalInstability(f"non-finite membrane state at step {state.step}")
            if budget:
                budget.check()

    spikes = np.concatenate(logged) if logged else np.zeros((0, 2), dtype=np.int64)
    trial = Trial(
        counts=counts,
        steps=end,
        spikes_logged=spikes,
        spikes_dropped=dropped,
        population_bins=pop_bins,
        bin_ms=bin_ms,
        active_neurons=int(state.active.size),
        total_spikes=int(counts.sum()),
    )
    return trial, state


def save_checkpoint(path, state: State) -> None:
    np.savez(path, **state.to_arrays())


def load_checkpoint(path, net: Network) -> State:
    with np.load(path, allow_pickle=False) as a:
        return State.from_arrays(net, {k: a[k] for k in a.files})
