import { describe, expect, it } from "vitest";
import { isAllowedApiHost } from "./hostCheck";

describe("the dev server's API host check", () => {
  it("admits loopback names and IP literals, with or without a port", () => {
    for (const host of [
      "localhost",
      "localhost:5173",
      "LOCALHOST:5173",
      "app.localhost:5173",
      "127.0.0.1:5173",
      "127.0.0.1",
      "192.168.1.20:4173",
      "[::1]:5173",
      "[::1]",
    ])
      expect(isAllowedApiHost(host, []), host).toBe(true);
  });
  it("refuses a rebound name, a missing host and malformed ones", () => {
    for (const host of [
      "evil.example:5173",
      "evil.example",
      "localhost.evil.example:5173",
      "127.0.0.1.evil.example",
      "[::1].evil.example",
      "[not-an-ip]:5173",
      "[::1",
      "localhost:port",
      "",
      "   ",
      undefined,
    ])
      expect(isAllowedApiHost(host, []), String(host)).toBe(false);
  });
  it("admits exactly what allowedHosts lists, and a leading dot's subdomains", () => {
    const allowed = ["twin.test", ".lab.example"];
    expect(isAllowedApiHost("twin.test:5173", allowed)).toBe(true);
    expect(isAllowedApiHost("sub.twin.test:5173", allowed)).toBe(false);
    expect(isAllowedApiHost("lab.example", allowed)).toBe(true);
    expect(isAllowedApiHost("a.lab.example:4173", allowed)).toBe(true);
    expect(isAllowedApiHost("evillab.example", allowed)).toBe(false);
    expect(isAllowedApiHost("evil.example", allowed)).toBe(false);
  });
  it("leaves the check off only where the developer turned host checking off", () => {
    expect(isAllowedApiHost("evil.example:5173", true)).toBe(true);
  });
});
