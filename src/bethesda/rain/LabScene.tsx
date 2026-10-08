/**
 * The R.A.I.N. Lab interior. Presentation only.
 *
 * Restrained on purpose: dark floors, glass, paper-coloured sources, quiet
 * instrument lights and one recurring accent, spectral teal #0B5D63. What the
 * room shows is derived from records — a source tile per verified span, a
 * broken stub for a turn with none, two branches that never meet for a
 * contested point, one archive slab per experiment whatever its ending, the
 * city's own state on the observation wall — and nothing drawn here is ever
 * measured or sent anywhere.
 *
 * The four perspectives are embodied from R.A.I.N.'s own client
 * (R.A.I.N.'s Godot client in topherchris420/james_library: `agent_avatar.gd` LOOKS and the lab theme's
 * colours) as rigged, skinned figures (`figures.ts`), animated with the
 * client's own behaviours (`figureMotion.ts`). Staging follows R.A.I.N.'s
 * neutral event vocabulary: the speaker of the current `agent_utterance` is
 * lit and talks, and the others turn to them. Nothing animates confidence or
 * agreement.
 *
 * No React state on the frame loop: motion lives in refs and `useFrame`;
 * the store is read, never written per frame (room changes are discrete).
 */
import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useRendererToneMapping } from "@/components/scene/Atmosphere";
import { buildings, bounds } from "../model";
import { PERSPECTIVES, type Perspective } from "./contracts";
import {
  EXIT_DOOR,
  ROOMS,
  ROOM_IDS,
  SEATS,
  STATIONS,
  TABLE,
  WALLS,
  WALL_HEIGHT,
  moveInLab,
  roomAt,
  routeInLab,
  type RoomId,
  type Vec,
} from "./labLayout";
import { currentSpeaker } from "./session";
import { EMBODIMENT } from "./embodiment";
import { buildFigure } from "./figures";
import {
  FigureAnimator,
  arrived,
  followRoute,
  seedFor,
  yawToward,
  type RouteWalk,
} from "./figureMotion";
import { LookDrag, stepFor, walkIntent, type Stick } from "../walkInput";
import { canRender } from "../webgl";
import type { LabStore } from "./store";
import { RAINResonanceFace, type ResonanceQuality } from "./ResonanceFace";
import { resonanceView, snapshotOf, type ResonanceView } from "./resonance";

export interface LabNav {
  pos: Vec;
  yaw: number;
  pitch: number;
  keys: Set<string>;
  /** The touch screen's walking stick, read with the keys every frame. */
  stick: Stick;
  /**
   * Where on the canvas the room is left uncovered, in CSS pixels, when the
   * panels take a large share of a small screen; null centres the view as
   * usual. The camera's projection is shifted to centre on it, so the room
   * ahead shows in the gap rather than behind the panel.
   */
  viewCenter: { x: number; y: number } | null;
  teleport: Vec | null;
  atExit: boolean;
  failed: boolean;
}

const TEAL = "#0B5D63";

function textTexture(text: string, width = 512, height = 96, size = 40) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const c = canvas.getContext("2d")!;
  c.fillStyle = "rgba(6,18,20,0.85)";
  c.fillRect(0, 0, width, height);
  c.fillStyle = "#bfe5e1";
  c.font = `${size}px ui-monospace, monospace`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText(text, width / 2, height / 2);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function Shell() {
  const built = useMemo(() => {
    const group = new THREE.Group();
    const floor = new THREE.MeshStandardMaterial({ color: "#1b2628", roughness: 0.92 });
    const wall = new THREE.MeshStandardMaterial({ color: "#26343a", roughness: 0.85 });
    const glass = new THREE.MeshStandardMaterial({
      color: "#7fc9c4",
      roughness: 0.08,
      metalness: 0.1,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
    });
    const trim = new THREE.MeshStandardMaterial({
      color: TEAL,
      emissive: TEAL,
      emissiveIntensity: 0.9,
    });
    for (const id of ROOM_IDS) {
      const r = ROOMS[id];
      const w = r.max.x - r.min.x,
        d = r.max.z - r.min.z;
      const f = new THREE.Mesh(new THREE.PlaneGeometry(w, d), floor);
      f.rotation.x = -Math.PI / 2;
      f.position.set((r.min.x + r.max.x) / 2, 0, (r.min.z + r.max.z) / 2);
      group.add(f);
      // The room's name, small, over its own floor: a plate, not a sign.
      const plate = new THREE.Mesh(
        new THREE.PlaneGeometry(2.4, 0.45),
        new THREE.MeshBasicMaterial({
          map: textTexture(r.label.toUpperCase()),
          transparent: true,
        }),
      );
      plate.position.set((r.min.x + r.max.x) / 2, WALL_HEIGHT - 0.5, r.min.z + 0.12);
      group.add(plate);
    }
    for (const seg of WALLS) {
      const len = Math.hypot(seg.b.x - seg.a.x, seg.b.z - seg.a.z);
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(len, WALL_HEIGHT, seg.glass ? 0.05 : 0.2),
        seg.glass ? glass : wall,
      );
      m.position.set((seg.a.x + seg.b.x) / 2, WALL_HEIGHT / 2, (seg.a.z + seg.b.z) / 2);
      m.rotation.y = -Math.atan2(seg.b.z - seg.a.z, seg.b.x - seg.a.x);
      group.add(m);
      if (!seg.glass) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(len, 0.03, 0.22), trim);
        strip.position.set(m.position.x, 0.08, m.position.z);
        strip.rotation.y = m.rotation.y;
        group.add(strip);
      }
    }
    // The way back: a door slab in the threshold's south wall.
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 2.4, 0.12),
      new THREE.MeshStandardMaterial({ color: "#121a1c", roughness: 0.6 }),
    );
    door.position.set(EXIT_DOOR.x, 1.2, EXIT_DOOR.z - 0.15);
    group.add(door);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.05, 0.14), trim);
    frame.position.set(EXIT_DOOR.x, 2.45, EXIT_DOOR.z - 0.15);
    group.add(frame);
    return group;
  }, []);
  useEffect(
    () => () =>
      built.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          const mat = o.material as THREE.Material & { map?: THREE.Texture | null };
          mat.map?.dispose();
          mat.dispose();
        }
      }),
    [built],
  );
  return <primitive object={built} />;
}

/** The rule, on the threshold wall: R.A.I.N.'s own three sentences. */
function ThresholdWords() {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 256;
    const c = canvas.getContext("2d")!;
    c.fillStyle = "#0a1416";
    c.fillRect(0, 0, 1024, 256);
    c.fillStyle = "#cfe9e5";
    c.font = "34px ui-serif, Georgia, serif";
    c.textAlign = "center";
    [
      "Inference is not evidence.",
      "Evidence is not permission.",
      "Confidence is not authority.",
    ].forEach((line, i) => c.fillText(line, 512, 70 + i * 62));
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  // On the threshold's north wall, beside the doorway into the Research Panel.
  return (
    <mesh position={[-3.5, 2.0, 7.12]}>
      <planeGeometry args={[4.0, 1.0]} />
      <meshBasicMaterial map={texture} />
    </mesh>
  );
}

/** A slow waveform on the threshold floor. Ornament; it encodes nothing. */
function Waveform() {
  const { line, geometry, positions } = useMemo(() => {
    const positions = new Float32Array(120 * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const line = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({ color: "#3fb6b0" }),
    );
    return { line, geometry, positions };
  }, []);
  useEffect(
    () => () => {
      geometry.dispose();
      (line.material as THREE.Material).dispose();
    },
    [geometry, line],
  );
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    for (let i = 0; i < 120; i++) {
      const x = -5 + (i / 119) * 10;
      positions[i * 3] = x;
      positions[i * 3 + 1] = 0.02;
      positions[i * 3 + 2] = 11 + Math.sin(x * 1.3 + t * 0.6) * 0.35 * Math.cos(x * 0.31);
    }
    geometry.attributes.position!.needsUpdate = true;
  });
  return <primitive object={line} />;
}

/** The evidence table: sources, interpretations and the lines between them. */
function EvidenceTable({ store }: { store: LabStore }) {
  const group = useRef<THREE.Group>(null);
  const key = useRef("");
  const materials = useMemo(
    () => ({
      top: new THREE.MeshStandardMaterial({
        color: "#9cc9c6",
        transparent: true,
        opacity: 0.22,
        roughness: 0.05,
        depthWrite: false,
      }),
      leg: new THREE.MeshStandardMaterial({
        color: "#3a464a",
        metalness: 0.6,
        roughness: 0.4,
      }),
      source: new THREE.MeshStandardMaterial({
        color: "#e8dcc0",
        emissive: "#5a5040",
        emissiveIntensity: 0.35,
      }),
      turn: new THREE.MeshStandardMaterial({
        color: "#9fb8c9",
        transparent: true,
        opacity: 0.55,
      }),
      link: new THREE.LineBasicMaterial({ color: "#e8dcc0" }),
      broken: new THREE.LineDashedMaterial({
        color: "#d9a066",
        dashSize: 0.05,
        gapSize: 0.08,
      }),
      contested: new THREE.LineBasicMaterial({ color: "#d9a066" }),
    }),
    [],
  );
  useEffect(
    () => () => Object.values(materials).forEach((m) => m.dispose()),
    [materials],
  );
  useFrame(() => {
    const g = group.current;
    const m = store.meeting;
    const k = m ? `${m.record.meeting_id}:${m.revealed}` : "";
    if (!g || k === key.current) return;
    key.current = k;
    for (const child of [...g.children]) {
      g.remove(child);
      if (child instanceof THREE.Mesh || child instanceof THREE.Line)
        child.geometry.dispose();
    }
    if (!m) return;
    const turns = m.record.turns.slice(0, m.revealed);
    const y = 0.86;
    const sources = new Map<string, THREE.Vector3>();
    const all = m.record.turns.flatMap((t) =>
      t.quotes.filter((q) => q.verified).map((q) => q.source),
    );
    [...new Set(all)].forEach((s, i, list) =>
      sources.set(
        s,
        new THREE.Vector3(
          TABLE.center.x - 1.7 + (3.4 * (i + 0.5)) / list.length,
          y,
          TABLE.center.z - 0.6,
        ),
      ),
    );
    turns.forEach((t, i) => {
      const at = new THREE.Vector3(
        TABLE.center.x - 1.8 + (3.6 * (i + 0.5)) / m.record.turns.length,
        y,
        TABLE.center.z + 0.55,
      );
      const tile = new THREE.Mesh(
        new THREE.BoxGeometry(0.28, 0.02, 0.18),
        materials.turn,
      );
      tile.position.copy(at);
      g.add(tile);
      const verified = t.quotes.filter((q) => q.verified);
      if (!verified.length) {
        // An ungrounded turn: a stub that reaches toward the sources and stops.
        const stub = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([
            at,
            at.clone().add(new THREE.Vector3(0, 0.03, -0.45)),
          ]),
          materials.broken,
        );
        stub.computeLineDistances();
        g.add(stub);
      }
      for (const q of verified) {
        const s = sources.get(q.source)!;
        g.add(
          new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([at, s]),
            materials.link,
          ),
        );
      }
    });
    for (const p of sources.values()) {
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(0.34, 0.03, 0.24),
        materials.source,
      );
      slab.position.copy(p);
      g.add(slab);
    }
    if (m.revealed >= m.record.turns.length && m.record.verdict?.contested) {
      // Contested: two branches leave one point and never rejoin.
      const root = new THREE.Vector3(TABLE.center.x + 1.6, y + 0.01, TABLE.center.z);
      for (const side of [-1, 1]) {
        const curve = new THREE.QuadraticBezierCurve3(
          root,
          root.clone().add(new THREE.Vector3(0.2, 0.25, side * 0.2)),
          root.clone().add(new THREE.Vector3(0.45, 0.02, side * 0.65)),
        );
        g.add(
          new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(curve.getPoints(16)),
            materials.contested,
          ),
        );
      }
    }
  });
  return (
    <group>
      <mesh position={[TABLE.center.x, 0.82, TABLE.center.z]} material={materials.top}>
        <boxGeometry args={[TABLE.width, 0.05, TABLE.depth]} />
      </mesh>
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => (
          <mesh
            key={`${sx}${sz}`}
            position={[
              TABLE.center.x + sx * (TABLE.width / 2 - 0.15),
              0.4,
              TABLE.center.z + sz * (TABLE.depth / 2 - 0.15),
            ]}
            material={materials.leg}
          >
            <boxGeometry args={[0.06, 0.8, 0.06]} />
          </mesh>
        )),
      )}
      <group ref={group} />
    </group>
  );
}

/** The library: one paper slab per corpus source the current meeting cites. */
function Library({ store }: { store: LabStore }) {
  const group = useRef<THREE.Group>(null);
  const key = useRef("");
  const shelf = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#2c383c", roughness: 0.8 }),
    [],
  );
  const paper = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#e8dcc0",
        emissive: "#3a3328",
        emissiveIntensity: 0.3,
      }),
    [],
  );
  const dim = useMemo(() => new THREE.MeshStandardMaterial({ color: "#5d5a50" }), []);
  useEffect(
    () => () => [shelf, paper, dim].forEach((m) => m.dispose()),
    [shelf, paper, dim],
  );
  useFrame(() => {
    const g = group.current;
    const m = store.meeting?.record;
    const k = m ? m.meeting_id : "none";
    if (!g || k === key.current) return;
    key.current = k;
    for (const c of [...g.children]) {
      g.remove(c);
      if (c instanceof THREE.Mesh) c.geometry.dispose();
    }
    const cited = new Set(
      m
        ? m.turns.flatMap((t) => t.quotes.filter((q) => q.verified).map((q) => q.source))
        : [],
    );
    const count = Math.max(cited.size, 0);
    for (let row = 0; row < 3; row++)
      for (let i = 0; i < 9; i++) {
        const lit = row === 1 && i < count;
        const slab = new THREE.Mesh(
          new THREE.BoxGeometry(0.06, 0.34, 0.26),
          lit ? paper : dim,
        );
        slab.position.set(-17.5, 0.9 + row * 0.7, -15.5 + i * 0.32);
        g.add(slab);
      }
  });
  return (
    <group>
      {[0, 1, 2].map((row) => (
        <mesh key={row} position={[-17.55, 0.7 + row * 0.7, -14.2]} material={shelf}>
          <boxGeometry args={[0.4, 0.05, 3.4]} />
        </mesh>
      ))}
      <group ref={group} />
    </group>
  );
}

/** The archive: every record is a slab; its ending decides its colour and mark. */
function Archive({ store }: { store: LabStore }) {
  const group = useRef<THREE.Group>(null);
  const key = useRef("");
  const mats = useMemo(
    () => ({
      supported: new THREE.MeshStandardMaterial({
        color: "#3fb6b0",
        emissive: TEAL,
        emissiveIntensity: 0.6,
      }),
      not_supported: new THREE.MeshStandardMaterial({
        color: "#d9a066",
        emissive: "#5a3c18",
        emissiveIntensity: 0.5,
      }),
      inconclusive: new THREE.MeshStandardMaterial({ color: "#8d9599" }),
      failed: new THREE.MeshStandardMaterial({
        color: "#b5524b",
        emissive: "#3c1210",
        emissiveIntensity: 0.5,
      }),
      rejected: new THREE.MeshStandardMaterial({ color: "#3c3550" }),
    }),
    [],
  );
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  useFrame(() => {
    const g = group.current;
    const k = store.records.map((r) => r.run_id).join();
    if (!g || k === key.current) return;
    key.current = k;
    for (const c of [...g.children]) {
      g.remove(c);
      if (c instanceof THREE.Mesh) c.geometry.dispose();
    }
    store.records.slice(0, 40).forEach((r, i) => {
      const m =
        r.outcome.state === "COMPLETED"
          ? r.outcome.verdict === "supported"
            ? mats.supported
            : mats.not_supported
          : r.outcome.state === "INCONCLUSIVE"
            ? mats.inconclusive
            : r.outcome.state === "FAILED"
              ? mats.failed
              : mats.rejected;
      const slab = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.36), m);
      slab.position.set(-17.3, 0.35 + Math.floor(i / 20) * 0.6, -3.8 + (i % 20) * 0.5);
      g.add(slab);
    });
  });
  return <group ref={group} />;
}

/** Instruments in the bay, and two columns that fill as arms complete. */
function Bay({ store }: { store: LabStore }) {
  const control = useRef<THREE.Mesh>(null),
    treatment = useRef<THREE.Mesh>(null);
  const rack = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#253033",
        metalness: 0.4,
        roughness: 0.5,
      }),
    [],
  );
  const led = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#3fb6b0",
        emissive: "#3fb6b0",
        emissiveIntensity: 1.2,
      }),
    [],
  );
  useEffect(() => () => [rack, led].forEach((m) => m.dispose()), [rack, led]);
  useFrame(({ clock }) => {
    const p = store.run?.progress;
    const share = p
      ? (p.armIndex + p.tick / Math.max(1, p.totalTicks)) / Math.max(1, p.arms)
      : 0;
    // Ornament: both columns fill with the run's progress; the panels hold the numbers.
    if (control.current) control.current.scale.y = 0.05 + share;
    if (treatment.current) treatment.current.scale.y = 0.05 + share;
    led.emissiveIntensity = store.run ? 0.8 + Math.sin(clock.elapsedTime * 4) * 0.4 : 0.6;
  });
  return (
    <group>
      {[0, 1, 2, 3].map((i) => (
        <group key={i} position={[17.4, 0, -15.5 + i * 1.6]}>
          <mesh material={rack} position={[0, 1, 0]}>
            <boxGeometry args={[0.6, 2, 1.2]} />
          </mesh>
          <mesh material={led} position={[-0.31, 1.6, 0.3]}>
            <boxGeometry args={[0.02, 0.05, 0.05]} />
          </mesh>
        </group>
      ))}
      <mesh ref={control} position={[10.6, 1, -9]}>
        <cylinderGeometry args={[0.18, 0.18, 2, 16]} />
        <meshStandardMaterial color="#9fb8c9" transparent opacity={0.5} />
      </mesh>
      <mesh ref={treatment} position={[13.4, 1, -9]}>
        <cylinderGeometry args={[0.18, 0.18, 2, 16]} />
        <meshStandardMaterial color="#3fb6b0" emissive={TEAL} emissiveIntensity={0.6} />
      </mesh>
    </group>
  );
}

/** The observation wall: the live city's own state, redrawn once a second. */
function ObservationWall({ store }: { store: LabStore }) {
  const { canvas, texture, base } = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 512;
    const base = document.createElement("canvas");
    base.width = base.height = 512;
    const c = base.getContext("2d")!;
    c.fillStyle = "#081416";
    c.fillRect(0, 0, 512, 512);
    const s = 500 / Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z);
    c.fillStyle = "#1f3a3e";
    for (const b of buildings) {
      c.beginPath();
      b.ring.forEach((v, i) => {
        const x = 6 + (v.x - bounds.min.x) * s,
          y = 6 + (v.z - bounds.min.z) * s;
        if (i) c.lineTo(x, y);
        else c.moveTo(x, y);
      });
      c.fill();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return { canvas, texture, base };
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  const last = useRef(-1);
  useFrame(({ clock }) => {
    const second = Math.floor(clock.elapsedTime);
    if (second === last.current) return;
    last.current = second;
    const c = canvas.getContext("2d")!;
    c.drawImage(base, 0, 0);
    const s = 500 / Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z);
    for (const a of store.sim.agents) {
      if (a.inside) continue;
      c.fillStyle =
        a.kind === "pedestrian"
          ? "#9ab69b"
          : a.kind === "emergency"
            ? "#f1b86d"
            : "#d4c8a4";
      c.fillRect(
        6 + (a.point.x - bounds.min.x) * s,
        6 + (a.point.z - bounds.min.z) * s,
        2,
        2,
      );
    }
    c.strokeStyle = "#e7a56c";
    for (const e of store.sim.events) {
      c.beginPath();
      c.arc(
        6 + (e.at.x - bounds.min.x) * s,
        6 + (e.at.z - bounds.min.z) * s,
        Math.max(3, e.radius * s),
        0,
        Math.PI * 2,
      );
      c.stroke();
    }
    // Perspectives out in the city, in their own colours.
    c.lineWidth = 2;
    for (const m of store.presenceSnapshot()) {
      c.strokeStyle = EMBODIMENT[m.who].body;
      c.beginPath();
      c.arc(
        6 + (m.x - bounds.min.x) * s,
        6 + (m.z - bounds.min.z) * s,
        5,
        0,
        Math.PI * 2,
      );
      c.stroke();
    }
    c.lineWidth = 1;
    texture.needsUpdate = true;
  });
  return (
    <mesh position={[0, 2.2, -16.85]}>
      <planeGeometry args={[4.4, 4.4]} />
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  );
}

/** Systems: status lights that say whether anything is connected. */
function Systems({ store }: { store: LabStore }) {
  const lamp = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(() => {
    if (!lamp.current) return;
    const live = store.mode() === "LIVE";
    lamp.current.color.set(live ? "#3fb6b0" : "#8a6a3a");
    lamp.current.emissive.set(live ? TEAL : "#3a2a12");
  });
  return (
    <group>
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[17.3, 1.1, -3 + i * 2.4]}>
          <boxGeometry args={[0.7, 2.2, 1.4]} />
          <meshStandardMaterial color="#20292c" roughness={0.6} />
        </mesh>
      ))}
      <mesh position={[16.9, 1.9, 0.6]}>
        <sphereGeometry args={[0.07, 12, 12]} />
        <meshStandardMaterial ref={lamp} emissiveIntensity={1.4} />
      </mesh>
    </group>
  );
}

// --- The four perspectives --------------------------------------------------------

/** A soft dark disc under a figure: the room has no shadow-casting light, and feet need a floor. */
function contactShadow() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const c = canvas.getContext("2d")!;
  const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(0,0,0,0.62)");
  g.addColorStop(0.45, "rgba(0,0,0,0.34)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const reducedMotion = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * The four perspectives, embodied (`figures.ts`) and animated
 * (`figureMotion.ts`) from R.A.I.N.'s neutral event vocabulary alone: who
 * has the current turn, and where the meeting is. Between meetings each idles
 * at its station; when a meeting is staged they walk to the table through the
 * doorways (`routeInLab`), and back when it is cleared. The speaker's mouth
 * and hands move and the others look to them; nothing moves with confidence
 * or agreement. A perspective out on an outing is in the city: its seat stays
 * empty, nobody turns to it, and its turn lights no ring.
 */
function Perspectives({ store }: { store: LabStore }) {
  const reduced = useMemo(reducedMotion, []);
  const cast = useMemo(
    () =>
      PERSPECTIVES.map((who) => {
        const rig = buildFigure(who, "lab");
        const start = STATIONS[who].at;
        const animator = new FigureAnimator(rig, seedFor(who));
        animator.place(start.x, start.z, STATIONS[who].facing);
        // The walks every meeting makes, planned now rather than on the frame
        // a meeting starts (the first also builds the lab's walking grid).
        routeInLab(start, SEATS[who]);
        routeInLab(SEATS[who], start);
        const walk: RouteWalk & { key: string; away: boolean } = {
          x: start.x,
          z: start.z,
          route: [],
          leg: 0,
          speed: 0,
          key: "",
          away: false,
        };
        return {
          who,
          rig,
          animator,
          walk,
          head: new THREE.Vector3(),
          glances: [] as THREE.Vector3[],
        };
      }),
    [],
  );
  const shadowMap = useMemo(contactShadow, []);
  useEffect(
    () => () => {
      for (const c of cast) c.rig.dispose();
      shadowMap.dispose();
    },
    [cast, shadowMap],
  );
  const halos = useRef<Record<string, THREE.Mesh | null>>({});
  const shadows = useRef<Record<string, THREE.Mesh | null>>({});
  const table = useMemo(
    () => new THREE.Vector3(TABLE.center.x, 0.86, TABLE.center.z),
    [],
  );
  const visitor = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera }, dt) => {
    const m = store.meeting;
    const meeting = !!m && m.revealed <= m.record.turns.length;
    const turn = currentSpeaker(
      m?.record ?? null,
      m && m.revealed < m.record.turns.length ? m.revealed : -1,
    );
    const away = store.presenceSnapshot();
    const isAway = (who: Perspective) => {
      for (const a of away) if (a.who === who) return true;
      return false;
    };
    // Whose turn it is, if they are in the room to take it.
    const speaker = turn && !isAway(turn) ? turn : null;
    const key = `${meeting}`;
    visitor.copy(camera.position);
    for (const c of cast) {
      c.rig.root.visible = !isAway(c.who);
      // Where each head is, for the others to look at.
      c.head.set(
        c.walk.x,
        c.rig.scale * (c.rig.kind === "octopus" ? 1.0 : 1.62),
        c.walk.z,
      );
    }
    let speaking: (typeof cast)[number] | null = null;
    for (const c of cast) if (c.who === speaker) speaking = c;
    for (const c of cast) {
      const { who, rig, animator, walk } = c;
      const halo = halos.current[who],
        shadow = shadows.current[who];
      if (!rig.root.visible) {
        // On an outing the figure is in the city; it comes back to its station.
        walk.away = true;
        if (halo) halo.visible = false;
        if (shadow) shadow.visible = false;
        continue;
      }
      const target = meeting ? SEATS[who] : STATIONS[who].at;
      if (walk.away || reduced) {
        walk.away = false;
        walk.x = target.x;
        walk.z = target.z;
        walk.route = [];
        walk.leg = 0;
        walk.key = key;
        animator.place(target.x, target.z, animator.position.yaw);
      }
      if (walk.key !== key) {
        walk.key = key;
        walk.route = routeInLab({ x: walk.x, z: walk.z }, target).slice(1);
        walk.leg = 0;
      }
      followRoute(walk, Math.min(dt, 0.1));
      // Face the speaker, the table, or the station's own direction.
      const towards =
        speaker && speaker !== who ? SEATS[speaker] : meeting ? TABLE.center : null;
      const face = !arrived(walk)
        ? null
        : towards
          ? yawToward(towards.x - walk.x, towards.z - walk.z)
          : STATIONS[who].facing;
      // Attention: the speaker; the table while a meeting has no speaker in
      // the room; a visitor who comes close between meetings; otherwise ahead.
      let look: THREE.Vector3 | null = null;
      if (speaking && speaking !== c) look = speaking.head;
      else if (meeting && !speaking) look = table;
      else if (!meeting && Math.hypot(visitor.x - walk.x, visitor.z - walk.z) < 3)
        look = visitor;
      c.glances.length = 0;
      if (speaking === c)
        for (const o of cast) if (o !== c && o.rig.root.visible) c.glances.push(o.head);
      animator.update(
        dt,
        {
          x: walk.x,
          z: walk.z,
          ground: 0,
          face,
          look,
          glances: c.glances,
          speaking: speaking === c,
          scan: false,
        },
        reduced,
      );
      if (halo) {
        halo.visible = speaking === c;
        halo.position.set(walk.x, 0.02, walk.z);
      }
      if (shadow) {
        shadow.visible = true;
        shadow.position.set(walk.x, 0.012, walk.z);
      }
    }
  });
  return (
    <>
      {cast.map(({ who, rig }) => (
        <group key={who}>
          <primitive object={rig.root} />
          <mesh
            ref={(s) => void (shadows.current[who] = s)}
            rotation={[-Math.PI / 2, 0, 0]}
            scale={rig.footprint * rig.scale * 2.4}
            renderOrder={1}
          >
            <planeGeometry args={[1, 1]} />
            <meshBasicMaterial
              map={shadowMap}
              transparent
              depthWrite={false}
              toneMapped={false}
              polygonOffset
              polygonOffsetFactor={-2}
            />
          </mesh>
          <mesh
            ref={(h) => void (halos.current[who] = h)}
            rotation={[-Math.PI / 2, 0, 0]}
            visible={false}
          >
            <ringGeometry
              args={[rig.footprint * 1.25, rig.footprint * 1.25 + 0.08, 48]}
            />
            <meshBasicMaterial
              color="#3fb6b0"
              transparent
              opacity={0.7}
              depthWrite={false}
            />
          </mesh>
        </group>
      ))}
    </>
  );
}

function Lights() {
  useRendererToneMapping({
    postprocessing: false,
    exposure: 1.1,
    restoreOnUnmount: true,
  });
  const { scene } = useThree();
  useEffect(() => {
    const previous = scene.background;
    scene.background = new THREE.Color("#071012");
    return () => {
      scene.background = previous;
    };
  }, [scene]);
  return (
    <>
      <hemisphereLight args={["#9cc6cf", "#1a2224", 0.75]} />
      {[
        [0, 3.6, 1, "#cfe9e5"],
        [-12, 3.6, -11, "#f1e7cf"],
        [12, 3.6, -11, "#bfe5e1"],
        [0, 3.6, -11, "#bfe5e1"],
        [-12, 3.6, 1, "#d8d0e8"],
        [12, 3.6, 1, "#bfe5e1"],
        [0, 3.4, 11, "#9fd6d0"],
      ].map(([x, y, z, c]) => (
        <pointLight
          key={`${x},${z}`}
          position={[x as number, y as number, z as number]}
          color={c as string}
          intensity={14}
          distance={13}
          decay={1.6}
        />
      ))}
    </>
  );
}

function Walker({ store, nav }: { store: LabStore; nav: LabNav }) {
  const { camera, gl, size } = useThree();
  const room = useRef<RoomId | null>(null);
  const offset = useRef("");
  useEffect(() => {
    const canvas = gl.domElement;
    const look = new LookDrag(0.0022);
    const down = (e: PointerEvent) => {
      if (look.begin(e)) canvas.setPointerCapture(e.pointerId);
    };
    const up = (e: PointerEvent) => look.end(e);
    const move = (e: PointerEvent) => {
      const turn = look.turn(e, document.pointerLockElement === canvas);
      if (!turn) return;
      nav.yaw += turn.yaw;
      nav.pitch = Math.max(-1.1, Math.min(1.1, nav.pitch + turn.pitch));
    };
    const lock = () => void canvas.requestPointerLock()?.catch(() => {});
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("dblclick", lock);
    return () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("dblclick", lock);
    };
  }, [gl, nav]);
  useFrame((_, dt) => {
    if (nav.teleport) {
      nav.pos = { ...nav.teleport };
      nav.teleport = null;
    }
    const intent = walkIntent(nav.keys, nav.stick, true);
    if (intent) {
      const t = Math.min(dt, 0.1);
      const { dx, dz } = stepFor(intent, nav.yaw, 1.8 * t, 3.4 * t);
      nav.pos = moveInLab(nav.pos, { x: nav.pos.x + dx, z: nav.pos.z + dz });
    }
    camera.position.set(nav.pos.x, 1.65, nav.pos.z);
    camera.rotation.order = "YXZ";
    camera.rotation.set(nav.pitch, nav.yaw, 0);
    // Centre the projection on the part of the canvas the panels leave open.
    const c = nav.viewCenter;
    const ox = c ? Math.round(size.width / 2 - c.x) : 0,
      oy = c ? Math.round(size.height / 2 - c.y) : 0;
    const key = `${size.width}x${size.height}+${ox}+${oy}`;
    if (key !== offset.current && camera instanceof THREE.PerspectiveCamera) {
      offset.current = key;
      if (ox === 0 && oy === 0) camera.clearViewOffset();
      else camera.setViewOffset(size.width, size.height, ox, oy, size.width, size.height);
      // The point the projection now centres on, for the phone checks to read.
      gl.domElement.dataset.viewCenter = `${size.width / 2 - ox},${size.height / 2 - oy}`;
    }
    nav.atExit = Math.hypot(nav.pos.x - EXIT_DOOR.x, nav.pos.z - EXIT_DOOR.z) < 1.8;
    const r = roomAt(nav.pos);
    if (r && r !== room.current) {
      room.current = r;
      store.enterRoom(r);
    }
  });
  return null;
}

/**
 * The resonance view, re-derived only when the store has changed: the
 * instrument reads it every frame, and the store is never written by it.
 */
function useResonance(store: LabStore) {
  return useMemo(() => {
    let version = -1,
      view: ResonanceView | null = null;
    return () => {
      if (!view || store.version !== version) {
        version = store.version;
        view = resonanceView(snapshotOf(store));
      }
      return view;
    };
  }, [store]);
}

export function LabScene({
  store,
  nav,
  quality,
  auto,
  onInspect,
}: {
  store: LabStore;
  nav: LabNav;
  /** Where R.A.I.N.'s instrument starts; under `auto` it steps down on slow frames. */
  quality: ResonanceQuality;
  auto: boolean;
  /** A click or tap on the instrument: open what R.A.I.N. is doing. */
  onInspect: () => void;
}) {
  const supported = useMemo(canRender, []);
  const read = useResonance(store);
  if (!supported || nav.failed)
    return (
      <p role="status" className="absolute top-44 left-5 max-w-sm text-sm text-teal-100">
        3D rendering is unavailable. Every room and every capability remains available in
        the panels.
      </p>
    );
  return (
    <Canvas
      // Every drag on the interior is a look, never the browser's scroll.
      style={{ touchAction: "none" }}
      dpr={[1, 1.5]}
      camera={{ fov: 70, near: 0.05, far: 120, position: [nav.pos.x, 1.65, nav.pos.z] }}
      gl={{
        antialias: true,
        logarithmicDepthBuffer: true,
        powerPreference: "high-performance",
      }}
      onCreated={({ gl }) => {
        gl.domElement.addEventListener("webglcontextlost", () => {
          nav.failed = true;
        });
      }}
    >
      <fog attach="fog" args={["#071012", 14, 46]} />
      <Lights />
      <Shell />
      <ThresholdWords />
      <Waveform />
      <EvidenceTable store={store} />
      <Library store={store} />
      <Archive store={store} />
      <Bay store={store} />
      <ObservationWall store={store} />
      <Systems store={store} />
      <Perspectives store={store} />
      <RAINResonanceFace
        key={quality}
        read={read}
        quality={quality}
        auto={auto}
        onInspect={onInspect}
      />
      <Walker store={store} nav={nav} />
    </Canvas>
  );
}
