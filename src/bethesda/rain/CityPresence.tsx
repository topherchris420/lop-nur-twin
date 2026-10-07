import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type * as THREE from "three";
import { groundAt } from "../terrain";
import { sidewalks } from "../network";
import { EMBODIMENT } from "./embodiment";
import type { Perspective } from "./contracts";
import type { PresenceMark } from "./presence";
import type { FigureRig, buildFigure } from "./figures";
import type { FigureAnimator, seedFor } from "./figureMotion";

const WHO = Object.keys(EMBODIMENT) as Perspective[];

/**
 * The pavement an outing walks on, above the terrain: the paving laid over a
 * footway (geometry.ts draws it to +0.1975 m) or the road where a crossing
 * runs over it — the heights the city's own pedestrians stand at (Actors.tsx).
 */
const SIDEWALK = 0.2,
  CROSSING = 0.14;
const crossingSegments = sidewalks.edges
  .filter((e) => e.crossing)
  .map((e) => [sidewalks.nodes.get(e.from)!, sidewalks.nodes.get(e.to)!] as const);
function surfaceAt(x: number, z: number) {
  for (const [a, b] of crossingSegments) {
    const dx = b.x - a.x,
      dz = b.z - a.z;
    const t = Math.max(
      0,
      Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)),
    );
    if (Math.hypot(a.x + dx * t - x, a.z + dz * t - z) < 1.6) return CROSSING;
  }
  return SIDEWALK;
}
const floorAt = (x: number, z: number) => groundAt({ x, z }) + surfaceAt(x, z);

/**
 * The figures load with the first outing, not with the city: most visits
 * never send a perspective out, and the city bundle should not carry them.
 * A failed load (a stale build's renamed chunk) draws no figure and says
 * nothing — the outing itself, its observation and the wall map go on.
 */
interface Kit {
  buildFigure: typeof buildFigure;
  FigureAnimator: typeof FigureAnimator;
  seedFor: typeof seedFor;
}
let kit: Kit | null = null;
let loading: Promise<void> | null = null;
function loadKit() {
  loading ??= Promise.all([import("./figures"), import("./figureMotion")]).then(
    ([figures, motion]) => {
      kit = {
        buildFigure: figures.buildFigure,
        FigureAnimator: motion.FigureAnimator,
        seedFor: motion.seedFor,
      };
    },
    () => undefined,
  );
}
const reducedMotion = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * The lab's perspectives on outings, drawn in the city. Presentation only:
 * the marks come from the lab's store (`presenceSnapshot`), which derives
 * them from the city tick. Nothing here is a simulation agent — no pedestrian
 * sees, avoids or reacts to these figures, and where one stands is never
 * evidence. A faint ring at the feet means the simulator is being asked to
 * observe the place; it is not a measurement.
 *
 * The figures are the lab's own (`figures.ts`), loaded and built the first
 * time each perspective goes out, and they jog — the outing's 3 m/s — with
 * their feet placed on the pavement, at the height the city's pedestrians
 * walk; while the simulator observes, they stand and look round the place.
 *
 * Kept light enough for the city bundle: it imports no lab store or panel.
 */
export function CityPresence({ read }: { read: () => readonly PresenceMark[] }) {
  const group = useRef<THREE.Group>(null);
  const halos = useRef<Partial<Record<Perspective, THREE.Mesh | null>>>({});
  const reduced = useMemo(reducedMotion, []);
  const cast = useRef<
    Partial<
      Record<
        Perspective,
        { rig: FigureRig; animator: FigureAnimator; x: number; z: number }
      >
    >
  >({});
  useEffect(
    () => () => {
      // Out of the group first: a re-run effect (Fast Refresh, StrictMode)
      // keeps the group, and a disposed figure left in it would be drawn.
      for (const c of Object.values(cast.current)) {
        c?.rig.root.removeFromParent();
        c?.rig.dispose();
      }
      cast.current = {};
    },
    [],
  );
  useFrame((_, dt) => {
    const marks = read();
    for (const who of WHO) {
      const halo = halos.current[who];
      const mark = marks.find((m) => m.who === who);
      let c = cast.current[who];
      if (!mark) {
        if (c) c.rig.root.visible = false;
        if (halo) halo.visible = false;
        continue;
      }
      if (!c && !kit) loadKit();
      if (!c && kit && group.current) {
        const rig = kit.buildFigure(who, "city");
        group.current.add(rig.root);
        c = cast.current[who] = {
          rig,
          animator: new kit.FigureAnimator(rig, kit.seedFor(who)),
          x: mark.x,
          z: mark.z,
        };
        c.animator.place(mark.x, mark.z, 0);
      }
      if (!c) continue;
      if (!c.rig.root.visible) {
        // A new outing starts at the lab's door, not where the last one ended.
        c.x = mark.x;
        c.z = mark.z;
        c.animator.place(mark.x, mark.z, c.animator.position.yaw);
      }
      c.rig.root.visible = true;
      // Ease toward the 10 Hz position so the walk reads as a walk.
      const k = reduced ? 1 : Math.min(1, dt * 8);
      c.x += (mark.x - c.x) * k;
      c.z += (mark.z - c.z) * k;
      const ground = floorAt(c.x, c.z);
      c.animator.update(
        dt,
        {
          x: c.x,
          z: c.z,
          ground,
          face: null,
          look: null,
          glances: [],
          speaking: false,
          scan: mark.phase === "observing",
          groundAt: floorAt,
        },
        reduced,
      );
      if (halo) {
        halo.visible = mark.phase === "observing";
        halo.position.set(c.x, ground + 0.02, c.z);
      }
    }
  });
  return (
    <group name="rain-lab-presence" ref={group}>
      {WHO.map((who) => (
        <mesh
          key={who}
          ref={(h) => void (halos.current[who] = h)}
          rotation={[-Math.PI / 2, 0, 0]}
          visible={false}
        >
          <ringGeometry args={[0.55, 0.68, 32]} />
          <meshBasicMaterial
            color="#3fb6b0"
            transparent
            opacity={0.65}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}
