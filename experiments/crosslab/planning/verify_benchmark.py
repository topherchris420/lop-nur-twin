"""Re-score held-out model receipts without the planner or an inference server."""

from hashlib import sha256
import json
import math
from pathlib import Path
import sys


def entropy(p):
    return -p * math.log2(p) - (1 - p) * math.log2(1 - p)


def information(p, q):
    return entropy((p + q) / 2) - (entropy(p) + entropy(q)) / 2


def equivalent(a, b):
    if not math.isclose(a, b, abs_tol=1e-12):
        raise ValueError(f"Benchmark score differs: {a} vs {b}")


def verify(spec, development, heldout):
    def read(path):
        return json.loads(path.read_bytes())

    protocol, dev, held = map(read, (spec, development, heldout))
    for receipt in (dev, held):
        if receipt["protocol_sha256"] != sha256(spec.read_bytes()).hexdigest():
            raise ValueError("Protocol digest mismatch")
    if held["development_receipt_sha256"] != sha256(development.read_bytes()).hexdigest():
        raise ValueError("Development receipt digest mismatch")
    if any(dev[k] != held[k] for k in ("model", "model_sha256", "selected")):
        raise ValueError("Held-out run differs from frozen development choice")
    for receipt, phase, strategies in ((dev, "development", {"structured_counts", "structured_rules"}),
                                        (held, "heldout", {"direct", dev["selected"]})):
        observed = set()
        for row in receipt["rows"]:
            family, seed, style = (row[k] for k in ("family", "seed", "style"))
            key = family, seed, style
            if key in observed:
                raise ValueError("Duplicate evaluation")
            observed.add(key)
            case_hash = bytes.fromhex(sha256(f"{family}/{seed}".encode()).hexdigest())
            rotation = int.from_bytes(case_hash[:4]) % 3
            nuisance = 0.9 if case_hash[5] % 2 else 0.1
            differing = (0.9, 0.1) if case_hash[4] % 2 else (0.1, 0.9)
            truth = dict(zip("abc", [((differing), (nuisance, nuisance), (0.5, 0.5))[(i + rotation) % 3]
                                    for i in range(3)], strict=True))
            if row["request_sha256"] != sha256(json.dumps(row["request"], separators=(",", ":"),
                                                         ensure_ascii=False).encode()).hexdigest():
                raise ValueError("Model request digest mismatch")
            brier = None
            try:
                answer = json.loads(row["answer"]["text"])
            except json.JSONDecodeError:
                answer = {}
            if not isinstance(answer, dict):
                answer = {}
            if style == "direct":
                choice = answer.get("choice")
                choice = choice if set(answer) == {"choice"} and choice in list("abc") else None
            elif set(answer) == set("abc") and all(isinstance(pair, list) and len(pair) == 2
                    and all(p in (0.1, 0.5, 0.9) for p in pair) for pair in answer.values()):
                choice = max("abc", key=lambda k: information(*answer[k]))
                brier = sum(q*(1-p)**2+(1-q)*p**2 for k in "abc"
                            for p,q in zip(answer[k], truth[k], strict=True))/6
            else:
                choice = None
            if brier is None:
                if row["forecast_brier"] is not None:
                    raise ValueError("Unexpected Brier score")
            else:
                equivalent(row["forecast_brier"], brier)
            if choice != row["choice"] or (choice is not None) != row["valid"]:
                raise ValueError("Stored experiment choice differs from response")
            best = information(*differing)
            achieved = information(*truth[choice]) if choice else 0
            equivalent(row["expected_bits"], achieved)
            equivalent(row["regret_bits"], best-achieved)
            equivalent(row["fifo_bits"], information(*truth["a"]))
            equivalent(row["fixed_pilot_bits"], best)
        expected = {(f, s, style) for f in protocol["families"] for s in protocol[f"{phase}_seeds"]
                    for style in strategies}
        if expected != observed:
            raise ValueError("Benchmark case inventory differs from the protocol")
        if len(receipt["summaries"]) != len(strategies) or {x["style"] for x in receipt["summaries"]} != strategies:
            raise ValueError("Summary methods differ from the protocol")
        for summary in receipt["summaries"]:
            rows = [r for r in receipt["rows"] if r["style"] == summary["style"]]
            if len(rows) != summary["cases"] or sum(r["valid"] for r in rows) != summary["valid"]:
                raise ValueError("Summary case count mismatch")
            for metric, source in (("mean_bits", "expected_bits"), ("mean_regret", "regret_bits"),
                                   ("fifo_bits", "fifo_bits"), ("fixed_pilot_bits", "fixed_pilot_bits")):
                equivalent(summary[metric], sum(r[source] for r in rows)/len(rows))
            forecasts = [r["forecast_brier"] for r in rows if r["forecast_brier"] is not None]
            if forecasts:
                equivalent(summary["mean_brier"], sum(forecasts)/len(forecasts))
            elif summary["mean_brier"] is not None:
                raise ValueError("Unexpected summary Brier score")
    if min(dev["summaries"], key=lambda x: x["mean_regret"])["style"] != dev["selected"]:
        raise ValueError("Development selection differs from declared learning rule")
    return held["summaries"]


if __name__ == "__main__":
    print(json.dumps(verify(*map(Path, sys.argv[1:])), indent=2))
