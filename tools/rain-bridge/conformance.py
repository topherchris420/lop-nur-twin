#!/usr/bin/env python3
"""Cross-repository conformance: does R.A.I.N.'s own code accept and agree?

Given a lab experiment record and the admission bundle exported with it, this
runs james_library's code — not a copy of it — over the lab's output:

* ``schema.definition_errors`` on the pre-registration draft, completed with
  the fields R.A.I.N.'s registry assigns;
* ``schema.submission_errors`` on the submission;
* ``evaluate.evaluate`` on the submission's measurements, compared field by
  field with the lab's own ``rain-criteria/v1`` evaluation — the two must
  reach the same status, verdict, criterion results and summary;
* the run artifact digest, recomputed from the record the way R.A.I.N.
  hashes JSON, against the digest the submission reports;
* with ``--admit``, a real ``Registry.create`` + ``record_submission`` in a
  temporary registry, whose run status must match the lab's.

Exit status is 1 on any disagreement.

    python tools/rain-bridge/conformance.py --library ../james_library \\
        --record record.json --bundle bundle.json --admit
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import tempfile
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--library", required=True)
    parser.add_argument("--record", required=True)
    parser.add_argument("--bundle", required=True)
    parser.add_argument("--admit", action="store_true")
    args = parser.parse_args()
    sys.path.insert(0, str(Path(args.library).resolve()))
    from james_library.experiments.evaluate import evaluate  # noqa: PLC0415
    from james_library.experiments.registry import Registry  # noqa: PLC0415
    from james_library.experiments.runner import record_submission  # noqa: PLC0415
    from james_library.experiments.schema import definition_errors, submission_errors  # noqa: PLC0415

    record = json.loads(Path(args.record).read_text(encoding="utf-8"))
    bundle = json.loads(Path(args.bundle).read_text(encoding="utf-8"))
    failures: list[str] = []

    def check(name: str, ok: bool, detail: str = "") -> None:
        print(f"{'PASS' if ok else 'FAIL'} {name}{' — ' + detail if detail else ''}")
        if not ok:
            failures.append(name)

    definition = {"schema_version": "rain-experiment/v1", "experiment_id": "V3D-EXP-9999",
                  "experiment_version": 1, "created_at": "2026-01-01T00:00:00.000Z",
                  **bundle["draft"]}
    errors = definition_errors(definition)
    check("draft is a valid rain-experiment/v1 definition", not errors, "; ".join(errors[:5]))
    submission = dict(bundle["submission"], experiment_id="V3D-EXP-9999")
    errors = submission_errors(submission)
    check("submission is a valid rain-experiment-submission/v1", not errors, "; ".join(errors[:5]))
    check("submission carries no status or verdict",
          not {"status", "verdict", "hypothesis_verdict"} & set(submission))

    run = record.get("run") or {}
    expected_status = "error" if record.get("error") else run.get("status")
    if record.get("error"):
        check("a failed execution is reported as an error, not a result",
              "error" in submission and not run, "the hypothesis is not evaluated")
    else:
        status, verdict, evaluation = evaluate(definition, submission["measurements"])
        check("R.A.I.N. evaluate() reaches the lab's status", status == run.get("status"),
              f"R.A.I.N. {status}, lab {run.get('status')}")
        check("R.A.I.N. evaluate() reaches the lab's verdict", verdict == run.get("verdict"),
              f"R.A.I.N. {verdict}, lab {run.get('verdict')}")
        check("criterion-by-criterion evaluation is identical",
              json.dumps(evaluation, sort_keys=True) == json.dumps(run.get("evaluation"), sort_keys=True))

    body = {k: v for k, v in record.items() if k not in {"rain_admission", "record_sha256"}}
    canonical = json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
                           allow_nan=False)
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    reported = submission["artifacts"][0]["sha256"] if submission.get("artifacts") else None
    check("run artifact digest recomputes in Python", digest == reported,
          f"python {digest[:16]}…, submission {str(reported)[:16]}…")

    if args.admit:
        with tempfile.TemporaryDirectory(prefix="rain-conformance-") as scratch:
            registry = Registry(Path(scratch))
            created = registry.create(bundle["draft"])
            admitted = record_submission(registry, created["experiment_id"],
                                         dict(bundle["submission"], experiment_id=created["experiment_id"]))
            check("R.A.I.N. registry admits the run", admitted["status"] == expected_status,
                  f"{admitted['run_id']}: {admitted['status']} — {admitted['interpretation']['deterministic'][:120]}")
    print("conformance:", "FAILED" if failures else "ok")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
