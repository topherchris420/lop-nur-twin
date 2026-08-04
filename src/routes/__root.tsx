import { Crosshair, MoveLeft } from "lucide-react";
import { Link, Outlet, createRootRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export const Route = createRootRoute({
  component: () => <Outlet />,
  notFoundComponent: NotFound,
});

/**
 * Unknown paths are rewritten to `index.html` in production, so a typo or a
 * stale link arrives here rather than at a server 404. The router's own
 * fallback is unstyled text in the top-left corner with no way out — this at
 * least looks like the rest of the site and offers the two views that exist.
 */
function NotFound() {
  const path = typeof window === "undefined" ? "" : window.location.pathname;
  return (
    <div className="grid h-full w-full place-items-center p-6">
      <div className="hud-panel max-w-md p-8 text-center">
        <div className="text-muted-foreground font-mono text-[10px] tracking-[0.35em] uppercase">
          Lop Nur · No such view
        </div>
        <p className="text-foreground/90 mt-4 font-mono text-sm break-all">
          {path.slice(0, 80)}
        </p>
        <p className="text-muted-foreground mt-3 text-sm">
          Nothing is mapped to that address. Both views of the site are below.
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
      </div>
    </div>
  );
}
