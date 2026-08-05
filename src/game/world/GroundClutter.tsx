import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { useTwinStore } from "@/lib/store";
import { game } from "../core/gameState";
import { buildGroundClutter } from "./clutter";

/**
 * Mounts the ground clutter.
 *
 * Deliberately mounted *before* `CollisionBaker` in the scene, because effects
 * run in mount order and the baker has to be able to see the cover props in
 * the graph in order to bake colliders out of them.
 */
export function GroundClutter() {
  const scene = useThree((s) => s.scene);
  const qualityTier = useTwinStore((s) => s.qualityTier);

  useEffect(() => {
    const density =
      qualityTier >= 3 ? 1 : qualityTier >= 2 ? 0.82 : qualityTier >= 1 ? 0.58 : 0.34;
    const clutter = buildGroundClutter({ density });
    scene.add(clutter.group);
    game.stats.clutter = clutter.instances;
    return () => {
      scene.remove(clutter.group);
      clutter.dispose();
      game.stats.clutter = 0;
    };
  }, [scene, qualityTier]);

  return null;
}
