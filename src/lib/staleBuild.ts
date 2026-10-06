/**
 * Every deploy renames every chunk, and the old names stop existing. A page
 * opened before a deploy still holds the old names, so the first lazy chunk it
 * asks for afterwards (the cinematic camera, anything behind a hidden entrance)
 * is a 404, and the dynamic import rejects. Nothing is wrong with the browser or
 * with WebGL; the page is older than the site.
 *
 * Routes recover by themselves: TanStack Router's lazy route loader reloads
 * once on the same errors. Components loaded with `React.lazy` cannot — the
 * rejection is cached, so asking again fails again — and reloading for the
 * visitor would discard whatever they had open. So a boundary that catches
 * one of these says what happened and offers the reload.
 */
const CHUNK_FAILURES = [
  // Chromium, Firefox and Safari word a failed module fetch differently.
  "Failed to fetch dynamically imported module",
  "error loading dynamically imported module",
  "Importing a module script failed",
  // Vite's preload helper, when a chunk's stylesheet is the part that is gone.
  "Unable to preload CSS",
];

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return CHUNK_FAILURES.some((prefix) => message.startsWith(prefix));
}

export const STALE_BUILD_NOTICE =
  "The site has been updated since this page was opened, and the part it needs " +
  "now has a different name. Reload to open the current version.";

export function reloadPage(): void {
  window.location.reload();
}
