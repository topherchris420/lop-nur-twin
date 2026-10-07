/**
 * What a recorded model revision is identified by, shared by the recorder and
 * the build's validator so the two can never disagree about it.
 */

import { createHash } from "node:crypto";

import { canonicalJson } from "../src/lib/canonicalJson";

export function sha256(bytes: Buffer | string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/**
 * What the manifest says, without when it was generated or the package
 * version: SHA-256 over its canonical JSON with those two fields removed.
 */
export function contentKey(manifestText: string): string {
  const manifest = JSON.parse(manifestText) as Record<string, unknown>;
  delete manifest["generatedAt"];
  delete manifest["modelVersion"];
  return sha256(canonicalJson(manifest));
}
