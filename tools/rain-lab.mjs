#!/usr/bin/env node
/**
 * The R.A.I.N. Lab, end to end, against the artifact that ships.
 *
 * Serves `vite preview` (security headers included) and drives the hidden lab
 * in a headless browser, on three previews of its own:
 *
 * - **OFFLINE** (`RAIN_RUNTIME=off`): the lab must stay unloaded and
 *   unmentioned until found; open by its phrase and by its coordinates; say
 *   OFFLINE and send nothing else; label its DEMO as a recording; refuse a
 *   wrong authorization; run a matched experiment in a worker while Bethesda
 *   keeps its own time; verify that experiment by replay without contacting
 *   anything; refuse a tampered record; re-verify an exported record in a
 *   fresh browser; walk a perspective to a place and record what the
 *   simulator saw; pass axe in every room; keep every room usable without
 *   WebGL.
 * - **LIVE** (nothing configured): the research runtime runs inside the
 *   site's server process. The lab must show the runtime's identity, hold a
 *   meeting from the offline engine through the site's route, pre-register
 *   an experiment and report it to the runtime's registry, and, when the
 *   server stops answering, show the failure — never the DEMO.
 * - **MODEL** (`RAIN_MEETING_ENGINE=model`): a model meeting against
 *   `tools/stand-in-model.mjs`, a test double on loopback that quotes the
 *   corpus and claims nothing. The lab must show progress and no words while
 *   it runs, then the model's turns labelled as the model's, the runtime's
 *   fixed closing line as the runtime's, no invented grade or verdict, and a
 *   stop that stops it.
 *
 * Jev is a paid remote engine and is never consulted unless JEV_LIVE_TEST=1
 * (with TYPESAFE_API_KEY): then the MODEL preview also lets R.A.I.N.'s router
 * ask Jev (RAIN_DECISION_MODE=jev, RAIN_DECISION_REMOTE_ALLOWED=true) and one
 * decision is requested — one TypeSafe call, made by the server, never by the
 * browser. Jev's answer is shown as returned; R.A.I.N. decides what to do with it.
 *
 *   bun run build && node tools/rain-lab.mjs
 *   JEV_LIVE_TEST=1 TYPESAFE_API_KEY=… node tools/rain-lab.mjs
 */
import puppeteer from "puppeteer";
import { spawn } from "node:child_process";
import { openSync, readdirSync, rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const require = createRequire(import.meta.url),
  axeSource = await readFile(require.resolve("axe-core/axe.min.js"), "utf8");
const demoMeeting = JSON.parse(
  await readFile(
    new URL("../src/bethesda/rain/fixtures/demo-meeting.json", import.meta.url),
  ),
);
const OUT = "shots/rain-lab";
const OFFLINE = { port: 4185 },
  LIVE = { port: 4186 },
  MODEL = { port: 4187, standIn: 4189 };
/** Jev spends credit: it is consulted only when this is set, and then once. */
const jevLive = process.env.JEV_LIVE_TEST === "1";
const children = [];
const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " " + detail : ""}`);
};

/** Environment without any R.A.I.N. setting, so each preview is configured here and only here. */
const unconfigured = () =>
  Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("RAIN_")));
/** A preview's environment: the runtime's settings as given, and no TypeSafe key unless Jev may be asked. */
const previewEnv = (settings = {}) => {
  const env = { ...unconfigured(), ...settings };
  if (env.RAIN_DECISION_REMOTE_ALLOWED !== "true") delete env.TYPESAFE_API_KEY;
  return env;
};
/** A child's output, kept for a failure's post-mortem. */
const logTo = (name) => {
  const fd = openSync(`${OUT}/${name}.log`, "w");
  return ["ignore", fd, fd];
};
/** The scratch registries this run's runtimes create, removed when it ends. */
const scratchRegistries = () =>
  readdirSync(tmpdir()).filter((n) => n.startsWith("rain-registry-"));
const registriesBefore = new Set(scratchRegistries());
function preview(name, port, env) {
  const child = spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
    { stdio: logTo(`preview-${name}`), env },
  );
  children.push(child);
  return { origin: `http://127.0.0.1:${port}`, child };
}
async function listening(url) {
  for (let i = 0; i < 200; i++) {
    try {
      if ((await fetch(url)).ok) return true;
    } catch {
      /* Not listening yet. */
    }
    await delay(100);
  }
  throw new Error(`nothing answered at ${url}`);
}
const status = async (origin) => (await fetch(origin + "/api/rain/status")).json();

const isRain = (u) => {
  try {
    return new URL(u).pathname.startsWith("/api/rain/");
  } catch {
    return false;
  }
};
const rainPath = (u) => new URL(u).pathname;
const isLabChunk = (u) => /\/assets\/LabApp-[^/]+\.js/.test(u);

/** A page with its requests, errors, CSP reports and saved files recorded. */
async function open(context, { webgl = true, phone = false } = {}) {
  const page = await context.newPage();
  page.setDefaultTimeout(120000);
  await page.setViewport(
    phone
      ? { width: 390, height: 844, isMobile: true, hasTouch: true }
      : { width: 1100, height: 760 },
  );
  const log = { requests: [], errors: [] };
  page.on("request", (r) => log.requests.push(r.url()));
  page.on("pageerror", (e) => log.errors.push(String(e)));
  await page.evaluateOnNewDocument((webgl) => {
    Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 4 });
    globalThis.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      globalThis.__csp.push(`${e.effectiveDirective} ${e.blockedURI}`),
    );
    // Files the page offers to save are captured here instead of saved.
    globalThis.__saved = [];
    const blobs = new Map();
    const create = URL.createObjectURL;
    URL.createObjectURL = function (object) {
      const url = create.call(this, object);
      if (object instanceof Blob && object.type === "application/json")
        blobs.set(url, object.text());
      return url;
    };
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download && blobs.has(this.href)) {
        const name = this.download;
        void blobs.get(this.href).then((text) => globalThis.__saved.push({ name, text }));
        return;
      }
      return click.call(this);
    };
    if (!webgl) {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        if (type === "webgl" || type === "webgl2" || type === "experimental-webgl")
          return null;
        return getContext.call(this, type, ...args);
      };
    }
  }, webgl);
  const waitFor = (predicate, timeout = 120000, ...args) =>
    page.waitForFunction(predicate, { polling: 100, timeout }, ...args);
  const text = () => page.evaluate(() => document.body.innerText);
  const click = (name) =>
    page.evaluate((name) => {
      const b = [...document.querySelectorAll("button")].find(
        (b) => b.textContent.trim() === name,
      );
      if (!b) throw new Error("Missing button: " + name);
      b.click();
    }, name);
  const clickStarting = (prefix) =>
    page.evaluate((prefix) => {
      const b = [...document.querySelectorAll("button")].find((b) =>
        b.textContent.trim().startsWith(prefix),
      );
      if (!b) throw new Error("Missing button: " + prefix + "…");
      b.click();
    }, prefix);
  /** A form control inside the panel section titled `section`, by its label. */
  const control = async (section, label, tag) => {
    const handle = await page.evaluateHandle(
      (section, label, tag) => {
        const s = [...document.querySelectorAll("section[aria-labelledby]")].find(
          (x) => x.querySelector("h3")?.textContent.trim() === section,
        );
        return [...(s ?? document).querySelectorAll("label")]
          .find((l) => l.textContent.trim().startsWith(label))
          ?.querySelector(tag);
      },
      section,
      label,
      tag,
    );
    const element = handle.asElement();
    if (!element) throw new Error(`Missing ${tag} “${label}” in ${section}`);
    return element;
  };
  const type = async (element, value) => {
    await element.click({ count: 3 });
    await page.keyboard.press("Backspace");
    await element.type(value);
  };
  const axe = async (where) => {
    await page.evaluate(axeSource);
    const violations = await page.evaluate(async () => {
      const result = await globalThis.axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
        resultTypes: ["violations"],
      });
      return result.violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => ({ id: v.id, targets: v.nodes.slice(0, 4).map((n) => n.target) }));
    });
    check(
      `axe: ${where} has no serious or critical violations`,
      !violations.length,
      JSON.stringify(violations),
    );
  };
  const rain = () => log.requests.filter(isRain).map(rainPath);
  const tick = async () => Number(/Bethesda tick (\d+)/.exec(await text())?.[1]);
  const saved = async (name) => {
    await waitFor(
      (name) => globalThis.__saved.some((f) => f.name.startsWith(name)),
      30000,
      name,
    );
    return page.evaluate(
      (name) => globalThis.__saved.find((f) => f.name.startsWith(name)).text,
      name,
    );
  };
  return {
    page,
    log,
    waitFor,
    text,
    click,
    clickStarting,
    control,
    type,
    axe,
    rain,
    tick,
    saved,
  };
}

async function enterBethesda(s, origin) {
  await s.page.goto(origin + "/?quality=1", { waitUntil: "domcontentloaded" });
  // The twin is up: its HUD, or without WebGL the fallback that stands in for it.
  await s.waitFor(
    () =>
      document.body.innerText.includes("EVIDENCE TIMELINE") ||
      document.body.innerText.includes("could not start WebGL"),
  );
  await s.page.keyboard.press("Backquote");
  await s.page.waitForSelector("#anomaly-coordinate");
  await s.page.focus("#anomaly-coordinate");
  await s.page.keyboard.sendCharacter("38.9847,-77.0947");
  await s.page.keyboard.press("Enter");
  await s.page.waitForSelector('[data-bethesda="active"]');
}
async function telemetry(s, line) {
  await s.click("~ telemetry");
  await s.page.waitForSelector("#city-event");
  await s.page.focus("#city-event");
  await s.page.keyboard.sendCharacter(line);
  await s.page.keyboard.press("Enter");
}
async function enterLab(s, line = "resolve r.a.i.n.") {
  await telemetry(s, line);
  await s.page.waitForSelector('[data-rain-lab="active"]');
  await s.waitFor(
    () =>
      /RUNTIME (OFFLINE|LIVE)/.test(document.body.innerText) &&
      !document.body.innerText.includes("Runtime: checking"),
  );
}
/** R.A.I.N.'s resonance state, as the lab root states it. */
const resonance = (s) =>
  s.page.evaluate(() =>
    document.querySelector('[data-rain-lab="active"]')?.getAttribute("data-resonance"),
  );
/** Every resonance state the lab passes through from now on, in order. */
const followResonance = (s) =>
  s.page.evaluate(() => {
    const root = document.querySelector('[data-rain-lab="active"]');
    const seen = (globalThis.__resonance = [root.getAttribute("data-resonance")]);
    new MutationObserver(() => {
      const v = root.getAttribute("data-resonance");
      if (v !== seen.at(-1)) seen.push(v);
    }).observe(root, { attributes: true, attributeFilter: ["data-resonance"] });
  });
/** Waits for rendered frames, not time: under software WebGL a frame takes long. */
const frames = (s, n) =>
  s.page.evaluate(
    (n) =>
      new Promise((done) => {
        let i = 0;
        const f = () => (++i >= n ? done() : requestAnimationFrame(f));
        requestAnimationFrame(f);
      }),
    n,
  );
async function authorize(s) {
  await s.click("Experiment Bay");
  await s.click("Load the DEMO's scripted proposal");
  await s.waitFor(() => document.body.innerText.includes("AWAITING HUMAN APPROVAL"));
  const sha = await s.page.evaluate(
    () => document.querySelector("aside code.break-all")?.textContent ?? "",
  );
  // The authorization block is not a titled section; its label is unique in the panel.
  const prefix = await s.control("", "First 8 characters", "input");
  return { sha, prefix };
}
async function ask(s, question) {
  await s.click("Research Panel");
  await s.page.waitForSelector("#rain-question");
  await s.page.focus("#rain-question");
  await s.page.keyboard.sendCharacter(question);
  await s.click("Ask R.A.I.N.");
}

let browser;
try {
  await mkdir(OUT, { recursive: true });
  const { origin } = preview(
    "offline",
    OFFLINE.port,
    previewEnv({ RAIN_RUNTIME: "off" }),
  );
  await listening(origin);
  {
    const s = await status(origin);
    if (s.configured !== false || s.failure !== null)
      throw new Error(
        "the OFFLINE preview did not switch its runtime off; see the console",
      );
  }
  browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-gl=angle"],
  });

  // --- Discovery, OFFLINE and DEMO ---------------------------------------------------
  const a = await open(browser.defaultBrowserContext());
  await a.page.goto(origin + "/?quality=1", { waitUntil: "domcontentloaded" });
  await a.waitFor(() => document.body.innerText.includes("EVIDENCE TIMELINE"));
  check("the twin loads no lab code", !a.log.requests.some(isLabChunk));
  await enterBethesda(a, origin);
  await delay(1500);
  check(
    "Bethesda opens without the lab: no lab code, no R.A.I.N. request, no mention",
    !a.log.requests.some(isLabChunk) &&
      a.rain().length === 0 &&
      !(
        await a.page.evaluate(
          () => document.querySelector('[data-bethesda="active"]').innerText,
        )
      ).includes("R.A.I.N."),
  );
  await enterLab(a);
  check(
    "the phrase opens the lab and only then loads its code",
    a.log.requests.some(isLabChunk),
  );
  check(
    "the city is marked indoors and the title names the lab",
    !!(await a.page.$('[data-indoors="rain-lab"]')) &&
      (await a.page.title()).startsWith("R.A.I.N. Lab"),
  );
  check(
    "OFFLINE: the runtime is checked through the site's own route, once, and says so",
    (await a.text()).includes("RUNTIME OFFLINE") &&
      (await a.text()).includes(
        "the research runtime is switched off on this site's server",
      ) &&
      JSON.stringify(a.rain()) === JSON.stringify(["/api/rain/status"]),
    JSON.stringify(a.rain()),
  );
  check(
    "OFFLINE: R.A.I.N.'s plates lie strewn and still; nothing drives them",
    (await resonance(a)) === "idle",
    await resonance(a),
  );
  await followResonance(a);
  const entryTick = await a.tick();
  await a.axe("threshold");
  await a.click("Research Panel");
  await a.page.waitForSelector("#rain-question");
  check(
    "OFFLINE: asking is disabled and nothing is generated",
    await a.page.evaluate(
      () =>
        [...document.querySelectorAll("button")].find(
          (b) => b.textContent.trim() === "Ask R.A.I.N.",
        )?.disabled === true,
    ),
  );
  await a.click("Replay the recorded meeting (DEMO)");
  await a.waitFor(() => document.body.innerText.includes("PRERECORDED · DEMO"));
  const staged = await resonance(a);
  await a.clickStarting("Show all ");
  await a.waitFor(() => document.body.innerText.includes("WHERE THE ROOM STANDS"));
  {
    const words = await a.page.evaluate(
      () => document.getElementById("lab-resonance")?.innerText ?? "",
    );
    check(
      "the plates deliberate while the DEMO is staged and stay unresolved after it, as its partial grounding says",
      staged === "deliberating" &&
        (await resonance(a)) === "uncertain" &&
        words.includes("grounding was partial") &&
        words.includes("not evidence"),
      `${staged} → ${await resonance(a)}`,
    );
  }
  {
    const t = await a.text();
    check(
      "DEMO: labelled as a recording, scripted, sent nowhere",
      t.includes("DEMO · PRERECORDED") &&
        t.includes("SCRIPTED · NO MODEL RAN") &&
        t.includes("your question was not sent anywhere") &&
        JSON.stringify(a.rain()) === JSON.stringify(["/api/rain/status"]),
    );
    const turns = await a.page.evaluate(
      () => document.querySelector('[aria-label="Meeting turns"]').innerText,
    );
    check(
      "DEMO: the four perspectives speak the record's words, with checked sources",
      ["James", "Jasmine", "Luca", "Elena"].every((n) => turns.includes(n)) &&
        turns.includes(demoMeeting.turns[0].lead.slice(0, 60)) &&
        turns.includes("verified verbatim"),
    );
  }
  await a.axe("research panel with a meeting");
  await a.click("Evidence Library");
  await a.waitFor(() => document.querySelector('[aria-label="Evidence categories"]'));
  {
    const kinds = await a.page.evaluate(
      () => document.querySelector('[aria-label="Evidence categories"]').innerText,
    );
    check(
      "the library separates the six kinds of claim",
      [
        "SOURCE",
        "INTERPRETATION",
        "OBSERVATION",
        "SIMULATION RESULT",
        "HYPOTHESIS",
        "VALIDATED CHECK",
      ].every((k) => kinds.includes(k)),
    );
  }
  await a.axe("evidence library");

  // --- Experiment Bay: authorization, run, registry ------------------------------------
  const { sha, prefix } = await authorize(a);
  check(
    "a proposal waiting for a person stills the plates at the boundary",
    (await resonance(a)) === "awaiting-human",
    await resonance(a),
  );
  {
    const t = await a.text();
    check(
      "the bay shows the protocol before anything runs",
      [
        "QUESTION",
        "HYPOTHESIS",
        "CONTROL",
        "TREATMENT",
        "PRIMARY METRIC",
        "SEEDS",
        "FAILURE CONDITION",
        "EXPECTED OBSERVATIONS",
        "LIMITATIONS",
        "AUTHORIZATION STATUS",
      ].every((k) => t.includes(k)) &&
        t.includes("not authenticated identity") &&
        /^[0-9a-f]{64}$/.test(sha),
    );
  }
  await a.axe("experiment bay awaiting approval");
  await a.type(prefix, "00000000");
  await a.page.evaluate(() =>
    document.querySelector('aside input[type="checkbox"]').click(),
  );
  await a.click("Authorize this definition");
  await a.waitFor(() => document.querySelector('[role="alert"]'));
  check(
    "a wrong digest prefix is refused and nothing runs",
    (await a.text()).includes("AWAITING HUMAN APPROVAL") &&
      !(await a.text()).includes("EXPERIMENT RUNNING"),
  );
  await a.type(prefix, sha.slice(0, 8));
  await a.click("Authorize this definition");
  await a.waitFor(() =>
    document.body.innerText.includes(
      "Run in Bethesda (not pre-registered with R.A.I.N.)",
    ),
  );
  check(
    "the digest's own prefix authorizes, as a local operator record",
    (await a.text()).includes("Authorized by local operator R.A.I.N.Operator"),
  );
  await a.click("Run in Bethesda (not pre-registered with R.A.I.N.)");
  await a.waitFor(() => document.body.innerText.includes("EXPERIMENT RUNNING"));
  check(
    "the run starts in a worker",
    a.log.requests.some((u) => /\/assets\/experimentWorker-[^/]+\.js/.test(u)),
  );
  await a.click("Observation Room");
  await a.axe("observation room during a run");
  await a.waitFor(() => !document.body.innerText.includes("EXPERIMENT RUNNING"), 300000);
  check(
    "Bethesda kept its own time while the lab ran",
    (await a.tick()) > entryTick,
    `${entryTick} → ${await a.tick()}`,
  );
  await a.click("Registry / Archive");
  await a.waitFor(() => document.body.innerText.includes("COMPLETED · hypothesis"));
  check(
    "the registry records the demo hypothesis as COMPLETED · NOT SUPPORTED",
    (await a.text()).includes("COMPLETED · hypothesis NOT SUPPORTED"),
  );
  {
    const seen = await a.page.evaluate(() => globalThis.__resonance);
    const at = (state) => seen.indexOf(state);
    check(
      "the plates followed the runtime: deliberating, unresolved, at the boundary, running, then the result as recorded",
      at("deliberating") >= 0 &&
        at("deliberating") < at("uncertain") &&
        at("uncertain") < at("awaiting-human") &&
        at("awaiting-human") < at("experiment") &&
        at("experiment") < at("result-contradicted") &&
        seen.at(-1) === "result-contradicted",
      JSON.stringify(seen),
    );
  }
  // A visitor reaches the plates by pointing at them: the large plate opens
  // what it shows. Aim from the Research Panel's arrival: the camera at
  // (0, 1.65, 6.3), looking 0.14 rad down towards the plate's centre at
  // (0, 1.0, 3.85), through the projection the scene centred on the open room.
  await a.click("Research Panel");
  await frames(a, 8);
  {
    const [x, y] = await a.page.evaluate(() => {
      const c = document.querySelector('[data-rain-lab="active"] canvas'),
        r = c.getBoundingClientRect();
      const [cx, cy] = (c.dataset.viewCenter ?? `${r.width / 2},${r.height / 2}`)
        .split(",")
        .map(Number);
      const down =
        Math.tan(Math.atan(0.65 / 2.45) - 0.14) / Math.tan((35 * Math.PI) / 180);
      return [r.left + cx, r.top + cy + (down * r.height) / 2];
    });
    await a.page.mouse.move(x - 40, y - 30);
    await a.page.mouse.move(x, y, { steps: 4 });
    await frames(a, 3);
    await a.page.mouse.click(x, y);
    await a
      .waitFor(() => document.activeElement?.id === "lab-resonance", 30000)
      .catch(() => {});
    check(
      "pointing at R.A.I.N.'s plate and clicking it opens what it shows",
      await a.page.evaluate(
        () =>
          document.activeElement?.id === "lab-resonance" &&
          document.activeElement.innerText.includes("hypothesis NOT SUPPORTED") &&
          document.querySelector('[data-rain-lab="active"] canvas').style.cursor ===
            "pointer",
      ),
      await a.page.evaluate(() => document.activeElement?.id ?? ""),
    );
  }
  // The click is answered once: coming back to the room later leaves focus alone.
  await a.click("Registry / Archive");
  await a.click("Research Panel");
  await a.page.waitForSelector("#lab-resonance");
  await frames(a, 3);
  check(
    "a later visit to the Research Panel does not take focus again",
    await a.page.evaluate(() => document.activeElement?.id !== "lab-resonance"),
  );
  await a.click("Registry / Archive");
  await a.waitFor(() => document.body.innerText.includes("Verify by replay (no model)"));
  const beforeVerify = a.rain().length;
  await a.click("Verify by replay (no model)");
  await a.waitFor(
    () => /Verified: every arm|Verification FAILED/.test(document.body.innerText),
    300000,
  );
  check(
    "replay re-simulates every arm identically and contacts nothing",
    (await a.text()).includes(
      "Verified: every arm re-simulated identically; no model was contacted.",
    ) && a.rain().length === beforeVerify,
  );
  await a.axe("registry with a verified record");
  await a.click("Export record");
  const recordText = await a.saved("bethesda-rain-record-");
  const record = JSON.parse(recordText);
  check(
    "the exported record carries its definition, authorization, arms, outcome and provenance",
    record.schema === "bethesda-rain-experiment-record/v3" &&
      /^[0-9a-f]{64}$/.test(record.record_sha256) &&
      record.authorization?.identity_verified === false &&
      record.standing === null &&
      record.run?.arms?.length === 6 &&
      record.outcome?.state === "COMPLETED" &&
      "lop_nur_twin_commit" in record.provenance &&
      // The run followed the DEMO meeting: the R.A.I.N. revision is the one the
      // recording names, and the record says that is where it came from.
      record.provenance.rain_commit === demoMeeting.rain.commit &&
      record.provenance.rain_repository === demoMeeting.rain.repository &&
      record.provenance.rain_source === "demo-recording" &&
      record.provenance.model === null,
    JSON.stringify(record.provenance),
  );
  await writeFile(`${OUT}/record.json`, recordText);
  const tampered = { ...record, outcome: { ...record.outcome, summary: "It worked." } };
  await writeFile(`${OUT}/tampered-record.json`, JSON.stringify(tampered));
  await (
    await a.page.$('aside input[type="file"]')
  ).uploadFile(resolve(`${OUT}/tampered-record.json`));
  await a.waitFor(() => document.body.innerText.includes("nothing was imported"));
  check(
    "an edited record is refused at import",
    (await a.text()).includes("its digest does not match; nothing was imported"),
  );
  await a.click("Systems Room");
  check(
    "the Systems Room says the runtime is in this site's server, and switched off here",
    (await a.text()).includes("RAIN_RUNTIME=off"),
  );
  await a.axe("systems room");
  await a.click("Return to Bethesda");
  await a.page.waitForSelector('[data-bethesda="active"]:not([data-indoors])');
  check(
    "leaving returns to the same Bethesda",
    (await a.text()).includes("The city kept its own time while you were inside"),
  );
  // The lab's canvas released its WebGL context on the way out, as R3F does
  // half a second after an unmount; the city's must not take that for a loss.
  await delay(1500);
  check(
    "the city's 3D view is back, not replaced by the WebGL fallback",
    !(await a.text()).includes("3D rendering is unavailable") &&
      (await a.page.$$('[data-bethesda="active"] canvas')).length >= 2,
  );
  // The second entrance: the door's own coordinates, typed into the console.
  await enterLab(a, "38.98025, -77.09627");
  await a.click("Registry / Archive");
  check(
    "the door's coordinates open the lab, and its records outlive the visit",
    (await a.text()).includes("COMPLETED · hypothesis NOT SUPPORTED"),
  );
  // The lab holds a history entry above the city's: Back steps out of the lab,
  // not out of the site.
  await a.page.evaluate(() => history.back());
  await a.page.waitForSelector('[data-bethesda="active"]:not([data-indoors])');
  check(
    "the browser's Back steps out of the lab into the same city",
    (await a.text()).includes("The city kept its own time while you were inside") &&
      (await a.page.evaluate(() => location.origin)) === new URL(origin).origin,
  );
  await delay(1500);
  check(
    "a second visit leaves the 3D view intact too",
    !(await a.text()).includes("3D rendering is unavailable") &&
      (await a.page.$$('[data-bethesda="active"] canvas')).length >= 2,
  );
  check("no page errors", a.log.errors.length === 0, a.log.errors.join("\n"));
  check(
    "no CSP violations",
    (await a.page.evaluate(() => globalThis.__csp)).length === 0,
    JSON.stringify(await a.page.evaluate(() => globalThis.__csp)),
  );
  check(
    "nothing requested beyond the site",
    a.log.requests.every(
      (r) => r.startsWith(origin) || r.startsWith("data:") || r.startsWith("blob:"),
    ),
  );
  await a.page.close();

  // --- A phone: the lab walked by thumb, its panel open --------------------------------
  {
    const p = await open(await browser.createBrowserContext(), { phone: true });
    await enterBethesda(p, origin);
    await enterLab(p);
    const cdp = await p.page.createCDPSession();
    const touch = (type, points) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: points.map(([x, y, id]) => ({ x, y, id, radiusX: 4, radiusY: 4 })),
      });
    const PARTS = [
      "header",
      'nav[aria-label="Leave the lab"]',
      "[data-touch-stick]",
      'section[aria-label="Rooms"]',
      "#lab-room-panel",
      'div[role="status"].z-10',
    ];
    /**
     * The parts on screen, any two that overlap and any that leave the screen;
     * the band the room shows in (between the title and the rooms strip, left
     * of the panel when it stands down the right); and the point the camera's
     * projection is centred on, as the scene last applied it.
     */
    const layout = () =>
      p.page.evaluate((parts) => {
        const shown = parts
          .map((s) => [s, document.querySelector(s)?.getBoundingClientRect()])
          .filter(([, r]) => r && r.width > 0 && r.height > 0);
        const overlaps = [];
        for (let i = 0; i < shown.length; i++)
          for (let j = i + 1; j < shown.length; j++) {
            const [m, a] = shown[i],
              [n, b] = shown[j];
            if (
              Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
              Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1
            )
              overlaps.push(`${m} × ${n}`);
          }
        const outside = shown
          .filter(
            ([, r]) =>
              r.top < -1 ||
              r.left < -1 ||
              r.bottom > innerHeight + 1 ||
              r.right > innerWidth + 1,
          )
          .map(([s]) => s);
        const rect = (s) => document.querySelector(s).getBoundingClientRect();
        const header = rect("header"),
          rooms = rect('section[aria-label="Rooms"]'),
          panel = rect("#lab-room-panel"),
          stick = rect("[data-touch-stick]"),
          canvas = rect('[data-rain-lab="active"] canvas');
        const beside = panel.top < innerHeight / 2;
        const band = {
          left: 0,
          right: beside ? panel.left : innerWidth,
          top: header.bottom,
          bottom: rooms.top,
        };
        const [cx, cy] = (
          document.querySelector('[data-rain-lab="active"] canvas').dataset.viewCenter ??
          "NaN,NaN"
        )
          .split(",")
          .map(Number);
        return {
          size: `${innerWidth}x${innerHeight}`,
          shown: shown.map(([s]) => s),
          overlaps,
          outside,
          beside,
          band: {
            wide: Math.round(band.right - band.left),
            tall: Math.round(band.bottom - band.top),
          },
          // The stick stands in the band's lower corner, over at most half its width.
          cornered:
            stick.width === 0 ||
            (stick.left >= band.left - 1 &&
              stick.right <= (band.left + band.right) / 2 &&
              stick.bottom <= band.bottom + 1),
          centred:
            Math.abs(canvas.left + cx - (band.left + band.right) / 2) <= 2 &&
            Math.abs(canvas.top + cy - (band.top + band.bottom) / 2) <= 2,
          centre: [Math.round(canvas.left + cx), Math.round(canvas.top + cy)],
        };
      }, PARTS);
    /** Turns the phone, waiting until the camera has re-centred on the new band. */
    const turn = async (width, height) => {
      await p.page.setViewport({ width, height, isMobile: true, hasTouch: true });
      await p.waitFor(() => {
        const c = document.querySelector('[data-rain-lab="active"] canvas'),
          h = document.querySelector("header").getBoundingClientRect(),
          g = document
            .querySelector('section[aria-label="Rooms"]')
            .getBoundingClientRect();
        const y = Number(c.dataset.viewCenter?.split(",")[1]);
        return Math.abs(c.getBoundingClientRect().top + y - (h.bottom + g.top) / 2) <= 2;
      }, 60000);
    };
    const shares = (l, min) =>
      ["[data-touch-stick]", "#lab-room-panel"].every((s) => l.shown.includes(s)) &&
      l.overlaps.length === 0 &&
      l.outside.length === 0 &&
      l.band.tall >= min.tall &&
      l.band.wide >= min.wide &&
      l.cornered &&
      l.centred;
    const stickAt = () =>
      p.page.evaluate(() => {
        const r = document
          .querySelector("[data-touch-stick] > div")
          .getBoundingClientRect();
        return [r.left + r.width / 2, r.top + r.height / 2];
      });
    await turn(390, 844);
    const upright = await layout();
    const strip = await p.page.evaluate(() => {
      const s = document.querySelector('section[aria-label="Rooms"] div');
      return {
        tall: Math.round(
          document.querySelector('section[aria-label="Rooms"]').getBoundingClientRect()
            .height,
        ),
        scrolls: s.scrollWidth > s.clientWidth,
        look: (() => {
          for (
            let el = document.querySelector('[data-rain-lab="active"] canvas');
            el && el.closest('[data-rain-lab="active"]');
            el = el.parentElement
          )
            if (getComputedStyle(el).touchAction === "none") return "none";
          return "auto";
        })(),
      };
    });
    check(
      "on a phone the room, the stick, the rooms and the panel share the screen, the camera centred on the room's band",
      shares(upright, { tall: 180, wide: 300 }) && strip.look === "none",
      JSON.stringify(upright),
    );
    check(
      "the rooms are one strip that scrolls sideways",
      strip.tall <= 64 && strip.scrolls,
      JSON.stringify(strip),
    );
    // Scroll the strip to its far end first, so the room walked into starts
    // out of sight and only the strip's own scrolling can bring it back.
    const unseen = await p.page.evaluate(() => {
      const s = document.querySelector('section[aria-label="Rooms"] div');
      s.scrollLeft = s.scrollWidth;
      const r = s.getBoundingClientRect();
      return [...s.querySelectorAll("button")]
        .filter((b) => {
          const q = b.getBoundingClientRect();
          return q.right <= r.left + 1 || q.left >= r.right - 1;
        })
        .map((b) => b.textContent.trim());
    });
    const room = await p.page.evaluate(() =>
      document.querySelector("[data-lab-room]").getAttribute("data-lab-room"),
    );
    {
      const [x, y] = await stickAt();
      await touch("touchStart", [[x, y, 1]]);
      await touch("touchMove", [[x, y - 60, 1]]);
      try {
        await p.waitFor(
          (from) =>
            document.querySelector("[data-lab-room]").getAttribute("data-lab-room") !==
            from,
          180000,
          room,
        );
      } finally {
        await touch("touchEnd", []);
      }
    }
    check(
      "the stick walks from the threshold into the next room with the panel open",
      true,
      room,
    );
    {
      const walked = await p.page.evaluate(() => {
        const s = document.querySelector('section[aria-label="Rooms"] div'),
          b = s.querySelector('[aria-pressed="true"]'),
          q = b.getBoundingClientRect(),
          r = s.getBoundingClientRect();
        return {
          name: b.textContent.trim(),
          shown: q.left >= r.left - 1 && q.right <= r.right + 1,
        };
      });
      check(
        "the strip scrolls the room walked into back into view",
        unseen.includes(walked.name) && walked.shown,
        JSON.stringify({ unseen, walked }),
      );
    }
    {
      const last = await p.page.evaluate(() => {
        const s = document.querySelector('section[aria-label="Rooms"] div');
        s.scrollLeft = s.scrollWidth;
        const b = [...s.querySelectorAll("button")].at(-1),
          r = b.getBoundingClientRect();
        return {
          name: b.textContent.trim(),
          x: r.left + r.width / 2,
          y: r.top + r.height / 2,
        };
      });
      await p.page.touchscreen.tap(last.x, last.y);
      await p.waitFor(
        (name) => document.querySelector("h1")?.textContent.trim() === name,
        30000,
        last.name,
      );
      check("a tap on the strip opens that room", true, last.name);
    }
    // On its side the panel moves to the right and the stick and the strip to
    // the left; a small phone on its side is the tightest fit of all.
    const sideways = [];
    for (const [w, h] of [
      [844, 390],
      [568, 320],
    ]) {
      await turn(w, h);
      sideways.push(await layout());
    }
    check(
      "on its side, the room, the stick, the strip and the panel still share the screen",
      sideways.every((l) => l.beside && shares(l, { tall: 120, wide: 300 })),
      JSON.stringify(sideways),
    );
    await turn(390, 844);
    // The door back is a button a finger can press: walk backwards from the
    // threshold to it, then tap it with a real touch, not a scripted click.
    await p.click("Threshold");
    {
      const [x, y] = await stickAt();
      await touch("touchStart", [[x, y, 1]]);
      await touch("touchMove", [[x, y + 60, 1]]);
      try {
        await p.waitFor(
          () =>
            [...document.querySelectorAll("button")].some(
              (b) => b.textContent.trim() === "Open it",
            ),
          180000,
        );
      } finally {
        await touch("touchEnd", []);
      }
    }
    // Upright the prompt stands in the band above the stick; on its side,
    // under the title, beside the stick.
    const atDoor = [];
    for (const [w, h] of [
      [568, 320],
      [844, 390],
      [390, 844],
    ]) {
      await turn(w, h);
      atDoor.push(await layout());
    }
    check(
      "the door's prompt stands in the open room, on nothing else, upright or on its side",
      atDoor.every(
        (l) =>
          l.shown.includes('div[role="status"].z-10') &&
          l.overlaps.length === 0 &&
          l.outside.length === 0,
      ),
      JSON.stringify(atDoor),
    );
    const door = await p.page.evaluate(() => {
      const r = [...document.querySelectorAll("button")]
        .find((b) => b.textContent.trim() === "Open it")
        .getBoundingClientRect();
      return [r.left + r.width / 2, r.top + r.height / 2];
    });
    await p.page.touchscreen.tap(door[0], door[1]);
    await p.page.waitForSelector('[data-bethesda="active"]:not([data-indoors])');
    check("pulling the stick back reaches the door, and a tap on it steps outside", true);
    check(
      "no page errors on the phone",
      p.log.errors.length === 0,
      p.log.errors.join("\n"),
    );
    await p.page.close();
  }

  // --- A fresh browser without WebGL: import, replay, outings, tools ---------------------
  const fresh = await browser.createBrowserContext();
  const b = await open(fresh, { webgl: false });
  await enterBethesda(b, origin);
  await b.waitFor(() => document.body.innerText.includes("3D rendering is unavailable"));
  await enterLab(b);
  check(
    "without WebGL the lab says so and keeps every room",
    (await b.text()).includes(
      "Every room and every capability remains available in the panels.",
    ),
  );
  await b.click("Research Panel");
  await b.page.waitForSelector("#lab-resonance");
  check(
    "without WebGL R.A.I.N.'s resonance is still stated, in words",
    await b.page.evaluate(() => {
      const t = document.getElementById("lab-resonance").innerText;
      return t.includes("R.A.I.N.'S RESONANCE") && t.includes("not evidence");
    }),
  );
  await b.click("Registry / Archive");
  await b.waitFor(() => document.body.innerText.includes("No records yet"));
  const beforeImport = b.rain().length;
  await (
    await b.page.$('aside input[type="file"]')
  ).uploadFile(resolve(`${OUT}/record.json`));
  await b.waitFor(
    () => /Verified: every arm|Verification FAILED/.test(document.body.innerText),
    300000,
  );
  check(
    "an exported record re-verifies in a fresh browser, contacting nothing",
    (await b.text()).includes("Verified: every arm re-simulated identically") &&
      b.rain().length === beforeImport,
  );
  await b.click("Observation Room");
  await (
    await b.control("PERSPECTIVES IN THE CITY", "Place", "select")
  ).select("woodmont_bethesda");
  await b.click("Send to observe");
  await b.waitFor(() => document.body.innerText.includes("is walking"));
  await b.click("Inspect");
  await b.waitFor(() =>
    document.querySelector("aside pre")?.textContent.includes("bethesda-tool-result/v1"),
  );
  {
    const result = JSON.parse(
      await b.page.evaluate(() => document.querySelector("aside pre").textContent),
    );
    check(
      "a tool reads the simulator and names its tick and state hash",
      result.ok === true &&
        result.provenance.source === "bethesda-simulator" &&
        /^[0-9a-f]{16}$/.test(result.provenance.world_hash),
    );
  }
  await b.type(await b.control("BOUNDED OBSERVATION TOOLS", "Radius", "input"), "999");
  await b.click("Inspect");
  await b.waitFor(() =>
    document.querySelector("aside pre")?.textContent.includes('"ok": false'),
  );
  check(
    "a tool refuses an out-of-bounds request",
    (
      await b.page.evaluate(() => document.querySelector("aside pre").textContent)
    ).includes("radius must be"),
  );
  await b.axe("observation room with an outing");
  await b.waitFor(
    () => document.body.innerText.includes("the simulator recorded an observation"),
    240000,
  );
  await b.click("Evidence Library");
  check(
    "the walk ends in an observation the simulator made, in the library",
    (await b.text()).includes("requested by Luca") &&
      (await b.text()).includes("the avatar's position is not evidence"),
  );
  check(
    "no page errors without WebGL",
    b.log.errors.length === 0,
    b.log.errors.join("\n"),
  );
  check(
    "no CSP violations without WebGL",
    (await b.page.evaluate(() => globalThis.__csp)).length === 0,
  );
  await b.page.close();
  await fresh.close();

  // --- LIVE, against the research runtime in the site's own server ------------------------
  {
    const live = preview("live", LIVE.port, previewEnv());
    await listening(live.origin);
    const s = await status(live.origin);
    check(
      "LIVE: with nothing configured the runtime is on, offline engine, no decisions, no remote engine",
      s.configured === true &&
        s.identity?.runtime?.name === "lop-nur-twin-rain" &&
        s.identity?.rain?.repository === "topherchris420/lop-nur-twin" &&
        /^[0-9a-f]{40}$/.test(s.identity?.rain?.commit ?? "") &&
        s.identity?.meeting_engine === "rain.meeting.offline.buildOfflineMeeting" &&
        s.identity?.meeting_generation === "scripted" &&
        s.identity?.model === null &&
        s.identity?.bounded_decision === "off" &&
        s.identity?.remote_decisions === false &&
        s.identity?.corpus?.files > 0,
      "see the console for the status the route answered",
    );
    console.log("LIVE status:", JSON.stringify(s).slice(0, 400));
    const identity = s.identity;
    const context = await browser.createBrowserContext();
    const c = await open(context);
    await enterBethesda(c, live.origin);
    await enterLab(c);
    check(
      "LIVE: the runtime names this repository and its commit",
      (await c.text()).includes("RUNTIME LIVE") &&
        (await c.text()).includes("topherchris420/lop-nur-twin") &&
        (await c.text()).includes(identity.rain.commit.slice(0, 7)),
    );
    await c.axe("threshold, LIVE");
    await ask(c, demoMeeting.question);
    await c.waitFor(
      () => document.body.innerText.includes("R.A.I.N.'s offline engine answered"),
      90000,
    );
    {
      const t = await c.text();
      check(
        "LIVE: the offline engine answers through the site's route, scripted and labelled",
        t.includes("SCRIPTED · NO MODEL RAN") &&
          !t.includes("PRERECORDED · DEMO") &&
          c.rain().filter((p) => p === "/api/rain/meeting").length === 1,
      );
      check(
        "LIVE: the DEMO question gives the DEMO meeting, word for word, by id",
        t.includes(demoMeeting.meeting_id),
      );
    }
    const { sha: liveSha, prefix: livePrefix } = await authorize(c);
    await c.type(livePrefix, liveSha.slice(0, 8));
    await c.page.evaluate(() =>
      document.querySelector('aside input[type="checkbox"]').click(),
    );
    await c.click("Authorize this definition");
    await c.waitFor(() =>
      document.body.innerText.includes(
        "Pre-register with R.A.I.N., run, and report the measurements",
      ),
    );
    await c.click("Pre-register with R.A.I.N., run, and report the measurements");
    await c.waitFor(
      () => document.body.innerText.includes("pre-registered with R.A.I.N. as"),
      60000,
    );
    await c.waitFor(
      () => !document.body.innerText.includes("EXPERIMENT RUNNING"),
      300000,
    );
    await c.click("Registry / Archive");
    await c.waitFor(
      () => document.body.innerText.includes("R.A.I.N.'S OWN RECORD"),
      60000,
    );
    check(
      "LIVE: the runtime pre-registers the experiment and records its own evaluation",
      c.rain().filter((p) => p === "/api/rain/preregister").length === 1 &&
        c.rain().filter((p) => p === "/api/rain/submission").length === 1 &&
        (await c.text()).includes("V3D-EXP-0001"),
      JSON.stringify(c.rain()),
    );
    await c.click("Export record");
    const liveRecord = JSON.parse(await c.saved("bethesda-rain-record-"));
    // The proposal was the DEMO's, so the record keeps the recording's revision as
    // the R.A.I.N. provenance it followed; the runtime's own pre-registration and
    // record sit beside it, from the server this site runs.
    check(
      "LIVE: a run of the DEMO's proposal keeps the recording's provenance, with the runtime's pre-registration beside it",
      liveRecord.provenance.rain_source === "demo-recording" &&
        liveRecord.provenance.rain_commit === demoMeeting.rain.commit &&
        liveRecord.provenance.rain_repository === demoMeeting.rain.repository &&
        liveRecord.rain_preregistration?.experiment_id === "V3D-EXP-0001" &&
        liveRecord.rain_admission !== null &&
        liveRecord.rain_admission !== undefined,
      JSON.stringify({
        provenance: liveRecord.provenance,
        preregistration: liveRecord.rain_preregistration ?? null,
        admission: liveRecord.rain_admission
          ? Object.keys(liveRecord.rain_admission)
          : null,
      }).slice(0, 600),
    );
    await c.axe("registry with R.A.I.N.'s own record");
    // The mathematical substrate, LIVE: a search, an inspected family, a citation
    // with a stated assumption, and the basis in the protocol a person reviews —
    // context for a hypothesis, labelled as such, and never in the evidence.
    {
      const math = await (await fetch(live.origin + "/api/rain/math-status")).json();
      check(
        "LIVE: the runtime serves the pinned openai/math substrate",
        math.available === true &&
          math.substrate?.repository === "openai/math" &&
          /^[0-9a-f]{40}$/.test(math.substrate?.commit ?? "") &&
          math.substrate?.counts?.families > 0,
        JSON.stringify(math).slice(0, 300),
      );
      await c.click("Research Panel");
      await c.waitFor(() => document.body.innerText.includes("MATHEMATICAL SUBSTRATE"));
      await c.type(
        await c.control("MATHEMATICAL SUBSTRATE", "Question for the substrate", "input"),
        "percolation on random graphs",
      );
      await c.click("Search the substrate");
      await c.waitFor(() => document.body.innerText.includes("RELEVANT RESULTS"), 60000);
      {
        const t = await c.text();
        check(
          "LIVE: a substrate search shows results with their status, the commit and what is not established",
          t.includes(math.substrate.commit) &&
            /LEAN FORMALIZATION PRESENT · NOT CHECKED HERE|MANUSCRIPT · NOT FORMALIZED/.test(
              t,
            ) &&
            t.includes("Shared words are not applicability") &&
            c.rain().includes("/api/rain/math-search"),
        );
      }
      await c.clickStarting("Inspect family ");
      await c.waitFor(
        () => document.body.innerText.includes("CITE IN THE NEXT PROPOSAL"),
        60000,
      );
      await c.axe("Research Panel with a substrate search and an inspected result");
      await c.type(
        await c.control("INSPECTED RESULT", "Assumptions that connect it", "textarea"),
        "Pedestrians choosing among sidewalks at a junction behave like an open edge.",
      );
      await c.clickStarting("Cite family ");
      await c.waitFor(() =>
        document.body.innerText.includes("MATHEMATICAL BASIS OF THE NEXT PROPOSAL (1)"),
      );
      await c.click("Experiment Bay");
      await c.click("Propose it");
      await c.waitFor(() => document.body.innerText.includes("AWAITING HUMAN APPROVAL"));
      {
        const t = await c.text();
        check(
          "LIVE: a proposal carries the cited mathematics into the protocol a person authorizes, as context",
          t.includes("MATHEMATICAL BASIS") &&
            t.includes("Assumes: Pedestrians choosing among sidewalks") &&
            t.includes(
              "The cited mathematics does not establish the simulator outcome.",
            ) &&
            t.includes("Mathematical basis: closed, admissible, one substrate revision"),
        );
      }
      await c.axe("Experiment Bay with a mathematical basis");
      await c.click("Evidence Library");
      check(
        "LIVE: the evidence library says mathematics is not evidence, and lists none",
        (await c.text()).includes("Mathematics is not listed here."),
      );
    }
    // The server stops answering. The lab must say so and show nothing new.
    live.child.kill();
    await delay(15500);
    await c.click("Research Panel");
    await c.click("Ask R.A.I.N.");
    await c.waitFor(() => document.body.innerText.includes("LIVE request failed"), 90000);
    {
      const t = await c.text();
      check(
        "LIVE: a server that stops answering is shown as a failure, never replaced by the DEMO",
        /LIVE request failed: (UNAVAILABLE|TIMEOUT|ERROR)/.test(t) &&
          !t.includes("PRERECORDED · DEMO"),
      );
    }
    check("LIVE: no page errors", c.log.errors.length === 0, c.log.errors.join("\n"));
    check(
      "LIVE: no CSP violations",
      (await c.page.evaluate(() => globalThis.__csp)).length === 0,
    );
    check(
      "LIVE: the browser talks only to its own site",
      c.log.requests.every(
        (r) =>
          r.startsWith(live.origin) || r.startsWith("data:") || r.startsWith("blob:"),
      ),
    );
    await context.close();
  }

  // --- LIVE, a model meeting against the stand-in model server ----------------------------
  {
    const standIn = spawn(
      process.execPath,
      [
        "tools/stand-in-model.mjs",
        "--port",
        String(MODEL.standIn),
        // Slow enough for the lab to show a meeting in progress, and to stop one.
        "--delay-ms",
        "1500",
      ],
      { stdio: logTo("stand-in-model"), env: unconfigured() },
    );
    children.push(standIn);
    await listening(`http://127.0.0.1:${MODEL.standIn}/v1/models`);
    const model = preview(
      "model",
      MODEL.port,
      previewEnv({
        RAIN_MEETING_ENGINE: "model",
        RAIN_LLM_BASE_URL: `http://127.0.0.1:${MODEL.standIn}/v1`,
        RAIN_LLM_MODEL: "stand-in-model",
        RAIN_MEETING_TURNS: "4",
        RAIN_MEETING_TIMEOUT_MIN: "5",
        RAIN_MEETING_RECURSION: "false",
        ...(jevLive
          ? { RAIN_DECISION_MODE: "jev", RAIN_DECISION_REMOTE_ALLOWED: "true" }
          : {}),
      }),
    );
    await listening(model.origin);
    const s = await status(model.origin);
    check(
      "LIVE model: the runtime holds model meetings on the stand-in",
      s.configured === true &&
        s.identity?.meeting_generation === "model" &&
        s.identity?.model === "stand-in-model" &&
        s.identity?.meeting_engine === "rain.meeting.model.holdMeeting" &&
        s.identity?.remote_decisions === jevLive,
      `expected a model meeting on stand-in-model, remote decisions ${jevLive}; see the console for the status the route answered`,
    );
    console.log("MODEL status:", JSON.stringify(s).slice(0, 300));
    const context = await browser.createBrowserContext();
    const d = await open(context);
    await enterBethesda(d, model.origin);
    await enterLab(d);
    check(
      "LIVE model: the runtime names the model it runs",
      (await d.text()).includes("RUNTIME LIVE") &&
        (await d.text()).includes("model stand-in-model"),
    );
    await ask(d, demoMeeting.question);
    // The route paces one session's meetings 15 s apart, from when a request
    // arrives. Time the next ask from after this one was sent, not from before
    // the panel was opened and the question typed: on a slow runner that took
    // long enough for the second ask to be refused as paced.
    const askedAt = Date.now();
    await d.waitFor(
      () =>
        document.body.innerText.includes(
          "R.A.I.N.'s meeting is running on stand-in-model",
        ),
      60000,
    );
    check(
      "LIVE model: while it runs the lab shows progress and a way to stop it, and no words",
      (await d.text()).includes("Stop the meeting") &&
        !(await d.page.$('[aria-label="Meeting turns"]')),
    );
    await d.axe("research panel while a model meeting runs");
    await d.waitFor(
      () =>
        /generated by stand-in-model|LIVE request failed/.test(document.body.innerText),
      600000,
    );
    // The turns appear one by one; show them all (the button goes once they are).
    await d.page.evaluate(() =>
      [...document.querySelectorAll("button")]
        .find((b) => b.textContent.trim().startsWith("Show all "))
        ?.click(),
    );
    await d.waitFor(
      () => document.body.innerText.includes("WHERE THE ROOM STANDS"),
      30000,
    );
    {
      const t = await d.text();
      const turns = await d.page.evaluate(
        () => document.querySelector('[aria-label="Meeting turns"]')?.innerText ?? "",
      );
      check(
        "LIVE model: the meeting is the model's, and names the runtime's own record of it",
        t.includes("MODEL · stand-in-model") &&
          !t.includes("SCRIPTED · NO MODEL RAN") &&
          !t.includes("PRERECORDED · DEMO") &&
          /R\.A\.I\.N\.'s own record: session [A-Za-z0-9_-]+ · rain-session-artifact\/v1 · completed/.test(
            t,
          ),
        t.slice(0, 400),
      );
      check(
        "LIVE model: the four perspectives speak, each quote checked against the corpus",
        ["James", "Jasmine", "Luca", "Elena"].every((n) => turns.includes(n)) &&
          turns.includes("[stand-in model]") &&
          turns.includes("verified verbatim") &&
          !turns.includes("NOT verified"),
      );
      // The stand-in also offers a sentence no paper contains, in every turn.
      const invented = await d.page.evaluate(() =>
        [...document.querySelectorAll('[aria-label="Meeting turns"] blockquote')].some(
          (b) => b.textContent.includes("no paper in the corpus contains it"),
        ),
      );
      check(
        "LIVE model: a quotation no paper contains is counted, never shown as a source",
        (turns.match(/1 quotation in this turn did not verify/g)?.length ?? 0) >= 4 &&
          !invented,
      );
      check(
        "LIVE model: the runtime's fixed closing line is marked as its code's, not the model's",
        turns.includes("A FIXED LINE IN R.A.I.N.'S CODE · NOT THE MODEL") &&
          turns.includes("Meeting adjourned."),
      );
      check(
        "LIVE model: no grade and no verdict are invented for it",
        t.includes("does not grade how well the corpus covers the question") &&
          t.includes("records no verdict, so the lab states none"),
      );
      check(
        "LIVE model: a job the site's route started once and checked on",
        d.rain().filter((p) => p === "/api/rain/meeting").length === 1 &&
          d.rain().filter((p) => p === "/api/rain/meeting-status").length >= 1,
        JSON.stringify(d.rain()),
      );
    }
    await d.axe("research panel with a model meeting");

    // Stopping: the runtime is asked to stop, and nothing takes the meeting's place.
    await delay(Math.max(0, askedAt + 15500 - Date.now()));
    await d.click("Ask R.A.I.N.");
    await d.waitFor(
      () => document.body.innerText.includes("R.A.I.N.'s meeting is running on"),
      60000,
    );
    await d.click("Stop the meeting");
    await d.waitFor(() => document.body.innerText.includes("LIVE request failed"), 60000);
    {
      const t = await d.text();
      check(
        "LIVE model: a stopped meeting is stopped in the runtime, and shown as stopped",
        t.includes("LIVE request failed: CANCELLED") &&
          t.includes("The meeting below is the earlier LIVE one") &&
          d.rain().filter((p) => p === "/api/rain/meeting-cancel").length === 1,
        JSON.stringify(d.rain()),
      );
    }

    // Jev, once, only when credit may be spent.
    if (!jevLive) {
      console.log(
        "SKIP LIVE Jev: set JEV_LIVE_TEST=1 and TYPESAFE_API_KEY to spend one call",
      );
    } else {
      await d.click("Experiment Bay");
      await d.click("Ask R.A.I.N. to choose an experiment");
      await d.waitFor(
        () =>
          /R\.A\.I\.N\.('s router)? made no proposal|R\.A\.I\.N\.'s router chose option|proposal request failed/.test(
            document.body.innerText,
          ),
        120000,
      );
      const t = await d.text();
      const handed = t.includes("R.A.I.N. HANDED THE CHOICE BACK");
      const proposed = /R\.A\.I\.N\.'s router chose option X\d+/.test(t);
      const at = Math.max(0, t.indexOf("made no proposal"));
      check(
        "LIVE Jev: R.A.I.N. consulted Jev through its own router and the lab kept what it said",
        (handed && /Jev · jev-[\w.-]+: (chose|chose nothing)/.test(t)) || proposed,
        t.slice(at, at + 600),
      );
      const adopt = await d.page.evaluate(
        () =>
          [...document.querySelectorAll("button")]
            .find((b) => /^Propose X\d+ as my own$/.test(b.textContent.trim()))
            ?.textContent.trim() ?? null,
      );
      if (handed && adopt) {
        await d.click(adopt);
        await d.waitFor(() => document.body.innerText.includes("You proposed X"));
        const after = await d.text();
        check(
          "LIVE Jev: Jev's pick, handed back, becomes a person's proposal only when a person takes it",
          after.includes("The proposal is yours") &&
            after.includes("AWAITING HUMAN APPROVAL") &&
            after.includes("· origin a person"),
        );
      } else
        console.log(
          handed
            ? "NOTE LIVE Jev: Jev chose no supported experiment; nothing is offered to adopt"
            : "NOTE LIVE Jev: R.A.I.N. acted on Jev's answer (a calibration profile exists)",
        );
      check(
        "LIVE Jev: one decision, asked by the server; the browser never reached TypeSafe",
        d.rain().filter((p) => p === "/api/rain/proposal").length === 1 &&
          d.log.requests.every((r) => !/typesafe/i.test(r)),
      );
    }
    check(
      "LIVE model: no page errors",
      d.log.errors.length === 0,
      d.log.errors.join("\n"),
    );
    check(
      "LIVE model: no CSP violations",
      (await d.page.evaluate(() => globalThis.__csp)).length === 0,
    );
    check(
      "LIVE model: the browser talks only to its own site",
      d.log.requests.every(
        (r) =>
          r.startsWith(model.origin) || r.startsWith("data:") || r.startsWith("blob:"),
      ),
    );
    await context.close();
  }
  await writeFile(`${OUT}/browser-checks.json`, JSON.stringify(checks, null, 2));
  if (checks.some((c) => !c.ok)) process.exitCode = 1;
} catch (error) {
  await writeFile(`${OUT}/browser-checks.json`, JSON.stringify(checks, null, 2)).catch(
    () => {},
  );
  // What each open page said when the suite stopped: a stack alone cannot
  // tell a refused request from a slow one.
  const pages = [];
  for (const page of (await browser?.pages().catch(() => [])) ?? [])
    pages.push(
      await page
        .evaluate(() => ({
          url: location.href,
          text: document.body.innerText.slice(0, 20000),
        }))
        .catch((e) => ({ error: String(e) })),
    );
  await writeFile(
    `${OUT}/browser-failure.json`,
    JSON.stringify({ error: String(error?.stack ?? error), pages }, null, 2),
  ).catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const child of children) child.kill();
  await delay(500);
  // Each LIVE runtime wrote a scratch registry; nothing of this run is left behind.
  for (const name of scratchRegistries())
    if (!registriesBefore.has(name))
      rmSync(join(tmpdir(), name), { recursive: true, force: true });
}
