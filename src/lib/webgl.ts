/**
 * Whether this browser can create a WebGL context at all. Both 3D surfaces
 * ask before mounting a canvas, so a browser without WebGL gets a page that
 * says so and points to the routes that work without it, rather than a blank
 * canvas or an error thrown from inside the renderer.
 */
export function canCreateWebGLContext(): boolean {
  if (typeof document === "undefined") return false;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
  if (!context) return false;
  context.getExtension("WEBGL_lose_context")?.loseContext();
  return true;
}
