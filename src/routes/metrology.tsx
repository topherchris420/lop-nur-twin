import { lazy, Suspense } from "react";
import { createFileRoute } from "@tanstack/react-router";

const MetrologyView = lazy(() => import("../bethesda/metrology/view/MetrologyView"));

/**
 * `/metrology` — the ECHO Intelligence Metrology Bench's verified archives,
 * read-only. Unlisted like `/live`: nothing on the site links here, so the
 * Bethesda anomaly stays hidden. The page lives in
 * `src/bethesda/metrology/view/`; the method in
 * docs/ECHO_INTELLIGENCE_METROLOGY.md.
 */
export const Route = createFileRoute("/metrology")({
  component: () => (
    <Suspense fallback={null}>
      <MetrologyView />
    </Suspense>
  ),
});
