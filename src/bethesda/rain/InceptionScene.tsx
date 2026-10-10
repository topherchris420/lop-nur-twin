/** Presentation reads host session status. It never invents speech or implies agreement. */
import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { buildFigure } from "./figures";
import {
  FigureAnimator,
  followRoute,
  seedFor,
  yawToward,
  type RouteWalk,
} from "./figureMotion";
import { PARTNERS, type Partner } from "./inceptionProtocol";
import {
  INCEPTION_SEATS,
  INCEPTION_STATIONS,
  INCEPTION_OBSERVATORY,
  TABLE,
  routeInLab,
} from "./labLayout";
import type { DiscoveryView } from "./discoveryView";
import type { LabNav } from "./LabScene";
function nameplate(text: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 80;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#071012";
  context.fillRect(0, 0, 512, 80);
  context.fillStyle = "#d4efed";
  context.font = "26px monospace";
  context.textAlign = "center";
  context.fillText(text, 256, 48);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.375), material);
  return {
    mesh,
    dispose: () => {
      mesh.geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}
export function InceptionScene({
  view,
  onInspect,
  colors,
  nav,
}: {
  view: DiscoveryView | null;
  onInspect: (partner: Partner | null) => void;
  colors: { founder: string; collaborator: string };
  nav: LabNav;
}) {
  const reduced = useMemo(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );
  const cast = useMemo(
    () =>
      PARTNERS.map((who, i) => {
        const rig = buildFigure("Luca", "lab", {
          body: i ? colors.collaborator : colors.founder,
          accent: i ? "#66558a" : "#8c6638",
          skin: i ? "#7dd3dc" : "#bea58a",
          hair: i ? "#ccd9ed" : "#31313a",
        });
        rig.root.name = "rain-partner-" + who;
        const label = nameplate(who);
        label.mesh.rotation.y = Math.PI;
        label.mesh.position.set(0, 2, 0);
        rig.root.add(label.mesh);
        const station = INCEPTION_STATIONS[who];
        const animator = new FigureAnimator(rig, seedFor(who));
        animator.place(station.x, station.z, Math.PI);
        const walk: RouteWalk & { active: boolean } = {
          ...station,
          route: [],
          leg: 0,
          speed: 0,
          active: false,
        };
        return { who, rig, animator, walk, label };
      }),
    [colors.founder, colors.collaborator],
  );
  useEffect(
    () => () => {
      cast.forEach((c) => {
        c.label.dispose();
        c.rig.dispose();
      });
    },
    [cast],
  );
  useFrame((_, dt) => {
    nav.nearPartner = null;
    const active = !!view?.active && !!view.research?.partnership;
    for (const c of cast) {
      if (c.walk.active !== active) {
        c.walk.active = active;
        const target = active ? INCEPTION_SEATS[c.who] : INCEPTION_STATIONS[c.who];
        if (reduced) {
          c.walk.x = target.x;
          c.walk.z = target.z;
          c.walk.route = [];
        } else c.walk.route = routeInLab(c.walk, target).slice(1);
        c.walk.leg = 0;
      }
      followRoute(c.walk, Math.min(dt, 0.1));
      if (Math.hypot(c.walk.x - nav.pos.x, c.walk.z - nav.pos.z) < 2)
        nav.nearPartner = c.who;
      const speaking =
        active && view?.stage === "COLLABORATE" && view.detail.startsWith(c.who + ":");
      c.animator.update(
        dt,
        {
          x: c.walk.x,
          z: c.walk.z,
          ground: 0,
          face: yawToward(TABLE.center.x - c.walk.x, TABLE.center.z - c.walk.z),
          look: null,
          glances: [],
          speaking,
          scan: active && view?.stage === "LITERATURE",
        },
        reduced,
      );
    }
  });
  const observatory = INCEPTION_OBSERVATORY;
  const labs = view?.observatory?.labs ?? [];
  const graphKey = JSON.stringify(
    labs
      .slice(0, 12)
      .map((l) => ({ id: l.id, parent: l.parent, generation: l.generation })),
  );
  const graph = useMemo(() => {
    const nodes = JSON.parse(graphKey) as {
      id: string;
      parent: string;
      generation: number;
    }[];
    const positions = new Map([
      ...[["bethesda-rain", new THREE.Vector3(-1.2, 0.95, 0.1)] as const],
      ...nodes.map(
        (n, i) =>
          [
            n.id,
            new THREE.Vector3(-1.2 + n.generation * 0.7, 0.75 - i * 0.14, 0.1),
          ] as const,
      ),
    ]);
    const material = new THREE.LineBasicMaterial({ color: "#69bdc6" });
    const group = new THREE.Group();
    for (const n of nodes) {
      const from = positions.get(n.parent),
        to = positions.get(n.id);
      if (from && to)
        group.add(
          new THREE.Line(new THREE.BufferGeometry().setFromPoints([from, to]), material),
        );
    }
    const title = nameplate("Inception Observatory / Generation 0–2");
    title.mesh.position.set(0, 1.3, 0.1);
    group.add(title.mesh);
    return {
      group,
      dispose: () => {
        title.dispose();
        group.children.forEach((child) => {
          if (child instanceof THREE.Line) child.geometry.dispose();
        });
        material.dispose();
      },
    };
  }, [graphKey]);
  useEffect(() => () => graph.dispose(), [graph]);
  return (
    <>
      {cast.map((c) => (
        <group key={c.who}>
          <primitive object={c.rig.root} />
          <mesh
            position={[INCEPTION_STATIONS[c.who].x, 0.08, INCEPTION_STATIONS[c.who].z]}
            onClick={(e) => {
              e.stopPropagation();
              onInspect(c.who);
            }}
            rotation={[-Math.PI / 2, 0, 0]}
          >
            <ringGeometry args={[0.45, 0.6, 24]} />
            <meshBasicMaterial
              color={c.who === "Christopher-Sim" ? colors.founder : colors.collaborator}
              side={THREE.DoubleSide}
            />
          </mesh>
        </group>
      ))}
      <group
        position={[observatory.at.x, 1.5, observatory.at.z]}
        onClick={(e) => {
          e.stopPropagation();
          onInspect(null);
        }}
      >
        <mesh>
          <boxGeometry args={[observatory.width, observatory.height, 0.08]} />
          <meshStandardMaterial color="#0b282b" emissive="#082326" />
        </mesh>
        <primitive object={graph.group} />
        {labs.slice(0, 12).map((lab, i) => (
          <mesh
            key={lab.id}
            position={[-1.2 + lab.generation * 0.7, 0.75 - i * 0.14, 0.1]}
          >
            <sphereGeometry args={[0.065, 8, 6]} />
            <meshBasicMaterial color={lab.status === "running" ? "#f2cd73" : "#69bdc6"} />
          </mesh>
        ))}
      </group>
    </>
  );
}
