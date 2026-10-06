/**
 * Places that open inside a page without a URL of their own — a hidden
 * environment, a room inside it — still deserve the browser's Back. Without an
 * entry, Back from one of them leaves the site altogether.
 *
 * Each open layer takes a history entry on the same URL, its name listed under
 * `LAYERS_KEY` in `history.state`. Back pops the entry, and the component that
 * owns the layer closes it when the list stops naming it. Closing from inside
 * the page goes through Back too, so the entry never outlives the layer.
 *
 * Nothing opens from history: an entry that names a layer which is not open (a
 * page reloaded inside one, a Forward past a closed one) is rewritten without
 * it when it is reached. The router keeps working throughout — TanStack's
 * history wraps `pushState`/`replaceState` and treats these as same-route
 * entries.
 */
const LAYERS_KEY = "lopNurLayers";

function currentState(): Record<string, unknown> {
  const state: unknown = window.history.state;
  return state !== null && typeof state === "object" ? { ...state } : {};
}

export function layersOf(state: unknown): string[] {
  if (state === null || typeof state !== "object") return [];
  const value = (state as Record<string, unknown>)[LAYERS_KEY];
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

/** Adds an entry naming `name` on top of the layers already open. */
export function pushLayer(name: string): void {
  const state = currentState();
  const index = typeof state.__TSR_index === "number" ? state.__TSR_index : 0;
  window.history.pushState(
    // The router reads the index to tell Back from Forward; keep it counting.
    { ...state, __TSR_index: index + 1, [LAYERS_KEY]: [...layersOf(state), name] },
    "",
  );
}

/**
 * Closes `name` through Back when the current entry is its own. Returns false
 * when it is not (the caller then closes the layer directly).
 */
export function closeLayer(name: string): boolean {
  if (layersOf(window.history.state).at(-1) !== name) return false;
  window.history.back();
  return true;
}

/** Rewrites the current entry so it names only `keep`'s layers. */
export function forgetLayers(keep: (name: string) => boolean): void {
  const state = currentState();
  const layers = layersOf(state);
  const kept = layers.filter(keep);
  if (kept.length === layers.length) return;
  window.history.replaceState({ ...state, [LAYERS_KEY]: kept }, "");
}

/** Calls `fn` with the layers the entry reached by Back or Forward names. */
export function onLayersChange(fn: (layers: string[]) => void): () => void {
  const pop = (event: PopStateEvent) => fn(layersOf(event.state));
  window.addEventListener("popstate", pop);
  return () => window.removeEventListener("popstate", pop);
}
