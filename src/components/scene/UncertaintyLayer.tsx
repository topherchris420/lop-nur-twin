import { useMemo } from "react";
import * as THREE from "three";
import { APRONS, RUNWAYS, RUNWAY_CENTER, STRUCTURES } from "@/lib/layout";
import { getUncertaintyForSubject } from "@/lib/evidence";
import { uncertaintyRadiusM, type UncertaintyLevel } from "@/lib/uncertainty";
import { useSubjectFilter } from "@/lib/sceneVisibility";
import { terrainHeight } from "@/lib/terrain";
import { useTwinStore } from "@/lib/store";

/**
 * Spatial uncertainty, drawn only where the model documents a number.
 *
 * Three things this layer deliberately does not do:
 *
 * - **It does not invent envelopes.** A subject whose `UncertaintyEnvelope`
 *   carries no metres gets no ring. Most of the model is in that position, and
 *   an empty patch of ground is the correct rendering of "not stated" — filling
 *   it with a default radius would put a fabricated number on screen in the one
 *   place a viewer would read it as measured.
 * - **It does not carry meaning in colour.** Ring *radius* is the metric
 *   channel and the dash pattern encodes identification; both are restated as
 *   text in the dossier and in `/analysis`. The amber tint is decoration.
 * - **It does not animate.** Nothing here moves, under reduced motion or
 *   otherwise. A pulsing uncertainty ring would imply a changing quantity.
 *
 * Cost is bounded by construction: the geometry is two shared ring primitives
 * scaled per instance, all opaque-sorted onto one transparent pass, and the
 * whole layer unmounts below quality tier 2. That keeps the promise in
 * `quality.ts` that a low tier stays cheap without making the feature
 * conditional on anything a viewer would notice as missing information — the
 * numbers are still in the dossier and the table.
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

export function UncertaintyLayer() {
  const showUncertainty = useTwinStore((state) => state.showUncertainty);
  const qualityTier = useTwinStore((state) => state.qualityTier);
  const isDrawn = useSubjectFilter();
  const envelopes = useMemo(collectEnvelopes, []);

  const visible = useMemo(
    () =>
      envelopes.filter((envelope) =>
        // The runway's three envelopes hang off derived ids, so they are tested
        // against the runway record itself.
        isDrawn({ id: envelope.id.replace(/-(from|to|center)$/, "") }),
      ),
    [envelopes, isDrawn],
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
    </group>
  );
}
