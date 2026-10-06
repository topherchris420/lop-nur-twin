/**
 * Whether this browser can start the WebGL2 context the city and the lab
 * render with. R3F configures its renderer asynchronously, so a missing
 * context can reject before a React boundary sees it; probe and release one
 * instead. Controls that only make sense with a view — the touch stick, the
 * hint to drag the street — ask this too, so they never describe a scene that
 * is not there.
 */
export function canRender(): boolean {
  try {
    const context = document.createElement("canvas").getContext("webgl2");
    if (!context) return false;
    context.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}
