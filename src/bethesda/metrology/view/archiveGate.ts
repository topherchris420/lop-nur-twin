/**
 * The research view's gate: an archive is shown only if the browser can check
 * it. The summary's bytes must hash to the manifest's digest, the committed
 * verification must name this very manifest and say VERIFIED (static checks
 * passed and a sample of runs re-simulated byte for byte), the archived
 * protocol must hash to its digest too, and the files must agree on protocol
 * and split. Anything else is shown as unverified, with the reason, and no
 * number from it is displayed.
 *
 * Pure: raw file texts in, a decision out.
 */
import { canonicalJson, sha256 } from "../../../rain/sha256.js";
import type { Summary } from "../analysis.js";
import type { Manifest } from "../archive.js";
import type { Protocol } from "../protocol.js";
import type { Verification } from "../verify.js";

export interface ArchiveTexts {
  summary: string | undefined;
  manifest: string | undefined;
  verification: string | undefined;
  protocol: string | undefined;
}

export type Gate =
  | {
      shown: true;
      summary: Summary;
      manifest: Manifest;
      verification: Verification;
      manifestDigest: string;
      /** Conditions the protocol declares the candidate's development never met. */
      novel: string[];
    }
  | { shown: false; reasons: string[] };

function parse<T>(text: string | undefined, name: string, reasons: string[]): T | null {
  if (text === undefined) {
    reasons.push(`${name} is missing`);
    return null;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    reasons.push(`${name} is not JSON`);
    return null;
  }
}

export function gateArchive(t: ArchiveTexts): Gate {
  const reasons: string[] = [];
  const manifest = parse<Manifest>(t.manifest, "manifest.json", reasons);
  const verification = parse<Verification>(t.verification, "verification.json", reasons);
  const summary = parse<Summary>(t.summary, "summary.json", reasons);
  const protocol = parse<Protocol>(t.protocol, "protocol.json", reasons);
  if (
    !manifest ||
    !verification ||
    !summary ||
    !protocol ||
    t.summary === undefined ||
    t.protocol === undefined
  )
    return { shown: false, reasons };
  if (manifest.schema !== "eimb-manifest/v1")
    reasons.push("manifest.json is not eimb-manifest/v1");
  if (summary.schema !== "eimb-summary/v1")
    reasons.push("summary.json is not eimb-summary/v1");
  if (verification.schema !== "eimb-verification/v1")
    reasons.push("verification.json is not eimb-verification/v1");
  if (sha256(t.summary) !== manifest.files?.["summary.json"])
    reasons.push("summary.json does not match the digest its manifest records");
  if (sha256(t.protocol) !== manifest.files?.["protocol.json"])
    reasons.push("protocol.json does not match the digest its manifest records");
  const manifestDigest = sha256(canonicalJson(manifest));
  if (verification.manifestDigest !== manifestDigest)
    reasons.push("the verification was made for another manifest");
  if (verification.status !== "VERIFIED")
    reasons.push(
      `the verification status is ${String(verification.status)}, not VERIFIED`,
    );
  if (
    summary.protocol?.digest !== manifest.protocolDigest ||
    summary.split !== manifest.split
  )
    reasons.push("summary and manifest name different protocols or splits");
  if (
    verification.split !== manifest.split ||
    verification.protocol !== manifest.protocol
  )
    reasons.push("verification and manifest name different protocols or splits");
  if (reasons.length) return { shown: false, reasons };
  const novel = (protocol.conditions ?? [])
    .filter((c) => c.novelToCandidate)
    .map((c) => c.id);
  return { shown: true, summary, manifest, verification, manifestDigest, novel };
}
