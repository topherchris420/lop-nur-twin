#!/usr/bin/env node
/**
 * The R.A.I.N. Lab, end to end, against the artifact that ships.
 *
 * Serves `vite preview` (security headers included) and drives the hidden lab
 * in a headless browser. It must stay unloaded and unmentioned until found;
 * open by its phrase and by its coordinates; say OFFLINE when nothing is
 * configured and send nothing else; label its DEMO as a recording; refuse a
 * wrong authorization; run a matched experiment in a worker while Bethesda
 * keeps its own time; verify that experiment by replay without contacting
 * anything; refuse a tampered record; re-verify an exported record in a fresh
 * browser; walk a perspective to a place and record what the simulator saw;
 * pass axe in every room; and keep every room usable without WebGL.
 *
 * With RAIN_LIBRARY_PATH set to a james_library checkout it also starts the
 * reference bridge on loopback, serves a second preview configured for it and
 * runs LIVE: the bridge's identity, a meeting from R.A.I.N.'s own engine, a
 * pre-registered experiment reported back to R.A.I.N.'s registry, and a
 * bridge that stops answering — which must show the failure, never the DEMO.
 * No model is called in either mode: the bridge's meeting engine is R.A.I.N.'s
 * offline engine, and nothing here reaches past loopback.
 *
 *   bun run build && node tools/rain-lab.mjs
 *   node tools/rain-lab.mjs http://localhost:4173     # an already-running preview
 *   RAIN_LIBRARY_PATH=../james_library node tools/rain-lab.mjs
 */
import puppeteer from "puppeteer";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
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
  LIVE = { port: 4186, bridge: 8797 };
const library = process.env.RAIN_LIBRARY_PATH;
const children = [];
const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " " + detail : ""}`);
};

/** Environment without any R.A.I.N. setting, so the OFFLINE preview is unconfigured. */
const unconfigured = () =>
  Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("RAIN_")));
function preview(port, env) {
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
    { stdio: "ignore", env },
  );
  children.push(child);
  return `http://127.0.0.1:${port}`;
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
  await s.waitFor(() => document.body.innerText.includes("CONSTRUCTION TIMELINE"));
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

let browser;
try {
  await mkdir(OUT, { recursive: true });
  // An origin on the command line is used as is; otherwise this owns a preview.
  const origin = process.argv[2] ?? preview(OFFLINE.port, unconfigured());
  await listening(origin);
  const status = await (await fetch(origin + "/api/rain/status")).json();
  if (status.configured)
    throw new Error(
      "the OFFLINE preview has a R.A.I.N. backend configured (.env.local?); unset RAIN_BACKEND_URL",
    );
  browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-gl=angle"],
  });

  // --- Discovery, OFFLINE and DEMO ---------------------------------------------------
  const a = await open(browser.defaultBrowserContext());
  await a.page.goto(origin + "/?quality=1", { waitUntil: "domcontentloaded" });
  await a.waitFor(() => document.body.innerText.includes("CONSTRUCTION TIMELINE"));
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
      (await a.text()).includes("no R.A.I.N. backend is configured for this site") &&
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
    record.schema === "bethesda-rain-experiment-record/v1" &&
      /^[0-9a-f]{64}$/.test(record.record_sha256) &&
      record.authorization?.identity_verified === false &&
      record.run?.arms?.length === 6 &&
      record.outcome?.state === "COMPLETED" &&
      "lop_nur_twin_commit" in record.provenance &&
      // The run followed the DEMO meeting: R.A.I.N.'s revision is the one the
      // recording names, and the record says that is where it came from.
      record.provenance.james_library_commit === demoMeeting.rain.commit &&
      record.provenance.james_library_source === "demo-recording" &&
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
  await a.click("Return to Bethesda");
  await a.page.waitForSelector('[data-bethesda="active"]:not([data-indoors])');
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

  // --- LIVE, against R.A.I.N.'s own engine through the reference bridge ------------------
  if (!library) {
    console.log("SKIP LIVE: set RAIN_LIBRARY_PATH to a james_library checkout");
  } else {
    const bridge = spawn(
      "python3",
      [
        "tools/rain-bridge/rain_bethesda_bridge.py",
        "--library",
        library,
        "--port",
        String(LIVE.bridge),
      ],
      { stdio: "ignore", env: unconfigured() },
    );
    children.push(bridge);
    await listening(`http://127.0.0.1:${LIVE.bridge}/rain-bethesda/v1/identity`);
    const identity = await (
      await fetch(`http://127.0.0.1:${LIVE.bridge}/rain-bethesda/v1/identity`)
    ).json();
    const liveOrigin = preview(LIVE.port, {
      ...unconfigured(),
      RAIN_BACKEND_URL: `http://127.0.0.1:${LIVE.bridge}`,
    });
    await listening(liveOrigin);
    const context = await browser.createBrowserContext();
    const c = await open(context);
    await enterBethesda(c, liveOrigin);
    await enterLab(c);
    check(
      "LIVE: the runtime names R.A.I.N.'s engine and commit",
      (await c.text()).includes("RUNTIME LIVE") &&
        (await c.text()).includes(identity.rain.commit.slice(0, 12)),
    );
    await c.click("Research Panel");
    await c.page.waitForSelector("#rain-question");
    await c.page.focus("#rain-question");
    await c.page.keyboard.sendCharacter(demoMeeting.question);
    await c.click("Ask R.A.I.N.");
    await c.waitFor(
      () => document.body.innerText.includes("R.A.I.N.'s offline engine answered"),
      90000,
    );
    {
      const t = await c.text();
      check(
        "LIVE: R.A.I.N.'s engine answers through the site's route, scripted and labelled",
        t.includes("SCRIPTED · NO MODEL RAN") &&
          !t.includes("PRERECORDED · DEMO") &&
          c.rain().filter((p) => p === "/api/rain/meeting").length === 1,
      );
      check(
        "LIVE: the DEMO is that same meeting, recorded",
        identity.rain.commit !== demoMeeting.rain.commit ||
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
      "LIVE: R.A.I.N. pre-registers the experiment and records its own evaluation",
      c.rain().filter((p) => p === "/api/rain/preregister").length === 1 &&
        c.rain().filter((p) => p === "/api/rain/submission").length === 1,
      JSON.stringify(c.rain()),
    );
    // The bridge stops answering. The lab must say so and show nothing new.
    bridge.kill();
    await delay(15500);
    await c.click("Research Panel");
    await c.click("Ask R.A.I.N.");
    await c.waitFor(() => document.body.innerText.includes("LIVE request failed"), 90000);
    {
      const t = await c.text();
      check(
        "LIVE: an unreachable backend is shown as a failure, never replaced by the DEMO",
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
        (r) => r.startsWith(liveOrigin) || r.startsWith("data:") || r.startsWith("blob:"),
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
  await writeFile(
    `${OUT}/browser-failure.json`,
    JSON.stringify({ error: String(error?.stack ?? error) }, null, 2),
  ).catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const child of children) child.kill();
}
