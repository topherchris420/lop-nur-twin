/**
 * The causal trace's page: a self-contained HTML file that draws a research
 * fly's trace (scripts/ecology-trace.ts). No network, no libraries: inline
 * SVG and a few lines of script reading the embedded JSON. Every panel names
 * what its data are (the trace's `provenance`); nothing on it is a thought.
 */
export function page(trace: unknown): string {
  const data = JSON.stringify(trace).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Research fly trace</title>
<style>
:root {
  color-scheme: light;
  --surface: #fcfcfb; --surface-2: #f2f1ee; --border: #dddcd7;
  --text: #0b0b0b; --text-2: #52514e; --text-3: #7a7974;
  --s1: #2a78d6; --s2: #eb6834; --s3: #1baf7a; --s4: #eda100;
  --ref: #8a8984;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --surface: #1a1a19; --surface-2: #242423; --border: #3a3a38;
    --text: #f0efec; --text-2: #c3c2b7; --text-3: #94938c;
    --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500;
    --ref: #8a8984;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --surface: #1a1a19; --surface-2: #242423; --border: #3a3a38;
  --text: #f0efec; --text-2: #c3c2b7; --text-3: #94938c;
  --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500;
  --ref: #8a8984;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--surface); color: var(--text); font: 15px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1100px; margin: 0 auto; padding: 24px 16px 48px; }
h1 { font-size: 22px; margin: 0 0 4px; }
h2 { font-size: 15px; margin: 0 0 6px; }
p.lede { color: var(--text-2); margin: 0 0 16px; max-width: 75ch; }
.grid { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 20px; }
@media (max-width: 860px) { .grid { grid-template-columns: minmax(0, 1fr); } }
.chart { margin: 0 0 10px; }
.chart .title { display: flex; justify-content: space-between; gap: 8px; font-size: 13px; color: var(--text-2); }
.chart .title b { color: var(--text); font-weight: 600; }
svg { display: block; width: 100%; height: auto; overflow: visible; }
.axis { stroke: var(--border); stroke-width: 1; }
.tick { fill: var(--text-3); font-size: 11px; }
.line { fill: none; stroke: var(--s1); stroke-width: 2; stroke-linejoin: round; }
.refline { stroke: var(--ref); stroke-width: 1; stroke-dasharray: 4 4; }
.reflabel { fill: var(--text-3); font-size: 10px; }
.cross { stroke: var(--text-2); stroke-width: 1; }
.panel { position: sticky; top: 12px; align-self: start; background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 14px; }
.step { border-left: 3px solid var(--border); padding: 4px 0 8px 10px; margin: 0 0 4px; }
.step h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--text-3); margin: 0 0 2px; }
.step .v { font-size: 13px; color: var(--text); overflow-wrap: anywhere; }
.arrow { color: var(--text-3); font-size: 12px; margin: -2px 0 2px 12px; }
.legend { display: flex; flex-wrap: wrap; gap: 12px; font-size: 12px; color: var(--text-2); margin: 4px 0 0; }
.sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; }
label.slider { display: block; font-size: 13px; color: var(--text-2); margin: 8px 0 14px; }
input[type=range] { width: 100%; }
.prov { font-size: 12px; color: var(--text-3); margin: 2px 0 0; }
details { margin-top: 20px; }
table { border-collapse: collapse; font-size: 12px; width: 100%; }
th, td { border-bottom: 1px solid var(--border); padding: 3px 6px; text-align: right; white-space: nowrap; }
th:last-child, td:last-child { text-align: left; white-space: normal; }
.tablewrap { max-height: 420px; overflow: auto; border: 1px solid var(--border); border-radius: 6px; }
</style>
</head>
<body>
<main>
<h1>A research fly's day, traced</h1>
<p class="lede" id="lede"></p>
<label class="slider">Time in the trace: <output id="tlabel"></output>
<input id="t" type="range" min="0" value="0" step="1" aria-label="Time in the trace"></label>
<div class="grid">
<div id="charts"></div>
<aside class="panel" aria-live="polite">
<h2>The loop at this moment</h2>
<div id="loop"></div>
</aside>
</div>
<details><summary>What each panel's data are</summary><ul id="prov"></ul></details>
<details><summary>All samples as a table</summary><div class="tablewrap"><table id="table"></table></div></details>
</main>
<script type="application/json" id="trace">${data}</script>
<script>
const T = JSON.parse(document.getElementById("trace").textContent);
const S = T.samples;
const H = (s) => (s.t_s / 3600);
const fmt = (x, d = 2) => (x === null || x === undefined || Number.isNaN(x) ? "—" : Number(x).toFixed(d));
const hhmm = (s) => { const h = s.world.hour; const hh = Math.floor(h); const mm = Math.round((h - hh) * 60) % 60; return String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0"); };
document.getElementById("lede").textContent =
  "Subject " + T.subject + " (" + T.source + "). Sampled every 30 s for " + fmt(H(S[S.length - 1]), 1) +
  " simulated hours; " + (T.alive_at_end ? "alive at the end." : "it died of " + T.cause + ".") +
  " Drawn from the simulation's own records: no panel shows a thought or a feeling.";
const GROUPS = { rest: 0, groom: 0, walk: 1, feed: 2, takeoff: 3, flight: 3, land: 3, escape: 3 };
const GROUP_NAMES = ["still (rest, groom)", "walking", "feeding", "flying"];
const W = 640, PAD = 34;
const x = (h) => PAD + (h / H(S[S.length - 1])) * (W - PAD - 8);
const charts = [];
function lineChart(title, unit, get, refs = []) {
  const vals = S.map(get).filter((v) => v !== null && v !== undefined);
  if (!vals.length) return;
  let lo = Math.min(...vals, ...refs.map((r) => r[0])), hi = Math.max(...vals, ...refs.map((r) => r[0]));
  if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
  const Hh = 92, y = (v) => 8 + (1 - (v - lo) / (hi - lo)) * (Hh - 24);
  let d = "", pen = false;
  S.forEach((s) => { const v = get(s); if (v === null || v === undefined) { pen = false; return; } d += (pen ? "L" : "M") + x(H(s)).toFixed(1) + "," + y(v).toFixed(1); pen = true; });
  const div = document.createElement("div"); div.className = "chart";
  div.innerHTML = '<div class="title"><b>' + title + '</b><span class="val"></span></div>' +
    '<svg viewBox="0 0 ' + W + ' ' + Hh + '" role="img" aria-label="' + title + ' over time">' +
    '<line class="axis" x1="' + PAD + '" x2="' + (W - 8) + '" y1="' + (Hh - 16) + '" y2="' + (Hh - 16) + '"/>' +
    '<text class="tick" x="' + (PAD - 4) + '" y="' + (y(hi) + 4) + '" text-anchor="end">' + fmt(hi, 1) + '</text>' +
    '<text class="tick" x="' + (PAD - 4) + '" y="' + (y(lo) + 4) + '" text-anchor="end">' + fmt(lo, 1) + '</text>' +
    refs.map((r) => '<line class="refline" x1="' + PAD + '" x2="' + (W - 8) + '" y1="' + y(r[0]) + '" y2="' + y(r[0]) + '"/><text class="reflabel" x="' + (W - 10) + '" y="' + (y(r[0]) - 3) + '" text-anchor="end">' + r[1] + '</text>').join("") +
    '<path class="line" d="' + d + '"/>' +
    '<text class="tick" x="' + PAD + '" y="' + (Hh - 2) + '">' + hhmm(S[0]) + '</text>' +
    '<text class="tick" x="' + (W - 8) + '" y="' + (Hh - 2) + '" text-anchor="end">' + hhmm(S[S.length - 1]) + '</text>' +
    '<line class="cross" x1="0" x2="0" y1="4" y2="' + (Hh - 16) + '"/></svg>';
  document.getElementById("charts").appendChild(div);
  charts.push({ div, get, unit });
}
function bandChart() {
  const div = document.createElement("div"); div.className = "chart";
  const Hh = 40; let rects = "";
  for (let i = 0; i < S.length - 1; i++) {
    const g = GROUPS[S[i].body.mode] ?? 0;
    const x0 = x(H(S[i])), x1 = x(H(S[i + 1]));
    rects += '<rect x="' + x0.toFixed(1) + '" y="6" width="' + Math.max(0.5, x1 - x0).toFixed(1) + '" height="18" fill="var(--s' + (g + 1) + ')"/>';
  }
  let marks = "";
  S.forEach((s, i) => s.effects.forEach((e) => {
    const col = e.kind === "drink" ? "var(--s1)" : e.kind === "inoculate" ? "var(--s4)" : "var(--s3)";
    marks += '<line x1="' + x(H(s)).toFixed(1) + '" x2="' + x(H(s)).toFixed(1) + '" y1="27" y2="35" stroke="' + col + '" stroke-width="2"/>';
  }));
  div.innerHTML = '<div class="title"><b>What the body was doing</b><span class="val"></span></div>' +
    '<svg viewBox="0 0 ' + W + ' ' + Hh + '" role="img" aria-label="The body\\'s mode over time, and its effects on the world">' + rects + marks +
    '<line class="cross" x1="0" x2="0" y1="2" y2="36"/></svg>' +
    '<div class="legend">' + GROUP_NAMES.map((n, i) => '<span><span class="sw" style="background:var(--s' + (i + 1) + ')"></span>' + n + '</span>').join("") +
    '<span>ticks below: interactions with the world (drinking, sugar taken, yeast left)</span></div>';
  document.getElementById("charts").appendChild(div);
  charts.push({ div, get: (s) => s.body.mode, unit: "" });
}
bandChart();
lineChart("Body water (share of full)", "", (s) => s.physiology?.water, [[0.7, "thirsty below"], [0.35, "lethal"]]);
lineChart("Humidity at the antennae", "", (s) => s.senses.humidity_at_antennae);
lineChart("Food odour sensed (relative)", "", (s) => s.senses.odour);
lineChart("Energy reserve (share of full)", "", (s) => s.body.reserve);
lineChart("Body temperature (°C)", "°C", (s) => s.physiology?.temp_c, [[31, "hot above"]]);
lineChart("Air temperature (°C)", "°C", (s) => s.world.temp_c);
lineChart("Mushroom body: learning trials so far", "", (s) => s.learning.trials);
const slider = document.getElementById("t"); slider.max = String(S.length - 1);
function show(i) {
  const s = S[i]; slider.value = String(i);
  document.getElementById("tlabel").textContent = hhmm(s) + " (" + fmt(H(s), 2) + " h in)";
  for (const c of charts) {
    const cx = x(H(s)); c.div.querySelectorAll(".cross").forEach((l) => { l.setAttribute("x1", cx); l.setAttribute("x2", cx); });
    const v = c.get(s); c.div.querySelector(".val").textContent = typeof v === "number" ? fmt(v, 3) + (c.unit ? " " + c.unit : "") : (v ?? "—");
  }
  const lt = s.learning.last_trial;
  const effects = s.effects.length ? s.effects.map((e) => e.kind + " " + e.item + " (" + fmt(e.effect, 4) + ")").join("; ") : "none in this sample";
  const steps = [
    ["Stimulus (sensed)", "odour " + fmt(s.senses.odour, 3) + " · humidity " + fmt(s.senses.humidity_at_antennae, 2) + " · light " + fmt(s.senses.light, 2) + " · looming " + fmt(s.senses.looming_drive, 2)],
    ["Internal state (model)", "water " + fmt(s.physiology?.water, 2) + " · body " + fmt(s.physiology?.temp_c, 1) + " °C · reserve " + fmt(s.body.reserve, 2) +
      (lt ? " · last learning trial: reinforcement " + fmt(lt.reinforcement, 2) + ", prediction " + fmt(lt.before, 2) + " → " + fmt(lt.after, 2) + ", dopamine +" + fmt(lt.dPlus, 1) + "/−" + fmt(lt.dMinus, 1) + " Hz" : " · no learning trial yet") +
      " · places remembered " + s.learning.remembered_places],
    ["Decision (logged reason)", s.decision ? s.decision.mode + ": " + s.decision.reason : "—"],
    ["Action (body)", s.body.mode + " at (" + fmt(s.body.x, 1) + ", " + fmt(s.body.z, 1) + ") m"],
    ["Effect on the world", effects],
  ];
  document.getElementById("loop").innerHTML = steps.map((st, k) =>
    '<div class="step"><h3>' + st[0] + '</h3><div class="v"></div></div>' + (k < steps.length - 1 ? '<div class="arrow">↓</div>' : "")).join("") +
    '<div class="arrow">↺ back to what it senses next</div>';
  document.querySelectorAll("#loop .v").forEach((el, k) => (el.textContent = steps[k][1]));
}
slider.addEventListener("input", () => show(Number(slider.value)));
document.getElementById("charts").addEventListener("pointermove", (ev) => {
  const svg = ev.target.closest("svg"); if (!svg) return;
  const r = svg.getBoundingClientRect(); const px = ((ev.clientX - r.left) / r.width) * W;
  const h = ((px - PAD) / (W - PAD - 8)) * H(S[S.length - 1]);
  let best = 0; S.forEach((s, i) => { if (Math.abs(H(s) - h) < Math.abs(H(S[best]) - h)) best = i; });
  show(best);
});
const prov = document.getElementById("prov");
for (const [k, v] of Object.entries(T.provenance)) { const li = document.createElement("li"); li.textContent = k + ": " + v; prov.appendChild(li); }
const tbl = document.getElementById("table");
tbl.innerHTML = "<thead><tr><th>time</th><th>mode</th><th>water</th><th>body °C</th><th>reserve</th><th>humidity</th><th>odour</th><th>reason</th></tr></thead>";
const tb = document.createElement("tbody");
for (const s of S) { const tr = document.createElement("tr"); [hhmm(s), s.body.mode, fmt(s.physiology?.water, 2), fmt(s.physiology?.temp_c, 1), fmt(s.body.reserve, 2), fmt(s.senses.humidity_at_antennae, 2), fmt(s.senses.odour, 3), s.decision?.reason ?? "—"].forEach((v) => { const td = document.createElement("td"); td.textContent = v; tr.appendChild(td); }); tb.appendChild(tr); }
tbl.appendChild(tb);
show(0);
</script>
</body>
</html>
`;
}
