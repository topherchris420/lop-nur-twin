/**
 * The fly's inspection panel. Two halves, kept apart on purpose: what this
 * run of the simulator is doing (simulation observations), and what the model
 * is built from (FlyBody's body model, published parameters, this simulator's
 * own choices and the Virtual Fly Brain reference). It reads the fly four
 * times a second; nothing here writes to the fly or the city.
 */
import { useEffect, useState, type ReactNode } from "react";
import { EXTERNAL_LINK_PROPS, safeExternalHref } from "../../lib/safeUrl";
import { REDUCED_ORDER_DESCRIPTOR, ReducedOrderController } from "./controller";
import source from "./data/flybody.source.json" with { type: "json" };
import { FLY_VERSION } from "./fly";
import type { FlyViewControl } from "./FlyView";
import { CITATIONS, citationUrl, PARAMS, type Param, type ParamName } from "./params";
import { doiUrl, VFB_REFERENCE, VFB_TERMS, vfbUrl } from "./reference";
import { UNSUPPORTED_SENSES } from "./senses";
import { SKELETON } from "./skeleton";
import { radToDeg } from "./units";

const KIND_LABEL = {
  flybody: "FlyBody model value",
  published: "published",
  model: "model choice",
} as const;

function Link({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={safeExternalHref(href)} {...EXTERNAL_LINK_PROPS} className="underline">
      {children}
    </a>
  );
}

function Term({ id }: { id: string }) {
  const t = VFB_TERMS.get(id);
  return (
    <Link href={vfbUrl(id)}>
      {t ? (t.symbol && t.symbol !== t.label ? `${t.label} (${t.symbol})` : t.label) : id}
    </Link>
  );
}

function Row({
  label,
  evidence,
  children,
}: {
  label: string;
  evidence?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[104px_1fr] gap-2">
      <dt className="text-slate-300">{label}</dt>
      <dd>
        {children}
        {evidence ? (
          <span className="ml-1 font-mono text-[9px] tracking-wide text-teal-200/80">
            [{evidence}]
          </span>
        ) : null}
      </dd>
    </div>
  );
}

const compass = (yaw: number) => {
  // yaw 0 = east, π/2 = north; compass bearing clockwise from north.
  const b = (90 - radToDeg(yaw) + 360) % 360;
  const names = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return `${b.toFixed(0)}° (${names[Math.round(b / 45) % 8]})`;
};
const seconds = (x: number) => (Number.isFinite(x) ? `${x.toFixed(2)} s` : "none");

export function FlyPanel({
  control,
  panel,
  button,
  viewer,
  canDraw,
  onClose,
}: {
  control: FlyViewControl;
  panel: string;
  button: string;
  /** Where the visitor is, to say where the fly is from them. */
  viewer: () => { x: number; z: number };
  /** False without a 3D view: the fly still lives, but cannot be drawn or inspected. */
  canDraw: boolean;
  onClose: () => void;
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!canDraw) control.inspect = control.slow = false;
  }, [canDraw, control]);
  // On a phone the panel would cover the close-up, so it folds to its buttons there.
  const [details, setDetails] = useState(false);
  const folded = control.inspect && !details;
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(timer);
  }, []);
  const city = control.city;
  const fly = city.fly;
  const s = fly.state;
  const f = fly.lastFrame;
  const gait = fly.gaitNow();
  const speed = Math.hypot(s.v[0], s.v[1], s.v[2]);
  const flying = s.mode === "flight" || s.mode === "land";
  const recent = fly.log.slice(-4).reverse();
  const inputs = city.world.inputs;
  const at = viewer();
  const away = Math.hypot(s.p[0] - at.x, s.p[2] - at.z);
  const reserve = s.reserve / PARAMS.reserveJ.value;
  const hungry = 1 - reserve > PARAMS.hungerSeek.value;
  // What the built-in controller believes and remembers; another controller reports none.
  const nav =
    fly.adapter instanceof ReducedOrderController ? fly.adapter.state.nav : null;
  const byEstimate = (q: readonly number[]) =>
    nav ? Math.hypot(q[0]! - nav.est[0], q[1]! - nav.est[1]) : 0;
  const nearestPlace = nav?.places.reduce<number | null>(
    (best, place) => Math.min(best ?? Infinity, byEstimate(place.at)),
    null,
  );
  return (
    <section
      aria-label="Digital fly"
      className={
        "absolute top-32 right-4 z-20 max-h-[calc(100vh-10rem)] w-[min(400px,calc(100vw-32px))] overflow-auto text-[11px] " +
        panel
      }
    >
      <p className="font-mono text-[9px] tracking-[.24em] text-teal-200">DIGITAL FLY</p>
      <h2 className="mt-1 text-base">
        <i>Drosophila melanogaster</i>, adult
      </h2>
      <p className="mt-1 text-slate-300">
        One simulated fly at true size ({SKELETON.measures.bodyLengthCm.toFixed(3)} cm
        long), on a {city.placedOn}.{" "}
        {canDraw
          ? `The ring marks where it is; the fly is not enlarged. Drawn: ${control.drawn}.`
          : "Without a 3D view it is not drawn; this panel follows it."}
      </p>
      {city.failed ? (
        <p role="alert" className="mt-2 text-amber-200">
          The fly stopped: {city.failed}. The city is unaffected.
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {canDraw ? (
          <>
            <button
              type="button"
              className={button}
              aria-pressed={control.inspect}
              onClick={() => {
                control.inspect = !control.inspect;
                tick((n) => n + 1);
              }}
            >
              {control.inspect ? "Leave close-up" : "Inspect up close"}
            </button>
            <button
              type="button"
              className={button}
              aria-pressed={control.slow}
              onClick={() => {
                control.slow = !control.slow;
                tick((n) => n + 1);
              }}
            >
              Wings at 1/100 speed
            </button>
          </>
        ) : null}
        <button type="button" className={button} onClick={onClose}>
          Close
        </button>
        {control.inspect ? (
          <button
            type="button"
            className={button + " sm:hidden"}
            aria-expanded={details}
            aria-controls="fly-details"
            onClick={() => setDetails((d) => !d)}
          >
            {details ? "Hide details" : "Details"}
          </button>
        ) : null}
      </div>
      {control.inspect ? (
        <p className="mt-1 text-slate-300">
          Drag to turn the close-up. FlyBody&apos;s mesh at full detail.
        </p>
      ) : null}

      <div id="fly-details" className={folded ? "max-sm:hidden" : undefined}>
        <h3 className="mt-3 font-mono text-[9px] tracking-[.2em] text-teal-200">
          THIS RUN · SIMULATION OBSERVATIONS
        </h3>
        <p className="text-slate-300">
          What the simulator is doing now. These describe the simulator, not a real fly.
        </p>
        <dl className="mt-1 space-y-1">
          <Row label="Where">
            {away < 1
              ? `${(away * 100).toFixed(0)} cm from you`
              : `${away.toFixed(0)} m from you, ${compass(Math.atan2(-(s.p[2] - at.z), s.p[0] - at.x))}`}
          </Row>
          <Row label="Behaviour" evidence="simulated">
            {s.mode}
            {s.sub ? ` · ${s.sub}` : ""} for {s.modeT.toFixed(1)} s
          </Row>
          <Row label="Movement" evidence="simulated">
            {(speed * 100).toFixed(1)} cm/s, heading {compass(s.yaw)}
            {flying && f
              ? `, ${(f.altitude * 100).toFixed(0)} cm above the ${f.below?.kind ?? "surface"}`
              : ""}
            {s.mode === "walk"
              ? `; ${gait.pattern} gait, ${gait.stance} of 6 legs planted`
              : ""}
            {flying
              ? `; wingbeat ${s.wingHz.toFixed(0)} Hz, amplitude L ${s.ampL.toFixed(2)} / R ${s.ampR.toFixed(2)}`
              : ""}
          </Row>
          <Row label="Sensory input" evidence="simulated">
            {f ? (
              <>
                {f.looming
                  ? `Looming ${f.looming.kind} ${(f.looming.distance * 100).toFixed(0)} cm away, ${f.looming.sizeDeg.toFixed(1)}° expanding ${f.looming.expansionDegS.toFixed(0)}°/s (giant-fiber proxy ${f.looming.drive.toFixed(2)} of threshold ${PARAMS.gfThreshold.value}). `
                  : "Nothing looming. "}
                {f.visibleMovers} moving {f.visibleMovers === 1 ? "thing" : "things"}{" "}
                visible. Light {f.light.toFixed(2)} (relative proxy)
                {f.lightBearing !== null
                  ? `, brightest ${radToDeg(f.lightBearing).toFixed(0)}° from heading`
                  : ""}
                .
                {flying
                  ? ` Time to contact ahead ${seconds(f.ttcFront)}, left ${seconds(f.ttcLeft)}, right ${seconds(f.ttcRight)}.`
                  : ""}
                {` Food odour ${f.odour.toFixed(3)} (relative proxy); ${f.landmarks.length} ${f.landmarks.length === 1 ? "landmark" : "landmarks"} in view`}
                {f.shadeBearing !== null
                  ? `; shade on the ground ${radToDeg(f.shadeBearing).toFixed(0)}° from heading`
                  : ""}
                .
              </>
            ) : (
              "not yet sampled"
            )}
          </Row>
          <Row label="Energy" evidence="simulated">
            Reserve {(reserve * 100).toFixed(0)} % of full ({s.reserve.toFixed(2)} of{" "}
            {PARAMS.reserveJ.value} J)
            {hungry ? ": hungry, so drawn to food odour and food" : ": fed"}
            {reserve < PARAMS.flightReserveFloor.value
              ? ", too low to take off on its own"
              : ""}
            . Fed {s.counts.meals} {s.counts.meals === 1 ? "time" : "times"} (
            {s.counts.feedS.toFixed(0)} s, {s.counts.fedJ.toFixed(3)} J taken in); spent{" "}
            {s.counts.spentJ.toFixed(3)} J.
          </Row>
          <Row label="Navigation" evidence="simulated">
            {nav ? (
              <>
                {nav.goal
                  ? `${nav.goal.kind === "return" ? "Flying back to food it remembers" : "On a long flight toward a place it has not been"}, ${byEstimate(nav.goal.at).toFixed(0)} m to go by its own estimate. `
                  : ""}
                Its path integration puts it{" "}
                {Math.hypot(nav.est[0] - s.p[0], nav.est[1] - s.p[2]).toFixed(1)} m from
                where it is
                {nav.compass
                  ? " (heading held to the sky or the brightest light)"
                  : " (no compass in view: its heading drifts)"}
                . It remembers {nav.places.length} food{" "}
                {nav.places.length === 1 ? "place" : "places"}
                {nearestPlace !== null && nearestPlace !== undefined
                  ? `, the nearest ${nearestPlace.toFixed(0)} m away by its estimate`
                  : ""}
                , and has been in {nav.visited.length} of its 10 m squares
                {nav.search && s.t < nav.search.until
                  ? "; searching near food it left"
                  : ""}
                .
              </>
            ) : (
              "Not reported by this controller."
            )}
          </Row>
          <Row label="Not sensed" evidence="unsupported">
            {[...new Set([...UNSUPPORTED_SENSES, ...inputs.unsupported])].join(", ")}
          </Row>
          <Row label="Decision" evidence="simulated">
            <ul>
              {recent.map((r, i) => (
                <li key={`${r.t}-${i}`}>
                  {r.t.toFixed(1)} s · {r.kind === "refused" ? "refused: " : ""}
                  {r.from === r.to ? r.to : `${r.from} → ${r.to}`} — {r.reason}
                </li>
              ))}
            </ul>
          </Row>
          <Row label="Confidence">
            Not reported: the controller has no calibrated estimate of its own confidence.
          </Row>
          <Row label="So far" evidence="simulated">
            {s.counts.takeoffs} takeoffs ({s.counts.escapes} escapes), {s.counts.landings}{" "}
            landings, {s.counts.saccades} saccades, {s.counts.collisions} collisions (
            {s.counts.contactS.toFixed(1)} s touching), {s.counts.groomBouts} grooming
            bouts; walked {(s.counts.walkedM * 100).toFixed(0)} cm, flew{" "}
            {s.counts.flownM.toFixed(1)} m; {s.counts.rejected} commands refused by the
            gate
          </Row>
          <Row label="Run">
            {FLY_VERSION}, seed {city.seed}, placed at city tick {city.placedAtTick}. Not
            part of the city&apos;s state, hash or replay.
          </Row>
        </dl>

        <h3 className="mt-3 font-mono text-[9px] tracking-[.2em] text-teal-200">
          THE MODEL · BIOLOGICAL EVIDENCE AND ITS LIMITS
        </h3>
        <dl className="mt-1 space-y-1">
          <Row label="Organism">
            <i>Drosophila melanogaster</i> (fruit fly), adult
          </Row>
          <Row label="Body model" evidence="FlyBody model">
            <Link href={citationUrl(CITATIONS.flybody)}>FlyBody</Link> (
            {CITATIONS.flybody.short}), commit {source.commit.slice(0, 7)},{" "}
            {source.license}: {SKELETON.bodies.length} bodies, the MJCF&apos;s hinge
            joints and colours; meshes decimated from {source.sourceTriangles} to{" "}
            {source.lods.map((l) => l.triangles).join(" / ")} triangles.
          </Row>
          <Row label="Controller" evidence="model">
            {REDUCED_ORDER_DESCRIPTOR.label}: {REDUCED_ORDER_DESCRIPTOR.fidelity} Not a
            neural simulation. Wingbeat, leg placement and body attitude are drawn, not
            simulated as aerodynamics or contact.
          </Row>
          <Row label="Neuroanatomical reference" evidence="published">
            <Term id={VFB_REFERENCE.template} /> ({VFB_REFERENCE.template}), via{" "}
            <Link href={doiUrl(VFB_REFERENCE.citation.doi)}>Virtual Fly Brain</Link>. Its
            brain geometry is CC-BY-NC-SA and is linked, not bundled. Retrieved{" "}
            {VFB_REFERENCE.retrievedAt.slice(0, 10)}.
          </Row>
          <Row label="Evidence classes">
            FlyBody model: FlyBody&apos;s body, joints and meshes, and the constants its
            code sets or its trained policies report: a model of a fly, not measurements
            of one · measured: VFB&apos;s connectome counts · published: values reported
            for real flies · model: choices this simulator makes · simulated: this run ·
            unsupported: not sensed at all
          </Row>
        </dl>
        <details className="mt-2">
          <summary className="cursor-pointer">Brain regions (Virtual Fly Brain)</summary>
          <p className="mt-1 text-slate-300">{VFB_REFERENCE.evidence}</p>
          {VFB_REFERENCE.groups.map((g) => (
            <div key={g.id} className="mt-2">
              <p className="font-semibold">{g.label}</p>
              <p className="text-slate-300">{g.modelled}</p>
              <p>
                {g.terms.map((id, i) => (
                  <span key={id}>
                    {i ? " · " : ""}
                    <Term id={id} />
                  </span>
                ))}
              </p>
            </div>
          ))}
          <p className="mt-2 font-semibold">Connectivity [measured, as VFB reports it]</p>
          <ul>
            {VFB_REFERENCE.connectivity.flatMap((c) =>
              c.connections.map((x) => (
                <li key={`${x.upstreamClass}-${x.downstreamClass}`}>
                  <Term id={x.upstreamClass} /> → <Term id={x.downstreamClass} />:{" "}
                  {x.connectedUpstream} of {x.totalUpstream} neurons connected (
                  {x.percentConnected}%), total weight {x.totalWeight}
                  {c.excludedDatasets.length
                    ? ` (datasets excluded by VFB: ${c.excludedDatasets.join(", ")})`
                    : ""}
                </li>
              )),
            )}
          </ul>
          <p className="mt-2 font-semibold">What the controller cites</p>
          <ul>
            {REDUCED_ORDER_DESCRIPTOR.regions.map((r) => (
              <li key={r.module} className="mt-1">
                {r.module} — {r.relation}: {r.note}
              </li>
            ))}
          </ul>
        </details>
        <details className="mt-2">
          <summary className="cursor-pointer">Parameters and their sources</summary>
          <table className="mt-1 w-full text-left">
            <thead>
              <tr className="text-slate-300">
                <th className="pr-2 font-normal">Parameter</th>
                <th className="pr-2 font-normal">Value</th>
                <th className="font-normal">Source</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(PARAMS) as ParamName[]).map((name) => {
                const p: Param = PARAMS[name];
                return (
                  <tr key={name} className="align-top">
                    <td className="pr-2 font-mono text-[10px]">{name}</td>
                    <td className="pr-2">
                      {Number(p.value.toPrecision(4))} {p.unit}
                      {p.min !== p.max ? (
                        <span className="block text-slate-300">
                          range {Number(p.min.toPrecision(4))}–
                          {Number(p.max.toPrecision(4))}
                        </span>
                      ) : null}
                    </td>
                    <td>
                      {KIND_LABEL[p.kind]}
                      {p.source ? (
                        <>
                          {" · "}
                          <Link href={citationUrl(p.source)}>{p.source.short}</Link>
                        </>
                      ) : null}
                      {" · "}
                      <span className="text-slate-300">{p.note}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </details>
        <p className="mt-2 text-slate-300">
          Inputs this world gives the fly: {inputs.supported.join("; ")}. Proxies:{" "}
          {inputs.proxies.join("; ")}.
        </p>
      </div>
    </section>
  );
}
