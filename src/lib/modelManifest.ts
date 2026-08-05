/**
 * Reading the release manifest from the running application.
 *
 * `public/model-manifest.json` is written by `scripts/generate-manifest.ts`
 * before every build. The app fetches it lazily, same-origin, so a reviewer
 * can see the hashes and counts of the exact build they are looking at
 * without leaving the page — and can download the file itself as evidence.
 *
 * This is the only request the analytical view makes at runtime, and it goes
 * to the same origin that served the page. Counts shown next to it in the UI
 * are computed in-app from the same data, so the panel degrades to something
 * still true if the manifest has not been generated.
 */

import { useEffect, useRef, useState } from "react";

export const MODEL_MANIFEST_PATH = "/model-manifest.json";

export interface ModelManifest {
  modelName: string;
  modelVersion: string;
  generatedAt: string;
  coordinateReferenceSystem: string;
  evidenceRecordCount: number;
  sourceCount: number;
  structureCount: number;
  geometryHash: string;
  evidenceLedgerHash: string;
  validationStatus: string;
  knownLimitations: readonly string[];
}

function isModelManifest(value: unknown): value is ModelManifest {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate["modelName"] === "string" &&
    typeof candidate["modelVersion"] === "string" &&
    typeof candidate["generatedAt"] === "string" &&
    typeof candidate["geometryHash"] === "string" &&
    typeof candidate["evidenceLedgerHash"] === "string" &&
    typeof candidate["validationStatus"] === "string" &&
    Array.isArray(candidate["knownLimitations"])
  );
}

export type ManifestState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; manifest: ModelManifest }
  | { status: "unavailable"; reason: string };

/**
 * Fetches the manifest once, when `enabled` first becomes true. Failure is a
 * normal outcome — a dev server started without running `manifest`, an
 * offline mirror — and reports as `unavailable` rather than throwing.
 */
export function useModelManifest(enabled: boolean): ManifestState {
  const [state, setState] = useState<ManifestState>({ status: "idle" });
  /**
   * Fetch once per mount, tracked in a ref rather than in the effect's
   * dependencies. Depending on the state here is the obvious version and it
   * deadlocks: setting `loading` re-runs the effect, whose cleanup aborts the
   * request that was still in flight, and the panel reads "Reading the
   * manifest…" forever. The ref is reset on cleanup so React 19's
   * StrictMode double-mount still ends with a live request.
   */
  const started = useRef(false);

  useEffect(() => {
    if (!enabled || started.current) return;
    started.current = true;
    let cancelled = false;
    setState({ status: "loading" });

    fetch(MODEL_MANIFEST_PATH, {
      credentials: "omit",
      cache: "no-cache",
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`manifest request returned ${response.status}`);
        return (await response.json()) as unknown;
      })
      .then((value) => {
        if (cancelled) return;
        if (!isModelManifest(value))
          throw new Error("manifest did not match the expected shape");
        setState({ status: "ready", manifest: value });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          status: "unavailable",
          reason: error instanceof Error ? error.message : "manifest unavailable",
        });
      });

    return () => {
      cancelled = true;
      started.current = false;
    };
  }, [enabled]);

  return state;
}

/** `sha256:abcd…` shortened for a panel, with the full value kept for `title`. */
export function shortHash(hash: string): string {
  const [algorithm, digest] = hash.split(":");
  if (digest === undefined) return hash.slice(0, 16);
  return `${algorithm}:${digest.slice(0, 12)}…${digest.slice(-4)}`;
}
