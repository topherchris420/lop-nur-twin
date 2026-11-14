"""Optional local retrieval. Responses are source leads, without scientific standing."""
import json
from urllib.error import HTTPError
from urllib.parse import quote, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

from memory import digest


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise HTTPError(args[2], 400, "Redirect refused", None, None)


def loopback(base):
    parsed = urlsplit(base)
    if (parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or parsed.username is not None
            or parsed.path not in {"", "/"} or parsed.query or parsed.fragment or parsed.port is None):
        raise ValueError("An explicit local loopback service is required")
    return base.rstrip("/")


class Anna:
    def __init__(self, base):
        self.base = loopback(base)
        self.opener = build_opener(ProxyHandler({}), NoRedirect())

    def request(self, path, body=None):
        request = Request(self.base + path, data=None if body is None else json.dumps(body).encode(),
                          headers={"Content-Type": "application/json"})
        with self.opener.open(request, timeout=5) as response:
            raw = response.read(256_001)
        if len(raw) > 256_000:
            raise ValueError("Anna response exceeds budget")
        return json.loads(raw)

    def discover(self, query):
        if not isinstance(query, str) or not 1 <= len(query) <= 300:
            raise ValueError("Invalid Anna query")
        result = self.request("/api/v1/agent/search", {"query": query, "limit": 5})
        if result.get("status") != "success" or not isinstance(result.get("results"), list):
            raise ValueError("Anna search failed")
        leads = []
        for hit in result["results"][:5]:
            document = hit["id"]
            if not isinstance(document, str) or not 1 <= len(document) <= 512:
                raise ValueError("Invalid Anna document id")
            citation = self.request(f"/api/v1/document/{quote(document, safe='')}/citation")
            if citation.get("id") != document:
                raise ValueError("Anna citation identity changed")
            leads.append({"provider": "anna", "standing": "context", "hit": hit,
                          "citation": citation, "sha256": digest({"hit": hit, "citation": citation})})
        return leads

    def verify_record(self, record):
        result = self.request("/api/v1/evidence/verify", record)
        return {"provider": "anna", "standing": "context", "verification": result,
                "sha256": digest(result)}


def gbrain_search(call_tool, query, source_id):
    """Use the host's configured, read-only MCP client, pinned to a source."""
    if not isinstance(query, str) or not 1 <= len(query) <= 300 or not isinstance(source_id, str) or not source_id or source_id == "__all__":
        raise ValueError("A bounded query and a configured source are required")
    value = call_tool("search", {"query": query, "source_id": source_id,
                                 "limit": 5, "snippet_chars": 500})
    if not isinstance(value, dict) or value.get("isError") or len(json.dumps(value)) > 256_000:
        raise ValueError("GBrain retrieval failed or exceeded budget")
    return {"provider": "gbrain", "standing": "context", "response": value, "sha256": digest(value)}
