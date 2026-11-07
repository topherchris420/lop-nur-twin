#!/usr/bin/env python3
"""One persistent, spectator-independent life. Python standard library only."""
import copy
import json
import logging
import math
import os
import random
import signal
import sqlite3
import threading
import time
import uuid
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo
import learning
import eva_plasticity  # eva-plasticity

TZ = ZoneInfo("America/New_York")
PLACES = {
    "leaf": {"name": "Under the maple leaf", "x": .29, "y": .38, "sheltered": True},
    "window": {"name": "The warm windowsill", "x": .82, "y": .375, "sheltered": True},
    "flowers": {"name": "The last of the asters", "x": .68, "y": .63},
    "pear": {"name": "A fallen pear", "x": .24, "y": .79},
    "water": {"name": "The rain saucer", "x": .51, "y": .83},
    "fence": {"name": "The cedar fence", "x": .13, "y": .53},
    "stone": {"name": "A sun-warmed stone", "x": .77, "y": .85},
}
ARRIVALS = {
    "leaf": ["Finds the small, sheltered world beneath a maple leaf.", "Tucks into a familiar fold of green."],
    "window": ["Lands on the windowsill, where a little warmth lingers.", "The window holds a small square of borrowed warmth."],
    "flowers": ["Finds a little sweetness in the late asters.", "Visits the asters. There is still something here."],
    "pear": ["A fallen pear offers more than enough for one fly.", "Returns to the pear and its soft, sweet edge."],
    "water": ["Takes a drink from the rain saucer.", "Finds a bead of water on the saucer's rim."],
    "fence": ["Lands on the cedar fence and feels the air.", "Tries a different patch of the old fence."],
    "stone": ["Settles on a smooth stone beside the path.", "Rests where the garden meets the path."],
}


def seasonal_weather(now):
    local = datetime.fromtimestamp(now, TZ)
    temperatures = [3, 5, 10, 17, 22, 27, 30, 29, 25, 18, 11, 6]
    return {"temperature": temperatures[local.month - 1] - (7 if local.hour < 8 or local.hour > 18 else 0),
            "code": 2, "wind": 7, "rain": 0, "fetched_at": 0, "source": "seasonal", "sun": {}}


def daylight(now, weather):
    local = datetime.fromtimestamp(now, TZ)
    sun = weather.get("sun", {}).get(local.strftime("%Y-%m-%d"))
    if sun:
        return sun[0] <= now < sun[1]
    hours = 12 + 2.6 * math.sin(2 * math.pi * (local.timetuple().tm_yday - 80) / 365.25)
    noon = 12.15 + local.dst().total_seconds() / 3600
    return noon - hours / 2 <= local.hour + local.minute / 60 < noon + hours / 2


def weather_name(code):
    if code == 0:
        return "clear skies"
    if code in (1, 2):
        return "partly cloudy"
    if code == 3:
        return "overcast"
    if code in (45, 48):
        return "a little fog"
    if 51 <= code <= 67 or 80 <= code <= 82:
        return "rain in the garden"
    if 71 <= code <= 77 or code in (85, 86):
        return "snow in Bethesda"
    if code >= 95:
        return "a passing storm"
    return "changing skies"


class World:
    plasticity = None  # eva-plasticity
    def __init__(self, db_path, now=None):
        now = time.time() if now is None else now
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.db = sqlite3.connect(str(db_path), check_same_thread=False)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.execute("CREATE TABLE IF NOT EXISTS world (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)")
        self.db.execute("CREATE TABLE IF NOT EXISTS moments (id INTEGER PRIMARY KEY, at REAL NOT NULL, words TEXT NOT NULL)")
        row = self.db.execute("SELECT value FROM world WHERE id=1").fetchone()
        if row:
            self.state = json.loads(row[0])
        else:
            place = "leaf" if not daylight(now, seasonal_weather(now)) else "flowers"
            self.state = {"version": 1, "life_id": str(uuid.uuid4()), "born_at": now,
                          "updated_at": now, "ticks": 0, "seed": uuid.uuid4().hex,
                          "place": place, "position": [PLACES[place]["x"], PLACES[place]["y"]],
                          "activity": "sleeping" if place == "leaf" else "feeding", "travel": None,
                          "energy": 78., "fullness": 75., "water": 80., "distance": 0., "journeys": 0,
                          "visits": {place: 1}, "next_decision": now + 100, "next_moment": now + 180,
                          "was_day": daylight(now, seasonal_weather(now)), "weather": seasonal_weather(now)}
            self._moment(now, "A small life begins in a garden in Bethesda.")
            self._save()
        learning.initialize(self.state)
        if self.plasticity is not None:  # eva-plasticity
            self.plasticity.bind(self.state)  # eva-plasticity
        self._save()
        self.advance(now)

    def _save(self):
        self.db.execute("INSERT INTO world VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
                        (json.dumps(self.state, separators=(",", ":")),))
        self.db.commit()

    def _moment(self, now, words):
        self.db.execute("INSERT INTO moments(at, words) VALUES(?, ?)", (now, words))

    def effective_weather(self, now):
        weather = self.state["weather"]
        return weather if weather.get("fetched_at", 0) > now - 21600 else seasonal_weather(now)

    def set_weather(self, weather):
        with self.lock:
            self.state["weather"] = weather
            self._save()

    def _depart(self, destination, now, rng):
        s = self.state
        start = s["position"][:]
        end = [PLACES[destination]["x"], PLACES[destination]["y"]]
        duration = rng.uniform(18, 42)  # Display estimate; arrival is determined by physical motion.
        s["travel"] = {"from": start, "to": end, "control": [(start[0] + end[0]) / 2,
                         max(.12, min(start[1], end[1]) - rng.uniform(.08, .2))],
                         "started_at": now, "ends_at": now + duration, "destination": destination}
        s["activity"] = "flying"
        s["journeys"] += 1
        self._moment(now, rng.choice(["Lifts off, following a small possibility.", "Takes the long way across the garden.",
                                     "Leaves its perch. The garden is wide enough."]))

    def _step(self, now, dt):
        s = self.state
        rng = random.Random(f"{s['seed']}:{s['ticks']}")
        s["ticks"] += 1
        weather = self.effective_weather(now)
        day = daylight(now, weather)
        if day != s["was_day"]:
            s["was_day"] = day
            self._moment(now, "Morning reaches the garden. Another day to be a fly." if day else
                         "The garden slips into evening. A quiet place begins to matter.")
            s["next_decision"] = min(s["next_decision"], now)
        activity = s["activity"]
        s["energy"] += dt * (.07 if activity in ("sleeping", "resting") else -.055 if activity == "flying" else -.01)
        s["fullness"] += dt * (.25 if activity == "feeding" else -.003)
        s["water"] += dt * (.3 if activity == "drinking" else -.002)
        for key in ("energy", "fullness", "water"):
            s[key] = round(max(10., min(100., s[key])), 5)
        travel = s["travel"]
        if travel:
            if now < travel.get("paused_until", 0):
                learning.execute(s, "rest", [0., 0.], now, dt, weather, rng)
                return
            motion = learning.choose_motion(s, weather)
            if self.plasticity is not None:  # eva-plasticity
                motion = self.plasticity.choose(s, weather, motion)  # eva-plasticity
            target = travel["to"]
            delta = [target[i] - s["position"][i] for i in (0, 1)]
            distance = math.hypot(*delta)
            estimate = learning.model(s, motion, learning.context(s, weather))["gain"]
            effort = min(1., distance / max(.001, estimate * dt))
            command = [v / max(distance, 1e-9) * effort for v in delta]
            start = s["position"][:]  # eva-plasticity
            s["distance"] += learning.execute(s, motion, command, now, dt, weather, rng) * 6
            if self.plasticity is not None:  # eva-plasticity
                self.plasticity.observe(s, motion, start, target, command, dt)  # eva-plasticity
            s["activity"] = "flying" if motion == "fly" else "walking"
            # No arrival by elapsed time: inability to move cannot teleport the fly.
            if math.dist(s["position"], target) < .012:
                s["place"] = travel["destination"]
                s["visits"][s["place"]] = s["visits"].get(s["place"], 0) + 1
                s["travel"] = None
                s["activity"] = ("feeding" if s["place"] in ("pear", "flowers") else "drinking" if s["place"] == "water"
                                 else "sleeping" if not day else "resting")
                s["next_decision"] = now + rng.uniform(70, 210)
                self._moment(now, rng.choice(ARRIVALS[s["place"]]))
            elif now - travel["started_at"] > 600:
                # Pause at the actual location, recover, and try the route again later.
                travel["paused_until"] = now + 90
                travel["started_at"] = now + 90
                s["activity"] = "resting"
                self._moment(now, "The journey asks too much for now. Pauses to recover.")
            return
        # At a perch, brief leg movements provide safe calibration without a viewer.
        if activity not in ("sleeping", "feeding", "drinking") and s["ticks"] % 6 == 0:
            angle = rng.uniform(0, math.tau)
            command = [.08 * math.cos(angle), .08 * math.sin(angle)]
            anchor = [PLACES[s["place"]]["x"], PLACES[s["place"]]["y"]]
            if math.dist(s["position"], anchor) > .018:
                command = [(anchor[i] - s["position"][i]) * 3 for i in (0, 1)]
            s["distance"] += learning.execute(s, "walk", command, now, dt, weather, rng) * 6
        else:
            learning.execute(s, "groom" if activity == "grooming" else "rest", [0., 0.], now, dt, weather, rng)
        if now >= s["next_decision"]:
            destination = None
            sheltered = PLACES[s["place"]].get("sheltered", False)
            rough = weather["rain"] > .2 or weather["wind"] > 25 or weather["temperature"] < 7
            if s["fullness"] < 32:
                destination = rng.choice(["pear", "flowers"])
            elif s["water"] < 30:
                destination = "water"
            elif (not day or rough or s["energy"] < 28) and not sheltered:
                destination = rng.choice(["leaf", "window"])
            elif (not day or rough) and sheltered:
                s["activity"] = "sleeping" if rng.random() < .8 else "grooming"
            elif s["energy"] < 65 and rng.random() < .6:
                s["activity"] = "resting"
            elif rng.random() < .64:
                destination = rng.choice([p for p in PLACES if p != s["place"]])
            else:
                s["activity"] = rng.choice(["grooming", "resting"])
            if destination and destination != s["place"]:
                self._depart(destination, now, rng)
            elif destination:
                s["activity"] = "drinking" if destination == "water" else "feeding"
            s["next_decision"] = now + rng.uniform(100, 300)
        if now >= s["next_moment"]:
            if s["activity"] == "sleeping":
                words = rng.choice(["A breeze stirs the leaf. The fly settles a little closer to the stem.",
                                    "Wings folded. The night has its own kind of life.",
                                    "Somewhere beyond the fence, Bethesda goes on. Here, a fly rests."])
            elif s["activity"] == "grooming":
                words = "Cleans its forelegs, then its wings. Small, necessary work."
            elif s["activity"] == "feeding":
                words = "Lingers over a little sweetness. There is no hurry."
            elif s["activity"] == "drinking":
                words = "A drop of water is a whole event at this scale."
            else:
                words = rng.choice(["Turns toward a passing ripple in the air.", "A small pause. Then a small adjustment.",
                                    "The garden offers another patch of light and shade."])
            self._moment(now, words)
            s["next_moment"] = now + rng.uniform(180, 480)

    def advance(self, now):
        with self.lock:
            remaining = max(0., now - self.state["updated_at"])
            # Five-second live steps; bounded, approximate catch-up after a long host outage.
            step = max(5., math.ceil(remaining / 3600 / 5) * 5)
            changed = False
            while now - self.state["updated_at"] >= 5:
                dt = min(step, now - self.state["updated_at"])
                self.state["updated_at"] += dt
                # Large outage catch-up uses bounded motor time; it is approximate,
                # and cannot manufacture high-speed trips or giant learning samples.
                self._step(self.state["updated_at"], min(dt, 5.))
                changed = True
            if changed:
                self._save()
                if self.plasticity is not None:  # eva-plasticity
                    self.plasticity.save()  # eva-plasticity

    def snapshot(self, now=None):
        now = time.time() if now is None else now
        with self.lock:
            s = copy.deepcopy(self.state)
            moments = [{"id": row[0], "at": row[1], "text": row[2]} for row in self.db.execute(
                "SELECT id, at, words FROM moments ORDER BY id DESC LIMIT 8")]
            count = self.db.execute("SELECT COUNT(*) FROM moments").fetchone()[0]
            weather = copy.deepcopy(self.effective_weather(now))
        weather["description"] = weather_name(weather["code"])
        weather["is_day"] = daylight(now, weather)
        return {"life_id": s["life_id"], "born_at": s["born_at"], "server_time": now,
                "updated_at": s["updated_at"], "ticks": s["ticks"], "place": s["place"],
                "place_name": PLACES[s["place"]]["name"], "position": s["position"],
                "activity": s["activity"], "travel": s["travel"], "journeys": s["journeys"],
                "distance": round(s["distance"], 2), "places_visited": len(s["visits"]),
                "moments_count": count, "moments": moments, "weather": weather,
                "learning": learning.summary(s, weather),
                "needs": {"energy": round(s["energy"]), "fullness": round(s["fullness"]), "water": round(s["water"])}}

    def close(self):
        with self.lock:
            self.db.close()


def fetch_weather():
    url = ("https://api.open-meteo.com/v1/forecast?latitude=38.9847&longitude=-77.0947"
           "&current=temperature_2m,precipitation,weather_code,wind_speed_10m"
           "&daily=sunrise,sunset&timezone=America%2FNew_York&timeformat=unixtime&forecast_days=2")
    with urlopen(Request(url, headers={"User-Agent": "BethesdaFly/1.0"}), timeout=8) as response:
        data = json.load(response)
    current, daily = data["current"], data["daily"]
    temperature, wind, rain = [float(current[key]) for key in ("temperature_2m", "wind_speed_10m", "precipitation")]
    if not (-60 <= temperature <= 60 and 0 <= wind <= 300 and 0 <= rain <= 200):
        raise ValueError("Weather outside supported bounds")
    sun = {datetime.fromtimestamp(rise, TZ).strftime("%Y-%m-%d"): [rise, setting]
           for rise, setting in zip(daily["sunrise"], daily["sunset"])}
    return {"temperature": temperature, "code": int(current["weather_code"]), "wind": wind, "rain": rain,
            "fetched_at": time.time(), "source": "Open-Meteo", "sun": sun}


def serve():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    World.plasticity = eva_plasticity.from_environment(os.environ.get("FLY_DB", "/var/lib/bethesda-fly/world.sqlite3"))  # eva-plasticity
    world = World(os.environ.get("FLY_DB", "/var/lib/bethesda-fly/world.sqlite3"))
    stop = threading.Event()

    def clock_loop():
        while not stop.wait(5):
            try:
                world.advance(time.time())
            except Exception:
                logging.exception("World clock failed; exiting for service recovery")
                os._exit(1)

    def weather_loop():
        while not stop.is_set():
            try:
                world.set_weather(fetch_weather())
                wait = 1800
            except Exception as error:
                logging.warning("Weather unavailable; using cached or seasonal conditions: %s", error)
                wait = 300
            stop.wait(wait)

    class Handler(BaseHTTPRequestHandler):
        server_version = "Garden"

        def do_GET(self):
            if self.path == "/state":
                payload = world.snapshot()
                if world.plasticity is not None:  # eva-plasticity
                    with world.lock:  # eva-plasticity
                        payload["adaptive"] = world.plasticity.status()  # eva-plasticity
            elif self.path == "/health":
                snapshot = world.snapshot()
                if time.time() - snapshot["updated_at"] > 30:
                    self.send_error(503)
                    return
                payload = {"ok": True, "ticks": snapshot["ticks"]}
            else:
                self.send_error(404)
                return
            body = json.dumps(payload, separators=(",", ":")).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def log_message(self, *_args):
            pass

    threads = [threading.Thread(target=clock_loop, daemon=True, name="world-clock"),
               threading.Thread(target=weather_loop, daemon=True, name="weather")]
    for thread in threads:
        thread.start()
    server = ThreadingHTTPServer(("127.0.0.1", int(os.environ.get("FLY_PORT", "8765"))), Handler)
    server.daemon_threads = True
    def terminate(_signal, _frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, terminate)
    logging.info("The garden is running; life=%s", world.state["life_id"])
    if world.plasticity is not None:  # eva-plasticity
        logging.info("Embodied plasticity: %s, %s", world.plasticity.mode, world.plasticity.status()["status"])  # eva-plasticity
    try:
        server.serve_forever(poll_interval=.5)
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        server.server_close()
        for thread in threads:
            thread.join(timeout=10)
        world.close()


if __name__ == "__main__":
    serve()
