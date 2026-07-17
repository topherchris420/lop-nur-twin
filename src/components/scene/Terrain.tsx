import { useMemo } from "react";
import * as THREE from "three";
import { SITE_SIZE } from "@/lib/layout";
import { flattenFactor, mottle, rawHeight } from "@/lib/terrain";
import { makeGroundNormalTexture } from "@/lib/textures";
import { SITE_SEED } from "@/lib/noise";

const SEGMENTS = 512;

/** Arid palette, washed-out tan ground matching overhead aerial reference. */
const C_DARK = new THREE.Color("#84806e");
const C_BASE = new THREE.Color("#a19a83");
const C_DUST = new THREE.Color("#cabc98");
const C_COMPACT = new THREE.Color("#bcae8c");

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

      // mottled desert coloring, lighter compacted halo near pavement
      const m = mottle(x, z);
      const t = THREE.MathUtils.clamp(m * 0.5 + 0.5, 0, 1);
      scratch.lerpColors(C_DARK, C_BASE, THREE.MathUtils.smoothstep(t, 0.1, 0.9));
      const dustiness = Math.pow(Math.max(0, m), 2.2) * 0.55;
      scratch.lerp(C_DUST, dustiness);
      scratch.lerp(C_COMPACT, (1 - flat) * 0.45);

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
    <mesh geometry={geometry} receiveShadow name="terrain">
      <meshStandardMaterial
        vertexColors
        roughness={0.96}
        metalness={0}
        normalMap={normalMap}
        normalScale={new THREE.Vector2(0.4, 0.4)}
      />
    </mesh>
  );
}
