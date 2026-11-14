"""Export independently checked evidence to a fresh ATLAS review ledger."""
import argparse
from pathlib import Path
import sys

from challenge import check_checkout, load, ROOT, digest
from verify import verify


def export(atlas, workspace, output):
    p = load(ROOT/"protocol.json")
    result = verify(workspace)
    check_checkout(atlas,p["atlas_revision"])
    sys.path.insert(0,str(atlas/"src"))
    from rain_atlas.ledger.store import Ledger
    from rain_atlas.observatory.export import export as export_observatory
    output.mkdir(parents=True,exist_ok=False)
    ledger = Ledger(output/"ledger")
    author = {"role":"R.A.I.N.AssumptionChallenge","generation":"scripted"}
    plan = ledger.append("preregistration",{
        "title":"Model-led challenge to an extrapolated signal-quality assumption",
        "question":"Does a model's explanation survive a selected counterfactual and a new waveform?",
        "hypothesis":"At least one forecast is refuted and a frozen revision improves held-out Brier loss by at least 0.05.",
        "null_hypothesis":"The registered forecast correction screen is not met.",
        "design":p,"acceptance":p["evaluation"],"created_by":author,
    })
    for path in sorted(workspace.glob("*.json")):
        ref = ledger.put_file(path)
        if ref!="sha256:"+digest(path):
            raise ValueError("ATLAS artifact digest changed")
        ledger.append("dataset",{"experiment":plan.object,"name":path.name,"origin":"synthetic",
                                 "media_type":"application/json","object":ref,
                                 "provenance":{"source_sha256":digest(path),"human_review":"pending"}})
    ledger.append("report",{
        "experiment":plan.object,
        "findings":[{"statement":"The model revised an experimentally tested forecast.","claims":[],
                     "verdict":"unresolved","reason":"Descriptive correction screen "+("met." if result["forecast_correction_screen_passed"] else "missed.")}],
        "limitations":["Two calls to one local model; bounded human-authored experiment catalog.",
                       "Synthetic pulse generators share CIRCLE reconstruction. No independent laboratory or physical validation.",
                       "A compatible forecast does not validate all of the model's prose. Human scientific review pending."],
        "reproduction":"Run challenge.py --replay and verify.py against the pinned CIRCLE source.",
        "author":author,"report_object":ledger.put_file(workspace/"result.json"),
        "acceptance":result,"conclusion":"Simulation evidence for review; no automatic discovery claim.",
    })
    if ledger.verify():
        raise ValueError("ATLAS ledger verification failed")
    export_observatory(output/"ledger",output/"observatory")
    print(f"Verified {len(list(ledger.entries()))} ATLAS records; human review pending.")


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ("atlas","workspace","output"):
        parser.add_argument(name,type=Path)
    a=parser.parse_args()
    export(a.atlas.resolve(),a.workspace.resolve(),a.output.resolve())
