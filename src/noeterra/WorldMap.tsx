import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Scan, ZoomIn, ZoomOut } from "lucide-react";
import { SITE_PROFILE } from "@/lib/siteData";
import { cn } from "@/lib/utils";
import { glass } from "./format";
import type { GameState, Geometry, Pt } from "./types";

/** "Kingdom of Loulan" → "Loulan"; the map names nations, not titles. */
export function shortName(name: string): string {
  return name.replace(/^Kingdom of /, "").replace(/^the /, "");
}

const ringPath = (rings: Pt[][]) =>
  rings.map((r) => "M" + r.map((p) => `${p[0]},${p[1]}`).join("L") + "Z").join("");

interface NationLabel {
  civ: number;
  d: string;
  text: string;
  size: number;
}

/** Each nation's name arcs along the principal axis of its provinces. */
function nationLabels(state: GameState, geo: Geometry): NationLabel[] {
  const out: NationLabel[] = [];
  for (const civ of state.civs) {
    if (!civ.alive) continue;
    const pts = state.provinces
      .filter((p) => p.owner === civ.id)
      .map((p) => geo.shapes[p.id]?.center)
      .filter((c): c is Pt => c !== undefined);
    if (!pts.length) continue;
    const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    let sxx = 0,
      syy = 0,
      sxy = 0;
    for (const [x, y] of pts) {
      sxx += (x - mx) ** 2;
      syy += (y - my) ** 2;
      sxy += (x - mx) * (y - my);
    }
    let theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    // Keep the name readable: never steeper than 50 degrees, never upside down.
    theta = Math.max(-0.87, Math.min(0.87, theta));
    const ax = Math.cos(theta),
      ay = Math.sin(theta);
    const proj = pts.map(([x, y]) => (x - mx) * ax + (y - my) * ay);
    const spread = Math.max(...proj) - Math.min(...proj);
    const text = shortName(civ.name).toUpperCase();
    const length = Math.max(spread * 1.1, 26 + text.length * 2.2);
    const nx = -ay,
      ny = ax;
    const up = ny > 0 ? -1 : 1;
    const bow = length * 0.07 * up;
    const p0 = [mx - (ax * length) / 2, my - (ay * length) / 2];
    const p1 = [mx + (ax * length) / 2, my + (ay * length) / 2];
    const c = [mx + nx * bow, my + ny * bow];
    const size = Math.max(4.5, Math.min(18, length / (text.length * 1.05)));
    out.push({
      civ: civ.id,
      d: `M${p0[0]},${p0[1]} Q${c[0]},${c[1]} ${p1[0]},${p1[1]}`,
      text,
      size,
    });
  }
  return out;
}

function star(cx: number, cy: number, r: number): string {
  let d = "";
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 ? r * 0.45 : r;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    d +=
      (i ? "L" : "M") +
      (cx + rr * Math.cos(a)).toFixed(2) +
      "," +
      (cy + rr * Math.sin(a)).toFixed(2);
  }
  return d + "Z";
}

export interface WorldMapProps {
  state: GameState;
  geometry: Geometry;
  selected: number | null;
  focus: number[];
  you: number | null;
  onSelect: (province: number) => void;
}

export function WorldMap({
  state,
  geometry,
  selected,
  focus,
  you,
  onSelect,
}: WorldMapProps) {
  const base = geometry.view_box;
  const [view, setView] = useState<[number, number, number, number]>(base);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{
    pointer: number;
    x: number;
    y: number;
    vx: number;
    vy: number;
    moved: boolean;
  } | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => setView(geometry.view_box), [geometry]);

  const toSvg = useCallback((clientX: number, clientY: number): Pt => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return [0, 0];
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return [p.x, p.y];
  }, []);

  const zoom = useCallback(
    (factor: number, around?: Pt) => {
      setView(([x, y, w, h]) => {
        const nw = Math.max(base[2] * 0.12, Math.min(base[2] * 1.6, w * factor));
        const f = nw / w;
        const [cx, cy] = around ?? [x + w / 2, y + h / 2];
        return [cx - (cx - x) * f, cy - (cy - y) * f, nw, h * f];
      });
    },
    [base],
  );

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, toSvg(e.clientX, e.clientY));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [zoom, toSvg]);

  const zoomLevel = base[2] / view[2];
  const labels = useMemo(() => nationLabels(state, geometry), [state, geometry]);
  const lastTurn = state.turn - 1;
  const battles = useMemo(
    () =>
      new Set(
        state.events
          .filter(
            (e) =>
              e.turn === lastTurn && (e.kind === "battle" || e.kind === "occupation"),
          )
          .flatMap((e) => e.provinces),
      ),
    [state.events, lastTurn],
  );
  const focusSet = useMemo(() => new Set(focus), [focus]);
  const capitals = useMemo(
    () => new Map(state.civs.filter((c) => c.alive).map((c) => [c.capital, c.id])),
    [state.civs],
  );
  const armiesAt = useMemo(() => {
    const m = new Map<number, Map<number, number>>();
    for (const a of state.armies) {
      const byOwner = m.get(a.location) ?? new Map<number, number>();
      byOwner.set(a.owner, (byOwner.get(a.owner) ?? 0) + a.strength);
      m.set(a.location, byOwner);
    }
    return m;
  }, [state.armies]);
  const isDesertWorld = state.scenario.id.startsWith("tarim");
  const clip = geometry.has_basemap ? "url(#nt-landclip)" : undefined;
  const navigate = useNavigate();
  // The Lop Nur twin's airfield sits about 60 km from Loulan; on the ancient map
  // it is a modern marker that leads back to the reconstruction.
  const twin: Pt | null =
    state.scenario.id === "tarim-77bc"
      ? (() => {
          const [lon0, lat0, cos0, k] = geometry.projection;
          const { latitude, longitude } = SITE_PROFILE.referenceCoordinate;
          return [(longitude - lon0) * cos0 * k, (lat0 - latitude) * k];
        })()
      : null;
  const bigSea = `${base[0] - base[2]},${base[1] - base[3]} ${base[2] * 3},${base[3] * 3}`
    .split(/[ ,]/)
    .map(Number);

  const map = (
    <svg
      ref={svgRef}
      // A map you can pan, zoom and click is a group of controls, not an image.
      role="group"
      aria-roledescription="map"
      aria-labelledby="nt-map-title"
      tabIndex={0}
      className="noeterra-map h-full w-full touch-none outline-none select-none"
      viewBox={view.join(" ")}
      preserveAspectRatio="xMidYMid meet"
      onPointerDown={(e) => {
        // One finger (or the mouse) pans; a second finger would yank the view.
        if (!e.isPrimary) return;
        (e.target as Element).setPointerCapture?.(e.pointerId);
        drag.current = {
          pointer: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          vx: view[0],
          vy: view[1],
          moved: false,
        };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.pointer !== e.pointerId) return;
        const svg = svgRef.current;
        if (!svg) return;
        const k = view[2] / svg.clientWidth;
        const dx = e.clientX - d.x,
          dy = e.clientY - d.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
        if (d.moved) setView(([, , w, h]) => [d.vx - dx * k, d.vy - dy * k, w, h]);
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        if (!d || d.pointer !== e.pointerId) return;
        drag.current = null;
        if (!d.moved) {
          const id = (e.target as Element).getAttribute("data-province");
          if (id !== null) onSelect(Number(id));
        }
      }}
      // The browser took the touch (a system gesture, a palm): drop the drag.
      onPointerCancel={(e) => {
        if (drag.current?.pointer === e.pointerId) drag.current = null;
      }}
      onKeyDown={(e) => {
        const step = view[2] * 0.08;
        if (e.key === "+" || e.key === "=") zoom(1 / 1.25);
        else if (e.key === "-") zoom(1.25);
        else if (e.key === "0") setView(base);
        else if (e.key === "ArrowLeft") setView(([x, y, w, h]) => [x - step, y, w, h]);
        else if (e.key === "ArrowRight") setView(([x, y, w, h]) => [x + step, y, w, h]);
        else if (e.key === "ArrowUp") setView(([x, y, w, h]) => [x, y - step, w, h]);
        else if (e.key === "ArrowDown") setView(([x, y, w, h]) => [x, y + step, w, h]);
        else return;
        e.preventDefault();
      }}
    >
      <title id="nt-map-title">
        Map of {state.scenario.name}, {state.date}. Drag to pan; scroll, press plus and
        minus, or use the zoom buttons to zoom.
      </title>
      <defs>
        <radialGradient id="nt-sea" cx="50%" cy="45%" r="75%">
          <stop offset="0%" stopColor="#1d4550" />
          <stop offset="70%" stopColor="#10303a" />
          <stop offset="100%" stopColor="#081a20" />
        </radialGradient>
        <filter
          id="nt-relief"
          x="0"
          y="0"
          width="1"
          height="1"
          filterUnits="objectBoundingBox"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.045"
            numOctaves="5"
            seed="7"
            result="noise"
          />
          <feDiffuseLighting
            in="noise"
            surfaceScale="3.2"
            lightingColor="#ffffff"
            result="light"
          >
            <feDistantLight azimuth="315" elevation="38" />
          </feDiffuseLighting>
          <feComposite in="light" in2="SourceGraphic" operator="in" />
        </filter>
        <filter id="nt-glow">
          <feGaussianBlur stdDeviation="1.6" />
        </filter>
        {state.civs.map((c) => (
          <pattern
            key={c.id}
            id={`nt-occ-${c.id}`}
            patternUnits="userSpaceOnUse"
            width="3"
            height="3"
            patternTransform="rotate(45)"
          >
            <rect width="3" height="3" fill="transparent" />
            <rect width="1.3" height="3" fill={c.color} opacity="0.85" />
          </pattern>
        ))}
        {labels.map((l) => (
          <path key={l.civ} id={`nt-label-${l.civ}`} d={l.d} />
        ))}
        {/* Provinces are drawn inside the land: exact coastlines, no slivers at sea.
            A small disc at every seat keeps a speck of an island the basemap dropped. */}
        <clipPath id="nt-landclip">
          {geometry.land.map((r, i) => (
            <path key={i} d={ringPath([r])} />
          ))}
          {geometry.shapes.map((s) => (
            <circle key={`s${s.id}`} cx={s.center[0]} cy={s.center[1]} r="7" />
          ))}
        </clipPath>
      </defs>

      <rect
        x={bigSea[0]}
        y={bigSea[1]}
        width={bigSea[2]}
        height={bigSea[3]}
        fill="url(#nt-sea)"
      />

      {/* Shallows and coast. */}
      <g
        fill="none"
        stroke="#5f9aa0"
        strokeLinejoin="round"
        opacity="0.28"
        filter="url(#nt-glow)"
      >
        {geometry.land.map((r, i) => (
          <path key={i} d={ringPath([r])} strokeWidth="3.4" />
        ))}
      </g>
      <g
        fill={isDesertWorld ? "#8f7d55" : "#6d6a52"}
        stroke="#0c1d22"
        strokeWidth="0.45"
        strokeLinejoin="round"
      >
        {geometry.land.map((r, i) => (
          <path key={i} d={ringPath([r])} />
        ))}
      </g>

      {/* Nations over the land. */}
      <g strokeLinejoin="round" clipPath={clip}>
        {geometry.shapes.map((s) => {
          const p = state.provinces[s.id];
          if (!p) return null;
          const owner = p.owner === null ? undefined : state.civs[p.owner];
          const occupied = p.controller !== null && p.controller !== p.owner;
          return (
            <g key={s.id}>
              <path
                d={ringPath(s.rings)}
                data-province={s.id}
                className="nt-prov"
                fill={owner ? owner.color : "#d9cfb2"}
                fillOpacity={owner ? 0.62 : 0.12}
                stroke={owner ? "#1b1712" : "#e9dfc4"}
                strokeOpacity={owner ? 0.55 : 0.45}
                strokeWidth={owner ? 0.5 : 0.35}
                strokeDasharray={owner ? undefined : "1.2 1"}
              >
                <title>
                  {p.name} — {owner ? owner.name : "independent"}
                  {occupied && p.controller !== null
                    ? `, occupied by ${state.civs[p.controller]?.name ?? ""}`
                    : ""}
                </title>
              </path>
              {occupied && p.controller !== null && (
                <path
                  d={ringPath(s.rings)}
                  fill={`url(#nt-occ-${p.controller})`}
                  pointerEvents="none"
                />
              )}
            </g>
          );
        })}
      </g>

      {/* Relief shows through the colours, as on a physical map. */}
      <g
        filter="url(#nt-relief)"
        opacity="0.5"
        style={{ mixBlendMode: "multiply" }}
        pointerEvents="none"
      >
        {geometry.land.map((r, i) => (
          <path key={i} d={ringPath([r])} fill="#fff" />
        ))}
      </g>

      <g fill="#1c4652" stroke="#0c1d22" strokeWidth="0.3" pointerEvents="none">
        {geometry.lakes.map((r, i) => (
          <path key={i} d={ringPath([r])} />
        ))}
      </g>
      <g
        fill="none"
        stroke="#5f97a3"
        strokeWidth="0.55"
        strokeLinecap="round"
        opacity="0.75"
        pointerEvents="none"
      >
        {geometry.rivers.map((r, i) => (
          <path key={i} d={"M" + r.line.map((p) => `${p[0]},${p[1]}`).join("L")} />
        ))}
      </g>
      <g
        stroke="#b9d3d6"
        strokeWidth="0.35"
        strokeDasharray="1.4 1.4"
        opacity="0.35"
        pointerEvents="none"
      >
        {geometry.lanes
          .filter((l) => l.sea)
          .map((l, i) => {
            const a = geometry.shapes[l.a]?.center,
              b = geometry.shapes[l.b]?.center;
            return a && b ? (
              <line key={i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />
            ) : null;
          })}
      </g>

      {/* Your realm, the selection and the season's flashpoints. */}
      <g fill="none" pointerEvents="none" strokeLinejoin="round" clipPath={clip}>
        {you !== null &&
          geometry.shapes
            .filter((s) => state.provinces[s.id]?.owner === you)
            .map((s) => (
              <path
                key={s.id}
                d={ringPath(s.rings)}
                stroke="#ffe9a8"
                strokeWidth="0.6"
                opacity="0.7"
              />
            ))}
        {geometry.shapes
          .filter((s) => focusSet.has(s.id) || battles.has(s.id))
          .map((s) => (
            <path
              key={s.id}
              d={ringPath(s.rings)}
              stroke="#ff5a4a"
              strokeWidth="1.1"
              className="nt-pulse"
            />
          ))}
        {selected !== null && geometry.shapes[selected] && (
          <path
            d={ringPath(geometry.shapes[selected].rings)}
            stroke="#ffffff"
            strokeWidth="1.3"
          />
        )}
        {hover !== null && hover !== selected && geometry.shapes[hover] && (
          <path
            d={ringPath(geometry.shapes[hover].rings)}
            stroke="#ffffff"
            strokeOpacity="0.6"
            strokeWidth="0.8"
          />
        )}
      </g>

      {/* Nation names, Open-Historia style. */}
      <g pointerEvents="none" className="nt-nation-labels">
        {labels.map((l) => (
          <text
            key={l.civ}
            fontSize={l.size}
            letterSpacing={l.size * 0.32}
            fill="#fbf6e9"
            fillOpacity="0.9"
            stroke="#1a140c"
            strokeOpacity="0.55"
            strokeWidth={l.size * 0.09}
            style={{ paintOrder: "stroke" }}
            textAnchor="middle"
          >
            <textPath href={`#nt-label-${l.civ}`} startOffset="50%">
              {l.text}
            </textPath>
          </text>
        ))}
      </g>

      {/* Settlements and armies. */}
      <g pointerEvents="none">
        {geometry.shapes.map((s) => {
          const p = state.provinces[s.id];
          if (!p) return null;
          const [x, y] = s.center;
          const cap = capitals.get(s.id);
          const showName = cap !== undefined || zoomLevel > 1.8 || selected === s.id;
          return (
            <g key={s.id}>
              {cap !== undefined ? (
                <path
                  d={star(x, y, 2.4)}
                  fill="#fff3c4"
                  stroke="#2a2010"
                  strokeWidth="0.35"
                />
              ) : (
                <circle
                  cx={x}
                  cy={y}
                  r="0.85"
                  fill="#f4ecd8"
                  stroke="#2a2010"
                  strokeWidth="0.25"
                />
              )}
              {showName && (
                <text
                  x={x}
                  y={y + 4.4}
                  fontSize={cap !== undefined ? 3 : 2.5}
                  textAnchor="middle"
                  fill="#f7f0de"
                  stroke="#14100a"
                  strokeWidth="0.55"
                  style={{ paintOrder: "stroke" }}
                  className="nt-city"
                >
                  {p.name.replace(/\s*\(.*\)$/, "").replace(/,.*$/, "")}
                </text>
              )}
            </g>
          );
        })}
        {[...armiesAt.entries()].map(([pid, byOwner]) => {
          const c = geometry.shapes[pid]?.center;
          if (!c) return null;
          const list = [...byOwner.entries()];
          return list.map(([owner, strength], i) => {
            const x = c[0] + (i - (list.length - 1) / 2) * 7.5 + 4;
            const y = c[1] - 5.2;
            const civ = state.civs[owner];
            return (
              <g key={`${pid}-${owner}`}>
                <rect
                  x={x - 3.4}
                  y={y - 2.1}
                  width="6.8"
                  height="4.2"
                  rx="0.9"
                  fill={civ?.color ?? "#888"}
                  stroke="#0e0b07"
                  strokeWidth="0.35"
                />
                <text
                  x={x}
                  y={y + 1.25}
                  fontSize="2.9"
                  textAnchor="middle"
                  fill="#fff"
                  fontWeight="700"
                  className="nt-army"
                >
                  {Math.round(strength)}
                </text>
              </g>
            );
          });
        })}
        {[...battles].map((pid) => {
          const c = geometry.shapes[pid]?.center;
          return c ? (
            <text
              key={`b${pid}`}
              x={c[0] - 6}
              y={c[1] + 1}
              fontSize="5"
              fill="#ff7a6a"
              stroke="#200"
              strokeWidth="0.4"
            >
              ⚔
            </text>
          ) : null;
        })}
      </g>

      {/* Hit targets on top, so labels never swallow a click. */}
      <g fill="transparent" clipPath={clip}>
        {geometry.shapes.map((s) => (
          <path
            key={s.id}
            d={ringPath(s.rings)}
            data-province={s.id}
            className="cursor-pointer"
            onPointerEnter={() => setHover(s.id)}
            onPointerLeave={() => setHover((h) => (h === s.id ? null : h))}
          />
        ))}
      </g>
      {twin && (
        <g
          role="link"
          tabIndex={0}
          aria-label="The Lop Nur twin airfield (modern) — return to the reconstruction"
          className="cursor-pointer"
          onPointerUp={(e) => {
            e.stopPropagation();
            void navigate({ to: "/" });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void navigate({ to: "/" });
          }}
        >
          <title>
            {SITE_PROFILE.name}, today — about 60 km from Loulan. Open the twin.
          </title>
          <circle
            cx={twin[0]}
            cy={twin[1]}
            r="3.6"
            fill="#0b1418"
            stroke="#7fe3ff"
            strokeWidth="0.6"
            className="nt-pulse"
          />
          <path
            d={`M${twin[0] - 2},${twin[1] + 0.9} L${twin[0] + 2},${twin[1] - 0.9}`}
            stroke="#7fe3ff"
            strokeWidth="0.9"
          />
          <text
            x={twin[0]}
            y={twin[1] - 5}
            fontSize="2.6"
            textAnchor="middle"
            fill="#bdf3ff"
            stroke="#04090b"
            strokeWidth="0.5"
            style={{ paintOrder: "stroke" }}
          >
            Lop Nur twin (today)
          </text>
        </g>
      )}
    </svg>
  );

  return (
    <>
      {map}
      {/* A touch screen has no wheel and the map takes every touch to pan, so
          zooming needs buttons: under the date on a phone, above the note wider. */}
      <div
        role="group"
        aria-label="Zoom"
        className="absolute top-36 right-3 z-10 flex flex-col gap-1 sm:top-auto sm:bottom-10 sm:flex-row"
      >
        {(
          [
            ["Zoom in", ZoomIn, () => zoom(1 / 1.25)],
            ["Zoom out", ZoomOut, () => zoom(1.25)],
            ["Show the whole map", Scan, () => setView(base)],
          ] as const
        ).map(([label, Icon, run]) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            title={label}
            onClick={run}
            className={cn(glass, "grid size-9 place-items-center hover:bg-white/10")}
          >
            <Icon className="size-4" aria-hidden="true" />
          </button>
        ))}
      </div>
    </>
  );
}
