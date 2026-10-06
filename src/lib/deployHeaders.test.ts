import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The container image must send the hosted demo's security headers on every
 * response. nginx makes that easy to break silently: a `location` with any
 * `add_header` of its own inherits none from the server block, which once
 * served the app shell, every bundle and the manifest with no CSP at all
 * while the one location without a header was fine.
 */

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

const vercel = JSON.parse(read("vercel.json")) as {
  headers: { source: string; headers: { key: string; value: string }[] }[];
};
const nginx = read("deploy/nginx.conf");
const snippet = read("deploy/security-headers.conf");
const INCLUDE = "include /etc/nginx/snippets/lop-nur-security-headers.conf;";

/** nginx text without its comments, which mention the very directives checked here. */
const code = (text: string) => text.replace(/#[^\n]*/g, "");

describe("the container's security headers", () => {
  it("match vercel.json's, value for value", () => {
    const hosted = vercel.headers.find((h) => h.source === "/(.*)")!.headers;
    const container = new Map(
      [...code(snippet).matchAll(/add_header\s+(\S+)\s+"([^"]*)"\s+always;/g)].map(
        (m) => [m[1]!, m[2]!],
      ),
    );
    // TLS, and so HSTS, belongs to whoever terminates it in front of the image.
    const expected = hosted.filter((h) => h.key !== "Strict-Transport-Security");
    expect(container.size).toBe(expected.length);
    for (const { key, value } of expected) expect(container.get(key), key).toBe(value);
  });

  it("are included at server level and in every location that sets a header", () => {
    const body = code(nginx);
    const locations = [...body.matchAll(/location\s[^{]*\{([^}]*)\}/g)];
    expect(locations.length).toBeGreaterThan(4);
    const outside = locations.reduce((text, [block]) => text.replace(block, ""), body);
    expect(outside).toContain(INCLUDE);
    for (const [block, inner] of locations)
      if (/\badd_header\b/.test(inner!)) expect(inner, block).toContain(INCLUDE);
  });

  it("are copied into the image where the include looks for them", () => {
    expect(read("Dockerfile")).toContain(
      "COPY --chown=101:101 deploy/security-headers.conf /etc/nginx/snippets/lop-nur-security-headers.conf",
    );
  });
});
