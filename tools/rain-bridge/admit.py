#!/usr/bin/env python3
"""Admit a Bethesda lab run into a R.A.I.N. experiment registry, offline.

When the lab ran without a live bridge it exports an admission bundle
(``rain-bethesda-admission-bundle/v1``): a ``create --from`` draft and a
submission whose ``experiment_id`` R.A.I.N. has not assigned yet. This helper
uses james_library's own registry API to do what the bridge would have done:

1. ``Registry.create(draft)`` — R.A.I.N. validates and pre-registers the
   experiment and assigns ``V3D-EXP-NNNN``;
2. sets that id in the submission;
3. ``record_submission`` — R.A.I.N. validates the submission against its own
   schema and evaluates the pre-registered criteria itself.

It prints R.A.I.N.'s run record summary. Registration here happens *after* the
run, and the submission already says so in its limitations.

    python tools/rain-bridge/admit.py bundle.json --library ../james_library \\
        --registry /tmp/scratch-registry
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("bundle")
    parser.add_argument("--library", required=True, help="path to a james_library checkout")
    parser.add_argument("--registry", required=True, help="registry directory to write")
    parser.add_argument("--json", action="store_true", help="print the full run record")
    args = parser.parse_args()
    library = Path(args.library).resolve()
    sys.path.insert(0, str(library))
    from james_library.experiments.registry import Registry  # noqa: PLC0415
    from james_library.experiments.runner import record_submission  # noqa: PLC0415

    raw = Path(args.bundle).read_bytes()
    if len(raw) > 4 * 1024 * 1024:
        sys.exit("bundle exceeds 4 MB")
    bundle = json.loads(raw)
    if not isinstance(bundle, dict) or bundle.get("schema") != "rain-bethesda-admission-bundle/v1":
        sys.exit("not a rain-bethesda-admission-bundle/v1 file")
    registry = Registry(Path(args.registry))
    definition = registry.create(bundle["draft"])
    submission = dict(bundle["submission"], experiment_id=definition["experiment_id"])
    record = record_submission(registry, definition["experiment_id"], submission)
    if args.json:
        print(json.dumps(record, indent=2, ensure_ascii=False))
    else:
        print(f"{record['run_id']}: {record['status']} ({record['hypothesis_verdict']})")
        print(record["interpretation"]["deterministic"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
