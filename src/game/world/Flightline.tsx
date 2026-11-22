import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { APRONS, STRUCTURES, type StructureDef } from "@/lib/layout";
import { useSceneDressingVisible, useSubjectFilter } from "@/lib/sceneVisibility";
import { useTwinStore } from "@/lib/store";
import { sunState } from "@/lib/sunState";
import { makeDoorCoating, makeStandMarkings } from "./flightlinePaint";

const HALLS = STRUCTURES.filter((s) => s.type === "hangar-monolith");
const MAIN_APRON = APRONS.find((s) => s.id === "apron-main");
const DRESSING = { noCollide: true };

/** Light projected down the painted door from the three fittings. In local
 * door UVs the spill stays attached to its lamp and costs no dynamic lights. */
function makeDoorLightMap() {
  const canvas = document.createElement("canvas");
  canvas.width = 384;
  canvas.height = 128;
  const c = canvas.getContext("2d")!;
  c.fillStyle = "#000";
  c.fillRect(0, 0, 384, 128);
  for (const x of [64, 192, 320]) {
    c.save();
    c.translate(x, 2);
    c.scale(0.72, 1);
    const falloff = c.createRadialGradient(0, 0, 0, 0, 0, 85);
    falloff.addColorStop(0, "#e7b981");
    falloff.addColorStop(0.32, "#8f6744");
    falloff.addColorStop(1, "#000");
    c.fillStyle = falloff;
    c.globalCompositeOperation = "lighter";
    c.fillRect(-85, -2, 170, 92);
    c.restore();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function buildHangarSkin(hall: StructureDef, number: string, detailed: boolean) {
  const [w, h, d] = hall.size;
  const frame: THREE.BufferGeometry[] = [];
  const glazing: THREE.BufferGeometry[] = [];
  const lenses: THREE.BufferGeometry[] = [];
  const doors: THREE.BufferGeometry[] = [];
  const root = new THREE.Group();
  root.name = `flightline-${hall.id}`;
  const tint = new THREE.Color();

  // Position vertices in building-local space. Both ends and both long sides
  // share four material batches, independent of the number of ribs or lights.
  function steel(
    target: THREE.BufferGeometry[],
    color: string,
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    facing = 1,
  ) {
    const g = new THREE.BoxGeometry(width, height, depth);
    g.translate(x, y, z);
    if (facing < 0) g.rotateY(Math.PI);
    tint.set(color);
    const colors = new Float32Array(g.getAttribute("position").count * 3);
    for (let i = 0; i < colors.length; i += 3) tint.toArray(colors, i);
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    target.push(g);
  }

  for (const face of [-1, 1]) {
    // The two existing apron annexes flank a narrower opening on the north
    // end. At the opposite end the skin follows the full original shutter.
    const left = -0.25 * w + 9;
    const right = 0.28 * w - 5;
    const width = face < 0 ? right - left - 1.8 : w * 0.78;
    const center = face < 0 ? -(left + right) / 2 : 0;
    const height = (h - 1.4) * 0.77;
    const sill = 0.62;
    const z = d / 2 + (face < 0 ? 0.15 : 0.49);
    const leaf = width / 6;
    const head = sill + height;
    function box(
      target: THREE.BufferGeometry[],
      color: string,
      x: number,
      y: number,
      dz: number,
      sx: number,
      sy: number,
      sz: number,
    ) {
      steel(target, color, center + x, y, z + dz, sx, sy, sz, face);
    }
    for (let i = 0; i < 6; i++) {
      const x = leaf * (i - 2.5);
      // Alternating tracks give the leaves a real overlap and a narrow
      // self-shadow. Keep the paint aligned across the two tracks.
      const offset = i % 2 ? 0.095 : 0;
      const panel = new THREE.PlaneGeometry(leaf, height);
      const uv = panel.getAttribute("uv");
      for (let j = 0; j < uv.count; j++) uv.setX(j, (i + uv.getX(j)) / 6);
      panel.translate(center + x, sill + height / 2, z + offset);
      if (face < 0) panel.rotateY(Math.PI);
      doors.push(panel);
      box(
        frame,
        "#46504b",
        x - leaf / 2,
        sill + height / 2,
        offset + 0.08,
        0.17,
        height,
        0.18,
      );
      if (detailed) {
        for (let j = 1; j <= 4; j++) {
          box(
            frame,
            "#68736a",
            x + leaf * (j / 5 - 0.5),
            sill + height / 2,
            offset + 0.025,
            0.065,
            height,
            0.05,
          );
        }
      }
      const windowY = sill + height * 0.79;
      box(frame, "#313c39", x, windowY, offset + 0.1, leaf * 0.93, height * 0.135, 0.15);
      for (const [j, pane] of ["#566564", "#637474", "#526261"].entries()) {
        box(
          glazing,
          pane,
          x + (j - 1) * leaf * 0.3,
          windowY,
          offset + 0.185,
          leaf * 0.282,
          height * 0.095,
          0.04,
        );
      }
      if (i % 2 === 0) {
        const lampX = x + leaf * 0.5;
        box(frame, "#464842", lampX, head + 0.04, 0.55, 1.65, 0.29, 0.65);
        box(lenses, "#fff1dc", lampX, head - 0.11, 0.7, 1.38, 0.12, 0.4);
      }
    }
    box(frame, "#4a4c46", 0, head + 0.32, 0.18, width + 1.3, 0.46, 1.02);
    box(frame, "#85867a", 0, head + 0.57, 0.35, width + 1.54, 0.09, 1.45);
    box(frame, "#4d504b", 0, sill + 0.09, 0.16, width + 0.45, 0.16, 0.48);
  }

  // Window bands in the original long walls are continuous. Break the dark
  // strips into panes and bays and give the downpipes collars with human scale.
  const wallH = h - 1.4;
  for (const side of [-1, 1]) {
    const edge = side * (w * 0.5 + 0.32);
    const span = d * 0.9;
    const bays = Math.round(span / 3.2);
    for (const level of [0.48, 0.68]) {
      for (let j = 0; j <= bays; j++) {
        steel(
          frame,
          "#8b8d80",
          edge,
          level * wallH,
          span * (j / bays - 0.5),
          0.11,
          1.19,
          0.11,
        );
      }
      steel(frame, "#a09e90", edge, level * wallH - 0.59, 0, 0.25, 0.1, span + 0.15);
    }
    for (const fraction of [-0.43, 0.43]) {
      const x = side * (w / 2 + 0.41);
      steel(frame, "#7a8079", x, wallH / 2 + 0.5, fraction * d, 0.24, wallH, 0.29);
      for (let y = 2; y < wallH; y += 3.4) {
        steel(frame, "#555b53", x, y, fraction * d, 0.32, 0.12, 0.37);
      }
    }
  }
  const coating = makeDoorCoating(number, detailed ? 1024 : 512);
  const spill = makeDoorLightMap();
  const painted = new THREE.MeshStandardMaterial({
    map: coating,
    roughness: 0.73,
    metalness: 0.19,
    emissive: 0xffffff,
    emissiveMap: spill,
    emissiveIntensity: 0,
  });
  const hardware = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.64,
    metalness: 0.32,
  });
  const glass = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.23,
    metalness: 0.21,
  });
  const fixtures = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.32,
    emissive: "#ffce99",
    emissiveIntensity: 0,
  });
  function batch(
    parts: THREE.BufferGeometry[],
    material: THREE.Material,
    shadows: boolean,
  ) {
    const merged = mergeGeometries(parts);
    parts.forEach((g) => g.dispose());
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    mesh.userData.noCollide = true;
    root.add(mesh);
    return merged;
  }
  const buffers = [
    batch(doors, painted, false),
    batch(frame, hardware, true),
    batch(glazing, glass, false),
    batch(lenses, fixtures, false),
  ];
  return {
    root,
    painted,
    fixtures,
    dispose() {
      for (const resource of [
        ...buffers,
        painted,
        hardware,
        glass,
        fixtures,
        coating,
        spill,
      ])
        resource.dispose();
    },
  };
}

function HangarSkin({
  hall,
  number,
  detailed,
}: {
  hall: StructureDef;
  number: string;
  detailed: boolean;
}) {
  const skin = useMemo(
    () => buildHangarSkin(hall, number, detailed),
    [hall, number, detailed],
  );
  useEffect(() => () => skin.dispose(), [skin]);
  useFrame(() => {
    const dark = 1 - THREE.MathUtils.smoothstep(sunState.dayFactor, 0.14, 0.7);
    skin.fixtures.emissiveIntensity = 0.09 + 4.6 * dark;
    skin.painted.emissiveIntensity = 0.85 * dark;
  });
  return (
    <primitive
      object={skin.root}
      position={[hall.position[0], 0, hall.position[1]]}
      rotation-y={hall.rotation}
    />
  );
}

function StandPaint({
  apron,
  detailed,
}: {
  apron: (typeof APRONS)[number];
  detailed: boolean;
}) {
  const map = useMemo(
    () => makeStandMarkings(...apron.size, detailed ? 2048 : 1024),
    [apron, detailed],
  );
  useEffect(() => () => map.dispose(), [map]);
  return (
    <mesh
      name="flightline-stand-paint"
      userData={DRESSING}
      position={[apron.center[0], 0.092, apron.center[1]]}
      rotation={[-Math.PI / 2, 0, -apron.rotation]}
      receiveShadow
      renderOrder={1}
    >
      <planeGeometry args={apron.size} />
      <meshStandardMaterial
        map={map}
        transparent
        depthWrite={false}
        roughness={0.93}
        polygonOffset
        polygonOffsetFactor={-1}
        polygonOffsetUnits={-1}
      />
    </mesh>
  );
}

export function Flightline() {
  const visible = useSceneDressingVisible();
  const isDrawn = useSubjectFilter();
  const detailed = useTwinStore((s) => s.qualityTier >= 2);
  if (!visible) return null;
  return (
    <>
      {HALLS.map(
        (hall, i) =>
          isDrawn(hall) && (
            <HangarSkin
              key={hall.id}
              hall={hall}
              number={String(i + 1).padStart(2, "0")}
              detailed={detailed}
            />
          ),
      )}
      {MAIN_APRON && isDrawn(MAIN_APRON) && (
        <StandPaint apron={MAIN_APRON} detailed={detailed} />
      )}
    </>
  );
}
