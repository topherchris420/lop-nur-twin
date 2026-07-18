import { useMemo } from "react";
import * as THREE from "three";
import { SITE_SIZE } from "@/lib/layout";
import { flattenFactor, gravelField, mottle, rawHeight, wadiMask } from "@/lib/terrain";
import { makeGroundNormalTexture } from "@/lib/textures";
import { SITE_SEED } from "@/lib/noise";

const SEGMENTS = 640;

/** Lop Nur / Gobi palette: tan lakebed, darker desert-pavement gravel,
 *  pale dry playa, and slightly damp-looking dry-wash channels. */
const C_DARK = new THREE.Color("#7c7660");
const C_BASE = new THREE.Color("#a99e80");
const C_DUST = new THREE.Color("#cabc98");
const C_GRAVEL = new THREE.Color("#6c6653");
const C_PLAYA = new THREE.Color("#c8c0a4");
const C_WADI = new THREE.Color("#867753");
const C_COMPACT = new THREE.Color("#bcb094");

export function Terrain() {
  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(SITE_SIZE, SITE_SIZE, SEGMENTS, SEGMENTS);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    if (!pos) return geo;
    const count = pos.count;
    const colors = new Float32Array(count * 3);
    const scratch = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const flat = flattenFactor(x, z);
      pos.setY(i, rawHeight(x, z) * flat);

      // mottled desert base, then gobi gravel, dry playa, wadi channels
      const m = mottle(x, z);
      const t = THREE.MathUtils.clamp(m * 0.5 + 0.5, 0, 1);
      scratch.lerpColors(C_DARK, C_BASE, THREE.MathUtils.smoothstep(t, 0.1, 0.9));
      const dustiness = Math.pow(Math.max(0, m), 2.2) * 0.5;
      scratch.lerp(C_DUST, dustiness);
      // broad darker desert-pavement fields
      scratch.lerp(C_GRAVEL, gravelField(x, z) * 0.6);
      // pale playa where the base reads brightest
      scratch.lerp(C_PLAYA, THREE.MathUtils.smoothstep(t, 0.82, 1) * 0.5);
      // dry-wash channels
      scratch.lerp(C_WADI, wadiMask(x, z) * 0.55);
      // lighter compacted halo bleeding out from the pavement
      scratch.lerp(C_COMPACT, (1 - flat) * 0.5);

      colors[i * 3] = scratch.r;
      colors[i * 3 + 1] = scratch.g;
      colors[i * 3 + 2] = scratch.b;
    }

    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    return geo;
  }, []);

  const normalMap = useMemo(() => {
    const tex = makeGroundNormalTexture(SITE_SEED + 7);
    tex.repeat.set(320, 320);
    return tex;
  }, []);

  return (
    <group name="terrain">
      {/* Distant desert floor: a large flat plane sitting just below the
          detailed terrain so the plain reads as endless and no hard mesh
          edge shows at the horizon (it only appears beyond the detail ring
          and fades into the haze). */}
      <mesh position={[0, -6, 0]} rotation={[-Math.PI / 2, 0, 0]} name="desert-floor">
        <planeGeometry args={[40000, 40000]} />
        <meshStandardMaterial color="#9a8f77" roughness={1} metalness={0} />
      </mesh>
      <mesh geometry={geometry} receiveShadow name="terrain-detail">
        <meshStandardMaterial
          vertexColors
          roughness={0.96}
          metalness={0}
          normalMap={normalMap}
          normalScale={new THREE.Vector2(0.4, 0.4)}
        />
      </mesh>
    </group>
  );
}
