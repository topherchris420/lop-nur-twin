import { describe, expect, it } from "vitest";
import { isChunkLoadError } from "./staleBuild";

describe("isChunkLoadError", () => {
  it("recognises a renamed chunk in every engine's words", () => {
    for (const message of [
      "Failed to fetch dynamically imported module: https://x/assets/App-1.js",
      "error loading dynamically imported module: https://x/assets/App-1.js",
      "Importing a module script failed.",
      "Unable to preload CSS for /assets/App-1.css",
    ])
      expect(isChunkLoadError(new TypeError(message))).toBe(true);
  });

  it("leaves every other failure alone", () => {
    expect(isChunkLoadError(new Error("WebGL context lost"))).toBe(false);
    expect(isChunkLoadError("Failed to fetch dynamically imported module")).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });
});
