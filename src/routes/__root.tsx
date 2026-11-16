import { Crosshair, MoveLeft, RotateCw } from "lucide-react";
import {
  Link,
  Outlet,
  createRootRoute,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { isChunkLoadError, reloadPage, STALE_BUILD_NOTICE } from "@/lib/staleBuild";

export const Route = createRootRoute({
  component: () => <Outlet />,
  notFoundComponent: NotFound,
  errorComponent: RouteError,
});

/**
 * A route that throws while it renders, with no boundary of its own, lands
 * here. The router's fallback for that is "Something went wrong!" in unstyled
 * text in a corner and a button that shows a stack: what `/live` served when a
 * three release broke the clay model's shader patch. A page that has failed
 * still owes its visitor what happened, a way to try again, and the views that
 * do not depend on whatever broke.
 *
 * The links are plain anchors, not router links: a fresh document load
 * re-evaluates every module, and the module that threw may be one the next
 * view shares.
 */
function RouteError({ error }: ErrorComponentProps) {
  const stale = isChunkLoadError(error);
  const message = error instanceof Error ? error.message : String(error);
  return (
    <main className="grid h-full w-full place-items-center overflow-y-auto p-6">
      <div role="alert" className="hud-panel max-w-md p-8 text-center">
        <p className="text-muted-foreground font-mono text-[10px] tracking-[0.35em] uppercase">
          Lop Nur · This view stopped
        </p>
        <h1 className="text-foreground mt-4 text-lg font-semibold">
          {stale ? "This page is older than the site" : "This view could not be drawn"}
        </h1>
        <p className="text-muted-foreground mt-3 text-sm">
          {stale
            ? STALE_BUILD_NOTICE
            : "Part of it failed while loading. Nothing was changed or lost; reloading tries again, and the views below do not need a 3D renderer."}
        </p>
        {stale ? null : (
          <p className="text-foreground/80 mt-3 font-mono text-xs break-words">
            {message.slice(0, 200)}
          </p>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button onClick={reloadPage}>
            <RotateCw />
            Reload
          </Button>
          <Button asChild variant="outline">
            <a href="/">
              <MoveLeft />
              Back to the twin
            </a>
          </Button>
        </div>
        <ul className="text-muted-foreground mt-4 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs">
          <li>
            <a href="/analysis" className="underline">
              Analysis table
            </a>
          </li>
          <li>
            <a href="/compare" className="underline">
              Manifest comparison
            </a>
          </li>
          <li>
            <a href="/evaluation" className="underline">
              Evaluations
            </a>
          </li>
        </ul>
      </div>
    </main>
  );
}

/**
 * Unknown paths are rewritten to `index.html` in production, so a typo or a
 * stale link arrives here rather than at a server 404. The router's own
 * fallback is unstyled text in the top-left corner with no way out — this at
 * least looks like the rest of the site and offers every view that exists.
 */
function NotFound() {
  const path = typeof window === "undefined" ? "" : window.location.pathname;
  return (
    <main className="grid h-full w-full place-items-center overflow-y-auto p-6">
      <div className="hud-panel max-w-md p-8 text-center">
        <h1 className="text-muted-foreground font-mono text-[10px] font-normal tracking-[0.35em] uppercase">
          Lop Nur · No such view
        </h1>
        <p className="text-foreground/90 mt-4 font-mono text-sm break-all">
          {path.slice(0, 80)}
        </p>
        <p className="text-muted-foreground mt-3 text-sm">
          Nothing is mapped to that address. These are the views the site has.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button asChild>
            <Link to="/">
              <MoveLeft />
              Back to the twin
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/play">
              <Crosshair />
              Play Blacksite
            </Link>
          </Button>
        </div>
        <ul className="text-muted-foreground mt-4 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs">
          <li>
            <Link to="/analysis" className="underline">
              Analysis table
            </Link>
          </li>
          <li>
            <Link to="/compare" className="underline">
              Manifest comparison
            </Link>
          </li>
          <li>
            <Link to="/evaluation" className="underline">
              Evaluations
            </Link>
          </li>
          <li>
            <Link to="/noeterra" className="underline">
              Noeterra civilizations
            </Link>
          </li>
        </ul>
      </div>
    </main>
  );
}
