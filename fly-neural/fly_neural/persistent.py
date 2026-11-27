"""Continuous BANC integration and body-bound, self-contained neural checkpoints.

Run with python -m fly_neural.persistent DATA_ROOT for a local JSON-lines peer.
The host owns the body's clock, motor gate and atomic checkpoint transaction.
"""
import base64
import hashlib
import io
import json
import math
import sys
from pathlib import Path

import numpy as np

from . import banc, connectome, lif, sensory
from .populations import resolve

SCHEMA = "banc-body-continuation/v1"


def canonical(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def digest(data):
    return hashlib.sha256(data).hexdigest()


class Model:
    """Immutable graph and matched population assignments, shareable across individuals."""

    def __init__(self, root):
        root = Path(root)
        _, record = banc.reviewed_files(root)
        graph = connectome.load(root / "compiled" / banc.COMPILED_NAME, verify_hashes=True)
        compiled_pin = graph.manifest.get("inputs", {})
        if (not compiled_pin.get("reviewed") or compiled_pin["pin"]["files"] != record["files"]
                or graph.manifest.get("sign_policy") != banc.SIGN_POLICY):
            raise ValueError("compiled graph does not match the reviewed BANC import")
        self.mapper = sensory.Mapper(graph, sensory.V3, resolver=lambda key, c: resolve(key, c, root))
        missing = [key for key, ids in self.mapper.idx.items() if not len(ids)]
        if missing:
            raise ValueError(f"missing BANC populations: {missing}")
        self.net = lif.Network(graph)
        self.pin = digest(canonical([connectome.arrays_digest(graph), self.net.params.as_dict(),
                                     banc.REVIEWED["files"]["neurons"]["sha256"],
                                     {k: digest(np.asarray(v, dtype="<i8").tobytes()) for k,v in self.mapper.idx.items()}, sensory.V3, SCHEMA]))


class Brain:
    def __init__(self, model, individual):
        if not isinstance(individual, str) or not individual:
            raise ValueError("missing individual")
        self.model = model
        self.individual = individual
        seed = int(digest(individual.encode())[:16], 16)
        self.state = lif.State(model.net, np.random.default_rng(seed))
        self.readout = sensory.TrailingReadout(model.mapper.idx, mapping=sensory.V3)

    def step(self, obs, duration_ms):
        # Even a five-second garden step consists of full neural integration
        # steps. Keep the decoder's trailing window independent of host cadence.
        if not math.isfinite(duration_ms) or not 0 < duration_ms <= 5000.001:
            raise ValueError("invalid neural interval")
        stim = lif.Stimulus(poisson=self.model.mapper.poisson(sensory.observation(obs)))
        dt = self.model.net.dt
        ticks = round(duration_ms / dt)
        if ticks <= 0 or abs(ticks * dt - duration_ms) > 1e-5:
            raise ValueError("empty neural interval")
        end = self.state.step + ticks
        reflex = {"escape": 0, "jump": 0}
        while self.state.step < end:
            start = self.state.step
            stop = min(end, start + round(10 / dt))
            trial, self.state = lif.run(self.model.net, stim, stop * dt, state=self.state)
            out = self.readout.update(trial.counts, (stop - start) * dt)
            for key in reflex:
                reflex[key] += out[key]["spikes"]
        for key, count in reflex.items():
            out[key]["predicted"] = count > 0
            out[key]["spikes"] = count
            cells = sum(len(self.model.mapper.idx[k]) for k in self.readout.readouts[key]["populations"])
            out[key]["mean_rate_hz"] = round(count / max(1, cells) / (ticks * dt / 1000), 3)
        return out

    def pack(self, body):
        history = [[width, counts, fired.tolist()] for width, counts, fired in self.readout.hist]
        meta = canonical([SCHEMA, self.model.pin, self.individual, body, history])
        buf = io.BytesIO()
        np.savez_compressed(buf, binding=np.frombuffer(meta, dtype=np.uint8), **self.state.to_arrays())
        data = buf.getvalue()
        return {"sha256": digest(data), "data": base64.b64encode(data).decode()}

    def restore(self, package, body):
        data = base64.b64decode(package["data"], validate=True)
        if digest(data) != package["sha256"]:
            raise ValueError("neural checkpoint checksum mismatch")
        with np.load(io.BytesIO(data), allow_pickle=False) as arrays:
            schema, pin, who, marker, history = json.loads(arrays["binding"].tobytes())
            if [schema, pin, who, marker] != [SCHEMA, self.model.pin, self.individual, body]:
                raise ValueError("neural checkpoint belongs to a different model, individual or body checkpoint")
            restored = lif.State.from_arrays(self.model.net, arrays)
        window = sensory.TrailingReadout(self.model.mapper.idx, mapping=sensory.V3)
        window.hist.extend((width, counts, np.asarray(ids, dtype=np.int64)) for width, counts, ids in history)
        self.state, self.readout = restored, window


def serve(root, inp=sys.stdin, out=sys.stdout):
    head = json.loads(inp.readline())
    brain = Brain(Model(root), head["individual"])
    if "checkpoint" in head:
        brain.restore(head["checkpoint"], head["body"])
    print(json.dumps({"ready": True, "pin": brain.model.pin}), file=out, flush=True)
    for line in inp:
        req = json.loads(line)
        if req.get("bye"):
            break
        if "pack" in req:
            answer = {"checkpoint": brain.pack(req["pack"])}
        else:
            answer = {"readouts": brain.step(req["obs"], req["duration_ms"])}
        print(json.dumps(answer, allow_nan=False), file=out, flush=True)


if __name__ == "__main__":
    try:
        serve(Path(sys.argv[1]))
    except Exception as error:
        print(json.dumps({"error": str(error)}), flush=True)
        raise SystemExit(1)
