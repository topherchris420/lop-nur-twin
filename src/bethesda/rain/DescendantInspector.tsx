import { useEffect, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { buildings } from "../model";
import { canRender } from "../webgl";
import { verifyRecord, type ReplayFrame } from "./replay";
import type { ExperimentRecord } from "./record";
import type { ResearchView } from "./researchProtocol";
type Inspection = {
  schema: "rain-descendant-inspection/v1";
  spec: { id: string; objective: string };
  digest: string;
  status: string;
  records: ExperimentRecord[];
  research: ResearchView | null;
  journal: unknown[];
};
function World({
  frame,
  center,
}: {
  frame: React.RefObject<ReplayFrame | null>;
  center: { x: number; z: number };
}) {
  const people = useRef<THREE.InstancedMesh>(null),
    vehicles = useRef<THREE.InstancedMesh>(null);
  const matrix = useRef(new THREE.Matrix4());
  const renders = useRef(0);
  useFrame(({ gl }) => {
    gl.domElement.dataset.rainReplayFrame = String(++renders.current);
    const current = frame.current;
    if (!current) {
      if (people.current) people.current.count = 0;
      if (vehicles.current) vehicles.current.count = 0;
      return;
    }
    for (const [mesh, points, y] of [
      [people.current, current.pedestrians, 1],
      [vehicles.current, current.vehicles, 0.5],
    ] as const) {
      if (!mesh) continue;
      mesh.count = Math.min(points.length, 400);
      points.slice(0, 400).forEach((p, i) => {
        matrix.current.makeTranslation(p.x, y, p.z);
        mesh.setMatrixAt(i, matrix.current);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
  });
  return (
    <>
      <ambientLight intensity={1.5} />
      <directionalLight position={[center.x + 100, 200, center.z + 50]} intensity={2} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[center.x, 0, center.z]}>
        <planeGeometry args={[600, 600]} />
        <meshStandardMaterial color="#273a3d" />
      </mesh>
      {buildings
        .filter((b) => Math.hypot(b.center.x - center.x, b.center.z - center.z) < 180)
        .map((b) => {
          const xs = b.ring.map((p) => p.x),
            zs = b.ring.map((p) => p.z);
          const width = Math.max(...xs) - Math.min(...xs),
            depth = Math.max(...zs) - Math.min(...zs);
          return (
            <mesh key={b.id} position={[b.center.x, b.height / 2, b.center.z]}>
              <boxGeometry args={[width, b.height, depth]} />
              <meshStandardMaterial color="#637a81" />
            </mesh>
          );
        })}
      <instancedMesh
        ref={people}
        args={[undefined, undefined, 400]}
        frustumCulled={false}
      >
        <capsuleGeometry args={[0.45, 1, 3, 6]} />
        <meshStandardMaterial color="#bd934f" />
      </instancedMesh>
      <instancedMesh
        ref={vehicles}
        args={[undefined, undefined, 400]}
        frustumCulled={false}
      >
        <boxGeometry args={[2, 1, 4]} />
        <meshStandardMaterial color="#5486bc" />
      </instancedMesh>
      <OrbitControls target={[center.x, 0, center.z]} maxDistance={400} />
    </>
  );
}
export function DescendantInspector({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [status, setStatus] = useState("Loading descendant records");
  const [running, setRunning] = useState(false);
  const [showWorld, setShowWorld] = useState(false);
  const [checks, setChecks] = useState<unknown>(null);
  const hostAbort = useRef<AbortController | null>(null);
  useEffect(() => () => hostAbort.current?.abort(), []);
  const frame = useRef<ReplayFrame | null>(null);
  const playback = useRef<ReturnType<typeof verifyRecord> | null>(null);
  const [recordIndex, setRecordIndex] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    void fetch("/api/rain/discovery?lab=" + encodeURIComponent(id), {
      signal: abort.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Descendant unavailable");
        const data = (await response.json()) as Inspection;
        if (
          data.schema !== "rain-descendant-inspection/v1" ||
          !Array.isArray(data.records)
        )
          throw new Error("Invalid descendant inspection");
        if (!abort.signal.aborted) {
          setInspection(data);
          setStatus("Select a completed experiment to enter its bounded replay");
        }
      })
      .catch((error) => {
        if (!abort.signal.aborted) setStatus(String(error));
      });
    return () => abort.abort();
  }, [id]);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      const replay = playback.current;
      if (!replay) {
        setRunning(false);
        return;
      }
      for (let i = 0; i < 8; i++) {
        const step = replay.next();
        if (step.done) {
          setChecks(step.value.checks);
          setStatus(
            step.value.ok
              ? "Replay verified: recorded simulator evidence reproduced"
              : "Browser replay differed; checking bounded host reproduction",
          );
          if (!step.value.ok) {
            const selected = inspection?.records[recordIndex];
            if (selected) {
              hostAbort.current?.abort();
              const abort = new AbortController();
              hostAbort.current = abort;
              void fetch(
                "/api/rain/discovery?verify=" +
                  encodeURIComponent(id) +
                  "&run=" +
                  encodeURIComponent(selected.run_id),
                { signal: abort.signal },
              )
                .then(async (response) => {
                  if (!response.ok) throw new Error("Host replay unavailable");
                  const receipt = await response.json();
                  if (!abort.signal.aborted) {
                    setChecks({ browser: step.value.checks, host: receipt });
                    setStatus(
                      receipt.schema === "rain-host-replay/v1" &&
                        receipt.record_sha256 === selected.record_sha256 &&
                        receipt.verification?.ok === true
                        ? "Host replay verified; browser state hashes differ. Displayed frames are approximate reconstruction, not exact verified playback."
                        : "Replay failed; displayed reconstruction is not verified evidence",
                    );
                  }
                })
                .catch((error) => {
                  if (!abort.signal.aborted) setStatus("Replay failed; " + String(error));
                });
            }
          }
          setRunning(false);
          playback.current = null;
          break;
        }
      }
    }, 16);
    return () => clearInterval(timer);
  }, [running, id, inspection, recordIndex]);
  const record = inspection?.records[recordIndex];
  const center = record?.definition?.center;
  return (
    <section
      aria-label="Descendant world inspection"
      className="my-3 border border-teal-700 p-3"
    >
      <button onClick={onClose}>Close descendant</button>
      <h4>{inspection?.spec.id ?? id}</h4>
      <p>{inspection?.spec.objective}</p>
      <p role="status">{status}</p>
      <p className="text-xs">
        This is a read-only reconstruction of an authorized recorded experiment. No new
        research or inference starts. Building boxes approximate the mapped footprints;
        the verifier owns measurements. Simulator findings remain simulator findings.
      </p>
      <label className="block">
        Recorded experiment{" "}
        <select
          disabled={running}
          value={recordIndex}
          onChange={(e) => {
            hostAbort.current?.abort();
            setRecordIndex(Number(e.target.value));
            playback.current = null;
            frame.current = null;
          }}
        >
          {inspection?.records.map((r, i) => (
            <option key={r.run_id} value={i}>
              {r.run_id}
            </option>
          ))}
        </select>
      </label>
      <button
        disabled={!record || running}
        onClick={() => {
          hostAbort.current?.abort();
          playback.current = verifyRecord(record, (next) => {
            frame.current = next;
          });
          setStatus("Replaying unverified frames; final verification pending");
          setChecks(null);
          setRunning(true);
        }}
      >
        Enter / restart bounded world replay
      </button>
      <button disabled={!playback.current} onClick={() => setRunning((v) => !v)}>
        {running ? "Pause replay" : "Resume replay"}
      </button>
      <button
        disabled={!playback.current}
        onClick={() => {
          hostAbort.current?.abort();
          setRunning(false);
          playback.current = null;
          setStatus("Replay cancelled; no verification receipt");
        }}
      >
        Cancel replay
      </button>
      <button disabled={!center || !canRender()} onClick={() => setShowWorld((v) => !v)}>
        {showWorld ? "Use accessible history view" : "Show 3D reconstruction"}
      </button>
      {record?.run && (
        <details open>
          <summary>Recorded seed measurements (simulator only)</summary>
          <textarea
            readOnly
            rows={8}
            value={JSON.stringify(record.run.per_seed, null, 2)}
            aria-label="Recorded simulator measurements"
            className="w-full max-h-40 overflow-auto whitespace-pre-wrap text-xs"
          />
        </details>
      )}
      {showWorld && center && canRender() && (
        <div className="h-72" data-rain-replay-preview="active">
          <Canvas
            onCreated={({ gl }) => gl.setClearColor("#273a3d", 1)}
            camera={{
              position: [center.x + 90, 110, center.z + 90],
              near: 0.1,
              far: 1500,
            }}
          >
            <World frame={frame} center={center} />
          </Canvas>
        </div>
      )}
      <details>
        <summary>Replay validation checks</summary>
        <pre className="max-h-60 overflow-auto whitespace-pre-wrap text-xs">
          {JSON.stringify(checks, null, 2)}
        </pre>
      </details>
      <details>
        <summary>Research history, sources and disagreements</summary>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs">
          {JSON.stringify(inspection?.research ?? inspection?.journal, null, 2)}
        </pre>
      </details>
    </section>
  );
}
