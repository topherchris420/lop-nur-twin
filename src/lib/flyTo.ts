import { useTwinStore } from "./store";
import { getStructure, type StructureDef } from "./layout";

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

/**
 * Frame the exploded evidence diagram.
 *
 * Stratified X-ray lifts the weaker layers hundreds of metres above the ground,
 * and from the default camera — angled down at the compound — three of the four
 * strata are above the top of the frame. An exploded diagram nobody can see is
 * not a diagram, so entering the mode moves the camera far enough back and low
 * enough to put all four layers in shot at once.
 */
export function frameEvidenceStrata(): void {
  const [x, z] = COMPOUND_FOCUS;
  useTwinStore
    .getState()
    // Below the top stratum and well back, looking slightly up: the layers read
    // as stacked planes rather than as scattered objects seen from above.
    .requestFlyTo([x + 560, 300, z + 690], [x, 175, z]);
}

/** The compound the strata are built over, from the layout's own geometry. */
const COMPOUND_FOCUS: readonly [number, number] = (() => {
  const hangar = getStructure("hangar-main");
  return hangar === undefined ? [1018, 1410] : hangar.position;
})();
