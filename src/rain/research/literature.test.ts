import { describe, expect, it, vi } from "vitest";
import { searchResearchLiterature } from "../autonomy/models.js";
import { parseCrossref, corpusContext, mathematicsContext } from "./knowledge.js";
import { sha256 } from "../sha256.js";
const body = JSON.stringify({
  message: {
    items: [
      {
        DOI: "10.5555/test",
        title: ["A source"],
        abstract: "<jats:p>An abstract only.</jats:p>",
        author: [{ given: "A", family: "Researcher" }],
        published: { "date-parts": [[2020]] },
      },
      { DOI: "10.5555/metadata", title: ["Metadata only"] },
    ],
  },
});
describe("bounded public literature and pinned knowledge", () => {
  it("records exact response bytes and distinguishes abstract from metadata-only reading", async () => {
    const transport = vi.fn(
      async () => new Response(body, { headers: { "content-type": "application/json" } }),
    );
    const r = await searchResearchLiterature(
      "urban movement",
      2,
      new AbortController().signal,
      transport,
    );
    expect(r.raw).toBe(body);
    expect(r.response_sha256).toBe(sha256(body));
    expect(r.sources[0]!.excerpt).toBe("An abstract only.");
    expect(r.sources[0]!.reading_scope).toContain("full text not read");
    expect(r.sources[1]!.reading_scope).toContain("metadata only");
    expect(r.sources[0]!.doi).toBe("10.5555/test");
    const [url, init] = transport.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(url).origin).toBe("https://api.crossref.org");
    expect(init.redirect).toBe("error");
  });
  it("cannot turn query content into a URL to fetch", async () => {
    const transport = vi.fn(
      async () => new Response(body, { headers: { "content-type": "application/json" } }),
    );
    await searchResearchLiterature(
      "http://127.0.0.1/private",
      1,
      new AbortController().signal,
      transport,
    );
    const [url] = transport.mock.calls[0] as unknown as [string];
    expect(new URL(url).hostname).toBe("api.crossref.org");
    expect(new URL(url).searchParams.get("query.bibliographic")).toBe(
      "http://127.0.0.1/private",
    );
  });
  it("rejects redirects, oversized bodies, malformed metadata and invalid query bounds", async () => {
    const signal = new AbortController().signal;
    await expect(
      searchResearchLiterature(
        "test",
        1,
        signal,
        async () => new Response("", { status: 302 }),
      ),
    ).rejects.toThrow();
    await expect(
      searchResearchLiterature(
        "test",
        1,
        signal,
        async () =>
          new Response("x".repeat(513 * 1024), {
            headers: { "content-type": "application/json" },
          }),
      ),
    ).rejects.toThrow("bound");
    await expect(
      searchResearchLiterature(
        "test",
        1,
        signal,
        async () =>
          new Response("{}", { headers: { "content-type": "application/json" } }),
      ),
    ).rejects.toThrow("Malformed");
    const transport = vi.fn();
    await expect(
      searchResearchLiterature("x".repeat(201), 1, signal, transport),
    ).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
    expect(() => parseCrossref("{}", "q", "url", "now", 1)).toThrow();
  });
  it("derives reproducible source identities from the pinned corpus and mathematical index", () => {
    const papers = corpusContext("resonance evidence authority");
    expect(papers.length).toBeGreaterThan(0);
    expect(papers).toEqual(corpusContext("resonance evidence authority"));
    const math = mathematicsContext("spectral graph bounds");
    expect(math.length).toBeGreaterThan(0);
    expect(math.map((s) => s.id)).toEqual(
      mathematicsContext("spectral graph bounds").map((s) => s.id),
    );
    expect(math.every((s) => s.reading_scope.includes("Lean was not executed"))).toBe(
      true,
    );
  });
});
