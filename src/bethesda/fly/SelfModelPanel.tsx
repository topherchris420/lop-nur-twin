/**
 * The fly panel's Self-Model view: what Project ECHO's self-model believes,
 * predicts, doubts and remembers, beside what researchers know and the fly
 * does not. Read-only like the rest of the panel: it reads the adapter's state
 * four times a second and calls nothing that changes it, so opening it
 * changes nothing the fly does.
 */
import type { ReactNode } from "react";
import type { EchoAdapter } from "./echo/adapter";
import { BELIEF_NAMES, N, X } from "./echo/forward";
import { ECHO_VERSION, EP } from "./echo/params";
import { believedCapability, VARIANT_LABELS } from "./echo/selfModel";
import type { DigitalFly } from "./fly";

function Row({
  label,
  tag,
  children,
}: {
  label: string;
  tag?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[104px_1fr] gap-2">
      <dt className="text-slate-300">{label}</dt>
      <dd>
        {children}
        {tag ? (
          <span className="ml-1 font-mono text-[9px] tracking-wide text-teal-200/80">
            [{tag}]
          </span>
        ) : null}
      </dd>
    </div>
  );
}

const pm = (x: number, sd: number, d = 2) => `${x.toFixed(d)} ± ${sd.toFixed(d)}`;
const cmS = (m: number, dt: number) => ((m / dt) * 100).toFixed(2);

export function SelfModelPanel({ fly, echo }: { fly: DigitalFly; echo: EchoAdapter }) {
  const model = echo.model;
  const s = fly.state;
  if (!model)
    return (
      <p className="text-slate-300">
        This variant has no self-model: {VARIANT_LABELS[echo.variant]}.
      </p>
    );
  const m = model.state;
  const x = m.belief.x;
  const sd = (i: number) => Math.sqrt(Math.max(0, m.belief.P[i * N + i]!));
  const cap = believedCapability(m, fly.params.walkSpeedMaxCmS);
  const last = m.last;
  const c = m.calibration;
  const leading = model.leading().slice(0, 3);
  const sample = fly.lastSelfMotion;
  const pert = fly.activePerturbation();
  const episodes = m.episodes.slice(-4).reverse();
  const beliefs = m.beliefs.slice(-4).reverse();
  return (
    <>
      <p className="text-slate-300">
        The fly&apos;s own estimates, computed only from its self-motion sense, its
        legs&apos; stepping, touch and what it commanded. It is never given its position,
        heading or any perturbation. A computational self-model, not awareness.
      </p>
      <dl className="mt-1 space-y-1">
        <Row label="Configuration" tag="model">
          {echo.descriptor.label} ({ECHO_VERSION}, {VARIANT_LABELS[echo.variant]}); seed{" "}
          {m.seed ?? "unknown"}.{" "}
          {echo.state.replaced.length
            ? `Self-model replaced ${echo.state.replaced.length} times (${echo.state.replaced.map((r) => `${r.how} at ${r.t.toFixed(1)} s`).join(", ")}).`
            : "Self-model never replaced since this fly was placed."}
        </Row>
        <Row label="Predicted vs sensed" tag="fly's estimate">
          {last ? (
            <>
              Over the last period ({last.kind}
              {last.learned ? "" : ", not used to learn"}): expected{" "}
              {cmS(last.predicted[0], fly.params.decisionPeriodMs / 1000)} cm/s forward
              and {(last.predicted[2] / (fly.params.decisionPeriodMs / 1000)).toFixed(2)}{" "}
              rad/s turning; sensed{" "}
              {cmS(last.observed[0], fly.params.decisionPeriodMs / 1000)} cm/s and{" "}
              {(last.observed[2] / (fly.params.decisionPeriodMs / 1000)).toFixed(2)}{" "}
              rad/s. Prediction error {last.nis.toFixed(1)} (normalized; about 3 when the
              model fits).
            </>
          ) : (
            "No period compared yet."
          )}
        </Row>
        <Row label="Confidence" tag="fly's estimate">
          Trusts its sense of motion at {(1 / m.noiseScale).toFixed(2)} of its innate
          precision.
          {c.n
            ? ` Its predicted 90% intervals held ${((c.in90.reduce((a, b) => a + b, 0) / (3 * c.n)) * 100).toFixed(0)}% of ${c.n} observations (90% is calibrated).`
            : ""}
          {m.caution
            ? " Unsure of itself: walking and flying slower, no voluntary takeoff."
            : ""}
          {m.probe
            ? ` Probing: ${m.probe.kind === "stop" ? "a stop" : "a short walk"}.`
            : ""}
        </Row>
        <Row label="Its movement" tag="fly's estimate">
          Leg speed gain {pm(x[X.legGain]!, sd(X.legGain))}, turning gain{" "}
          {pm(x[X.legTurnGain]!, sd(X.legTurnGain))}, turning bias{" "}
          {pm(x[X.legTurnBias]!, sd(X.legTurnBias))} rad/s; wing speed gain{" "}
          {pm(x[X.wingGain]!, sd(X.wingGain))}. Believes it can walk at up to{" "}
          {cap.walkMaxCmS.toFixed(1)} cm/s.
        </Row>
        <Row label="Its surroundings" tag="fly's estimate">
          Outside drift {(Math.hypot(x[X.driftX]!, x[X.driftZ]!) * 100).toFixed(2)} cm/s,
          outside turn {pm(x[X.spin]!, sd(X.spin))} rad/s.
        </Row>
        <Row label="Inquiry" tag="fly's estimate">
          {m.inquiry
            ? `Asking why its predictions fail since ${m.inquiry.since.toFixed(1)} s (${m.inquiry.periods} periods of evidence): ${leading.map((l) => `${l.id} ${(l.p * 100).toFixed(0)}%`).join(", ")}.`
            : `None open. ${m.counts.inquiries} so far; concluded self ${m.counts.concluded.self}, outside ${m.counts.concluded.external}, both ${m.counts.concluded.both}, sense ${m.counts.concluded.sensor}, nothing ${m.counts.concluded.none}; ${m.counts.recalls} by recalling an episode; ${m.counts.unresolved} unresolved.`}
        </Row>
        <Row label="Revised beliefs" tag="fly's estimate">
          {beliefs.length ? (
            <ul>
              {beliefs.map((b, i) => (
                <li key={`${b.t}-${i}`}>
                  {b.t.toFixed(1)} s · {b.what} {b.from} → {b.to} ({b.why})
                </li>
              ))}
            </ul>
          ) : (
            "None yet: its innate body schema still fits."
          )}
        </Row>
        <Row label="Remembers" tag="fly's memory">
          {echo.variant === "no_memory" ? (
            "Episodic memory is disabled in this variant."
          ) : episodes.length ? (
            <ul>
              {episodes.map((e) => (
                <li key={e.id}>
                  #{e.id} at {e.concluded.toFixed(1)} s: {e.explanation} ({e.candidate}, p
                  = {e.reliability.posterior}
                  {e.resolved ? "" : ", unresolved"}) after {e.observed.periods} periods;
                  recalled {e.recalled} times
                </li>
              ))}
            </ul>
          ) : (
            `No episodes yet (it keeps at most ${EP.episodesKept}).`
          )}
        </Row>
      </dl>
      <p className="mt-2 font-mono text-[9px] tracking-[.2em] text-amber-200">
        GROUND TRUTH · RESEARCHERS ONLY, NEVER READ BY THE FLY
      </p>
      <dl className="mt-1 space-y-1">
        <Row label="Actual movement" tag="simulated">
          {(Math.hypot(s.v[0], s.v[2]) * 100).toFixed(2)} cm/s over the ground, turning{" "}
          {s.yawRate.toFixed(2)} rad/s
          {sample
            ? `; its sense reported ${cmS(sample.forward, sample.dt)} cm/s forward over the last period`
            : ""}
          .
        </Row>
        <Row label="Perturbation" tag="simulated">
          {pert
            ? `Speed ×${pert.speedGain.toFixed(2)}, turning ×${pert.turnGain.toFixed(2)} + ${pert.turnBias.toFixed(2)} rad/s, drift ${(Math.hypot(...pert.drift) * 100).toFixed(2)} cm/s, sense noise ×${pert.flowNoise.toFixed(1)}`
            : "None: the city applies no perturbation, so any change the fly concludes here is its own misreading of noise."}
        </Row>
      </dl>
      <p className="mt-1 text-slate-300">Beliefs: {BELIEF_NAMES.join(", ")}.</p>
    </>
  );
}
