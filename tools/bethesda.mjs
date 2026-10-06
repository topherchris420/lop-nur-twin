#!/usr/bin/env node
/** Production regression. Provider requests are intercepted before navigation;
 * no live model or external map service is used. Owns preview if no URL is given. */
import puppeteer from "puppeteer";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
const require = createRequire(import.meta.url),
  axeSource = await readFile(require.resolve("axe-core/axe.min.js"), "utf8");
const origin = process.argv[2] ?? "http://127.0.0.1:4182";
const server = process.argv[2]
  ? null
  : spawn(
      process.execPath,
      [
        "node_modules/vite/bin/vite.js",
        "preview",
        "--host",
        "127.0.0.1",
        "--port",
        "4182",
        "--strictPort",
      ],
      { stdio: "ignore" },
    );
let browser, page;
let providerCalls = 0;
const checks = [],
  errors = [],
  resources = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " " + detail : ""}`);
};
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(origin)).ok) break;
    } catch {
      /* Preview is not listening yet. */
    }
    await delay(100);
  }
  browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-gl=angle"],
  });
  page = await browser.newPage();
  page.setDefaultTimeout(60000);
  // Keep real WebGL enabled, with a bounded raster budget on software GPUs.
  await page.setViewport({ width: 960, height: 640 });
  // These are timer/DOM conditions, not render-frame conditions. Puppeteer's
  // default rAF polling can stall behind a slow SwiftShader frame in CI.
  const waitFor = (predicate, ...args) =>
    page.waitForFunction(predicate, { polling: 100, timeout: 60000 }, ...args);
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 4 });
    globalThis.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      globalThis.__csp.push(e.effectiveDirective),
    );
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    resources.push(r.url());
    if (r.url().includes("/api/jev/decision")) {
      providerCalls++;
      void r.respond({
        status: 503,
        contentType: "application/json",
        body: '{"error":"offline test double"}',
      });
    } else void r.continue();
  });
  await page.goto(origin + "/?quality=1", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await waitFor(() => document.body.innerText.includes("EVIDENCE TIMELINE"));
  check("Lop Nur opens normally", (await page.title()).startsWith("Lop Nur"));
  check("city not initially mounted", !(await page.$('[data-bethesda="active"]')));
  check("city bundle remains lazy", !resources.some((r) => /\/App-[^/]+\.js/.test(r)));
  await page.keyboard.press("Backquote");
  await page.waitForSelector("#anomaly-coordinate");
  await page.focus("#anomaly-coordinate");
  await page.keyboard.sendCharacter("38.9847,-77.0947");
  await page.keyboard.press("Enter");
  await page.waitForSelector('[data-bethesda="active"]', { timeout: 60000 });
  await delay(1500);
  check("hidden resolver mounts Bethesda", (await page.title()).includes("Bethesda"));
  check("3D canvas exists", (await page.$$("canvas")).length >= 2);
  const click = async (name) =>
    page.evaluate((name) => {
      const button = [...document.querySelectorAll("button")].find(
        (b) => b.textContent.trim() === name,
      );
      if (!button) throw new Error("Missing " + name);
      button.click();
    }, name);
  await mkdir("shots/bethesda", { recursive: true });
  // Use the existing public quality control without changing population or
  // simulation state. Both clicks run before another frame, avoiding Detail's
  // intermediate shadow allocation on the software renderer.
  await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find(
      (b) => b.textContent.trim() === "Visuals: auto",
    );
    if (!button) throw new Error("Missing visual quality control");
    button.click();
    button.click();
  });
  await waitFor(() => document.body.innerText.includes("Visuals: economy"));
  check("economy visuals remain selectable with WebGL", true);
  await click("Pause");
  await page.screenshot({ path: "shots/bethesda/survey.png" });
  await click("~ telemetry");
  await page.waitForSelector("#city-event");
  for (const event of [
    "Fire near Bethesda Row.",
    "A thunderstorm suddenly rolls through downtown Bethesda.",
    "The Metro station closes unexpectedly.",
    "A parade starts on Wisconsin Avenue.",
    "A strange unidentified object appears above Bethesda.",
  ]) {
    await page.focus("#city-event");
    await page.keyboard.sendCharacter(event);
    await page.keyboard.press("Enter");
    await waitFor(() => document.querySelector("#city-event").value === "");
    check(
      "scenario: " + event,
      await page.evaluate(
        () =>
          document.body.innerText.includes("Event injected:") &&
          document.body.innerText.includes("structured event"),
      ),
    );
  }
  await click("Close");
  await click("Resume");
  await click("Jev off");
  await waitFor(() => /fallback [1-9]/.test(document.body.innerText));
  await click("Jev on");
  await click("Walk");
  check(
    "a mouse and keyboard walk without a touch stick",
    !(await page.$("[data-touch-stick]")) &&
      (await page.evaluate(() => document.body.innerText.includes("WASD"))),
  );
  // Hold through actual simulation progress. A wall-clock sleep can elapse
  // entirely inside one software-rendered frame without a timer tick.
  const movementTick = await page.evaluate(() =>
    Number(/tick (\d+)/.exec(document.body.innerText)?.[1]),
  );
  await page.keyboard.down("KeyW");
  try {
    await waitFor(
      (tick) => Number(/tick (\d+)/.exec(document.body.innerText)?.[1]) >= tick + 3,
      movementTick,
    );
  } finally {
    await page.keyboard.up("KeyW");
  }
  await click("Pause");
  await page.screenshot({ path: "shots/bethesda/walk-storm.png" });
  await page.evaluate(() => {
    const original = URL.createObjectURL;
    URL.createObjectURL = function (blob) {
      void blob.text().then((text) => {
        globalThis.__cityExport = text;
      });
      return original.call(this, blob);
    };
  });
  check(
    "export says how much replay is left before it runs out",
    await page.evaluate(() => {
      const note = document.getElementById("replay-room")?.textContent ?? "";
      const button = [...document.querySelectorAll("button")].find(
        (b) => b.textContent.trim() === "Export replay",
      );
      return (
        /^\d+:\d\d of city time left to record/.test(note) &&
        button?.getAttribute("aria-describedby") === "replay-room" &&
        !button.disabled
      );
    }),
  );
  await click("Export replay");
  await waitFor(() => typeof globalThis.__cityExport === "string");
  const trace = await page.evaluate(() => globalThis.__cityExport),
    parsed = JSON.parse(trace);
  check(
    "native fetch reaches mocked outage",
    providerCalls > 0 &&
      parsed.decisions.some(
        (d) => d.source === "fallback" && d.reason.startsWith("unavailable"),
      ),
    `requests=${providerCalls}`,
  );
  check(
    "trace contains scenarios, movement, decisions and final hash",
    parsed.commands.filter((c) => c.type === "scenario").length === 5 &&
      parsed.commands.some((c) => c.type === "move") &&
      parsed.decisions.length > 0 &&
      parsed.finalHash.length > 0,
  );
  await writeFile("shots/bethesda/replay.json", trace);
  await (await page.$('input[type="file"]')).uploadFile("shots/bethesda/replay.json");
  await waitFor(() => document.body.innerText.includes("Replay verified"));
  check("re-import verifies decision history and state", true);
  await click("Resume");
  await writeFile("shots/bethesda/invalid-replay.json", "{}");
  await (
    await page.$('input[type="file"]')
  ).uploadFile("shots/bethesda/invalid-replay.json");
  await waitFor(() =>
    document.body.innerText.includes("Unsupported, mismatched or oversized replay"),
  );
  check(
    "invalid replay preserves a running city",
    await page.evaluate(() =>
      [...document.querySelectorAll("button")].some(
        (b) => b.textContent.trim() === "Pause",
      ),
    ),
  );
  await click("Pause");
  await click("Field notes");
  check(
    "fidelity and license are visible",
    await page.evaluate(
      () =>
        document.body.innerText.includes("bare-earth LiDAR DTM") &&
        document.body.innerText.includes("Redistribution permitted with attribution") &&
        document.body.innerText.includes("ODbL"),
    ),
  );
  await page.evaluate(axeSource);
  const violations = await page.evaluate(async () => {
    const result = await globalThis.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
      resultTypes: ["violations"],
    });
    return result.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) }));
  });
  check(
    "city field notes pass serious/critical axe checks",
    violations.length === 0,
    JSON.stringify(violations),
  );
  check("no CSP violations", (await page.evaluate(() => globalThis.__csp)).length === 0);
  await click("Close field notes");
  await click("Return to the desert");
  await waitFor(() => document.title.startsWith("Lop Nur"));
  check("return restores Lop Nur", !(await page.$('[data-bethesda="active"]')));
  // The second hidden entrance: Bethesda's coordinates typed into the twin's
  // own site index resolve to an anomalous row rather than a structure.
  await page.keyboard.press("KeyI");
  await page.waitForSelector("#site-index-search");
  await page.focus("#site-index-search");
  await page.keyboard.sendCharacter("38.9847, -77.0947");
  await waitFor(() => document.body.innerText.includes("UNRESOLVED FEATURE"));
  await click("UNRESOLVED FEATURE · 39° N 77° W · outside this site");
  await page.waitForSelector('[data-bethesda="active"]', { timeout: 60000 });
  check("site index coordinates also resolve Bethesda", true);
  // The city holds a history entry: Back returns to the twin, not off the site.
  await page.evaluate(() => history.back());
  await waitFor(() => document.title.startsWith("Lop Nur"));
  check(
    "the browser's Back returns from the city to the twin",
    !(await page.$('[data-bethesda="active"]')) &&
      (await page.evaluate(() => location.origin)) === new URL(origin).origin,
  );
  await page.evaluate(() => history.forward());
  await delay(1000);
  check(
    "Forward does not reopen the city",
    !(await page.$('[data-bethesda="active"]')) &&
      (await page.evaluate(() => document.title.startsWith("Lop Nur"))),
  );
  check("no page errors", errors.length === 0, errors.join("\n"));
  check(
    "no external map or assets requested",
    resources.every(
      (r) => r.startsWith(origin) || r.startsWith("data:") || r.startsWith("blob:"),
    ),
  );
  // Deliberate renderer failure after the normal error-free run. The city
  // must keep its independent timer and semantic controls alive.
  await waitFor(() => document.body.innerText.includes("EVIDENCE TIMELINE"));
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (type === "webgl" || type === "webgl2" || type === "experimental-webgl")
        return null;
      return original.call(this, type, ...args);
    };
  });
  await page.keyboard.press("Backquote");
  await page.waitForSelector("#anomaly-coordinate");
  await page.focus("#anomaly-coordinate");
  await page.keyboard.sendCharacter("38.9847,-77.0947");
  await page.keyboard.press("Enter");
  await waitFor(() => document.body.innerText.includes("3D rendering is unavailable"));
  const readTick = () =>
    page.evaluate(() => Number(/tick (\d+)/.exec(document.body.innerText)?.[1]));
  const before = await readTick();
  await waitFor(
    (tick) => Number(/tick (\d+)/.exec(document.body.innerText)?.[1]) > tick,
    before,
  );
  await click("~ telemetry");
  await page.focus("#city-event");
  await page.keyboard.sendCharacter("Fire near Bethesda Row.");
  await page.keyboard.press("Enter");
  check(
    "WebGL failure preserves city rules and scenario controls",
    await page.evaluate(() =>
      document.body.innerText.includes("Event injected: Fire · Bethesda Row"),
    ),
  );
  // Without a frame loop the position readout must still follow the walker.
  await click("Close");
  await click("Walk");
  const position = () =>
    page.evaluate(
      () => /\d+\.\d{5}° N · \d+\.\d{5}° W/.exec(document.body.innerText)?.[0],
    );
  const from = await position();
  const walkTick = await readTick();
  await page.keyboard.down("KeyW");
  try {
    await waitFor(
      (tick) => Number(/tick (\d+)/.exec(document.body.innerText)?.[1]) >= tick + 5,
      walkTick,
    );
  } finally {
    await page.keyboard.up("KeyW");
  }
  await delay(1200);
  const to = await position();
  check(
    "without WebGL, walking moves the position readout",
    !!from && !!to && from !== to,
    `${from} → ${to}`,
  );
  // A phone: the city walked by thumb. Real multi-touch goes in through the
  // DevTools protocol, so the pointer events are the ones a finger makes.
  {
    const phone = await browser.newPage();
    phone.setDefaultTimeout(60000);
    await phone.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await phone.evaluateOnNewDocument(() =>
      Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 4 }),
    );
    const phoneErrors = [];
    phone.on("pageerror", (e) => phoneErrors.push(String(e)));
    await phone.setRequestInterception(true);
    phone.on("request", (r) => {
      if (r.url().includes("/api/jev/decision")) {
        providerCalls++;
        void r.respond({
          status: 503,
          contentType: "application/json",
          body: '{"error":"offline test double"}',
        });
      } else void r.continue();
    });
    const cdp = await phone.createCDPSession();
    const touch = (type, points) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: points.map(([x, y, id]) => ({ x, y, id, radiusX: 4, radiusY: 4 })),
      });
    const until = (predicate, ...args) =>
      phone.waitForFunction(predicate, { polling: 100, timeout: 90000 }, ...args);
    const tap = (name) =>
      phone.evaluate((name) => {
        const b = [...document.querySelectorAll("button")].find(
          (b) => b.textContent.trim() === name,
        );
        if (!b) throw new Error("Missing " + name);
        b.click();
      }, name);
    const where = () =>
      phone.evaluate(() => {
        const m = /(\d+\.\d{5})° N · (\d+\.\d{5})° W/.exec(document.body.innerText);
        return m ? [Number(m[1]), Number(m[2])] : null;
      });
    const stick = () =>
      phone.evaluate(() => {
        const r = document
          .querySelector("[data-touch-stick] > div")
          ?.getBoundingClientRect();
        return r ? [r.left + r.width / 2, r.top + r.height / 2] : null;
      });
    /** Holds the stick pushed up until the readout has moved about 3 m. */
    const walk = async () => {
      const [x, y] = await stick();
      const from = await where();
      await touch("touchStart", [[x, y, 1]]);
      await touch("touchMove", [[x, y - 60, 1]]);
      try {
        await until((f) => {
          const m = /(\d+\.\d{5})° N · (\d+\.\d{5})° W/.exec(document.body.innerText);
          return m && Math.hypot(Number(m[1]) - f[0], Number(m[2]) - f[1]) >= 0.00003;
        }, from);
      } finally {
        await touch("touchEnd", []);
      }
      // The header re-renders once a second; let it catch the last step.
      await delay(2000);
      const to = await where();
      return [to[0] - from[0], to[1] - from[1]];
    };
    await phone.goto(origin + "/?quality=1", { waitUntil: "domcontentloaded" });
    await phone.waitForFunction(
      () => document.body.innerText.includes("EVIDENCE TIMELINE"),
      {
        polling: 100,
        timeout: 90000,
      },
    );
    // The phone's way in: the site index takes Bethesda's coordinates.
    await phone.evaluate(() =>
      [...document.querySelectorAll("button")]
        .find((b) => /index/i.test(b.getAttribute("aria-label") ?? ""))
        ?.click(),
    );
    await phone.waitForSelector("#site-index-search");
    await phone.type("#site-index-search", "38.9847, -77.0947");
    await until(() => document.body.innerText.includes("UNRESOLVED FEATURE"));
    await tap("UNRESOLVED FEATURE · 39° N 77° W · outside this site");
    await phone.waitForSelector('[data-bethesda="active"]', { timeout: 90000 });
    await phone.waitForSelector("[data-touch-stick]");
    const layout = await phone.evaluate(() => {
      const base = document.querySelector("[data-touch-stick] > div");
      const r = base.getBoundingClientRect();
      const reachable = [
        [0.5, 0.5],
        [0.15, 0.5],
        [0.85, 0.5],
        [0.5, 0.15],
        [0.5, 0.85],
      ].every(([fx, fy]) =>
        base.contains(
          document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy),
        ),
      );
      const boxes = [
        "header",
        "nav",
        "[data-touch-stick]",
        'section[aria-label="City controls"]',
      ]
        .map((s) => document.querySelector(s)?.getBoundingClientRect())
        .filter(Boolean);
      let overlaps = 0;
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i],
            b = boxes[j];
          if (
            Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
            Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1
          )
            overlaps++;
        }
      return {
        reachable,
        overlaps,
        // What a finger on the street gets: the canvas, or a wrapper inside the
        // city, refuses the browser's own pan and zoom.
        look: (() => {
          for (
            let el = document.querySelector('[data-bethesda="active"] canvas');
            el && el.closest('[data-bethesda="active"]');
            el = el.parentElement
          )
            if (getComputedStyle(el).touchAction === "none") return "none";
          return "auto";
        })(),
      };
    });
    check(
      "a phone walks with a stick nothing covers, beside panels that do not overlap",
      layout.reachable && layout.overlaps === 0,
      JSON.stringify(layout),
    );
    check(
      "on foot the street takes a drag as a look, not a scroll",
      layout.look === "none",
    );
    const k = Math.cos((38.98 * Math.PI) / 180);
    const angle = (a, b) =>
      (Math.acos(
        (a[0] * b[0] + a[1] * k * b[1] * k) /
          (Math.hypot(a[0], a[1] * k) * Math.hypot(b[0], b[1] * k)),
      ) *
        180) /
      Math.PI;
    // Half a turn is pi / 0.004 px of drag, in swipes that fit the screen.
    const half = Math.PI / 0.004,
      swipes = Math.ceil(half / 300),
      each = half / swipes;
    const ahead = await walk();
    const rested = await where();
    await delay(2500);
    const after = await where();
    check(
      "a full push of the stick walks, and letting go stops",
      Math.hypot(...ahead) > 0 && rested[0] === after[0] && rested[1] === after[1],
      `${ahead} then ${rested} → ${after}`,
    );
    // Two fingers: the stick held while another finger turns the street half
    // way round, then lifts; the walker must come back along the way it went.
    // The city is paused for the turn — under software rendering the swipes
    // span many ticks, and a walker turning while it walks leaves its path —
    // and resumed with the stick still held. In the protocol a touchEnd lifts
    // the fingers it lists.
    let back = [0, 0];
    {
      await tap("Pause");
      const [x, y] = await stick();
      const hold = [x, y - 60, 1];
      await touch("touchStart", [[x, y, 1]]);
      await touch("touchMove", [hold]);
      for (let s = 0; s < swipes; s++) {
        await touch("touchStart", [hold, [350, 340, 2]]);
        for (let i = 1; i <= 10; i++)
          await touch("touchMove", [hold, [350 - (each * i) / 10, 340, 2]]);
        await touch("touchEnd", [[350 - each, 340, 2]]);
      }
      await tap("Resume");
      await delay(2000);
      const from = await where();
      try {
        await until((f) => {
          const m = /(\d+\.\d{5})° N · (\d+\.\d{5})° W/.exec(document.body.innerText);
          return m && Math.hypot(Number(m[1]) - f[0], Number(m[2]) - f[1]) >= 0.00003;
        }, from);
      } catch {
        /* Judged below: a walker that did not move has no heading. */
      } finally {
        await touch("touchEnd", []);
      }
      await delay(2000);
      const to = await where();
      back = [to[0] - from[0], to[1] - from[1]];
      check(
        "a second finger turns the street while the stick keeps walking",
        Math.hypot(...back) > 0 && angle(ahead, back) > 150,
        Math.hypot(...back) > 0 ? `${angle(ahead, back).toFixed(0)}°` : "did not move",
      );
    }
    // One finger alone turns half way again, and the stick retraces the first leg.
    for (let s = 0; s < swipes; s++) {
      await touch("touchStart", [[350, 340, 3]]);
      for (let i = 1; i <= 10; i++)
        await touch("touchMove", [[350 - (each * i) / 10, 340, 3]]);
      await touch("touchEnd", []);
    }
    const again = await walk();
    check(
      "dragging the street half way round turns the walker back the way it came",
      Math.hypot(...back) > 0 && angle(back, again) > 150,
      Math.hypot(...back) > 0
        ? `${angle(back, again).toFixed(0)}°`
        : "no heading to compare",
    );
    check(
      "a phone starts with fewer city controls",
      await phone.evaluate(() =>
        [...document.querySelectorAll("button")].some(
          (b) => b.textContent.trim() === "More controls",
        ),
      ),
    );
    await tap("More controls");
    await tap("Pause");
    await phone.evaluate(() => {
      const original = URL.createObjectURL;
      URL.createObjectURL = function (blob) {
        void blob.text().then((text) => (globalThis.__touchExport = text));
        return original.call(this, blob);
      };
    });
    await tap("Export replay");
    await until(() => typeof globalThis.__touchExport === "string");
    const touched = JSON.parse(await phone.evaluate(() => globalThis.__touchExport));
    const moves = touched.commands.filter((c) => c.type === "move");
    check(
      "thumb steps are recorded moves, a full push at hurry speed",
      moves.length > 0 &&
        moves.every((m) => Math.abs(Math.hypot(m.dx, m.dz) - 0.65) < 1e-9),
      `${moves.length} moves`,
    );
    await writeFile("shots/bethesda/touch-replay.json", JSON.stringify(touched));
    await (
      await phone.$('input[type="file"]')
    ).uploadFile("shots/bethesda/touch-replay.json");
    await until(() => document.body.innerText.includes("Replay verified"));
    check("a walk taken by thumb replays and verifies", true);
    await tap("Survey");
    await until(
      () =>
        !document.querySelector("[data-touch-stick]") &&
        !!document.querySelector('[data-bethesda="active"] aside canvas'),
    );
    check("surveying puts the map back in place of the stick", true);
    await phone.screenshot({ path: "shots/bethesda/phone-survey.png" });
    check(
      "no page errors on the phone",
      phoneErrors.length === 0,
      phoneErrors.join("\n"),
    );
    await phone.close();
  }
  await writeFile("shots/bethesda/browser-checks.json", JSON.stringify(checks, null, 2));
  if (checks.some((c) => !c.ok)) process.exitCode = 1;
} catch (error) {
  await mkdir("shots/bethesda", { recursive: true });
  const hud = await Promise.race([
    page?.evaluate(() => document.body.innerText).catch(() => "unavailable"),
    delay(5000).then(() => "browser did not respond within 5 seconds"),
  ]);
  await writeFile("shots/bethesda/browser-checks.json", JSON.stringify(checks, null, 2));
  await writeFile(
    "shots/bethesda/browser-failure.json",
    JSON.stringify({ error: String(error), providerCalls, errors, hud }, null, 2),
  );
  throw error;
} finally {
  await browser?.close();
  server?.kill();
}
