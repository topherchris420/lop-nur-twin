"""Loopback agent service. Run the operator and agent processes as separate OS users."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import socket

from memory import Credentials, Journal, canonical, pending, standing


def dispatch(journal, principal, action, args):
    if not isinstance(args, dict):
        raise ValueError("Expected object arguments")
    if action == "recall" and set(args) == {"query"}:
        records = journal.recall(args["query"])
        state = standing(journal.snapshot())
        return [{**r, "review": state.get(r["hash"])} for r in records]
    if action == "resume" and not args and principal.role == "researcher":
        records = journal.snapshot()
        lookup = {r["hash"]: r for r in records}
        return [{"handoff": r, "sources": [lookup[h] for h in r["event"]["refs"]]}
                for r in pending(records, principal.name)]
    if action == "trace" and set(args) == {"hash"} and isinstance(args["hash"], str):
        records = journal.snapshot()
        by_hash = {r["hash"]: r for r in records}
        todo, seen = [args["hash"]], set()
        while todo:
            key = todo.pop()
            if key in seen:
                continue
            if key not in by_hash:
                raise ValueError("Unknown event")
            seen.add(key)
            todo.extend(by_hash[key]["event"]["refs"])
        return [r for r in records if r["hash"] in seen]
    if action == "append":
        # Instrument and verifier ingestion uses the ATLAS-verifying operator
        # pipeline, never a client credential asserting a digest or verdict.
        if principal.role not in {"researcher", "reviewer"}:
            raise PermissionError("This role cannot append through the service")
        return journal.append(principal, args)
    raise ValueError("Unknown action or invalid arguments")


def serve(journal, credentials, port):
    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(10)

        def log_message(self, *_):
            pass

        def reply(self, status, body):
            raw = canonical(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def do_POST(self):
            try:
                if self.headers.get("Host") != f"127.0.0.1:{self.server.server_port}" or "Origin" in self.headers:
                    raise PermissionError("Local agent requests only")
                if self.path not in {"/recall", "/resume", "/trace", "/append"}:
                    return self.reply(404, {"error": "Unknown route"})
                scheme, _, token = self.headers.get("Authorization", "").partition(" ")
                if scheme != "Bearer":
                    raise PermissionError("Authentication required")
                principal = credentials.authenticate(token)
                if self.headers.get_content_type() != "application/json" or "Transfer-Encoding" in self.headers:
                    raise ValueError("Expected JSON body with Content-Length")
                size = int(self.headers.get("Content-Length", "0"))
                if not 2 <= size <= 16_000:
                    raise ValueError("Invalid request size")
                result = dispatch(journal, principal, self.path[1:], json.loads(self.rfile.read(size)))
                self.reply(200, {"result": result})
            except PermissionError:
                self.reply(403, {"error": "Forbidden"})
            except (ValueError, TypeError, UnicodeError, socket.timeout):
                self.reply(400, {"error": "Invalid request or unavailable verified state"})

    with ThreadingHTTPServer(("127.0.0.1", port), Handler) as server:
        server.serve_forever()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("journal", type=Path)
    parser.add_argument("credentials", type=Path)
    parser.add_argument("--port", type=int, default=8768)
    args = parser.parse_args()
    if args.credentials.stat().st_mode & 0o077:
        parser.error("Credentials must be owner-only")
    serve(Journal(args.journal), Credentials(json.loads(args.credentials.read_text())), args.port)


if __name__ == "__main__":
    main()
