"""Post-run scientific audit: a stricter veto, never a replacement registration.

This audit was added after examining the first run. It cannot rescue a failed
registered screen. In particular, zero errors among zero estimates is undefined
risk, and an equal-score tie is not evidence of model-designed discrimination.
"""
import json
from pathlib import Path
import sys

from verify import verify, load, exact_interval


def audit(workspace):
    result = verify(workspace)
    protocol = load(workspace/"protocol.json")
    gains = load(workspace/"selection.json")["model_conditional_bits"]
    highest = max(gains.values())
    ties = [d for d,g in gains.items() if abs(g-highest)<1e-12]
    strata = {}
    for phase in ("discovery","replication"):
        rows = load(workspace/f"{phase}-windows.json")
        for design,profile,level in sorted({(r["design"],r["profile"],r["level"]) for r in rows}):
            group = [r for r in rows if (r["design"],r["profile"],r["level"])==(design,profile,level)]
            n = sum(r["accepted"] for r in group)
            k = sum(r["error"] for r in group)
            # One scheduled estimate per independently seeded replicate in a cell.
            strata[f"{phase}/{design}/{profile}/{level}"] = {
                "scheduled":len(group),"accepted":n,"errors":k,
                "coverage":n/len(group),"conditional_error_risk":k/n if n else None,
                "descriptive_exact_95_error_interval":exact_interval(k,n,.05) if n else None,
            }
    informative = len(ties)==1
    return {
        "schema":"rain-assumption-scientific-audit/v1",
        "origin":"post-run host audit; not preregistered",
        "registered_screen_passed":result["forecast_correction_screen_passed"],
        "max_information_ties":ties,
        "model_discriminated_between_designs":informative,
        "error_effect_unidentifiable_cells":[s for s,v in strata.items() if not v["accepted"]],
        "strata":strata,
        "scientific_milestone_established":False,
        "reason":"A numerical forecast screen cannot certify the meaning of free-text explanations. Human review and evidence of informative, independently replicated design are still required.",
        "claims_not_licensed":["physical validation","independent laboratory replication","general improvement in scientific ability","causal validation of model prose"],
        "human_review":"pending",
    }


if __name__=="__main__":
    print(json.dumps(audit(Path(sys.argv[1])),indent=2,sort_keys=True))
