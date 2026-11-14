"""Read-only stdio MCP tools for an operator-configured institutional memory service."""
import argparse
import json
import os
import sys
from urllib.request import ProxyHandler, Request, build_opener

from sources import NoRedirect, loopback

TOOLS = {
    "rain_memory_recall": ("recall", "Search the lab's typed research records.", {"query": {"type": "string"}}),
    "rain_memory_resume": ("resume", "Retrieve your open research handoffs and their original evidence.", {}),
    "rain_memory_trace": ("trace", "Trace an institutional record to its provenance.", {"hash": {"type": "string"}}),
}


def dispatch(message, call):
    method = message.get("method")
    if method == "initialize":
        version = message.get("params", {}).get("protocolVersion")
        return {"protocolVersion": version if version in {"2025-11-25", "2025-06-18", "2025-03-26"} else "2025-11-25",
                "capabilities": {"tools": {}}, "serverInfo": {"name": "rain-memory", "version": "1.0.0"}}
    if method == "ping":
        return {}
    if method == "tools/list":
        return {"tools": [{"name": name, "description": description,
                           "inputSchema": {"type": "object", "properties": props, "required": list(props),
                                           "additionalProperties": False},
                           "annotations": {"readOnlyHint": True}}
                          for name, (_, description, props) in TOOLS.items()]}
    if method == "tools/call":
        params = message.get("params", {})
        action, _, props = TOOLS[params["name"]]
        args = params.get("arguments", {})
        if not isinstance(args, dict) or set(args) != set(props):
            raise ValueError("Unexpected arguments")
        try:
            result = call(action, args)
        except (OSError, ValueError):
            return {"isError": True, "content": [{"type": "text", "text": "Memory request declined or unavailable"}]}
        return {"content": [{"type": "text", "text": json.dumps(result)}]}
    raise ValueError("Unsupported method")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--service", default="http://127.0.0.1:8768")
    args = parser.parse_args()
    base = loopback(args.service)
    token = os.environ.get("RAIN_MEMORY_TOKEN")
    if not token:
        parser.error("Set RAIN_MEMORY_TOKEN to the agent's credential")
    opener = build_opener(ProxyHandler({}), NoRedirect())

    def call(action, payload):
        request = Request(f"{base}/{action}", data=json.dumps(payload).encode(),
                          headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"})
        with opener.open(request, timeout=5) as response:
            data = response.read(2_000_001)
        if len(data) > 2_000_000:
            raise ValueError("Response exceeds budget")
        return json.loads(data)["result"]

    while raw := sys.stdin.buffer.readline(64_001):
        if len(raw) > 64_000:
            break
        request_id = None
        try:
            message = json.loads(raw)
            if not isinstance(message, dict) or message.get("jsonrpc") != "2.0":
                raise ValueError("Invalid JSON-RPC envelope")
            if "id" not in message:
                continue
            request_id = message["id"]
            result = {"result": dispatch(message, call)}
        except (ValueError, KeyError, TypeError, AttributeError):
            result = {"error": {"code": -32602, "message": "Invalid institutional memory request"}}
        print(json.dumps({"jsonrpc": "2.0", "id": request_id, **result}), flush=True)


if __name__ == "__main__":
    main()
