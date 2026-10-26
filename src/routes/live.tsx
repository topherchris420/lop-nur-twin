import { lazy, Suspense } from "react";
import { createFileRoute } from "@tanstack/react-router";

const LiveFly = lazy(() => import("../bethesda/live/LiveFly"));

/**
 * `/live` — the one Bethesda fly that lives continuously on a server, as its
 * read-only observer serves it. Unlisted: nothing on the site links here, so
 * the Bethesda anomaly stays hidden to visitors who were not given the link.
 * The page and its feed live in `src/bethesda/live/`.
 */
export const Route = createFileRoute("/live")({
  component: () => (
    <Suspense fallback={null}>
      <LiveFly />
    </Suspense>
  ),
});
