import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { SITE_SIZE } from "@/lib/layout";
import { terrainHeight } from "@/lib/terrain";
import { createHardSurfaceShaderMaterial } from "@/gfx/greeble";
import { getReferenceScene } from "@/lib/referenceImagery";
import { useTwinStore } from "@/lib/store";

/**
 * The registered reference scene, drawn on the ground the model is built on.
 *
 * This is the check nobody can argue with: put the public scene the geometry
 * was traced from underneath the geometry, in the same projected frame, and
 * slide between them. An edge that continues across the swipe line is
 * registered. An edge that jumps is not, and no amount of ledger reading would
 * have shown it.
 *
 * The image never comes from this application. It is a file the reviewer
 * supplies, read in their own browser as a blob URL, decoded to a texture here
 * and released when it is replaced — nothing is bundled, fetched, uploaded or
 * stored, which is what keeps the offline guarantee and leaves the licensing
 * decision with the person who holds the imagery.
 *
 * Registration is a plain translation: the plane covers exactly the projected
 * window `referenceImagery.ts` prints, at the same metre scale as everything
 * else, north-up. It inherits the same ±40 m the reference coordinate carries,
 * so agreement between the overlay and the model is agreement between two
 * things sharing one error — the frame outline is drawn even with no image
 * loaded so that window is visible while a crop is being prepared.
 */

const OVERLAY_HEAD = /* glsl */ `
uniform sampler2D uMap;
uniform float uOpacity;
uniform float uSwipe;
uniform float uSwipeEnabled;
uniform float uHalfExtent;
uniform vec3 uCenter;
`;

/**
 * The swipe is evaluated in *world* metres rather than in UV, so the divider
 * stays put on the ground while the camera moves. A UV-space divider would
 * slide across the site as the plane's screen projection changed, which reads
 * as the imagery moving relative to the model — the exact illusion this view
 * exists to rule out.
 */
const OVERLAY_FRAGMENT = /* glsl */ `
  float edge = uCenter.x - uHalfExtent + uSwipe * (uHalfExtent * 2.0);
  if (uSwipeEnabled > 0.5 && vWorldPos.x > edge) discard;

  vec4 texel = texture2D(uMap, vUvCoord);
  /* A thin bright seam on the divider, so the comparison boundary is never
     ambiguous when the two sides happen to be similar tones. */
  float seam = uSwipeEnabled > 0.5
    ? 1.0 - smoothstep(0.0, 26.0, abs(vWorldPos.x - edge))
    : 0.0;
  vec3 color = mix(texel.rgb, vec3(1.0, 0.86, 0.55), seam * 0.85);
  gl_FragColor = vec4(color, texel.a * uOpacity + seam * 0.5);
`;

const FRAME_HEAD = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
`;

const FRAME_FRAGMENT = /* glsl */ `
  gl_FragColor = vec4(uColor, uOpacity);
`;

/** The projected window's outline on the ground, as a closed rectangle. */
function frameGeometry(halfExtentM: number, center: readonly [number, number]) {
  const [cx, cz] = center;
  const corners: readonly [number, number][] = [
    [cx - halfExtentM, cz - halfExtentM],
    [cx + halfExtentM, cz - halfExtentM],
    [cx + halfExtentM, cz + halfExtentM],
    [cx - halfExtentM, cz + halfExtentM],
  ];
  const positions: number[] = [];
  for (let index = 0; index < corners.length; index += 1) {
    const from = corners[index]!;
    const to = corners[(index + 1) % corners.length]!;
    positions.push(
      from[0],
      terrainHeight(from[0], from[1]) + 1.2,
      from[1],
      to[0],
      terrainHeight(to[0], to[1]) + 1.2,
      to[1],
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(positions), 3),
  );
  return geometry;
}

export function ReferenceImagery() {
  const reference = useTwinStore((state) => state.reference);
  const showReference = useTwinStore((state) => state.showReference);
  const scene = getReferenceScene(reference.sceneId);

  const texture = useMemo(() => {
    if (reference.objectUrl === null) return null;
    const loaded = new THREE.TextureLoader().load(reference.objectUrl);
    loaded.colorSpace = THREE.SRGBColorSpace;
    // The crop is a georeferenced window, so it must never repeat or mirror at
    // the edge — a wrapped pixel would draw ground that is not in the scene.
    loaded.wrapS = THREE.ClampToEdgeWrapping;
    loaded.wrapT = THREE.ClampToEdgeWrapping;
    loaded.anisotropy = 8;
    return loaded;
  }, [reference.objectUrl]);

  useEffect(() => () => texture?.dispose(), [texture]);

  const material = useMemo(() => {
    const shader = createHardSurfaceShaderMaterial({
      head: OVERLAY_HEAD,
      fragmentBody: OVERLAY_FRAGMENT,
      transparent: true,
      uniforms: {
        uMap: { value: null },
        uOpacity: { value: 1 },
        uSwipe: { value: 0.5 },
        uSwipeEnabled: { value: 1 },
        uHalfExtent: { value: SITE_SIZE / 2 },
        uCenter: { value: new THREE.Vector3() },
      },
    });
    shader.depthWrite = false;
    return shader;
  }, []);

  const frameMaterial = useMemo(() => {
    const shader = createHardSurfaceShaderMaterial({
      head: FRAME_HEAD,
      fragmentBody: FRAME_FRAGMENT,
      transparent: true,
      uniforms: {
        uColor: { value: new THREE.Color("#7dd3fc") },
        uOpacity: { value: 0.6 },
      },
    });
    shader.depthWrite = false;
    return shader;
  }, []);

  useEffect(
    () => () => {
      material.dispose();
      frameMaterial.dispose();
    },
    [material, frameMaterial],
  );

  /**
   * The overlay is draped over the heightfield, not laid on a single flat plane.
   *
   * The site window is 6.8 km across and the procedural relief moves several
   * metres inside it, so a flat plane at the centre's height is buried wherever
   * the ground rises and visibly floating wherever it falls — a
   * "ground-registered" overlay that is neither. Displacing the vertices by the
   * same `terrainHeight` the terrain mesh uses keeps the image on the ground
   * everywhere, which is the only way the swipe comparison means anything.
   */
  const geometry = useMemo(() => {
    if (scene === undefined) return null;
    const extent = scene.window.halfExtentM * 2;
    // ~53 m between samples across the site window: finer than the 46 m
    // wavelength of the terrain's smallest term, so the drape has no visible
    // facets against the surface it is following.
    const segments = Math.min(160, Math.max(24, Math.round(extent / 53)));
    const plane = new THREE.PlaneGeometry(extent, extent, segments, segments);
    // Laid flat so the image's top row is north, matching a north-up crop.
    plane.rotateX(-Math.PI / 2);

    const [cx, cz] = scene.window.centerLocal;
    const position = plane.getAttribute("position");
    for (let index = 0; index < position.count; index += 1) {
      const x = cx + position.getX(index);
      const z = cz + position.getZ(index);
      // A hand's breadth above the surface: enough to clear the pavement decals
      // the model lays at 0.05-0.14 m without floating off the ground.
      position.setY(index, terrainHeight(x, z) + 0.6);
    }
    position.needsUpdate = true;
    plane.computeVertexNormals();
    return plane;
  }, [scene]);

  const frame = useMemo(
    () =>
      scene === undefined
        ? null
        : frameGeometry(scene.window.halfExtentM, scene.window.centerLocal),
    [scene],
  );

  useEffect(
    () => () => {
      geometry?.dispose();
      frame?.dispose();
    },
    [geometry, frame],
  );

  // Uniforms are poked from the frame loop rather than rebuilt on every store
  // change, so dragging the swipe slider never re-renders the scene graph.
  useFrame(() => {
    if (scene === undefined) return;
    material.uniforms["uMap"]!.value = texture;
    material.uniforms["uOpacity"]!.value =
      reference.mode === "blend" ? reference.opacity : 1;
    material.uniforms["uSwipe"]!.value = reference.swipe;
    material.uniforms["uSwipeEnabled"]!.value = reference.mode === "swipe" ? 1 : 0;
    material.uniforms["uHalfExtent"]!.value = scene.window.halfExtentM;
    (material.uniforms["uCenter"]!.value as THREE.Vector3).set(
      scene.window.centerLocal[0],
      0,
      scene.window.centerLocal[1],
    );
  });

  if (!showReference || scene === undefined || geometry === null) return null;

  const [cx, cz] = scene.window.centerLocal;
  return (
    <group name="reference-imagery">
      {texture === null ? null : (
        <mesh
          geometry={geometry}
          material={material}
          // The drape already carries absolute ground heights per vertex, so
          // the mesh only shifts in the horizontal plane — adding a y here
          // would count the terrain twice.
          position={[cx, 0, cz]}
          renderOrder={1}
          frustumCulled={false}
        />
      )}
      {frame === null ? null : (
        <lineSegments geometry={frame} material={frameMaterial} renderOrder={2} />
      )}
    </group>
  );
}
