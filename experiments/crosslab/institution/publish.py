"""Build a fresh ATLAS evidence ledger, then project its verified receipts."""
import json
from pathlib import Path
import sys

from memory import Journal, Principal, digest, event
from study import ORIGINAL, PHASES, PROTOCOL, ROOT, check_checkout, evaluate, measure

AUTHOR = {"role": "R.A.I.N. correction study", "generation": "scripted"}
SUBJECT = "delivery-coverage"
PLANNER = Principal("experiment-planner", "researcher")
FOLLOWUP = Principal("replication-researcher", "researcher")
INSTRUMENT = Principal("circle-reconstruction", "instrument")
VERIFIER = Principal("independent-scorer", "verifier")
REGISTRATION = "8067c37824fe18731668bc35cc0d2bfc5e9ca44a84"


def run(circle, atlas, output):
    from atlas_export import export as export_archive

    check_checkout(atlas, ORIGINAL["atlas_revision"])
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    # The archived model outcome is admitted by its own unchanged independent verifier.
    archive = ROOT.parent / "assumptions" / "record"
    export_archive(atlas, archive, output / "historical-atlas")
    from rain_atlas.ledger.store import Ledger

    historic = Ledger(output / "historical-atlas" / "ledger")
    history = list(historic.records("report"))
    if len(history) != 1 or history[0][1]["acceptance"]["forecast_correction_screen_passed"]:
        raise ValueError("Expected the existing negative result")
    journal_path = output / "memory.sqlite"
    journal = Journal(journal_path)
    provenance = journal.append(INSTRUMENT, event("software", SUBJECT,
        "Archived assumption challenge. The revised forecast failed the preregistered screen.",
        ledger=list(historic.entries())[-1].hash.removeprefix("sha256:"),
        object=history[0][0].object.removeprefix("sha256:"),
        circle_revision=ORIGINAL["circle_revision"], atlas_revision=ORIGINAL["atlas_revision"]))
    hypothesis = journal.append(PLANNER, event("hypothesis", SUBJECT, PROTOCOL["hypothesis"], [provenance]))
    rival = journal.append(PLANNER, event("disagreement", SUBJECT, PROTOCOL["rival"], [hypothesis]))
    handoff = journal.append(PLANNER, event("handoff", SUBJECT,
        "Separate candidate estimation error from the existing gate's withholding.",
        [hypothesis, rival, provenance], assignee=FOLLOWUP.name,
        question="Does bias reverse with ramp direction on new seeds and another waveform?"))
    # A fresh connection has only durable state.
    journal = Journal(journal_path)
    receipt = journal.append(FOLLOWUP, event("receipt", SUBJECT,
        "Resumed the registered question and its original evidence.", [handoff]))
    plan = journal.append(FOLLOWUP, event("protocol", SUBJECT, PROTOCOL["design"],
        [hypothesis, rival, receipt], registration=REGISTRATION, sha256=digest(PROTOCOL)))
    prediction = journal.append(FOLLOWUP, event("prediction", SUBJECT,
        PROTOCOL["replication_rule"], [plan, rival]))

    ledger = Ledger(output / "atlas")
    registration = ledger.append("preregistration", {
        "title": "Coverage and delivery correction", "question": "Does reporting conceal delayed error?",
        "hypothesis": PROTOCOL["rival"], "null_hypothesis": PROTOCOL["hypothesis"],
        "design": PROTOCOL, "acceptance": {"discovery": PROTOCOL["discovery_rule"],
                                          "replication": PROTOCOL["replication_rule"]},
        "created_by": AUTHOR,
    })
    outcomes = []
    summaries = {}
    for phase in PHASES:
        rows = measure(circle, phase)
        raw = ledger.put_json(rows)
        ledger.append("dataset", {"experiment": registration.object, "name": phase,
            "origin": "synthetic", "media_type": "application/json", "object": raw,
            "provenance": {"circle_revision": ORIGINAL["circle_revision"], "registration": REGISTRATION}})
        # Score the reloaded measurement object instead of a designer-authored verdict.
        result = evaluate(ledger.get_json(raw), phase)
        summaries[phase] = result
        report = ledger.append("report", {
            "experiment": registration.object,
            "findings": [{"statement": f"{phase} screen: {result['verdict']}.", "claims": [],
                          "verdict": "unresolved", "reason": "Human scientific review pending."}],
            "limitations": [PROTOCOL["limits"]],
            "reproduction": "Run study.py and compare the content-addressed measurement objects.",
            "author": AUTHOR, "report_object": ledger.put_json(result),
            "measured_object": raw, "acceptance": result,
            "conclusion": "A computational result for review.",
        })
        problems = ledger.verify()
        if problems or ledger.get_json(report.object)["measured_object"] != raw:
            raise ValueError(f"ATLAS evidence verification failed: {problems}")
        head = report.hash.removeprefix("sha256:")
        observation = journal.append(INSTRUMENT, event("observation", SUBJECT,
            f"CIRCLE {phase} measured {len(rows)} matched candidates.", [plan, prediction],
            object=raw.removeprefix("sha256:"), ledger=head))
        outcomes.append(journal.append(VERIFIER, event("outcome", SUBJECT,
            f"Independent {phase} scoring: {result['verdict']}.", [observation],
            object=report.object.removeprefix("sha256:"), ledger=head, phase=phase, verdict=result["verdict"])))

    if [summary["verdict"] for summary in summaries.values()] == ["refuted", "compatible"]:
        journal.append(FOLLOWUP, event("correction", SUBJECT,
            "In this simulator, sufficient coverage does not guarantee accuracy when delivery delays truncate a changing rate. "
            "Candidates underestimate rising rates and overestimate falling rates. The freshness gate withholds these candidates, "
            "leaving reported error undefined in the delayed arm.", [hypothesis, *outcomes]))
    (output / "results.json").write_text(json.dumps(summaries, indent=2, sort_keys=True) + "\n")
    from rain_atlas.observatory.export import export

    export(output / "atlas", output / "atlas-observatory")
    from view import public_snapshot

    (output / "memory.json").write_text(json.dumps(public_snapshot(journal.snapshot(), summaries),
                                                  indent=2, sort_keys=True) + "\n")
    print(json.dumps(summaries, indent=2, sort_keys=True))
