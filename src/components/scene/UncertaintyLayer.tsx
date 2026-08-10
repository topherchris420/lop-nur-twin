import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { APRONS, RUNWAYS, RUNWAY_CENTER, STRUCTURES } from "@/lib/layout";
import { getUncertaintyForSubject } from "@/lib/evidence";
import { uncertaintyRadiusM, type UncertaintyLevel } from "@/lib/uncertainty";
import { getDefensibility } from "@/lib/forensics";
import { createHardSurfaceShaderMaterial } from "@/gfx/greeble";
import { useSubjectFilter } from "@/lib/sceneVisibility";
import { terrainHeight } from "@/lib/terrain";
import { useTwinStore } from "@/lib/store";

/**
 * Uncertainty, drawn in space instead of written in a caption.
 *
 * Three different things are unknown about a modeled subject and they are
 * unknown in three different ways, so they get three different shapes:
 *
 * - **Halos** — the positional envelope. A ring at the documented radius,
 *   broken into dashes by how well the subject is identified.
 * - **Boundary envelopes** — the extent envelope. A band around the modeled
 *   footprint at the resolution floor of the cited scene, which is the honest
 *   statement that the edge could be anywhere in that band.
 * - **Height columns** — the unknown that has no number at all. Every roofline
 *   in this model is a modeling decision, because no cited source states the
 *   height of anything here, and an open-ended dashed column rising from each
 *   roof and fading out says exactly that: the top is not known, and it is not
 *   known by an amount this project cannot state either.
 *
 * Four things this layer deliberately does not do:
 *
 * - **It does not invent envelopes.** A subject whose `UncertaintyEnvelope`
 *   carries no metres gets no ring and no band. Most of the model is in that
 *   position, and an empty patch of ground is the correct rendering of "not
 *   stated" — filling it with a default radius would put a fabricated number on
 *   screen in the one place a viewer would read it as measured.
 * - **It does not put a number on the height columns.** They are open-ended and
 *   fade out rather than reaching a cap, because a cap would be a tolerance and
 *   there isn't one.
 * - **It does not carry meaning in colour.** Ring radius, band width and dash
 *   pattern are the metric channels; all three are restated as text in the
 *   dossier and in `/analysis`. The amber tint is decoration.
 * - **It does not animate.** Nothing here moves, under reduced motion or
 *   otherwise. A pulsing uncertainty ring would imply a changing quantity.
 *
 * Cost is bounded by construction: the bands and the columns are each merged
 * into a single geometry, the rings are shared primitives scaled per instance,
 * and the whole layer unmounts below quality tier 2.
 */

/** Dash counts per identification level. 0 means a solid ring. */
const RING_SEGMENTS: Record<UncertaintyLevel, number> = {
  known: 0,
  probable: 24,
  possible: 12,
  unknown: 8,
};

interface Envelope {
  id: string;
  x: number;
  z: number;
  radiusM: number;
  identification: UncertaintyLevel;
}

/**
 * Every subject with a documented spatial envelope, in layout order.
 *
 * The runway is represented at its centre rather than along its length: the
 * ±40 m the project documents is an *endpoint* uncertainty, so a corridor down
 * the whole strip would assert a tolerance the source register does not state.
 */
function collectEnvelopes(): Envelope[] {
  const envelopes: Envelope[] = [];

  const push = (id: string, x: number, z: number) => {
    const envelope = getUncertaintyForSubject(id);
    if (envelope === undefined) return;
    const radiusM = uncertaintyRadiusM(envelope);
    if (radiusM === undefined) return;
    envelopes.push({ id, x, z, radiusM, identification: envelope.identification });
  };

  for (const structure of STRUCTURES) {
    push(structure.id, structure.position[0], structure.position[1]);
  }
  for (const apron of APRONS) push(apron.id, apron.center[0], apron.center[1]);

  const runway = RUNWAYS[0];
  if (runway !== undefined) {
    // Both thresholds and the centre, which are the three points the published
    // measurements are actually taken between.
    const measured = getUncertaintyForSubject("measurement-runway-length");
    const radiusM = measured === undefined ? undefined : uncertaintyRadiusM(measured);
    if (radiusM !== undefined) {
      const identification = measured?.identification ?? "unknown";
      envelopes.push(
        {
          id: `${runway.id}-from`,
          x: runway.from[0],
          z: runway.from[1],
          radiusM,
          identification,
        },
        {
          id: `${runway.id}-to`,
          x: runway.to[0],
          z: runway.to[1],
          radiusM,
          identification,
        },
        {
          id: `${runway.id}-center`,
          x: RUNWAY_CENTER[0],
          z: RUNWAY_CENTER[1],
          radiusM,
          identification,
        },
      );
    }
  }

  return envelopes;
}

function EnvelopeRing({ envelope }: { envelope: Envelope }) {
  const segments = RING_SEGMENTS[envelope.identification];
  const geometry = useMemo(() => {
    const inner = Math.max(0.001, envelope.radiusM * 0.86);
    if (segments === 0) {
      return new THREE.RingGeometry(inner, envelope.radiusM, 64);
    }
    // A dashed ring is a ring with a theta gap, instanced round the circle.
    // Building it as one merged geometry keeps this to a single draw call.
    const step = (Math.PI * 2) / segments;
    return new THREE.RingGeometry(inner, envelope.radiusM, 64, 1, 0, step * 0.55);
  }, [envelope.radiusM, segments]);

  const y = terrainHeight(envelope.x, envelope.z) + 0.35;
  const dashes = segments === 0 ? [0] : Array.from({ length: segments }, (_, i) => i);
  const step = segments === 0 ? 0 : (Math.PI * 2) / segments;

  return (
    <group position={[envelope.x, y, envelope.z]}>
      {dashes.map((index) => (
        <mesh
          key={index}
          geometry={geometry}
          rotation={[-Math.PI / 2, 0, index * step]}
          renderOrder={2}
        >
          <meshBasicMaterial
            color="#f0b95c"
            transparent
            opacity={0.34}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Boundary envelopes                                                  */
/* ------------------------------------------------------------------ */

/**
 * A band around a modeled footprint at the extent tolerance.
 *
 * The band is the honest picture of a footprint traced off a 10 m scene: the
 * modeled edge is somewhere inside it, and one pixel of the source is wider
 * than most of the walls this model draws.
 */
function footprintBand(
  halfWidth: number,
  halfDepth: number,
  toleranceM: number,
): THREE.BufferGeometry {
  const outerW = halfWidth + toleranceM;
  const outerD = halfDepth + toleranceM;
  // A tolerance wider than the building itself would invert the inner ring, so
  // the inner edge is clamped rather than allowed to fold through zero.
  const innerW = Math.max(0.5, halfWidth - toleranceM);
  const innerD = Math.max(0.5, halfDepth - toleranceM);

  const shape = new THREE.Shape();
  shape.moveTo(-outerW, -outerD);
  shape.lineTo(outerW, -outerD);
  shape.lineTo(outerW, outerD);
  shape.lineTo(-outerW, outerD);
  shape.closePath();

  const hole = new THREE.Path();
  hole.moveTo(-innerW, -innerD);
  hole.lineTo(-innerW, innerD);
  hole.lineTo(innerW, innerD);
  hole.lineTo(innerW, -innerD);
  hole.closePath();
  shape.holes.push(hole);

  return new THREE.ShapeGeometry(shape);
}

/** Every structure whose envelope documents an extent tolerance, merged. */
function mergeFootprintBands(
  isDrawn: (subject: { id: string }) => boolean,
): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = [];
  for (const structure of STRUCTURES) {
    if (!isDrawn(structure)) continue;
    const envelope = getUncertaintyForSubject(structure.id);
    const toleranceM = envelope?.footprintMeters;
    if (toleranceM === undefined || !(toleranceM > 0)) continue;

    const [width, , depth] = structure.size;
    const band = footprintBand(width / 2, depth / 2, toleranceM);
    const [x, z] = structure.position;
    band.applyMatrix4(
      new THREE.Matrix4().compose(
        new THREE.Vector3(x, terrainHeight(x, z) + 0.25, z),
        new THREE.Quaternion().setFromEuler(
          // Laid flat first (shape +y becomes world -z), then turned to the
          // structure's own heading.
          new THREE.Euler(-Math.PI / 2, 0, -structure.rotation, "YXZ"),
        ),
        new THREE.Vector3(1, 1, 1),
      ),
    );
    parts.push(band);
  }
  if (parts.length === 0) return null;
  const merged = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  return merged;
}

function FootprintEnvelopes({
  isDrawn,
}: {
  isDrawn: (subject: { id: string }) => boolean;
}) {
  const geometry = useMemo(() => mergeFootprintBands(isDrawn), [isDrawn]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (geometry === null) return null;
  return (
    <mesh geometry={geometry} renderOrder={2} frustumCulled={false}>
      <meshBasicMaterial
        color="#f0b95c"
        transparent
        opacity={0.16}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

/* ------------------------------------------------------------------ */
/* Height columns                                                      */
/* ------------------------------------------------------------------ */

const COLUMN_HEAD = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uBaseY;
`;

/**
 * Dashed and open-ended. The dashes make it read as a measurement annotation
 * rather than as a structure, and the fade means it stops without ever
 * reaching a cap — because a cap would be a tolerance, and none is stated.
 */
const COLUMN_FRAGMENT = /* glsl */ `
  float rise = vWorldPos.y - uBaseY;
  float dash = step(0.5, fract(rise * 0.14));
  if (dash < 0.5) discard;
  float fade = 1.0 - clamp(rise / 46.0, 0.0, 1.0);
  gl_FragColor = vec4(uColor, uOpacity * fade * fade);
`;

/**
 * One open-ended column per structure, rising from the modeled roofline.
 *
 * Drawn for every structure rather than for a selected one, because the
 * statement is true of every structure: `heightMeters` is populated nowhere in
 * this model, and a forest of columns over the whole compound is what that
 * actually looks like.
 */
function mergeHeightColumns(
  isDrawn: (subject: { id: string }) => boolean,
): { geometry: THREE.BufferGeometry; baseY: number } | null {
  const positions: number[] = [];
  let lowestBase = Number.POSITIVE_INFINITY;

  for (const structure of STRUCTURES) {
    if (!isDrawn(structure)) continue;
    // A subject whose height a source did state would not want this column;
    // none does today, and the check keeps that an observation rather than an
    // assumption baked into the render.
    const envelope = getUncertaintyForSubject(structure.id);
    if (envelope?.heightMeters !== undefined) continue;

    const [width, height, depth] = structure.size;
    const [x, z] = structure.position;
    const roof = terrainHeight(x, z) + height;
    lowestBase = Math.min(lowestBase, roof);

    // One column at each footprint corner, so the annotation reads as bounding
    // the volume rather than as a mast standing on the roof.
    const cos = Math.cos(structure.rotation);
    const sin = Math.sin(structure.rotation);
    const corners: readonly [number, number][] = [
      [width / 2, depth / 2],
      [-width / 2, depth / 2],
      [width / 2, -depth / 2],
      [-width / 2, -depth / 2],
    ];
    for (const [localX, localZ] of corners) {
      const cornerX = x + localX * cos + localZ * sin;
      const cornerZ = z - localX * sin + localZ * cos;
      positions.push(cornerX, roof, cornerZ, cornerX, roof + 46, cornerZ);
    }
  }

  if (positions.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(positions), 3),
  );
  return { geometry, baseY: Number.isFinite(lowestBase) ? lowestBase : 0 };
}

function HeightColumns({ isDrawn }: { isDrawn: (subject: { id: string }) => boolean }) {
  const built = useMemo(() => mergeHeightColumns(isDrawn), [isDrawn]);
  const material = useMemo(() => {
    const shader = createHardSurfaceShaderMaterial({
      head: COLUMN_HEAD,
      fragmentBody: COLUMN_FRAGMENT,
      transparent: true,
      uniforms: {
        uColor: { value: new THREE.Color("#f0b95c") },
        uOpacity: { value: 0.42 },
        uBaseY: { value: 0 },
      },
    });
    shader.depthWrite = false;
    return shader;
  }, []);

  useEffect(() => {
    if (built !== null) material.uniforms["uBaseY"]!.value = built.baseY;
  }, [built, material]);

  useEffect(
    () => () => {
      material.dispose();
      built?.geometry.dispose();
    },
    [material, built],
  );

  if (built === null) return null;
  return (
    <lineSegments
      geometry={built.geometry}
      material={material}
      renderOrder={2}
      frustumCulled={false}
      name="height-unknown-columns"
    />
  );
}

/* ------------------------------------------------------------------ */
/* Layer                                                               */
/* ------------------------------------------------------------------ */

export function UncertaintyLayer() {
  const showUncertainty = useTwinStore((state) => state.showUncertainty);
  const qualityTier = useTwinStore((state) => state.qualityTier);
  const proveIt = useTwinStore((state) => state.proveIt);
  const isDrawn = useSubjectFilter();
  const envelopes = useMemo(collectEnvelopes, []);

  const visible = useMemo(
    () =>
      envelopes.filter((envelope) => {
        // The runway's three envelopes hang off derived ids, so they are tested
        // against the runway record itself.
        const subjectId = envelope.id.replace(/-(from|to|center)$/, "");
        if (!isDrawn({ id: subjectId })) return false;
        // Under PROVE IT the only envelopes that mean anything are the ones
        // belonging to geometry that survived; drawing a tolerance around a
        // building that was just removed would be a tolerance on nothing.
        return !proveIt || getDefensibility(subjectId)?.retained.footprintAreaM2 !== 0;
      }),
    [envelopes, isDrawn, proveIt],
  );

  if (!showUncertainty) return null;
  // Tiers 0 and 1 are the constrained-device tiers. See the note above: the
  // information is not withheld, only its spatial rendering — the numbers stay
  // in the dossier and in `/analysis` at every tier.
  if (qualityTier < 2) return null;

  return (
    <group name="uncertainty-envelopes">
      {visible.map((envelope) => (
        <EnvelopeRing key={envelope.id} envelope={envelope} />
      ))}
      <FootprintEnvelopes isDrawn={isDrawn} />
      {/* Height is the one unknown with no number anywhere in the model, so it
          is the one that has to be drawn rather than tabulated. */}
      {proveIt ? null : <HeightColumns isDrawn={isDrawn} />}
    </group>
  );
}
