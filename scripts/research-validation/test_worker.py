"""The worker's closed input protocol must fail before upstream imports."""

import json
import subprocess
import sys
from pathlib import Path

import pytest
import worker


@pytest.mark.parametrize("raw", [
    b"{}", b"[]", b"null", b"not JSON", b"{" ,
    b'{"adapter":"qnp-stable","adapter":"drr-null","parameters":{},"seeds":[1],"repositories":{}}',
    b'{"adapter":"qnp-stable","parameters":{"alpha":NaN},"seeds":[1],"repositories":{}}',
    b" " * (worker.MAX_INPUT_BYTES + 1),
])
def test_invalid_protocol_is_rejected(raw):
    with pytest.raises(ValueError):
        worker.request_from_bytes(raw)


def test_worker_has_no_traceback_or_path_disclosure():
    result = subprocess.run(
        [sys.executable, "-B", str(Path(worker.__file__))], input=b"{}",
        capture_output=True, timeout=10, check=False,
    )
    assert result.returncode == 2
    assert result.stderr == b""
    assert json.loads(result.stdout)["error"]["code"] == "invalid_probe_request"
    assert b"Traceback" not in result.stdout


def test_worker_separates_diagnostics_from_evidence(monkeypatch):
    def fake_probe(**_payload):
        print("upstream diagnostic")
        print("private diagnostic", file=sys.stderr)
        return {"samples": [1.0], "checks": {"control": True}, "details": {}, "provenance": {}}

    monkeypatch.setattr(worker, "run_probe", fake_probe)
    result = worker.execute({})
    assert result["samples"] == [1.0]
    diagnostic = result["provenance"]["diagnostic_output"]
    assert diagnostic["stdout"]["bytes"] > 0
    assert diagnostic["stderr"]["bytes"] > 0
    assert "private diagnostic" not in json.dumps(result)
