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
async function open(context, { webgl = true } = {}) {
  const page = await context.newPage();
  page.setDefaultTimeout(120000);
  await page.setViewport({ width: 1100, height: 760 });
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
  await a.clickStarting("Show all ");
  await a.waitFor(() => document.body.innerText.includes("WHERE THE ROOM STANDS"));
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
    record.schema === "bethesda-rain-experiment-record/v2" &&
      /^[0-9a-f]{64}$/.test(record.record_sha256) &&
      record.authorization?.identity_verified === false &&
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
