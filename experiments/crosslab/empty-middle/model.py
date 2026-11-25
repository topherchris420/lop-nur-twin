"""Mediator-mode model for the empty-middle study (rain-c1-empty-middle-v1).

One atom starts in a trap at A. A second trap at B and the modes of a
mediator sit between them. Units are SI with hbar = 1: every energy is an
angular frequency in rad/s and every time is in seconds. The resonant mediator
mode sits at zero energy; the traps are tuned to it before each seed's
quasi-static offsets are added.

    H(t) = sum_k E_k |k><k| + dA |A><A| + dB |B><B|
         + sum_k [OmegaA(t) rA_k |A><k| + OmegaB(t) rB_k |B><k| + h.c.]

r_k is mode k's amplitude at the trap's coupling point divided by the
resonant mode's amplitude there, so Omega is the coupling to the resonant mode.
Pulses run B side first:

    OmegaB(t) = Omega exp(-(t - 7T/16)^2 / s^2)
    OmegaA(t) = Omega exp(-(t - 9T/16)^2 / s^2),   s = T/8

Modes within +-window*Omega of resonance are integrated explicitly. Every other
mode is far detuned (|E_k| > 100 Omega >> 1/s) and enters by adiabatic
elimination: a second-order shift and exchange on A and B, and its population
-(OmegaA rA_k cA + OmegaB rB_k cB) / E_k counted in the middle occupation.
"""

from dataclasses import dataclass
import math

import numpy as np

H = 6.62607015e-34
HBAR = H / (2 * math.pi)
DALTON = 1.66053906660e-27
MASS = 39.964 * DALTON  # potassium-40, as registered
MICRON = 1e-6
LATTICE_SPACING = 0.532 * MICRON
GUIDE_MARGIN = 1.0 * MICRON  # G1 and G2 guide length is d + 1 um
G1_INSET = 0.5 * MICRON  # G1 couples this far inside each guide end
TAIL_TERMS_MIN = 100_000


def guide_ground(length):
    """Lowest-mode energy (rad/s) of a hard-wall 1D guide of this length."""
    return HBAR * math.pi**2 / (2 * MASS * length**2)


@dataclass(frozen=True)
class Spectrum:
    """A mediator's modes relative to the realized resonance.

    energies, rA and rB are listed for every mode the model keeps, including
    the resonant one (energy 0, r = 1 at both traps unless the geometry flips
    a sign). tail_AA and tail_BB add the part of sum r^2/E beyond the last
    listed mode for a guide, whose spectrum is unbounded.
    """

    energies: np.ndarray
    rA: np.ndarray
    rB: np.ndarray
    resonant: int
    tail_AA: float = 0.0
    tail_BB: float = 0.0
    tail_QAA: float = 0.0
    tail_QBB: float = 0.0

    @property
    def size(self):
        return int(self.energies.size)


def single_mode():
    """G0: one mode at resonance, coupling independent of distance."""
    one = np.ones(1)
    return Spectrum(np.zeros(1), one, one.copy(), 0)


def _guide(length, resonant_n, xA, xB):
    theta = math.pi * min(xA, length - xB) / length
    terms = max(TAIL_TERMS_MIN, int(math.ceil(200 / theta)), 400 * resonant_n)
    n = np.arange(1, terms + 1, dtype=np.float64)
    ground = guide_ground(length)
    energies = ground * (n * n - float(resonant_n) ** 2)
    phiA = np.sin(n * math.pi * xA / length)
    phiB = np.sin(n * math.pi * xB / length)
    rA = phiA / phiA[resonant_n - 1]
    rB = phiB / phiB[resonant_n - 1]
    # Beyond the last mode, E_n ~ ground n^2 and sin^2 averages to 1/2.
    last = float(terms)
    tail_AA = 0.5 / (phiA[resonant_n - 1] ** 2 * ground * last)
    tail_BB = 0.5 / (phiB[resonant_n - 1] ** 2 * ground * last)
    tail_QAA = 0.5 / (phiA[resonant_n - 1] ** 2 * ground**2 * 3 * last**3)
    tail_QBB = 0.5 / (phiB[resonant_n - 1] ** 2 * ground**2 * 3 * last**3)
    return Spectrum(energies, rA, rB, resonant_n - 1, tail_AA, tail_BB, tail_QAA, tail_QBB)


def free_guide_lowest(distance):
    """G1: hard-wall guide of length d + 1 um, lowest mode, couplings 0.5 um in."""
    length = distance + GUIDE_MARGIN
    return _guide(length, 1, G1_INSET, length - G1_INSET)


def fast_mode_number(length, kinetic):
    """Mode number whose energy is nearest the kinetic energy (rad/s)."""
    ground = guide_ground(length)
    guess = max(1, int(round(math.sqrt(kinetic / ground))))
    candidates = [n for n in (guess - 1, guess, guess + 1) if n >= 1]
    return min(candidates, key=lambda n: (abs(ground * n * n - kinetic), n))


def free_guide_fast(distance, kinetic):
    """G2: the same guide, mode nearest E_kin, coupled at its end antinodes."""
    length = distance + GUIDE_MARGIN
    n = fast_mode_number(length, kinetic)
    inset = length / (2 * n)
    return _guide(length, n, inset, length - inset)


def lattice_sites(distance):
    """Smallest odd site count whose span (N - 1) a reaches the distance."""
    sites = int(math.ceil(distance / LATTICE_SPACING - 1e-9)) + 1
    return sites if sites % 2 else sites + 1


def lattice(distance, tunnelling, disorder=None):
    """G3: chain with hopping J, A on the first site, B on the last.

    disorder is the on-site energy of each site in rad/s, or None for a clean
    chain. The resonant mode is the eigenmode nearest zero energy; the traps
    are tuned to its realized energy.
    """
    sites = lattice_sites(distance)
    if disorder is None:
        k = np.arange(1, sites + 1, dtype=np.float64)
        energies = -2 * tunnelling * np.cos(k * math.pi / (sites + 1))
        first = np.sin(k * math.pi / (sites + 1))
        last = np.sin(k * math.pi * sites / (sites + 1))
        resonant = (sites - 1) // 2
        energies[resonant] = 0.0
    else:
        onsite = np.asarray(disorder, dtype=np.float64)[:sites]
        matrix = np.diag(onsite)
        hop = -tunnelling * np.ones(sites - 1)
        matrix += np.diag(hop, 1) + np.diag(hop, -1)
        values, vectors = np.linalg.eigh(matrix)
        resonant = int(np.argmin(np.abs(values)))
        energies = values - values[resonant]
        first = vectors[0, :]
        last = vectors[-1, :]
    rA = first / first[resonant]
    rB = last / last[resonant]
    return Spectrum(energies, rA, rB, resonant)


@dataclass(frozen=True)
class Partition:
    """Explicit modes for one coupling strength, and the far-mode sums."""

    energies: np.ndarray
    rA: np.ndarray
    rB: np.ndarray
    S_AA: float
    S_BB: float
    S_AB: float
    Q_AA: float
    Q_BB: float
    Q_AB: float


def partition(spectrum, omega, window):
    """Keep modes with |E| <= window * omega * max(1, |rA|, |rB|); eliminate the rest.

    Scaling the window by a mode's own relative coupling keeps every eliminated
    mode's coupling under 1/window of its detuning, the condition elimination
    needs. It matters in G1, whose lowest mode is small near the guide's ends,
    so the traps couple to higher modes up to L / (pi * 0.5 um) times harder.
    """
    reach = np.maximum(1.0, np.maximum(np.abs(spectrum.rA), np.abs(spectrum.rB)))
    near = np.abs(spectrum.energies) <= window * omega * reach
    near[spectrum.resonant] = True
    far = ~near
    E = spectrum.energies[far]
    rA = spectrum.rA[far]
    rB = spectrum.rB[far]
    return Partition(
        spectrum.energies[near],
        spectrum.rA[near],
        spectrum.rB[near],
        float(np.sum(rA * rA / E)) + spectrum.tail_AA,
        float(np.sum(rB * rB / E)) + spectrum.tail_BB,
        float(np.sum(rA * rB / E)),
        float(np.sum(rA * rA / (E * E))) + spectrum.tail_QAA,
        float(np.sum(rB * rB / (E * E))) + spectrum.tail_QBB,
        float(np.sum(rA * rB / (E * E))),
    )


def pulses(tau, area, reverse=False):
    """OmegaA T and OmegaB T at scaled times tau = t / T."""
    early = area * np.exp(-64.0 * (tau - 7.0 / 16.0) ** 2)
    late = area * np.exp(-64.0 * (tau - 9.0 / 16.0) ** 2)
    return (early, late) if reverse else (late, early)


@dataclass
class Run:
    """A batch of rows (one setting and one seed each) run together."""

    arrival: np.ndarray  # |cB(T)|^2 per row, before the loss factor
    middle: np.ndarray  # P_mid(t) per row at the sample times, shape (rows, samples)
    norm_error: np.ndarray  # | |psi(T)|^2 - 1 | per row
    steps: int
    explicit_modes: np.ndarray  # explicit mode count per row


def _sub_basis(rA, rB):
    """Orthonormal basis of span{rA, rB} and the coefficients of rA, rB in it."""
    a_norm = float(np.linalg.norm(rA))
    e1 = rA / a_norm
    along = float(e1 @ rB)
    rest = rB - along * e1
    rest_norm = float(np.linalg.norm(rest))
    if rest_norm <= 1e-12 * max(1.0, float(np.linalg.norm(rB))):
        return np.stack([e1]), np.array([[a_norm], [along]])
    e2 = rest / rest_norm
    return np.stack([e1, e2]), np.array([[a_norm, 0.0], [along, rest_norm]])


def required_steps(part, offsets, duration, samples=4001, max_phase=0.5):
    """Smallest multiple of samples - 1 with max |E| dt <= max_phase."""
    fastest = float(np.max(np.abs(part.energies))) * duration
    fastest = max(fastest, float(np.max(np.abs(offsets))) * duration)
    intervals = samples - 1
    return max(1, int(math.ceil(fastest / (max_phase * intervals)))) * intervals


def propagate(parts, offsets, omegas, durations, steps, samples=4001, reverse=False):
    """Integrate a batch of rows on one step grid.

    Row i has its own Partition, trap offsets (dA, dB in rad/s), coupling
    omega and duration T. Time is scaled by each row's T, so every row runs
    on tau in [0, 1] with the same steps. The integrator is a Strang split:
    exact phases from the diagonal, then an exact exponential of the coupling,
    which lives in the span of A, B, rA and rB. Rows with fewer explicit modes
    are padded with uncoupled modes that stay empty.
    """
    rows = len(parts)
    intervals = samples - 1
    if steps % intervals:
        raise ValueError("steps must be a multiple of samples - 1")
    per = steps // intervals
    dt = 1.0 / steps
    offsets = np.asarray(offsets, dtype=np.float64).reshape(rows, 2)
    omegas = np.asarray(omegas, dtype=np.float64).reshape(rows)
    durations = np.asarray(durations, dtype=np.float64).reshape(rows)
    areas = omegas * durations
    counts = np.array([p.energies.size for p in parts])
    modes = int(counts.max())

    diag = np.zeros((rows, 2 + modes))
    diag[:, 0] = offsets[:, 0] * durations
    diag[:, 1] = offsets[:, 1] * durations
    width = 1
    bases = []
    coeffs = []
    for i, p in enumerate(parts):
        diag[i, 2 : 2 + p.energies.size] = p.energies * durations[i]
        basis, coeff = _sub_basis(p.rA, p.rB)
        bases.append(basis)
        coeffs.append(coeff)
        width = max(width, basis.shape[0])
    basis = np.zeros((rows, width, modes))
    coeff = np.zeros((rows, 2, width))
    for i in range(rows):
        basis[i, : bases[i].shape[0], : counts[i]] = bases[i]
        coeff[i, :, : coeffs[i].shape[1]] = coeffs[i]
    half = np.exp(-0.5j * diag * dt)
    full = half * half
    S = np.array([[p.S_AA, p.S_BB, p.S_AB] for p in parts]) / durations[:, None]
    Q = np.array([[p.Q_AA, p.Q_BB, p.Q_AB] for p in parts]) / durations[:, None] ** 2

    psi = np.zeros((rows, 2 + modes), dtype=np.complex128)
    psi[:, 0] = 1.0
    middle = np.empty((rows, samples))

    def record(index, tau, state):
        a, b = pulses(tau, areas, reverse)
        cA = state[:, 0]
        cB = state[:, 1]
        far = (
            a * a * Q[:, 0] * np.abs(cA) ** 2
            + b * b * Q[:, 1] * np.abs(cB) ** 2
            + 2 * a * b * Q[:, 2] * np.real(np.conj(cA) * cB)
        )
        middle[:, index] = np.sum(np.abs(state[:, 2:]) ** 2, axis=1) + far

    record(0, 0.0, psi)
    dim = 2 + width
    chunk = max(1, min(2048, 2_000_000 // (rows * dim * dim)))
    step = 0
    while step < steps:
        count = min(chunk, steps - step)
        tau = (np.arange(step, step + count) + 0.5) * dt
        a, b = pulses(tau[:, None], areas[None, :], reverse)
        # Coupling matrix in the basis [A, B, e1, e2] for each step and row.
        M = np.zeros((count, rows, dim, dim))
        M[:, :, 0, 2:] = a[:, :, None] * coeff[None, :, 0, :]
        M[:, :, 1, 2:] = b[:, :, None] * coeff[None, :, 1, :]
        M[:, :, 2:, 0] = M[:, :, 0, 2:]
        M[:, :, 2:, 1] = M[:, :, 1, 2:]
        M[:, :, 0, 0] = -a * a * S[None, :, 0]
        M[:, :, 1, 1] = -b * b * S[None, :, 1]
        M[:, :, 0, 1] = -a * b * S[None, :, 2]
        M[:, :, 1, 0] = M[:, :, 0, 1]
        values, vectors = np.linalg.eigh(M)
        phases = np.exp(-1j * values * dt)
        U = np.einsum("trij,trj,trkj->trik", vectors, phases, vectors)
        for i in range(count):
            n = step + i
            psi *= half if n == 0 else full
            proj = np.einsum("rm,rwm->rw", psi[:, 2:], basis)
            sub = np.concatenate([psi[:, :2], proj], axis=1)
            new = np.einsum("rij,rj->ri", U[i], sub)
            psi[:, 2:] += np.einsum("rw,rwm->rm", new[:, 2:] - proj, basis)
            psi[:, :2] = new[:, :2]
            if (n + 1) % per == 0 and n + 1 < steps:
                # The state at (n + 1) dt is this one after its closing half kick.
                record((n + 1) // per, (n + 1) * dt, psi * half)
        step += count
    psi *= half
    record(intervals, 1.0, psi)
    norms = np.sum(np.abs(psi) ** 2, axis=1)
    return Run(
        arrival=np.abs(psi[:, 1]) ** 2,
        middle=middle,
        norm_error=np.abs(norms - 1.0),
        steps=steps,
        explicit_modes=counts,
    )
