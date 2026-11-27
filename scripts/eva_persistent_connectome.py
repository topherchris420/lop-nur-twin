"""Eva's authoritative garden clock with a body-bound BANC checkpoint in the same SQLite commit.

Use an existing, offline world database. First attachment must be explicit;
ordinary opens require both the body and its matching neural state.
"""
import argparse
import json
import math
import os
import random
import sys
import sqlite3
from pathlib import Path

from fly_neural.persistent import Brain, Model, canonical, digest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "deploy/garden/service"))
import eva_plasticity
import learning
from server import PLACES, World


class MotorBridge(eva_plasticity.Plasticity):
    """Use Eva's existing travel hook, with her prior learned state when present."""
    def __init__(self, memory, state, db_path):
        mode = memory["mode"] if memory else "shadow"
        super().__init__(mode, Path(db_path).with_name("eva" + eva_plasticity.SIDECAR_SUFFIX), db_path)
        self.signals = {}
        if memory:
            self.state = eva_plasticity.check(memory)
            if (memory["life_id"], memory["born_at"]) != (state["life_id"], state["born_at"]):
                raise ValueError("plasticity checkpoint belongs to a different garden life")
            if memory["last_tick"] is not None and memory["last_tick"] > state["ticks"]:
                raise ValueError("plasticity checkpoint is ahead of its body")

    def bind(self, life):
        pass  # Already validated against the body before World resumes.

    def choose(self, life, weather, baseline):
        motion = super().choose(life, weather, baseline)
        if self.signals.get("walk", {}).get("predicted"):
            return "walk"
        return motion

    def save(self):
        pass  # ConnectomeWorld._save commits this state with the body and brain.



def body_marker(state):
    return digest(canonical(state))


def garden_senses(state, weather, start, prior):
    """Planar model, six metres per map unit, using only pre-decision geometry."""
    x, y = state["position"]
    yaw = prior["yaw"] if prior else 0.
    if prior and math.dist((x, y), prior["position"]) > 1e-6:
        yaw = math.atan2(y - prior["position"][1], x - prior["position"][0])
    # Diameter from the exhibit's 2.5 mm midge. Its independent trajectory is
    # sampled on the same garden clock. A planar projection has no occlusion.
    ox, oy = learning.objects_at(start)["drifting_midge"]
    angle = math.atan2(oy - y, ox - x) - yaw
    bearing = math.atan2(math.sin(angle), math.cos(angle))
    size = math.degrees(2 * math.atan2(.00125, 6 * math.hypot(ox - x, oy - y)))
    elapsed = start - prior["at"] if prior else 0
    speed = expansion = 0.
    if elapsed > 0:
        delta = bearing - prior["bearing"]
        speed = math.degrees(math.atan2(math.sin(delta), math.cos(delta))) / elapsed
        expansion = max(0., (size - prior["size"]) / elapsed)
    distances = [6 * math.dist((x, y), (PLACES[p]["x"], PLACES[p]["y"])) for p in ("flowers", "pear")]
    contact = state["travel"] is None and min(distances) <= .072
    # An explicitly modelled food field (0.12 m decay length), independent
    # of whether the fly has chosen to feed. Weather is an ambient wind proxy.
    obs = {"onFood": contact, "airflow": weather["wind"] / 3.6, "odour": math.exp(-min(distances) / .12),
           "looming": {"sizeDeg": size, "expansionDegS": expansion, "bearing": bearing},
           "smallObject": {"sizeDeg": size, "speedDegS": speed, "bearing": bearing}}
    return obs, {"at": start, "position": [x, y], "bearing": bearing, "size": size, "yaw": yaw}


class ConnectomeWorld(World):
    def __init__(self, db_path, model, individual, *, attach=False, memory=None):
        # Read before World's constructor can initialize or save anything.
        uri = Path(db_path).resolve().as_uri() + "?mode=ro"
        conn = sqlite3.connect(uri, uri=True)
        try:
            conn.execute("BEGIN")
            row = conn.execute("SELECT value FROM world WHERE id=1").fetchone()
            if not row:
                raise ValueError("an existing garden life is required")
            state = json.loads(row[0])
            if state["life_id"] != individual:
                raise ValueError("wrong garden individual")
            exists = conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='neural_state'").fetchone()
            if bool(exists) == attach:
                raise ValueError("attach once to an existing body; resume requires its neural checkpoint")
            self.brain = Brain(model, individual)
            self.eye = None
            if exists:
                if memory is not None:
                    raise ValueError("resume already contains its plasticity memory")
                payload = conn.execute("SELECT payload FROM neural_state WHERE id=1").fetchone()
                if not payload:
                    raise ValueError("missing neural checkpoint")
                entry = json.loads(payload[0])
                memory = entry["plasticity"]
                self.eye = entry["eye"]
                self.brain.restore(entry["neural"], body_marker([state, memory, self.eye]))
            if individual == "5cf42cd6-fd0a-474d-882c-4cb70e0357e8" and memory is None:
                raise ValueError("Eva's original also requires her plasticity sidecar")
            self.plasticity = MotorBridge(memory, state, db_path)
        finally:
            conn.close()
        # A rehearsal resumes at the stored timestamp, independent of wall time.
        super().__init__(db_path, now=state["updated_at"])

    def _save(self):
        self.db.execute("CREATE TABLE IF NOT EXISTS neural_state (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL)")
        if self.plasticity.problem:
            raise ValueError(self.plasticity.problem)
        memory = self.plasticity.state
        checkpoint = {"neural": self.brain.pack(body_marker([self.state, memory, self.eye])), "plasticity": memory, "eye": self.eye}
        self.db.execute("INSERT OR REPLACE INTO neural_state VALUES(1, ?)", (json.dumps(checkpoint),))
        super()._save()  # body, neural state and outstanding moments commit together

    def _step(self, now, dt):
        s = self.state
        sensory, self.eye = garden_senses(s, self.effective_weather(now - dt), now - dt, self.eye)
        signals = self.brain.step(sensory, dt * 1000)
        self.plasticity.signals = signals
        if s["travel"] is None and s["activity"] not in ("drinking", "sleeping"):
            if signals["escape"]["predicted"] or signals["jump"]["predicted"]:
                # Eva has route flight, with no separate jump primitive. The
                # neural reflex can initiate departure; her physics flies it.
                shelters = [p for p in ("leaf", "window") if p != s["place"]]
                target = min(shelters, key=lambda p: math.dist(s["position"], (PLACES[p]["x"], PLACES[p]["y"])))
                self._depart(target, now - dt, random.Random(f"neural:{s['seed']}:{s['ticks']}"))
            elif sensory["onFood"] and signals["feed"]["predicted"]:
                s["activity"] = "feeding"
            elif signals["groom"]["predicted"]:
                s["activity"] = "grooming"
        super()._step(now, dt)


def main():
    parser = argparse.ArgumentParser(description="Advance a private rehearsal database by complete five-second garden ticks.")
    parser.add_argument("--db", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True, help="new private SQLite copy; input is opened read-only")
    parser.add_argument("--plasticity", type=Path, help="matching existing garden plasticity sidecar on first attach")
    parser.add_argument("--model-root", type=Path, required=True)
    parser.add_argument("--individual", required=True)
    parser.add_argument("--attach", action="store_true")
    parser.add_argument("--ticks", type=int, required=True)
    args = parser.parse_args()
    if not 0 <= args.ticks <= 1000:
        parser.error("ticks must be between zero and 1000")
    memory = json.loads(args.plasticity.read_text()) if args.plasticity else None
    model = Model(args.model_root)
    # Publish only a complete rehearsal. A failed attempt leaves the input
    # usable and the final destination absent. Exclusive link avoids clobber.
    import tempfile
    with tempfile.TemporaryDirectory(dir=args.out.parent) as tmp:
        work = Path(tmp) / "copy.sqlite"
        source = sqlite3.connect(args.db.resolve().as_uri() + "?mode=ro", uri=True)
        dest = sqlite3.connect(work)
        try:
            source.backup(dest)
        finally:
            dest.close()
            source.close()
        world = ConnectomeWorld(work, model, args.individual, attach=args.attach, memory=memory)
        try:
            world.advance(world.state["updated_at"] + 5 * args.ticks)
            result = {"individual": world.state["life_id"], "body_tick": world.state["ticks"],
                      "brain_step": world.brain.state.step, "model": world.brain.model.pin}
        finally:
            world.close()
        os.chmod(work, 0o600)
        os.link(work, args.out)
        directory = os.open(args.out.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
        print(json.dumps(result))


if __name__ == "__main__":
    main()
