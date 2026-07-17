import { useTwinStore } from "./store";
import type { StructureDef } from "./layout";

/**
 * Glide the orbit camera to frame a structure: offset to the southeast,
 * elevated proportionally to the structure's size.
 */
export function flyToStructure(def: StructureDef): void {
  const [x, z] = def.position;
  const footprint = Math.max(def.size[0], def.size[2]);
  const dist = Math.min(340, Math.max(70, footprint * 3.2));
  useTwinStore
    .getState()
    .requestFlyTo(
      [x + dist * 0.62, def.size[1] * 1.6 + dist * 0.55, z + dist * 0.62],
      [x, def.size[1] * 0.45, z],
    );
}

/** Fly the orbit camera to an arbitrary ground point (minimap clicks). */
export function flyToPoint(x: number, z: number): void {
  useTwinStore.getState().requestFlyTo([x + 160, 260, z + 160], [x, 0, z]);
}
