"""Independent interval arithmetic and forecast evaluation. No model invocation."""
from collections import Counter
from hashlib import sha256
import json
import math
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent


def load(p):
    return json.loads(p.read_text())


def digest(p):
    return sha256(p.read_bytes()).hexdigest()


def exact_interval(k, n, alpha):
    """Clopper-Pearson via binomial-tail inversion, no scientific dependency."""
    if not 0 <= k <= n or n < 1 or not 0 < alpha < 1:
        raise ValueError("Invalid binomial interval")
    def invert(test, target):
        lo, hi = 0.0, 1.0
        for _ in range(70):
            mid = (lo+hi)/2
            if test(mid) < target:
                lo = mid
            else:
                hi = mid
        return (lo+hi)/2
    lower = 0.0 if k == 0 else invert(
        lambda p: sum(math.comb(n,j)*p**j*(1-p)**(n-j) for j in range(k,n+1)), alpha/2)
    upper = 1.0 if k == n else invert(
        lambda p: sum(math.comb(n,j)*p**j*(1-p)**(n-j) for j in range(k+1,n+1)), 1-alpha/2)
    return [lower, upper]


def check_rows(rows, protocol, phase, designs):
    expected = Counter((s,p,d,l) for s in protocol[f"{phase}_seeds"] for p in protocol["profiles"]
                       for d in designs for l in protocol["catalog"][d]["levels"])
    actual = Counter((r["seed"],r["profile"],r["design"],r["level"]) for r in rows)
    if actual != expected:
        raise ValueError("Missing, duplicated or unregistered measurements")
    for r in rows:
        beats, intervals = r["reference_beats"], r["intervals"]
        if (not all(math.isfinite(x) for x in beats) or len(beats)<2
                or any(a>=b for a,b in zip(beats,beats[1:]))):
            raise ValueError("Invalid reference beat sequence")
        reference = round(60*(len(beats)-1)/(beats[-1]-beats[0]),6)
        if any(not (math.isfinite(a) and math.isfinite(b) and a<b
                    and b>=protocol["cutoff_seconds"]-protocol["window_seconds"]
                    and b<=protocol["cutoff_seconds"]) for a,b in intervals):
            raise ValueError("Invalid detected intervals")
        lengths = [b-a for a,b in intervals]
        estimate = round(60*len(lengths)/sum(lengths),6) if len(lengths)>=3 else None
        coverage = round(min(1,sum(lengths)/protocol["window_seconds"]),6)
        if reference != r["reference"] or estimate != r["estimate"] or coverage != r["coverage"]:
            raise ValueError("Estimate or reference arithmetic mismatch")
        accepted = estimate is not None and coverage>=protocol["minimum_beat_coverage"] and r["fresh"]
        error = bool(accepted and abs(estimate-reference)>protocol["error_bpm"])
        if accepted != r["accepted"] or error != r["error"]:
            raise ValueError("Gate or error label mismatch")
        oracle_intervals = [(a,b) for a,b in zip(beats,beats[1:])
                            if not any(lo<=a<=hi or lo<=b<=hi for lo,hi in r["mask"])]
        oracle = 60*len(oracle_intervals)/sum(b-a for a,b in oracle_intervals) if oracle_intervals else None
        if (oracle is None) != (r["oracle"] is None) or (oracle is not None and abs(oracle-r["oracle"])>1e-10):
            raise ValueError("Oracle control arithmetic mismatch")
        if r["waveform"] != protocol[f"{phase}_waveform"]:
            raise ValueError("Wrong replication generator")
    for seed in protocol[f"{phase}_seeds"]:
        for profile in protocol["profiles"]:
            paired = [r for r in rows if r["seed"]==seed and r["profile"]==profile and r["design"]=="mask_position"]
            if paired and (len({r["raw_sha256"] for r in paired})!=1 or len({r["unmasked"] for r in paired})!=1):
                raise ValueError("Mask contrast changed the optical samples or control")


def evaluate(protocol, proposal, revision, choice, discovery, replication):
    design = choice["design"]
    alpha = protocol["evaluation"]["alpha"]/protocol["evaluation"]["familywise_tests"]
    result = {"selected_design": design, "profiles": {}, "simulation_only": True,
              "human_review": "pending", "independent_lab_replication": False}
    before_losses, after_losses = [], []
    for profile in protocol["profiles"]:
        event_sets = {}
        for phase, rows in (("discovery",discovery),("replication",replication)):
            events = [int(any(r["error"] for r in rows if (r["seed"],r["profile"],r["design"])==(s,profile,design)))
                      for s in protocol[f"{phase}_seeds"]]
            event_sets[phase] = {"events": sum(events), "seeds": len(events),
                                 "probability_interval_familywise_95": exact_interval(sum(events),len(events),alpha)}
            if phase=="replication":
                before_losses.extend((y-proposal["forecasts"][design][profile][0])**2 for y in events)
                after_losses.extend((y-revision["probabilities"][profile])**2 for y in events)
        p = proposal["forecasts"][design][profile][0]
        q = revision["probabilities"][profile]
        dlow,dhigh = event_sets["discovery"]["probability_interval_familywise_95"]
        rlow,rhigh = event_sets["replication"]["probability_interval_familywise_95"]
        result["profiles"][profile] = {**event_sets, "original_forecast": p, "revised_forecast": q,
                                      "original_refuted_on_discovery": not dlow<=p<=dhigh,
                                      "revision_compatible_with_replication": rlow<=q<=rhigh}
    result["replication_brier_original"] = sum(before_losses)/len(before_losses)
    result["replication_brier_revised"] = sum(after_losses)/len(after_losses)
    improvement = result["replication_brier_original"]-result["replication_brier_revised"]
    result["brier_improvement"] = improvement
    result["forecast_correction_screen_passed"] = (
        any(v["original_refuted_on_discovery"] for v in result["profiles"].values())
        and all(v["revision_compatible_with_replication"] for v in result["profiles"].values())
        and improvement>=protocol["evaluation"]["minimum_brier_improvement"])
    # Design utility is descriptive counterexample yield, not information gain.
    result["baseline_comparison"] = {}
    for phase,rows in (("discovery",discovery),("replication",replication)):
        result["baseline_comparison"][phase] = {
            d: {"scheduled": len([r for r in rows if r["design"]==d]),
                "accepted": sum(r["accepted"] for r in rows if r["design"]==d),
                "accepted_errors": sum(r["error"] for r in rows if r["design"]==d)}
            for d in dict.fromkeys([design,protocol["fixed_baseline"]])}
    return result


def verify(workspace):
    # Shared functions reconstruct requests and admission only. Scores, reference
    # arithmetic, gate labels and confidence bounds above are independent code.
    from challenge import make_request, admit, select, summary
    protocol = load(ROOT/"protocol.json")
    if load(workspace/"protocol.json") != protocol:
        raise ValueError("Protocol changed after registration")
    required = {"protocol.json","proposal-request.json","proposal-model.json","selection.json",
                "discovery-windows.json","discovery-summary.json","revision-request.json","revision-model.json",
                "replication-windows.json","replication-summary.json","provenance.json"}
    manifest = load(workspace/"sha256.json")
    if set(manifest)!=required or any(digest(workspace/n)!=h for n,h in manifest.items()):
        raise ValueError("Evidence manifest mismatch")
    provenance = load(workspace/"provenance.json")
    repo = ROOT.parents[2]
    expected_sources = [ROOT/"challenge.py",ROOT/"verify.py",ROOT/"protocol.json",repo/"scripts/rain-assumption-model.ts",ROOT.parent/"replication/acquisition.py"]
    if set(provenance["source_files"])!={str(p.relative_to(repo)) for p in expected_sources}:
        raise ValueError("Study source set differs from the registered implementation")
    for path in expected_sources:
        expected = provenance["source_files"][str(path.relative_to(repo))]
        if not isinstance(expected,str) or len(expected)!=64 or any(c not in "0123456789abcdef" for c in expected):
            raise ValueError("Invalid source digest")
        # Original run source stays immutable when the verifier is strengthened.
        # These files are evidence, never imported or executed. Full replay uses
        # current code and separately compares every experimental measurement.
        archived = ROOT/"source_archive"/(expected+".txt")
        if digest(path)!=expected and (not archived.is_file() or digest(archived)!=expected):
            raise ValueError("Producing source is neither current nor preserved")
    if provenance["historical_result_sha256"]!=digest(ROOT.parent/"planning/record/result.json"):
        raise ValueError("Historical evidence changed")
    first,second = (load(workspace/f"{name}-model.json") for name in ("proposal","revision"))
    if first["model_sha256"]!=second["model_sha256"] or first["model"]!=second["model"]:
        raise ValueError("Model changed between forecasts")
    for name,receipt in (("proposal",first),("revision",second)):
        if not receipt.get("model") or receipt["answer"].get("reportedModel")!=receipt["model"]:
            raise ValueError("Server-reported model identity does not match attribution")
        if receipt["request_sha256"]!=digest(workspace/f"{name}-request.json") or receipt["generation"]!="model":
            raise ValueError("Model receipt mismatch")
    proposal = admit(first,make_request(protocol))
    choice = select(proposal)
    if load(workspace/"selection.json")!=choice:
        raise ValueError("Model-conditional design selection changed")
    designs = list(dict.fromkeys([choice["design"],protocol["fixed_baseline"]]))
    discovery,replication = (load(workspace/f"{phase}-windows.json") for phase in ("discovery","replication"))
    for phase,rows in (("discovery",discovery),("replication",replication)):
        check_rows(rows,protocol,phase,designs)
        if summary(rows)!=load(workspace/f"{phase}-summary.json"):
            raise ValueError("Measurement summary changed")
    revision = admit(second,make_request(protocol,proposal,summary(discovery)[choice["design"]]))
    result = evaluate(protocol,proposal,revision,choice,discovery,replication)
    if (workspace/"result.json").exists() and load(workspace/"result.json")!=result:
        raise ValueError("Published result differs from independent evaluation")
    return result


if __name__ == "__main__":
    result = verify(Path(sys.argv[1]))
    if len(sys.argv)>2 and sys.argv[2]=="--write":
        with (Path(sys.argv[1])/"result.json").open("x") as f:
            json.dump(result,f,indent=2,sort_keys=True,allow_nan=False)
            f.write("\n")
    print(json.dumps(result,indent=2))
