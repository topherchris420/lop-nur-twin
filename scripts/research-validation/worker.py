"""One fixed, JSON-in/JSON-out CPU probe; the host enforces process limits."""

from __future__ import annotations

import hashlib
import io
import json
import sys
from contextlib import redirect_stderr, redirect_stdout

from validation import run_probe

MAX_INPUT_BYTES = 65_536
MAX_OUTPUT_BYTES = 200_000


class DiagnosticDigest(io.TextIOBase):
    """Hash upstream diagnostic output without retaining or exposing paths."""

    def __init__(self):
        self.digest = hashlib.sha256()
        self.byte_count = 0

    def write(self, text):
        data = text.encode("utf-8", errors="replace")
        self.digest.update(data)
        self.byte_count += len(data)
        return len(text)

    def receipt(self):
        return {"sha256": self.digest.hexdigest(), "bytes": self.byte_count}


def _reject_constant(_value):
    raise ValueError("JSON constants must be finite")


def _unique_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("duplicate JSON field")
        value[key] = item
    return value


def request_from_bytes(raw: bytes) -> dict:
    if len(raw) > MAX_INPUT_BYTES:
        raise ValueError("probe input exceeds the bound")
    payload = json.loads(raw, parse_constant=_reject_constant, object_pairs_hook=_unique_object)
    if type(payload) is not dict or set(payload) != {"adapter", "parameters", "seeds", "repositories"}:
        raise ValueError("probe payload fields do not match the fixed protocol")
    if type(payload["adapter"]) is not str or type(payload["repositories"]) is not dict:
        raise ValueError("probe payload types do not match the fixed protocol")
    if len(payload["repositories"]) > 8 or any(
        type(key) is not str or type(path) is not str or len(path) > 4096
        for key, path in payload["repositories"].items()
    ):
        raise ValueError("repository mapping exceeds the protocol bound")
    return payload


def execute(payload: dict) -> dict:
    stdout, stderr = DiagnosticDigest(), DiagnosticDigest()
    with redirect_stdout(stdout), redirect_stderr(stderr):
        output = run_probe(**payload)
    output["provenance"]["worker_sha256"] = hashlib.sha256(__file_bytes()).hexdigest()
    output["provenance"]["diagnostic_output"] = {"stdout": stdout.receipt(), "stderr": stderr.receipt()}
    return output


def __file_bytes():
    # The file name is fixed by the host's worker entrypoint, never the payload.
    with open(__file__, "rb") as handle:
        return handle.read()


def main() -> int:
    try:
        if len(sys.argv) != 1:
            raise ValueError("worker accepts no command-line arguments")
        raw = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
        payload = request_from_bytes(raw)
        output = execute(payload)
        encoded = json.dumps(output, allow_nan=False, separators=(",", ":"))
        if len(encoded.encode("utf-8")) > MAX_OUTPUT_BYTES:
            raise ValueError("probe output exceeds the bound")
    except (ValueError, TypeError, OSError, RecursionError):
        print(json.dumps({"error": {"code": "invalid_probe_request", "message": "Probe input or repository verification failed."}}))
        return 2
    except ImportError:
        print(json.dumps({"error": {"code": "dependencies_unavailable", "message": "The selected numeric probe dependencies are unavailable."}}))
        return 3
    except Exception:  # noqa: BLE001 - process boundary: fail closed without exposing local paths
        print(json.dumps({"error": {"code": "probe_execution_failed", "message": "The numeric probe failed; no evidence was admitted."}}))
        return 4
    print(encoded)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
