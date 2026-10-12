"use strict";

// Noeterra workbench client. Every string that came from the simulation or from a
// model is placed with textContent; nothing is parsed as HTML.

const $ = (id) => document.getElementById(id);
const SVG = "http://www.w3.org/2000/svg";

const state = {
  meta: null,
  s: null,
  geo: null,
  events: [],
  eventCount: 0,
  selected: null,
  mindCiv: 0,
  polling: false,
  chartCache: "",
};

function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") n.className = v;
    // Through the CSSOM: the page's CSP forbids style attributes.
    else if (k === "style") n.style.cssText = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : String(v));
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    n.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return n;
}

function svg(tag, attrs, ...kids) {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null) continue;
    if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, String(v));
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined) continue;
    n.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return n;
}

async function api(path, body) {
  const opts =
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        };
  const r = await fetch(path, opts);
  const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

const civName = (c) =>
  c === null || c === undefined ? "independent" : (state.s.civs[c]?.name ?? `#${c}`);
const civColor = (c) =>
  c === null || c === undefined ? "#d8cfbd" : (state.s.civs[c]?.color ?? "#999");
const fmt = (x, d = 0) => {
  if (typeof x !== "number") return "—";
  const s = x.toFixed(d);
  // Never print "-0": a value that rounds to zero is zero.
  return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s;
};

const LABELS = {
  rules: ["RULES", "Rule-based policy"],
  amnesic: ["RULES · NO MEMORY", "Rule-based policy with memory withheld"],
  random: ["RANDOM", "Uniformly random legal choices — a baseline"],
  live: ["LIVE MODEL", "A validated model answer"],
  fallback: ["FALLBACK", "The model failed; the rules decided, and the record says why"],
  human: ["HUMAN", "Chosen by a person"],
  replay: ["REPLAY", "Re-applied from a recording"],
};

function badge(label) {
  const [text, title] = LABELS[label] || [String(label).toUpperCase(), ""];
  return el("span", { class: `badge b-${label}`, title }, text);
}

// ---------------------------------------------------------------- map

function drawMap() {
  const map = $("map");
  const g = state.geo;
  if (!g) return;
  map.setAttribute("viewBox", g.view_box.join(" "));
  for (const n of [...map.children]) if (n.tagName !== "title") n.remove();
  const defs = svg("defs");
  state.s.civs.forEach((c) => {
    defs.append(
      svg(
        "pattern",
        {
          id: `occ-${c.id}`,
          patternUnits: "userSpaceOnUse",
          width: 6,
          height: 6,
          patternTransform: "rotate(45)",
        },
        svg("rect", { width: 6, height: 6, fill: "#efe8d8" }),
        svg("rect", { width: 3, height: 6, fill: c.color }),
      ),
    );
  });
  const ringsPath = (rings) =>
    rings.map((r) => "M" + r.map((q) => q.join(",")).join("L") + "Z").join("");
  // Provinces are drawn inside the land, as on the web page: exact coastlines.
  if (g.has_basemap) {
    const clip = svg("clipPath", { id: "landclip" });
    for (const r of g.land) clip.append(svg("path", { d: ringsPath([r]) }));
    for (const sh of g.shapes)
      clip.append(svg("circle", { cx: sh.center[0], cy: sh.center[1], r: 7 }));
    defs.append(clip);
  }
  map.append(defs);
  const land = svg("g", { class: "land" });
  for (const r of g.land) land.append(svg("path", { d: ringsPath([r]) }));
  map.append(land);
  const lanes = svg("g", { class: "lanes" });
  for (const l of g.lanes.filter((x) => x.sea)) {
    const a = g.shapes[l.a].center;
    const b = g.shapes[l.b].center;
    lanes.append(svg("line", { x1: a[0], y1: a[1], x2: b[0], y2: b[1] }));
  }
  map.append(lanes);
  const provs = svg("g", {
    class: "provs",
    "clip-path": g.has_basemap ? "url(#landclip)" : null,
  });
  const lastTurn = state.s.turn - 1;
  const battles = new Set(
    state.events
      .filter(
        (e) => e.turn === lastTurn && (e.kind === "battle" || e.kind === "occupation"),
      )
      .flatMap((e) => e.provinces),
  );
  for (const sh of g.shapes) {
    const p = state.s.provinces[sh.id];
    const occupied = p.controller !== p.owner && p.controller !== null;
    const d = ringsPath(sh.rings);
    const path = svg(
      "path",
      {
        d,
        class:
          "prov" +
          (state.selected === sh.id ? " sel" : "") +
          (battles.has(sh.id) ? " hot" : ""),
        fill: occupied ? `url(#occ-${p.controller})` : civColor(p.owner),
        "fill-opacity": p.owner === null ? 1 : 0.78,
        tabindex: 0,
        role: "button",
        "aria-label": `${p.name}, ${civName(p.owner)}${occupied ? `, occupied by ${civName(p.controller)}` : ""}`,
        onclick: () => selectProvince(sh.id),
        onkeydown: (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            selectProvince(sh.id);
          }
        },
      },
      svg("title", {}, `${p.name} — ${civName(p.owner)}`),
    );
    provs.append(path);
  }
  map.append(provs);
  const marks = svg("g", { class: "marks" });
  for (const c of state.s.civs.filter((c) => c.alive)) {
    const ctr = g.shapes[c.capital].center;
    marks.append(svg("path", { d: star(ctr[0], ctr[1] - 9, 4.5), class: "capital" }));
  }
  const byProv = {};
  for (const a of state.s.armies) (byProv[a.location] ||= []).push(a);
  for (const [pid, list] of Object.entries(byProv)) {
    const ctr = g.shapes[pid].center;
    const owners = {};
    for (const a of list) owners[a.owner] = (owners[a.owner] || 0) + a.strength;
    Object.entries(owners).forEach(([o, s], i) => {
      const x = ctr[0] + i * 15 - (Object.keys(owners).length - 1) * 7.5;
      const y = ctr[1] + 4;
      marks.append(
        svg("rect", {
          x: x - 7,
          y: y - 5.5,
          width: 14,
          height: 11,
          rx: 2,
          fill: civColor(Number(o)),
          class: "army",
        }),
      );
      marks.append(svg("text", { x, y: y + 3, class: "armytext" }, Math.round(s)));
    });
  }
  map.append(marks);
  const labels = svg("g", { class: "labels" });
  for (const sh of g.shapes) {
    const p = state.s.provinces[sh.id];
    const short = p.name.replace(/\s*\(.*\)$/, "");
    labels.append(
      svg("text", { x: sh.center[0], y: sh.center[1] - 14, class: "plabel" }, short),
    );
  }
  map.append(labels);
  drawLegend();
}

function star(cx, cy, r) {
  let d = "";
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 ? r * 0.45 : r;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    d +=
      (i ? "L" : "M") +
      (cx + rr * Math.cos(a)).toFixed(1) +
      "," +
      (cy + rr * Math.sin(a)).toFixed(1);
  }
  return d + "Z";
}

function drawLegend() {
  const lg = $("legend");
  lg.replaceChildren(
    ...state.s.civs.map((c) =>
      el(
        "span",
        { class: "key" + (c.alive ? "" : " fallen") },
        el("i", { style: `background:${c.color}` }),
        c.name,
      ),
    ),
    el("span", { class: "key" }, el("i", { style: "background:#d8cfbd" }), "independent"),
    el("span", { class: "key" }, el("i", { class: "hatch" }), "occupied"),
    el("span", { class: "key" }, "★ capital · ▭ army (thousands)"),
  );
}

function selectProvince(id) {
  state.selected = id;
  drawMap();
  renderProvince();
}

function renderProvince() {
  const box = $("province");
  if (state.selected === null) return;
  const p = state.s.provinces[state.selected];
  const armies = state.s.armies.filter((a) => a.location === p.id);
  box.replaceChildren(
    el("h2", {}, p.name),
    el(
      "dl",
      { class: "facts" },
      el("dt", {}, "Owner"),
      el("dd", {}, civName(p.owner)),
      el("dt", {}, "Held by"),
      el("dd", {}, civName(p.controller)),
      el("dt", {}, "Terrain"),
      el("dd", {}, p.terrain + (p.coastal ? ", coastal" : "")),
      el("dt", {}, "People"),
      el("dd", {}, `${fmt(p.population)}k, ${p.culture}`),
      el("dt", {}, "Development"),
      el("dd", {}, fmt(p.development, 1)),
      el("dt", {}, "Fortification"),
      el("dd", {}, String(p.fort)),
      el("dt", {}, "Unrest"),
      el("dd", {}, fmt(p.unrest)),
      p.owner === null
        ? [el("dt", {}, "Local resistance"), el("dd", {}, `${fmt(p.natives, 1)}k`)]
        : null,
      el("dt", {}, "Claimed by"),
      el("dd", {}, p.claims.length ? p.claims.map(civName).join(", ") : "no one"),
      p.siege_by !== null
        ? [
            el("dt", {}, "Under siege by"),
            el("dd", {}, `${civName(p.siege_by)} (${Math.round(p.siege * 100)}%)`),
          ]
        : null,
      el("dt", {}, "Armies"),
      el(
        "dd",
        {},
        armies.length
          ? armies
              .map(
                (a) =>
                  `#${a.id} ${civName(a.owner)} ${fmt(a.strength, 1)}k (morale ${fmt(a.morale, 2)})`,
              )
              .join("; ")
          : "none",
      ),
    ),
  );
}

// ---------------------------------------------------------------- panels

function renderPowers() {
  const s = state.s;
  const head = el(
    "tr",
    {},
    ["", "Power", "Seat", "Prov.", "Armies", "Gold", "Stab.", "Learning"].map((h) =>
      el("th", { scope: "col" }, h),
    ),
  );
  const rows = s.civs.map((c) => {
    const seat = s.seats[c.id];
    const pc = s.provinces.filter((p) => p.owner === c.id).length;
    const str = s.armies
      .filter((a) => a.owner === c.id)
      .reduce((t, a) => t + a.strength, 0);
    return el(
      "tr",
      { class: c.alive ? "" : "fallen" },
      el("td", {}, el("i", { class: "swatch", style: `background:${c.color}` })),
      el(
        "th",
        { scope: "row" },
        el(
          "button",
          { class: "link", type: "button", onclick: () => openMind(c.id) },
          c.name,
        ),
        c.alive ? "" : " (fallen)",
      ),
      el("td", { class: "small" }, seat?.brain ?? ""),
      el("td", { class: "num" }, pc),
      el("td", { class: "num" }, fmt(str, 1)),
      el("td", { class: "num" }, fmt(c.treasury)),
      el("td", { class: "num" }, fmt(c.stability)),
      el("td", { class: "num" }, fmt(c.tech, 2)),
    );
  });
  $("powers").replaceChildren(el("thead", {}, head), el("tbody", {}, rows));
  renderChart();
  renderDecisions();
}

function renderChart() {
  const s = state.s;
  const key = `${s.turn}:${s.civs.length}`;
  if (key === state.chartCache) return;
  state.chartCache = key;
  const W = 420;
  const H = 150;
  const chart = $("chart");
  chart.setAttribute("viewBox", `0 0 ${W} ${H}`);
  chart.replaceChildren();
  const T = s.stats.length;
  const max = Math.max(1, ...s.stats.flat().map((x) => x.provinces));
  const x = (t) => 24 + (t / Math.max(1, T - 1)) * (W - 30);
  const y = (v) => H - 16 - (v / max) * (H - 26);
  chart.append(svg("line", { x1: 24, y1: H - 16, x2: W - 6, y2: H - 16, class: "axis" }));
  chart.append(svg("text", { x: 2, y: y(max) + 4, class: "tick" }, max));
  chart.append(svg("text", { x: 2, y: H - 12, class: "tick" }, 0));
  s.civs.forEach((c) => {
    const pts = s.stats
      .map((row, t) => `${x(t).toFixed(1)},${y(row[c.id]?.provinces ?? 0).toFixed(1)}`)
      .join(" ");
    chart.append(
      svg(
        "polyline",
        { points: pts, fill: "none", stroke: c.color, "stroke-width": 1.6 },
        svg("title", {}, c.name),
      ),
    );
  });
  chart.append(
    svg("text", { x: W - 6, y: H - 2, class: "tick end" }, `${T - 1} seasons`),
  );
}

function renderDecisions() {
  const box = $("decisions");
  const lt = state.s.last_turn;
  if (!lt) {
    box.replaceChildren(el("p", { class: "hint" }, "No season has been played yet."));
    return;
  }
  const items = lt.decisions
    .filter((d) => state.s.civs[d.civ].alive)
    .map((d) =>
      el(
        "details",
        { class: "decision" },
        el(
          "summary",
          {},
          badge(d.label),
          " ",
          civName(d.civ),
          " — ",
          d.chosen.length ? `${d.chosen.length} action(s)` : "no action",
        ),
        el(
          "ul",
          { class: "plain" },
          d.chosen.map((c) => el("li", {}, c)),
        ),
        d.rationale
          ? el(
              "p",
              { class: "model" },
              el("span", { class: "tag" }, `model-written · ${d.usage?.model ?? ""}`),
              " ",
              d.rationale,
            )
          : null,
        d.error ? el("p", { class: "error" }, `Model failure: ${d.error}`) : null,
        d.discarded?.length
          ? el(
              "p",
              { class: "small" },
              "Refused from the answer: ",
              d.discarded.join("; "),
            )
          : null,
        d.usage?.latency_ms
          ? el(
              "p",
              { class: "small" },
              `${(d.usage.latency_ms / 1000).toFixed(1)} s, tokens in ${d.usage.tokens_in ?? "unknown"}, out ${d.usage.tokens_out ?? "unknown"}`,
            )
          : null,
      ),
    );
  const rej = lt.rejected.length
    ? el(
        "details",
        {},
        el("summary", {}, `${lt.rejected.length} choice(s) refused by the resolver`),
        el(
          "ul",
          { class: "plain small" },
          lt.rejected.map((r) =>
            el("li", {}, `${civName(r.civ)}: ${r.what} — ${r.reason}`),
          ),
        ),
      )
    : null;
  box.replaceChildren(
    el(
      "p",
      { class: "small" },
      `${lt.date} · state hash `,
      el("code", {}, lt.hash.slice(0, 16) + "…"),
    ),
    ...items,
    rej,
  );
}

function renderDiplomacy() {
  const s = state.s;
  $("wars").replaceChildren(
    ...(s.wars.length
      ? s.wars.map((w) =>
          el(
            "li",
            {},
            el("strong", {}, `War #${w.id}: `),
            w.attackers.map(civName).join(", "),
            " against ",
            w.defenders.map(civName).join(", "),
            el(
              "span",
              { class: "small" },
              ` · since season ${w.started}, ${w.battles} battles, score ${w.score > 0 ? "+" : ""}${fmt(w.score)} for the attackers`,
            ),
          ),
        )
      : [el("li", { class: "hint" }, "No wars.")]),
  );
  $("treaties").replaceChildren(
    ...(s.treaties.length
      ? s.treaties.map((t) =>
          el(
            "li",
            {},
            `${civName(t.a)} — ${civName(t.b)}: ${t.kind.replace("_", "-")}${t.expires ? ` (truce until season ${t.expires})` : ""}`,
          ),
        )
      : [el("li", { class: "hint" }, "No treaties.")]),
  );
  const alive = s.civs.filter((c) => c.alive);
  const head = el(
    "tr",
    {},
    el("th", {}),
    alive.map((c) => el("th", { scope: "col", title: c.name }, c.key)),
  );
  const rows = alive.map((a) =>
    el(
      "tr",
      {},
      el("th", { scope: "row" }, a.key),
      alive.map((b) => {
        if (a.id === b.id) return el("td", { class: "self" }, "·");
        const v = s.opinion[a.id][b.id];
        const hue = v >= 0 ? 140 : 0;
        const light = 96 - Math.min(40, Math.abs(v) * 0.45);
        return el(
          "td",
          {
            style: `background:hsl(${hue} 55% ${light}%)`,
            title: `${a.name} regards ${b.name}: ${fmt(v)}`,
          },
          fmt(v),
        );
      }),
    ),
  );
  $("opinion").replaceChildren(el("thead", {}, head), el("tbody", {}, rows));
  const letters = s.messages.slice(-30).reverse();
  $("letters").replaceChildren(
    ...(letters.length
      ? letters.map((m) =>
          el(
            "li",
            {},
            el("strong", {}, `${civName(m.from)} → ${civName(m.to)}`),
            el(
              "span",
              { class: "tag" },
              m.generation === "model"
                ? "model-written"
                : m.generation === "human"
                  ? "written by a person"
                  : "scripted",
            ),
            el("q", {}, m.text),
          ),
        )
      : [el("li", { class: "hint" }, "No letters yet.")]),
  );
}

const MAJOR = new Set([
  "war",
  "peace",
  "fall",
  "treaty",
  "conquest",
  "revolt",
  "joined_war",
  "alliance_broken",
  "capital_moved",
  "succession",
  "occupation",
  "liberation",
  "tribute",
]);
const WAR = new Set([
  "war",
  "battle",
  "occupation",
  "liberation",
  "peace",
  "joined_war",
  "fall",
  "conquest",
]);
const DIPLO = new Set([
  "treaty",
  "treaty_cancelled",
  "alliance_broken",
  "tribute",
  "tribute_refused",
  "gift",
  "peace",
  "joined_war",
]);

function renderChronicle() {
  const f = $("evfilter").value;
  const keep = (e) =>
    f === "all" ||
    (f === "major"
      ? MAJOR.has(e.kind)
      : f === "war"
        ? WAR.has(e.kind)
        : DIPLO.has(e.kind));
  const list = state.events.filter(keep).slice(-400).reverse();
  const start = state.s.scenario ? state.s : null;
  $("chronicle").replaceChildren(
    ...list.map((e) =>
      el(
        "li",
        { class: `ev ev-${e.kind}` },
        el("span", { class: "when" }, seasonName(e.turn)),
        " ",
        e.text,
      ),
    ),
  );
  if (!list.length)
    $("chronicle").replaceChildren(
      el("li", { class: "hint" }, start ? "Nothing yet." : ""),
    );
}

function seasonName(turn) {
  const seasons = ["Spring", "Summer", "Autumn", "Winter"];
  const y = state.startYear + Math.floor(turn / 4);
  return `${seasons[turn % 4]} ${y <= 0 ? `${1 - y} BC` : `AD ${y}`}`;
}

async function openMind(c) {
  state.mindCiv = c;
  $("mindciv").value = String(c);
  selectTab("minds");
  await renderMind();
}

async function renderMind() {
  const c = Number($("mindciv").value);
  let m;
  try {
    m = await api(`/api/mind/${c}`);
  } catch (e) {
    $("mind").replaceChildren(el("p", { class: "error" }, e.message));
    return;
  }
  const civ = state.s.civs[c];
  const p = civ.personality;
  const beliefs = m.beliefs.filter((b) => b.id !== c && b.alive && b.in_contact);
  $("mind").replaceChildren(
    el(
      "p",
      {},
      el("strong", {}, civ.name),
      `, governed by ${civ.ruler}. Seat: ${state.s.seats[c]?.brain ?? ""}.`,
    ),
    el(
      "p",
      { class: "small" },
      "Temperament: ",
      Object.entries(p)
        .map(([k, v]) => `${k} ${fmt(v, 2)}`)
        .join(" · "),
    ),
    el("h3", {}, "Goals ", el("span", { class: "hint" }, "(derived by the host)")),
    el(
      "ul",
      { class: "plain" },
      m.goals.map((g) =>
        el(
          "li",
          {},
          `${g.text} `,
          el("span", { class: "small" }, `weight ${fmt(g.weight, 2)}`),
        ),
      ),
    ),
    el(
      "h3",
      {},
      "Beliefs about others ",
      el("span", { class: "hint" }, "(strength is an estimate)"),
    ),
    el(
      "table",
      { class: "data" },
      el(
        "thead",
        {},
        el(
          "tr",
          {},
          [
            "Power",
            "Opinion",
            "Their attitude ≈",
            "Strength ≈",
            "Trust",
            "Grievances",
            "Favours",
          ].map((h) => el("th", { scope: "col" }, h)),
        ),
      ),
      el(
        "tbody",
        {},
        beliefs.map((b) =>
          el(
            "tr",
            {},
            el("th", { scope: "row" }, b.name),
            el("td", { class: "num" }, fmt(b.our_opinion)),
            el("td", { class: "num" }, fmt(b.their_opinion_est)),
            el("td", { class: "num" }, fmt(b.strength_est)),
            el("td", { class: "num" }, fmt(b.trust, 2)),
            el("td", { class: "num" }, b.grievances),
            el("td", { class: "num" }, b.favors),
          ),
        ),
      ),
    ),
    el(
      "h3",
      {},
      "Memories ",
      el(
        "span",
        { class: "hint" },
        `(recorded by the host from what the realm witnessed; ${m.memory.entries.length} held)`,
      ),
    ),
    el(
      "ol",
      { class: "plain small", reversed: true },
      m.memory.entries
        .slice(-25)
        .reverse()
        .map((e) =>
          el(
            "li",
            {},
            el("span", { class: "when" }, seasonName(e.turn)),
            " ",
            e.text,
            el(
              "span",
              { class: "small" },
              ` · salience ${fmt(e.salience, 2)}, feeling ${e.valence > 0 ? "+" : ""}${fmt(e.valence, 1)}`,
            ),
          ),
        ),
    ),
    m.chronicle.length
      ? [
          el("h3", {}, "Older memory, consolidated"),
          el(
            "ul",
            { class: "plain small" },
            m.chronicle.map((t) => el("li", {}, t)),
          ),
        ]
      : null,
    m.memory.notes.length
      ? [
          el(
            "h3",
            {},
            "Its own notes ",
            el("span", { class: "hint" }, "(written by the seat's chooser)"),
          ),
          el(
            "ul",
            { class: "plain" },
            m.memory.notes
              .slice()
              .reverse()
              .map((n) =>
                el(
                  "li",
                  { class: "model" },
                  el("span", { class: "when" }, seasonName(n.turn)),
                  " ",
                  n.text,
                ),
              ),
          ),
        ]
      : null,
    el("h3", {}, "Recent decisions"),
    ...m.recent_decisions
      .filter((r) => r.decision)
      .map((r) =>
        el(
          "details",
          {},
          el(
            "summary",
            {},
            badge(r.decision.label),
            ` ${r.date}: ${r.decision.chosen.length} action(s)`,
          ),
          el(
            "ul",
            { class: "plain small" },
            r.decision.chosen.map((t) => el("li", {}, t)),
          ),
          r.decision.rationale
            ? el(
                "p",
                { class: "model" },
                el("span", { class: "tag" }, "model-written"),
                " ",
                r.decision.rationale,
              )
            : null,
          r.decision.error ? el("p", { class: "error" }, r.decision.error) : null,
          r.rejected.length
            ? el(
                "p",
                { class: "small" },
                "Refused by the resolver: ",
                r.rejected.map((x) => `${x.what} (${x.reason})`).join("; "),
              )
            : null,
        ),
      ),
  );
}

// ---------------------------------------------------------------- your seat

function renderSeat() {
  const box = $("seat");
  const humans = state.s.humans;
  if (!humans.length) {
    box.replaceChildren(
      el(
        "p",
        {},
        "No power is played by a person in this world. Choose ",
        el("strong", {}, "New world…"),
        " and set a power's seat to ",
        el("em", {}, "you"),
        ".",
      ),
    );
    return;
  }
  if (box.dataset.turn === String(state.s.turn) && box.dataset.ready === "1") return;
  box.dataset.turn = String(state.s.turn);
  box.dataset.ready = "1";
  const h = humans[0];
  const civ = state.s.civs[h.civ];
  const checks = h.offered.map((o) =>
    el(
      "label",
      { class: "offer" },
      el("input", { type: "checkbox", value: o.index, "data-kind": o.action.type }),
      ` [${o.index}] ${o.text}`,
    ),
  );
  const answers = h.proposals.map((p) =>
    el(
      "div",
      { class: "proposal" },
      el("p", {}, p.text),
      el(
        "label",
        {},
        el("input", { type: "radio", name: `prop-${p.id}`, value: "yes" }),
        " accept ",
      ),
      el(
        "label",
        {},
        el("input", { type: "radio", name: `prop-${p.id}`, value: "no", checked: true }),
        " refuse",
      ),
    ),
  );
  const providers = [];
  if (state.meta?.providers.lmstudio.available)
    providers.push(["lmstudio", "LM Studio (local)"]);
  if (state.meta?.providers.anthropic.key_present)
    providers.push(["anthropic", "Anthropic API (spends credit)"]);
  const others = state.s.civs.filter((c) => c.alive && c.id !== h.civ);
  box.replaceChildren(
    el("h3", {}, `You rule the ${civ.name}`),
    el(
      "p",
      { class: "small" },
      `Treasury ${fmt(civ.treasury)} gold · stability ${fmt(civ.stability)} · choose up to 6 actions, one move per army.`,
    ),
    providers.length
      ? el(
          "div",
          { class: "orders" },
          el("label", { for: "nl" }, "Give orders in your own words"),
          el("textarea", {
            id: "nl",
            rows: 3,
            placeholder:
              "e.g. Fortify the Sicilian border, send the Campanian legion to Bruttium, and offer Syracuse an alliance.",
          }),
          el(
            "div",
            { class: "row" },
            el(
              "select",
              { id: "nlprov", "aria-label": "Model to interpret orders" },
              providers.map(([v, t]) => el("option", { value: v }, t)),
            ),
            el("button", { type: "button", onclick: interpret }, "Interpret"),
          ),
          el("p", { class: "small", id: "nlout", "aria-live": "polite" }),
        )
      : el(
          "p",
          { class: "hint" },
          "Start LM Studio or set ANTHROPIC_API_KEY to give orders in plain language.",
        ),
    el(
      "fieldset",
      {},
      el("legend", {}, "Actions offered this season"),
      el("div", { class: "offers" }, checks),
    ),
    answers.length
      ? el("fieldset", {}, el("legend", {}, "Proposals awaiting your answer"), answers)
      : null,
    el(
      "fieldset",
      {},
      el("legend", {}, "Send a letter"),
      el(
        "div",
        { class: "row" },
        el(
          "select",
          { id: "letterto", "aria-label": "Recipient" },
          others.map((c) => el("option", { value: c.id }, c.name)),
        ),
        el("input", {
          id: "lettertext",
          type: "text",
          maxlength: 400,
          placeholder: "Your words to their ruler",
          "aria-label": "Letter",
        }),
        el("button", { type: "button", onclick: () => sendLetter(h.civ) }, "Send"),
      ),
      el("ul", { class: "plain", id: "parley" }),
    ),
    el(
      "div",
      { class: "row" },
      el(
        "button",
        { type: "button", onclick: () => queueOrders(h, false) },
        "Queue orders",
      ),
      el(
        "button",
        { type: "button", class: "primary", onclick: () => queueOrders(h, true) },
        "End season",
      ),
    ),
    el(
      "p",
      { class: "small", id: "queued", "aria-live": "polite" },
      h.queued ? "Orders are queued for this season." : "",
    ),
  );
  renderParley();
}

function renderParley() {
  const list = $("parley");
  if (!list) return;
  list.replaceChildren(
    ...state.s.parley
      .slice(-8)
      .reverse()
      .map((p) =>
        el(
          "li",
          {},
          el("strong", {}, `To ${civName(p.to)}: `),
          el("q", {}, p.letter),
          p.reply
            ? el(
                "p",
                { class: "model" },
                el(
                  "span",
                  { class: "tag" },
                  `reply, model-written · ${p.reply_model ?? ""}`,
                ),
                " ",
                p.reply,
              )
            : null,
          p.error ? el("p", { class: "small" }, p.error) : null,
        ),
      ),
  );
}

async function interpret() {
  const h = state.s.humans[0];
  const out = $("nlout");
  out.textContent = "Asking the model…";
  try {
    const r = await api("/api/interpret", {
      civ: h.civ,
      text: $("nl").value,
      provider: $("nlprov").value,
    });
    for (const box of document.querySelectorAll(".offer input"))
      box.checked = r.actions.some((a) => a.index === Number(box.value));
    out.replaceChildren(
      el("span", { class: "tag" }, `model-written · ${r.model}`),
      ` ${r.understood} `,
      el("em", {}, r.note),
    );
  } catch (e) {
    out.textContent = `Could not interpret: ${e.message}`;
  }
}

async function sendLetter(from) {
  const text = $("lettertext").value.trim();
  if (!text) return;
  $("lettertext").value = "";
  try {
    await api("/api/letter", { from, to: Number($("letterto").value), text });
  } catch (e) {
    alertBox(e.message);
  }
  await refresh();
  renderParley();
}

async function queueOrders(h, end) {
  const actions = [...document.querySelectorAll(".offer input:checked")]
    .map((b) => Number(b.value))
    .slice(0, 6);
  const responses = h.proposals.map((p) => ({
    proposal: p.id,
    accept: document.querySelector(`input[name="prop-${p.id}"]:checked`)?.value === "yes",
  }));
  try {
    const r = await api("/api/orders", { civ: h.civ, actions, responses });
    $("queued").textContent = r.queued.length
      ? `Queued: ${r.queued.join("; ")}`
      : "Queued: no actions this season.";
    if (end) await step(1);
  } catch (e) {
    $("queued").textContent = e.message;
  }
}

// ---------------------------------------------------------------- experiments

async function runExperiment() {
  $("xerror").textContent = "";
  $("xresult").replaceChildren(el("p", { class: "hint" }, "Running…"));
  const seeds = $("xseeds")
    .value.split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 0);
  const treatment = { id: "treatment", policy: $("xpolicy").value, interventions: [] };
  if ($("xtrait").value) {
    treatment.interventions.push({
      type: "set_trait",
      civ: $("xciv").value,
      trait: $("xtrait").value,
      value: Number($("xvalue").value),
    });
  }
  const sc = state.s.scenario?.id ?? "mediterranean-264bc";
  const scenario =
    sc === "generated"
      ? {
          kind: "generated",
          civs: state.s.civs.length,
          provinces: state.s.provinces.length,
        }
      : { kind: "builtin", id: sc };
  const plan = {
    schema: "noeterra-experiment/v1",
    scenario,
    turns: Number($("xturns").value),
    seeds,
    arms: [{ id: "control", policy: "rules", interventions: [] }, treatment],
  };
  try {
    const r = await api("/api/experiment", plan);
    const rows = r.paired.map((p) =>
      el(
        "tr",
        {},
        el("th", { scope: "row" }, p.metric),
        el("td", { class: "num" }, fmt(r.summary.control[p.metric].mean, 2)),
        el("td", { class: "num" }, fmt(r.summary.treatment[p.metric].mean, 2)),
        el(
          "td",
          { class: "num" },
          `${p.mean_delta > 0 ? "+" : ""}${fmt(p.mean_delta, 2)}`,
        ),
        el("td", { class: "num" }, `${p.increased}↑ ${p.decreased}↓ ${p.unchanged}=`),
      ),
    );
    $("xresult").replaceChildren(
      el(
        "p",
        { class: "small" },
        `${r.runs.length} runs · evidence class: `,
        el("strong", {}, r.evidence_class),
        ` · plan ${r.plan_sha256.slice(0, 12)}… · ${r.engine}`,
      ),
      el(
        "table",
        { class: "data" },
        el(
          "thead",
          {},
          el(
            "tr",
            {},
            ["Metric", "Control", "Treatment", "Mean change", "Per seed"].map((h) =>
              el("th", { scope: "col" }, h),
            ),
          ),
        ),
        el("tbody", {}, rows),
      ),
    );
  } catch (e) {
    $("xresult").replaceChildren();
    $("xerror").textContent = e.message;
  }
}

// ---------------------------------------------------------------- setup

const SEATS = [
  ["rules", "Rules"],
  ["amnesic", "Rules, no memory"],
  ["random", "Random (baseline)"],
  ["human", "You"],
  ["lmstudio", "LM Studio model"],
  ["anthropic", "Anthropic model"],
];

function seatOptions(selected) {
  return SEATS.filter(
    ([v]) => v !== "lmstudio" || state.meta?.providers.lmstudio.available,
  )
    .filter(([v]) => v !== "anthropic" || state.meta?.providers.anthropic.key_present)
    .map(([v, t]) => el("option", { value: v, selected: v === selected }, t));
}

function renderSetup() {
  $("scenario").replaceChildren(
    ...state.meta.scenarios.map((id) =>
      el("option", { value: id, selected: id === state.s.scenario?.id }, id),
    ),
  );
  $("defaultseat").replaceChildren(
    ...seatOptions("rules").filter((o) => o.value !== "human"),
  );
  const gen = $("scenario").value === "generated";
  for (const n of document.querySelectorAll(".gen")) n.hidden = !gen;
  const civs = gen
    ? []
    : state.s.scenario?.id === $("scenario").value
      ? state.s.civs
      : [];
  $("seatlist").replaceChildren(
    el("legend", {}, "Seats for this scenario's powers"),
    ...(civs.length
      ? civs.map((c) =>
          el(
            "label",
            { class: "seatpick" },
            el("i", { class: "swatch", style: `background:${c.color}` }),
            ` ${c.name} `,
            el(
              "select",
              { "data-key": c.key },
              el("option", { value: "" }, "(as above)"),
              seatOptions(""),
            ),
          ),
        )
      : [
          el(
            "p",
            { class: "hint" },
            gen
              ? "Generated powers all take the seat above; the first can be yours:"
              : "Begin once with this scenario to set seats per power.",
          ),
          gen
            ? el(
                "label",
                {},
                el("input", { type: "checkbox", id: "genhuman" }),
                " I play the first power",
              )
            : null,
        ]),
  );
  const lm = state.meta.providers.lmstudio;
  const an = state.meta.providers.anthropic;
  $("providerhint").textContent =
    `LM Studio: ${lm.available ? `available (${lm.models.filter((m) => !m.includes("embed")).join(", ")})` : `not reachable at ${lm.url}`}. ` +
    `Anthropic: ${an.key_present ? `key present on the server, model ${an.model}; every model seat calls the API each season and spends credit` : "no ANTHROPIC_API_KEY in the server's environment"}.`;
}

async function startGame() {
  $("setuperror").textContent = "";
  const scenario = $("scenario").value;
  const seats = {};
  for (const s of document.querySelectorAll("#seatlist select"))
    if (s.value) seats[s.dataset.key] = s.value;
  if (scenario === "generated" && $("genhuman")?.checked) seats.c0 = "human";
  try {
    await api("/api/new", {
      scenario,
      seed: Number($("seed").value),
      default_seat: $("defaultseat").value,
      seats,
      civs: Number($("gencivs").value),
      provinces: Number($("genprovs").value),
    });
    $("setup").hidden = true;
    $("newgame").setAttribute("aria-expanded", "false");
    state.events = [];
    state.eventCount = 0;
    state.selected = null;
    state.chartCache = "";
    $("seat").dataset.ready = "0";
    await refresh(true);
  } catch (e) {
    $("setuperror").textContent = e.message;
  }
}

// ---------------------------------------------------------------- loop

function alertBox(msg) {
  $("job").textContent = msg;
}

async function refresh(withGeo = false) {
  const s = await api(
    `/api/state?since=${state.eventCount}${withGeo || !state.geo ? "&geo=1" : ""}`,
  );
  if (s.geometry) state.geo = s.geometry;
  if (s.event_count < state.eventCount) {
    state.events = [];
    state.eventCount = 0;
    return refresh(true);
  }
  state.events.push(...s.events);
  state.eventCount = s.event_count;
  state.s = s;
  state.startYear = s.stats.length ? inferStartYear(s) : 0;
  render();
  return s;
}

function inferStartYear(s) {
  // "Spring 264 BC" at turn t → astronomical start year.
  const m = /(\d+) (BC)|AD (\d+)/.exec(s.date);
  const y = m ? (m[2] ? 1 - Number(m[1]) : Number(m[3])) : 0;
  return y - Math.floor(s.turn / 4);
}

function render() {
  const s = state.s;
  $("date").textContent = `${s.date} · season ${s.turn}`;
  const job = s.job;
  $("job").textContent = job.running
    ? `running ${job.done}/${job.target}…`
    : job.error
      ? job.error
      : "";
  for (const id of ["step1", "step10", "stepn", "verify", "save", "newgame"])
    $(id).disabled = job.running;
  $("stop").disabled = !job.running;
  $("scenarioline").textContent = s.scenario
    ? `${s.scenario.name}. ${s.scenario.description}`
    : "";
  $("provenance").textContent = s.scenario
    ? `Data: ${s.scenario.provenance}. Simulated outcomes are not historical evidence.`
    : "";
  drawMap();
  renderProvince();
  renderPowers();
  renderDiplomacy();
  renderChronicle();
  if ($("mindciv").options.length !== s.civs.length) {
    $("mindciv").replaceChildren(
      ...s.civs.map((c) => el("option", { value: c.id }, c.name)),
    );
    $("xciv").replaceChildren(
      ...s.civs.map((c) => el("option", { value: c.key }, c.name)),
    );
  }
  if (!$("tab-seat").hidden || s.humans.length) renderSeat();
  renderParley();
}

async function step(n) {
  try {
    await api("/api/step", { turns: n });
  } catch (e) {
    alertBox(e.message);
    return;
  }
  $("seat").dataset.ready = "0";
  poll();
}

async function poll() {
  if (state.polling) return;
  state.polling = true;
  try {
    for (;;) {
      const s = await refresh();
      if (!s.job.running) break;
      await new Promise((r) => setTimeout(r, 700));
    }
    $("seat").dataset.ready = "0";
    renderSeat();
    if (!$("tab-minds").hidden) renderMind();
  } finally {
    state.polling = false;
  }
}

function selectTab(name) {
  for (const t of document.querySelectorAll('[role="tab"]')) {
    const on = t.id === `t-${name}`;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    $(t.getAttribute("aria-controls")).hidden = !on;
  }
  if (name === "minds") renderMind();
  if (name === "seat") renderSeat();
}

function wire() {
  $("step1").addEventListener("click", () => step(1));
  $("step10").addEventListener("click", () => step(10));
  $("stepn").addEventListener("click", () => step(Number($("nturns").value) || 1));
  $("stop").addEventListener("click", () => api("/api/stop", {}));
  $("verify").addEventListener("click", async () => {
    alertBox("Replaying…");
    try {
      const r = await api("/api/verify", {});
      alertBox(
        r.ok
          ? `Replay verified: ${r.turns_checked} seasons reproduce every recorded state hash.`
          : `Replay diverged at season ${r.first_divergence}: ${r.reason}`,
      );
    } catch (e) {
      alertBox(e.message);
    }
  });
  $("save").addEventListener("click", async () => {
    const save = await api("/api/save");
    const blob = new Blob([JSON.stringify(save)], { type: "application/json" });
    const a = el("a", {
      href: URL.createObjectURL(blob),
      download: `noeterra-${save.scenario.id}-seed${save.seed}-t${save.turns.length}.json`,
    });
    document.body.append(a);
    a.click();
    a.remove();
  });
  $("load").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const r = await api("/api/load", JSON.parse(await f.text()));
      alertBox(`Loaded and verified by replay (${r.replay.turns_checked} seasons).`);
      state.events = [];
      state.eventCount = 0;
      state.chartCache = "";
      await refresh(true);
    } catch (err) {
      alertBox(err.message);
    }
    e.target.value = "";
  });
  $("newgame").addEventListener("click", () => {
    const open = $("setup").hidden;
    $("setup").hidden = !open;
    $("newgame").setAttribute("aria-expanded", String(open));
    if (open) renderSetup();
  });
  $("scenario").addEventListener("change", renderSetup);
  $("start").addEventListener("click", startGame);
  $("evfilter").addEventListener("change", renderChronicle);
  $("mindciv").addEventListener("change", renderMind);
  $("xrun").addEventListener("click", runExperiment);
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  tabs.forEach((t, i) => {
    t.addEventListener("click", () => selectTab(t.id.slice(2)));
    t.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        const next =
          tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
        next.focus();
        selectTab(next.id.slice(2));
      }
    });
  });
}

async function boot() {
  wire();
  try {
    state.meta = await api("/api/meta");
    await refresh(true);
    if (state.s.job.running) poll();
  } catch (e) {
    alertBox(`Cannot reach the workbench: ${e.message}`);
  }
}

boot();
