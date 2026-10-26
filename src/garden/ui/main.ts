/**
 * The exhibit page: asks the garden for its state, keeps the shared
 * presentation clock, and hands both, read-only, to the picture and the
 * words. The only request this page ever makes to the garden is
 * `GET /api/state`; there is no other endpoint it could call, nothing it
 * sends, and nothing a visitor does here (a camera, a preset, a pause)
 * reaches the simulation. Opening, refreshing or closing the page creates,
 * resets or ends nothing: the server's fly lives on its own.
 *
 * The 3D garden (Three.js, loaded on demand) draws when the browser has
 * WebGL 2; otherwise, or if it fails, the previous 2D painting takes over.
 */
import { parseObservation, type Observation } from "../core/observation.js";
import { PollScheduler } from "../core/poll.js";
import {
  AdaptiveResolution,
  defaultQuality,
  isQualityName,
  QUALITY,
  type QualityName,
} from "../core/quality.js";
import { clampFps, STOP_MOTION_FPS } from "../core/stopMotion.js";
import {
  PresentationClock,
  ServerClock,
  Timeline,
  type Interval,
} from "../core/timeline.js";
import type { CameraMode } from "../scene/camera.js";
import type { GardenScene, IntervalAt, Picture } from "../scene/garden.js";
import { Fallback2D } from "./fallback2d.js";
import {
  clockText,
  dayText,
  establishedFor,
  labelOf,
  learnedOf,
  lifeOf,
  memoriesOf,
  sceneDescription,
  statusOf,
  weatherOf,
} from "./words.js";

const STATE_URL = "/api/state";
const CAMERAS = [
  "observation",
  "tracking",
  "macro",
  "free",
] as const satisfies readonly CameraMode[];

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};

// ------------------------------------------------------------------ settings

interface Saved {
  camera: CameraMode;
  quality: QualityName;
  stopMotion: boolean;
  fps: number;
  motionBlur: boolean;
  panel: boolean;
}

const narrow = () => window.matchMedia("(max-width: 760px)").matches;
const deviceQuality = (): QualityName => {
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean };
  };
  return defaultQuality({
    mobile:
      window.matchMedia("(pointer: coarse)").matches &&
      Math.min(screen.width, screen.height) < 820,
    cores: nav.hardwareConcurrency || null,
    memoryGb: typeof nav.deviceMemory === "number" ? nav.deviceMemory : null,
    saveData: nav.connection?.saveData === true,
  });
};

/** A visitor's own preferences, kept in this browser only. */
function loadSaved(): Saved {
  const fallback: Saved = {
    camera: "tracking",
    quality: deviceQuality(),
    stopMotion: true,
    fps: STOP_MOTION_FPS.default,
    motionBlur: false,
    panel: !narrow(),
  };
  try {
    const raw = JSON.parse(localStorage.getItem("garden-view") ?? "null") as Partial<
      Record<keyof Saved, unknown>
    > | null;
    if (!raw || typeof raw !== "object") return fallback;
    return {
      camera: (CAMERAS as readonly unknown[]).includes(raw.camera)
        ? (raw.camera as CameraMode)
        : fallback.camera,
      quality: isQualityName(raw.quality) ? raw.quality : fallback.quality,
      stopMotion:
        typeof raw.stopMotion === "boolean" ? raw.stopMotion : fallback.stopMotion,
      fps: typeof raw.fps === "number" ? clampFps(raw.fps) : fallback.fps,
      motionBlur:
        typeof raw.motionBlur === "boolean" ? raw.motionBlur : fallback.motionBlur,
      panel: narrow()
        ? false
        : typeof raw.panel === "boolean"
          ? raw.panel
          : fallback.panel,
    };
  } catch {
    return fallback;
  }
}

const saved = loadSaved();
const save = () => {
  try {
    localStorage.setItem("garden-view", JSON.stringify(saved));
  } catch {
    // Private windows and blocked storage: preferences last for this visit only.
  }
};

const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
let reduced = motionQuery.matches;

// ------------------------------------------------------------- the garden's clock

const timeline = new Timeline();
const serverClock = new ServerClock();
const presentation = new PresentationClock();
const poller = new PollScheduler();
let lastAnswerMs: number | null = null;
let pollTimer: number | undefined;
let requesting = false;

function withTimeout(ms: number): { signal: AbortSignal; done(): void } {
  const c = new AbortController();
  const id = window.setTimeout(() => c.abort(), ms);
  return { signal: c.signal, done: () => window.clearTimeout(id) };
}

async function poll() {
  if (requesting) return;
  requesting = true;
  window.clearTimeout(pollTimer);
  const sent = performance.now();
  const timeout = withTimeout(8000);
  let delay: number;
  try {
    const response = await fetch(STATE_URL, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      signal: timeout.signal,
    });
    const received = performance.now();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const o = parseObservation(await response.json());
    serverClock.update(o.serverTime, sent, received);
    const result = timeline.push(o);
    if (result === "new-life") showLifeChange();
    lastAnswerMs = received;
    delay = poller.success(
      o.updatedAt,
      o.serverTime,
      result === "added" || result === "new-life",
      serverClock.now(received) ?? o.serverTime,
      document.hidden,
    );
  } catch (e) {
    if (!(e instanceof DOMException)) console.warn("garden: no state this time", e);
    delay = poller.failure(document.hidden);
  } finally {
    timeout.done();
    requesting = false;
  }
  pollTimer = window.setTimeout(() => void poll(), delay);
  words(true);
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    void poll();
    scene?.invalidate();
  }
});

// ---------------------------------------------------------------- the picture

const exhibit = $("exhibit");
const stage = $("stage");
let canvas = $<HTMLCanvasElement>("garden");
const locator = $<HTMLButtonElement>("locator");
let scene: GardenScene | null = null;
let flat: Fallback2D | null = null;
let adaptive = new AdaptiveResolution(
  QUALITY[saved.quality],
  window.devicePixelRatio || 1,
);
let paused: { t: number; iv: Interval | null } | null = null;
let shownAt: number | null = null;
let firstPicture = false;
let lastPicture: Picture | null = null;

const sceneSettings = () => ({
  camera: saved.camera,
  stopMotion: { enabled: saved.stopMotion, fps: saved.fps },
  motionBlur: saved.motionBlur,
  reducedMotion: reduced,
});

function webgl2(): boolean {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
}

async function start3D(): Promise<boolean> {
  if (!webgl2()) return false;
  try {
    const { GardenScene } = await import("../scene/garden.js");
    scene = new GardenScene(canvas, QUALITY[saved.quality], sceneSettings());
    resize();
    await scene.prepare();
    return true;
  } catch (e) {
    console.warn("garden: the 3D picture could not start; showing the plain garden", e);
    scene?.dispose();
    scene = null;
    return false;
  }
}

/** Swaps in a fresh canvas for the 2D painting (a canvas keeps the first kind of context it gave). */
function startFlat() {
  const next = document.createElement("canvas");
  next.id = "garden";
  next.setAttribute("role", "img");
  next.setAttribute("aria-label", canvas.getAttribute("aria-label") ?? "");
  next.textContent = canvas.textContent;
  canvas.replaceWith(next);
  canvas = next;
  flat = new Fallback2D(canvas);
  exhibit.dataset.renderer = "2d";
  $("picture")
    .querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select")
    .forEach((el) => (el.disabled = true));
  $("picture-note").textContent =
    "Your browser is showing the plain garden (WebGL 2 is unavailable). The fly's life is the same.";
  resize();
}

function resize() {
  const r = stage.getBoundingClientRect();
  if (scene) scene.resize(r.width, r.height, adaptive.dpr);
  else flat?.resize(r.width, r.height, window.devicePixelRatio || 1);
}
new ResizeObserver(resize).observe(stage);

const intervalAt: IntervalAt = (t) => (paused ? paused.iv : timeline.at(t));

let lastRaf = 0;
let drewLast = false;
let slowFrames = 0;
let lastStepDown = -Infinity;

function frame(now: number) {
  requestAnimationFrame(frame);
  const live = presentation.tick(now, serverClock.now(now));
  if (live === null) return;
  const t = paused ? paused.t : live;
  shownAt = t;
  if (scene) {
    if (presentation.jumped) scene.invalidate();
    const elapsed = now - lastRaf;
    const pic = scene.render(intervalAt, t, now);
    // A frame's cost shows as the time to the next display frame after a drawn one.
    if (drewLast && adaptive.sample(elapsed)) resize();
    if (drewLast) watchSpeed(elapsed);
    drewLast = pic.drawn;
    if (pic.drawn) {
      lastPicture = pic;
      if (!firstPicture) reveal();
      place(pic);
    }
  } else if (flat && now - lastRaf > 30) {
    const state = paused ? (paused.iv?.next ?? null) : timeline.stateAt(t);
    const at = flat.draw(
      state,
      now,
      saved.camera !== "observation",
      reduced,
      paused !== null,
    );
    if (state && !firstPicture) reveal();
    placeFlat(at);
  } else return;
  lastRaf = now;
}

/** On a device that cannot keep up even at its lowest resolution, step down one preset (once in a while). */
function watchSpeed(ms: number) {
  const q = QUALITY[saved.quality];
  const atFloor = adaptive.dpr <= q.minDpr + 0.01;
  slowFrames =
    atFloor && ms > q.budgetMs * 1.8 && ms < 250
      ? slowFrames + 1
      : Math.max(0, slowFrames - 1);
  if (slowFrames < 90 || performance.now() - lastStepDown < 20_000) return;
  slowFrames = 0;
  lastStepDown = performance.now();
  const next: QualityName | null =
    saved.quality === "high"
      ? "balanced"
      : saved.quality === "balanced"
        ? "performance"
        : null;
  if (!next) return;
  setQuality(next);
  $("picture-note").textContent =
    `Switched to ${QUALITY[next].label} to keep the garden smooth on this device. These settings change only your picture.`;
}

function reveal() {
  firstPicture = true;
  $("curtain").hidden = true;
}

function place(pic: Picture) {
  const fly = pic.fly;
  const unavailable = pic.flyStatus === "unavailable";
  const show =
    !!fly &&
    fly.inFrame &&
    (saved.camera === "observation" || saved.camera === "free" || unavailable) &&
    fly.length < 24;
  locator.hidden = !show;
  if (show && fly)
    locator.style.transform = `translate(${fly.x.toFixed(1)}px, ${fly.y.toFixed(1)}px)`;
}

function placeFlat(at: [number, number] | null) {
  locator.hidden = !at || saved.camera !== "observation";
  if (at)
    locator.style.transform = `translate(${at[0].toFixed(1)}px, ${at[1].toFixed(1)}px)`;
}

// ---------------------------------------------------------------- controls

function setCamera(mode: CameraMode) {
  saved.camera = mode;
  save();
  exhibit.dataset.camera = mode;
  document
    .querySelectorAll<HTMLButtonElement>(".lenses button")
    .forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.camera === mode)));
  scene?.update({ camera: mode });
  const hint = $("hint");
  hint.hidden = mode !== "free";
  if (mode === "free") window.setTimeout(() => (hint.hidden = true), 7000);
}

function setQuality(q: QualityName) {
  saved.quality = q;
  save();
  adaptive = new AdaptiveResolution(QUALITY[q], window.devicePixelRatio || 1);
  scene?.setQuality(QUALITY[q]);
  resize();
  syncPictureForm();
}

function syncPictureForm() {
  const form = $<HTMLFormElement>("picture");
  form
    .querySelectorAll<HTMLInputElement>('input[name="quality"]')
    .forEach((r) => (r.checked = r.value === saved.quality));
  (form.elements.namedItem("stop-motion") as HTMLInputElement).checked = saved.stopMotion;
  const fps = form.elements.namedItem("fps") as HTMLSelectElement;
  fps.value = String(saved.fps);
  fps.disabled = !saved.stopMotion || !!flat;
  (form.elements.namedItem("motion-blur") as HTMLInputElement).checked = saved.motionBlur;
}

document.querySelectorAll<HTMLButtonElement>(".lenses button").forEach((b) =>
  b.addEventListener("click", () => {
    const mode = b.dataset.camera;
    if ((CAMERAS as readonly (string | undefined)[]).includes(mode))
      setCamera(mode as CameraMode);
  }),
);

locator.addEventListener("click", () => setCamera("tracking"));

$("pause").addEventListener("click", () => {
  if (paused) {
    paused = null;
    scene?.invalidate();
  } else if (shownAt !== null) paused = { t: shownAt, iv: timeline.at(shownAt) };
  const b = $("pause");
  b.setAttribute("aria-pressed", String(paused !== null));
  b.textContent = paused ? "Resume view" : "Pause view";
  words(true);
});

$("picture-toggle").addEventListener("click", () => {
  const form = $("picture");
  form.hidden = !form.hidden;
  $("picture-toggle").setAttribute("aria-expanded", String(!form.hidden));
});

$("picture").addEventListener("change", (e) => {
  const el = e.target as HTMLInputElement | HTMLSelectElement;
  if (el.name === "quality" && isQualityName(el.value)) setQuality(el.value);
  else if (el.name === "stop-motion") saved.stopMotion = (el as HTMLInputElement).checked;
  else if (el.name === "fps") saved.fps = clampFps(Number(el.value));
  else if (el.name === "motion-blur") saved.motionBlur = (el as HTMLInputElement).checked;
  save();
  syncPictureForm();
  scene?.update(sceneSettings());
});
$("picture").addEventListener("submit", (e) => e.preventDefault());

function setPanel(open: boolean) {
  saved.panel = open;
  save();
  exhibit.dataset.panel = open ? "open" : "closed";
  $("panel-toggle").setAttribute("aria-expanded", String(open));
  $("panel-body").hidden = !open;
}
$("panel-toggle").addEventListener("click", () => setPanel(!saved.panel));
document
  .querySelector<HTMLAnchorElement>(".skip-link")
  ?.addEventListener("click", () => setPanel(true));

$("retry").addEventListener("click", () => void poll());

motionQuery.addEventListener("change", (e) => {
  reduced = e.matches;
  scene?.update({ reducedMotion: reduced });
});

// ------------------------------------------------------------------ words

let lastWords = 0;
let lastStateKey = "";
let lastDescribed = "";

const setText = (id: string, text: string) => {
  const el = $(id);
  if (el.textContent !== text) el.textContent = text;
};

function showLifeChange() {
  const change = timeline.lifeChanges.at(-1);
  if (!change) return;
  const el = $("life-change");
  el.hidden = false;
  el.textContent =
    `The server is now reporting a different individual (${change.to.lifeId.slice(0, 8)}, begun ${dayText(change.to.bornAt)}) ` +
    `in place of ${change.from.lifeId.slice(0, 8)}. This page shows what the server reports and does not blend the two.`;
}

/** The label, status and panel; at most once a second unless something changed. */
function words(force = false) {
  const now = performance.now();
  if (!force && now - lastWords < 1000) return;
  lastWords = now;
  const serverNow = serverClock.now(now);
  if (serverNow !== null) setText("clock", clockText(serverNow));
  const t = shownAt;
  const state: Observation | null = paused
    ? (paused.iv?.next ?? null)
    : t !== null
      ? timeline.stateAt(t)
      : timeline.latest();
  const latest = timeline.latest();
  const iv = t !== null ? timeline.at(t) : null;
  const status = statusOf({
    paused: paused !== null,
    failures: poller.consecutiveFailures,
    sinceAnswer: lastAnswerMs === null ? null : (now - lastAnswerMs) / 1000,
    newestAge: latest && serverNow !== null ? serverNow - latest.updatedAt : null,
    late: iv?.late ?? 0,
  });
  const pill = $("status");
  pill.dataset.state = status.state;
  setText("status-text", status.text);
  setText("now-status", status.text);
  setText("now-detail", status.detail);
  if (!firstPicture) {
    const failing = poller.consecutiveFailures > 0;
    setText(
      "curtain-text",
      failing
        ? "The garden is taking a moment to answer. The fly's life continues on the server."
        : "Opening a window into the garden…",
    );
    $("retry").hidden = !failing;
  }
  if (!state) return;
  setText("weather", weatherOf(state));
  setText(
    "weather-source",
    state.weather.source === "seasonal"
      ? " (a seasonal estimate while live weather is unavailable)"
      : "",
  );
  if (serverNow !== null) {
    const life = lifeOf(state, serverNow);
    setText("life-age", life.age);
    setText("life-born", life.born);
    setText("life-journeys", life.journeys);
    setText("life-places", life.places);
    setText("life-memories", life.memories);
    setText("life-identity", life.identity);
  }
  const key = `${state.lifeId}|${state.ticks}`;
  if (key === lastStateKey && !force) return;
  lastStateKey = key;
  const label = labelOf(state);
  setText("placard-kicker", label.kicker);
  setText("placard-place", label.place);
  setText("placard-line", label.line);
  setText("now-behaviour", label.activity);
  setText("now-place", label.place);
  const described = sceneDescription(state, paused !== null);
  if (described !== lastDescribed) {
    lastDescribed = described;
    canvas.setAttribute("aria-label", described);
  }
  renderMemories(state);
  renderLearned(state);
  renderEstablished(state.activity);
}

let memoryKey = "";
function renderMemories(state: Observation) {
  const list = memoriesOf(state.moments);
  const key = list.map((m) => m.key).join(",");
  if (key === memoryKey) return;
  memoryKey = key;
  const ol = $("memories");
  const items = list.map((m) => {
    const li = document.createElement("li");
    const time = document.createElement("time");
    time.dateTime = m.iso;
    time.title = m.title;
    time.textContent = m.time;
    const p = document.createElement("p");
    p.textContent = m.text;
    li.append(time, p);
    return li;
  });
  if (!items.length) {
    const li = document.createElement("li");
    li.className = "waiting";
    li.textContent = "No memories reported with this state.";
    items.push(li);
  }
  ol.replaceChildren(...items);
}

function renderLearned(state: Observation) {
  const l = learnedOf(state.learning);
  const ul = $("learned-movement");
  if (!l) {
    ul.replaceChildren(
      Object.assign(document.createElement("li"), {
        textContent: "The server did not report learning with this state.",
      }),
    );
    return;
  }
  ul.replaceChildren(
    ...l.movement.map((m) =>
      Object.assign(document.createElement("li"), { textContent: m }),
    ),
  );
  setText("learned-trials", l.trials);
  setText("learned-error", l.error);
  setText("learned-surprises", l.surprises);
  setText("learned-condition", l.condition);
  setText("learned-last", l.last ? `Last movement: ${l.last}.` : "");
  setText("learned-body", `Its modelled body: ${l.body}.`);
  setText("learned-others", l.others);
}

let establishedKey = "";
function renderEstablished(activity: string) {
  const notes = establishedFor(activity);
  const key = notes.map((n) => n.title).join("|");
  if (key === establishedKey) return;
  establishedKey = key;
  $("established").replaceChildren(
    ...notes.map((n) => {
      const div = document.createElement("div");
      div.className = "note";
      const h = document.createElement("h4");
      h.textContent = n.title;
      const p = document.createElement("p");
      p.textContent = n.text;
      const cite = document.createElement("cite");
      const a = document.createElement("a");
      a.href = n.source.href;
      a.target = "_blank";
      a.rel = "noreferrer";
      a.textContent = n.source.text;
      cite.append(a);
      div.append(h, p, cite);
      return div;
    }),
  );
}

// ------------------------------------------------------------------ start

setCamera(saved.camera);
setPanel(saved.panel);
syncPictureForm();
words(true);
void poll();
window.setInterval(() => words(), 1000);
void (async () => {
  if (!(await start3D())) startFlat();
  if (scene) {
    // A lost GPU context that never comes back leaves the plain garden.
    canvas.addEventListener("webglcontextlost", () => {
      window.setTimeout(() => {
        if (scene?.lost) {
          scene.dispose();
          scene = null;
          startFlat();
        }
      }, 5000);
    });
  }
  requestAnimationFrame(frame);
  if (new URLSearchParams(location.search).has("debug"))
    Object.assign(window, {
      garden: {
        timeline,
        presented: () => shownAt,
        scene: () => scene,
        picture: () => lastPicture,
        adaptive: () => adaptive,
      },
    });
})();
