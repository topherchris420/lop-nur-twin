#!/usr/bin/env python3
"""A stand-in for a local OpenAI-compatible model server, for offline tests.

It is not a model and claims nothing a model would. It answers
``GET /v1/models`` and ``POST /v1/chat/completions`` on loopback with
deterministic text built from the request itself: each reply quotes, word
for word, one sentence from the research-paper excerpts R.A.I.N. put in the
prompt (the ``--- PAPER: <path> ---`` blocks), so R.A.I.N.'s own citation
check has real corpus text to verify, and one sentence that is in no paper,
so the check has a quotation to refuse. Every reply says it came from the
stand-in. The bridge and the lab label the meeting with the model name this
server reports, ``stand-in-model``, never a real model's.

    python tools/rain-bridge/stand_in_model.py --port 8791

Standard library only; loopback only.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

MODEL = "stand-in-model"
DUMP = os.environ.get("STAND_IN_MODEL_DUMP", "")
MAX_BODY = 4 * 1024 * 1024
# R.A.I.N.'s prompt lists papers under "### SHARED RESEARCH DATABASE"; each
# excerpt ends at the next paper or the next "###" section (the transcript).
PAPER = re.compile(r"^--- PAPER: (?P<ref>[^\n]+?) ---\n(?P<body>.*?)(?=^--- PAPER: |^### |\Z)", re.M | re.S)
# A plain prose sentence: no markup, no quotes of its own, a sensible length.
SENTENCE = re.compile(r"(?<![\w.])([A-Z][^\"*#`|<>\[\]{}]{60,220}?[a-z0-9)]\.)(?=\s|$)")
# The quote an earlier stand-in reply made, carried through R.A.I.N.'s
# critique-and-revise passes, whose prompts hold the reply but no papers.
EARLIER = re.compile(r'quoted exactly: "([^"]{20,400})"')
#: A quotation no paper contains: R.A.I.N.'s check must not verify it.
INVENTED = "The stand-in model wrote this sentence itself, and no paper in the corpus contains it."


def sentences(prompt: str) -> list[str]:
    """Sentences from the paper excerpts. PDF text breaks lines mid-sentence;
    R.A.I.N.'s matcher collapses whitespace, so a sentence is quoted with its
    line breaks as spaces and still matches the paper exactly."""
    found: list[str] = []
    for paper in PAPER.finditer(prompt):
        flat = " ".join(paper.group("body").split())
        found.extend(m.group(1) for m in SENTENCE.finditer(flat) if "stand-in" not in m.group(1))
    return found


def reply(messages: list[dict[str, Any]], max_tokens: int) -> str:
    text = "\n".join(str(m.get("content") or "") for m in messages if isinstance(m, dict))
    if max_tokens <= 8:
        return "ok"
    pool = sentences(text)
    if not pool:
        pool = EARLIER.findall(text)[:1]
    # Deterministic: the same request always gets the same sentence.
    digest = int(hashlib.sha256(text.encode("utf-8", "ignore")).hexdigest(), 16)
    if not pool:
        return ("[stand-in model] The prompt carried no paper excerpt this stand-in could quote, "
                "so there is nothing here to verify. This is a test reply, not analysis, and it "
                "makes no claim about the question.")
    quote = pool[digest % len(pool)]
    return (f"[stand-in model] One sentence from the excerpts, quoted exactly: \"{quote}\" "
            f"And one that is in no paper, for the check to refuse: \"{INVENTED}\" "
            "This reply comes from a test double that copies a sentence from the corpus so "
            "that the citation check has something real to verify. It is not analysis, it "
            "weighs nothing, and it should not be read as an argument for or against any "
            "hypothesis. A real local model would answer here instead, with its own reasoning "
            "and its own quotations, each checked against the same corpus.")


class Handler(BaseHTTPRequestHandler):
    server_version = "stand-in-model/1"

    def log_message(self, *_: Any) -> None:  # quiet
        return

    def send(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path.rstrip("/") == "/v1/models":
            self.send(200, {"object": "list", "data": [{"id": MODEL, "object": "model", "owned_by": "test"}]})
        else:
            self.send(404, {"error": {"message": "not found"}})

    def do_POST(self) -> None:  # noqa: N802
        if self.path.rstrip("/") != "/v1/chat/completions":
            self.send(404, {"error": {"message": "not found"}})
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            self.send(413, {"error": {"message": "body too large"}})
            return
        try:
            body = json.loads(self.rfile.read(length))
        except (ValueError, UnicodeDecodeError):
            self.send(400, {"error": {"message": "invalid JSON"}})
            return
        messages = body.get("messages") if isinstance(body, dict) else None
        if not isinstance(messages, list):
            self.send(400, {"error": {"message": "messages required"}})
            return
        max_tokens = body.get("max_tokens") if isinstance(body.get("max_tokens"), int) else 512
        if DUMP:  # debugging aid: keep the last request, to see what the client sends
            Path(DUMP).write_text(json.dumps(body, indent=1), encoding="utf-8")
        content = reply(messages, max_tokens)
        self.send(200, {
            "id": "chatcmpl-stand-in-" + hashlib.sha256(content.encode()).hexdigest()[:12],
            "object": "chat.completion",
            "created": int(time.time()),
            "model": MODEL,
            "choices": [{"index": 0, "finish_reason": "stop",
                         "message": {"role": "assistant", "content": content}}],
            # No usage block: this server counts no tokens, and reports none.
        })


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--port", type=int, default=8791)
    args = parser.parse_args(argv)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"stand-in model on http://127.0.0.1:{server.server_address[1]}/v1 · model {MODEL} · "
          "a test double, not a model", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
