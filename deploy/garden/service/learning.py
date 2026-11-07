"""Small online sensorimotor model. Physics and learned predictions are separate.

Coordinates are garden fractions, time seconds. This is a toy embodiment, not
a biological or consciousness model. All learning comes from executed trials.
"""
import math


def clamp(x, low=0., high=1.):
    return max(low, min(high, x))


def initialize(state):
    state.setdefault("body", {"wing_integrity": 1., "leg_integrity": 1., "wetness": 0.})
    state.setdefault("learning", {"version": 1, "trials": 0, "models": {},
        "sensory_error": 0., "last": None, "objects": {}, "surprises": 0})
    state["version"] = 2


def context(state, weather):
    # These are sensed conditions, not access to the physics' movement gain.
    b = state["body"]
    return ":".join(["cold" if weather["temperature"] < 10 else "warm",
        "tired" if state["energy"] < 35 else "rested",
        "limited" if min(b["wing_integrity"], b["leg_integrity"]) < .7 else "sound",
        "wet" if b["wetness"] > .4 else "dry"])


def model(state, action, condition):
    return state["learning"]["models"].setdefault(action + "/" + condition,
        {"gain": .006, "samples": 0, "successes": 0, "error": 0.})


def choose_motion(state, weather):
    condition = context(state, weather)
    fly = model(state, "fly", condition)
    walk = model(state, "walk", condition)
    # Try each unfamiliar action; periodically retest so recovery is discoverable.
    if fly["samples"] < 3 or state["learning"]["trials"] % 37 == 0:
        return "fly"
    if walk["samples"] < 3:
        return "walk"
    def score(m):
        return m["gain"] * (m["successes"] + 1) / (m["samples"] + 2)
    return "fly" if score(fly) >= score(walk) else "walk"


def objects_at(now):
    # Independent world trajectories: neither reads the fly's actions or position.
    return {"drifting_midge": [.55 + .22 * math.sin(now / 23), .40 + .11 * math.cos(now / 31)],
            "swaying_leaf": [.30 + .025 * math.sin(now / 11), .34 + .012 * math.cos(now / 17)]}


def physical_step(state, action, command, dt, weather):
    b = state["body"]
    if action == "fly":
        gain = .018 * b["wing_integrity"] ** 2 * (1 - .85 * b["wetness"])
        gain *= .4 if weather["temperature"] < 10 else 1
        gain *= .35 if state["energy"] < 35 else 1
        if b["wing_integrity"] < .18 or b["wetness"] > .92:
            gain = 0.
    elif action == "walk":
        gain = .0035 * b["leg_integrity"] ** 2
        if b["leg_integrity"] < .15:
            gain = 0.
    else:
        gain = 0.
    start = state["position"][:]
    # Collision with garden boundary is an observable limitation, not a teleport.
    end = [clamp(start[i] + command[i] * dt * gain, .03, .97) for i in (0, 1)]
    return end


def execute(state, action, command, now, dt, weather, rng):
    """Predict first, execute independent physics, observe, then update estimates."""
    condition = context(state, weather)
    m = model(state, action, condition)
    start = state["position"][:]
    u = [v * dt for v in command]
    predicted_delta = [m["gain"] * v if action in ("fly", "walk") else 0. for v in u]
    predicted = [start[i] + predicted_delta[i] for i in (0, 1)]
    end = physical_step(state, action, command, dt, weather)
    # Noisy localization is the learner's observation. Truth is only used by physics/rendering.
    observed = [end[i] + rng.uniform(-.00015, .00015) for i in (0, 1)]
    delta = [observed[i] - start[i] for i in (0, 1)]
    error = math.dist(predicted, observed)
    excitation = sum(v*v for v in u)
    if excitation > 1e-10:
        measured_gain = sum(u[i]*delta[i] for i in (0, 1)) / excitation
        m["gain"] = clamp(m["gain"] + .22 * (measured_gain - m["gain"]), 0., .04)
    success = math.dist(start, end) > .0003 if action in ("fly", "walk") else True
    m["samples"] += 1
    m["successes"] += int(success)
    m["error"] += .15 * (error - m["error"])
    learning = state["learning"]
    learning["trials"] += 1
    learning["sensory_error"] += .12 * (error - learning["sensory_error"])
    if error > .025:
        learning["surprises"] += 1
    # Retinal prediction: stationary landmarks should move opposite to self-motion.
    landmark = [.82, .375]
    predicted_view = [landmark[i] - predicted[i] for i in (0, 1)]
    observed_view = [landmark[i] - observed[i] for i in (0, 1)]
    old_objects, new_objects = objects_at(now - dt), objects_at(now)
    for name, point in new_objects.items():
        track = learning["objects"].setdefault(name, {"samples": 0, "external_motion": 0.,
                                                     "self_only_error": 0., "moving_error": 0., "velocity": [0., 0.]})
        old_relative = [old_objects[name][i] - start[i] for i in (0, 1)]
        new_relative = [point[i] - observed[i] for i in (0, 1)]
        self_only = [old_relative[i] - predicted_delta[i] for i in (0, 1)]
        moving = [self_only[i] + track["velocity"][i] * dt for i in (0, 1)]
        # Compensate sensed self-displacement before attributing movement to others.
        external = [new_relative[i] - old_relative[i] + delta[i] for i in (0, 1)]
        track["samples"] += 1
        track["self_only_error"] += .12 * (math.dist(self_only, new_relative) - track["self_only_error"])
        track["moving_error"] += .12 * (math.dist(moving, new_relative) - track["moving_error"])
        track["external_motion"] += .12 * (math.hypot(*external) / dt - track["external_motion"])
        track["velocity"] = [external[i] / dt for i in (0, 1)]
    learning["last"] = {"at": now, "action": action, "condition": condition,
        "command": command, "predicted_position": predicted, "observed_position": observed,
        "prediction_error": error, "predicted_landmark": predicted_view, "observed_landmark": observed_view,
        "success": success}
    state["position"] = end
    # Gentle wear, wet wings, and recovery alter real capabilities without ending the life.
    b = state["body"]
    b["wetness"] = clamp(b["wetness"] + dt * (.002 if weather["rain"] > .2 and action == "fly" else -.001))
    if action == "fly":
        b["wing_integrity"] = clamp(b["wing_integrity"] - dt * .000002, .1, 1.)
    elif action in ("rest", "groom"):
        b["wing_integrity"] = clamp(b["wing_integrity"] + dt * .00003)
        b["leg_integrity"] = clamp(b["leg_integrity"] + dt * .00003)
    return math.dist(start, end)


def summary(state, weather):
    learning = state["learning"]
    condition = context(state, weather)
    capabilities = {}
    for action in ("fly", "walk"):
        m = learning["models"].get(action + "/" + condition)
        capabilities[action] = None if m is None or not m["samples"] else {
            "samples": m["samples"], "estimated_speed": round(m["gain"], 5),
            "success_rate": round(m["successes"] / m["samples"], 3)}
    return {"trials": learning["trials"], "condition": condition, "capabilities": capabilities,
        "prediction_error": round(learning["sensory_error"], 6), "last": learning["last"],
        "surprises": learning["surprises"], "body": state["body"],
        "nearby": [{"name": name, "position": point, **learning["objects"].get(name, {}),
            "independent": learning["objects"].get(name, {}).get("samples", 0) >= 10 and
                           learning["objects"].get(name, {}).get("external_motion", 0) > .0003}
            for name, point in objects_at(state["updated_at"]).items()]}
