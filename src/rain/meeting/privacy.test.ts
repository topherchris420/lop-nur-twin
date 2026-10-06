import { describe, expect, it } from "vitest";
import {
  PrivacyError,
  classifyHost,
  classifyIp,
  classifyUrl,
  enforceMeetingPrivacy,
} from "./privacy.js";

/** `RAIN_MEETING_PRIVACY=local` keeps a meeting on this machine or its network. */
const resolver = (table: Record<string, string[]>) => async (host: string) =>
  table[host] ?? [];

describe("meeting privacy", () => {
  it("classifies addresses", () => {
    expect(classifyIp("127.0.0.1")).toBe("loopback");
    expect(classifyIp("::1")).toBe("loopback");
    expect(classifyIp("::ffff:127.0.0.1")).toBe("loopback");
    expect(classifyIp("10.1.2.3")).toBe("private");
    expect(classifyIp("172.16.0.9")).toBe("private");
    expect(classifyIp("172.32.0.9")).toBe("remote");
    expect(classifyIp("192.168.1.1")).toBe("private");
    expect(classifyIp("169.254.3.4")).toBe("private");
    expect(classifyIp("fd12::1")).toBe("private");
    expect(classifyIp("fe80::1")).toBe("private");
    expect(classifyIp("93.184.216.34")).toBe("remote");
    expect(classifyIp("2606:4700::1")).toBe("remote");
    expect(classifyIp("not an address")).toBe("remote");
  });

  it("classifies hosts and URLs through the resolver", async () => {
    const resolve = resolver({
      "lan.local": ["192.168.0.2"],
      "mixed.example": ["10.0.0.1", "93.184.216.34"],
      "api.example": ["93.184.216.34"],
    });
    expect(await classifyHost("localhost")).toBe("loopback");
    expect(await classifyHost("LOCALHOST.")).toBe("loopback");
    expect(await classifyHost("[::1]")).toBe("loopback");
    expect(await classifyHost("lan.local", resolve)).toBe("private");
    expect(await classifyHost("mixed.example", resolve)).toBe("remote");
    expect(await classifyHost("unknown.example", resolve)).toBe("remote");
    expect(await classifyUrl("http://127.0.0.1:11434/v1", resolve)).toBe("loopback");
    expect(await classifyUrl("https://api.example/v1", resolve)).toBe("remote");
    expect(await classifyUrl("not a url", resolve)).toBe("remote");
  });

  it("fails closed under local privacy and passes hybrid through", async () => {
    const resolve = resolver({ "api.example": ["93.184.216.34"] });
    expect(
      await enforceMeetingPrivacy(
        "local",
        "http://127.0.0.1:11434/v1",
        "qwen2.5:7b",
        resolve,
      ),
    ).toBe("local");
    expect(
      await enforceMeetingPrivacy(
        "local",
        "http://10.0.0.5:1234/v1",
        "qwen2.5:7b",
        resolve,
      ),
    ).toBe("local");
    await expect(
      enforceMeetingPrivacy(
        "local",
        "http://127.0.0.1:11434/v1",
        "gpt-oss:cloud",
        resolve,
      ),
    ).rejects.toThrow(PrivacyError);
    await expect(
      enforceMeetingPrivacy("local", "https://api.example/v1", "qwen2.5:7b", resolve),
    ).rejects.toThrow(/not loopback or private-network/);
    expect(
      await enforceMeetingPrivacy(
        "hybrid",
        "https://api.example/v1",
        "gpt-oss:cloud",
        resolve,
      ),
    ).toBe("hybrid");
  });
});
