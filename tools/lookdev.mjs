#!/usr/bin/env node
/**
 * Look-development capture: a fixed, named shot list per subject.
 *
 * `tools/frames.mjs` fixed the camera for the six views that judge the world
 * as a whole. Look development on a single subject — the rifle in your hands,
 * a soldier at three metres, a bullet hitting a wall — needs frames the
 * general set never takes, and a review is only worth anything if the next
 * review looks at the same frames. So every subject has a named set here, and
 * a reviewer runs the set rather than composing shots by hand.
 *
 *   node tools/lookdev.mjs --list
 *   node tools/lookdev.mjs --set viewmodel --out shots/lookdev/viewmodel
 *   node tools/lookdev.mjs --set characters --origin http://localhost:5181
 *   node tools/lookdev.mjs --set sky --only horizon,into-sun
 *   node tools/lookdev.mjs --shots '[{"id":"x","setup":"await ld.place(1290,1350,45,-0.1)"}]'
 *
 * A shot is data: `route` ("play" or "twin"), extra URL `params`, an in-page
 * `setup` (the body of an async function receiving the `ld` helpers below),
 * puppeteer-side `actions` (mouse buttons, keys, frame waits), an optional
 * `pin` re-run right before the shutter, and `hud` (hidden unless true).
 *
 * Two things this has to do that are not obvious:
 *
 *  - **Inputs need a pointer lock**, which a headless browser never grants,
 *    so `InputManager` ignored every click and key and nothing could be fired,
 *    aimed or inspected on camera. The page gets a stand-in lock before any of
 *    its own code runs; the game sees an ordinary locked pointer.
 *  - **Wait in frames, not milliseconds.** Under software WebGL a frame takes
 *    seconds while `dt` is clamped to 50 ms, so game time runs far slower than
 *    the wall clock and a 300 ms ADS blend needs six frames, however long they
 *    take. Every settle here counts frames.
 */

import puppeteer from "puppeteer";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile, rm } from "node:fs/promises";
import {
  openSync,
  closeSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
} from "node:fs";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

let origin = arg("origin", "http://localhost:5173");
const serveArg = arg("serve", null);
const checkName = arg("check", null);

/**
 * The repo's own headless checks, by name. `--check` runs one of these and
 * nothing else: no free-form command reaches a process or a shell.
 */
const CHECKS = {
  gait: "tools/gait.mjs",
  smoke: "tools/smoke.mjs",
  engagement: "tools/engagement.mjs",
};
if (checkName !== null && !Object.hasOwn(CHECKS, checkName)) {
  console.error(`--check must be one of: ${Object.keys(CHECKS).join(", ")}`);
  process.exit(2);
}

/**
 * `--serve` must name a checkout of this project: a directory whose
 * package.json is this package. Anything else is refused before any process
 * is started in it.
 */
function resolveWorktree(dir) {
  const root = resolve(dir);
  let name = null;
  try {
    name = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).name;
  } catch {
    name = null;
  }
  if (name !== "desert-airfield-twin") {
    console.error(`--serve ${dir}: not a checkout of this project`);
    process.exit(2);
  }
  return root;
}
const serveDir = serveArg === null ? null : resolveWorktree(serveArg);
const outDir = arg("out", "shots/lookdev");
const quality = arg("quality", "3");
const compareDir = arg("compare", null);
const setName = arg("set", null);
const only = arg("only", null);
const inline = arg("shots", null);
const width = Number(arg("width", 1280));
const height = Number(arg("height", 720));

/* ------------------------------------------------------------------ */
/* Known places                                                        */
/* ------------------------------------------------------------------ */

// Look angles follow tools/frames.mjs: degrees of player yaw, so the compass
// heading the HUD prints is 360 - look. The sun sits at azimuth 112 (ESE).
const APRON = [1290, 1350];
const DESERT = [1440, 1830];
const HANGAR = [960, 1300];

/* ------------------------------------------------------------------ */
/* Shot sets                                                           */
/* ------------------------------------------------------------------ */

const SETS = {
  /**
   * The regression gate: one frame per subject, the whole look in nine
   * pictures. Capture it before a change and again after, then run the second
   * capture with --compare <before-dir>. A change ships only if every frame it
   * touches got better and none it does not touch moved.
   */
  ab: [
    {
      id: "spawn",
      note: "default spawn: rifle, hangar, sky, apron",
      setup: "await ld.place(null, null, null, -0.02)",
    },
    {
      id: "desert",
      note: "open lakebed to the horizon, clouds",
      setup: `await ld.place(${DESERT}, 20, -0.06)`,
    },
    {
      id: "apron",
      note: "apron: fuel tank, pavement, cover, sun behind",
      setup: `await ld.place(${APRON}, 45, -0.12)`,
    },
    {
      id: "into-sun",
      note: "same spot into the sun",
      setup: `await ld.place(${APRON}, 225, -0.05)`,
    },
    {
      id: "hangar",
      note: "hangar wall at close range",
      setup: `await ld.place(${HANGAR}, 80, 0.02)`,
    },
    {
      id: "ground",
      note: "ground underfoot",
      setup: `await ld.place(${APRON}, 45, -0.55)`,
    },
    {
      id: "rifle-raking",
      note: "rifle receiver under raking sun",
      setup: `await ld.place(${APRON}, 20, -0.08)`,
    },
    {
      id: "sky",
      note: "sky above the horizon, away from the sun",
      setup: `await ld.place(${DESERT}, 300, 0.22)`,
    },
    {
      id: "night",
      note: "night over the lakebed",
      setup: `ld.night(true); await ld.place(${DESERT}, 300, 0.04)`,
      frames: 5,
      after: [{ eval: "ld.night(false)" }],
    },
  ],

  /**
   * The rifle and the hands holding it: the most-seen object in the game.
   * Order matters: inspect-b continues inspect-a's animation, and the last
   * two leave the weapon mid-reload and then on the sidearm, so nothing has
   * to wait for an animation to finish.
   */
  viewmodel: [
    {
      id: "hip-sunlit",
      note: "rifle at the hip, sun over the shoulder, sky and apron behind",
      setup: `await ld.place(${APRON}, 300, -0.04)`,
    },
    {
      id: "hip-side-light",
      note: "rifle at the hip, sun raking across the receiver",
      setup: `await ld.place(${APRON}, 20, -0.08)`,
    },
    {
      id: "ads",
      note: "aimed down the sights: optic, reticle, rear of the receiver",
      setup: `await ld.place(${APRON}, 300, -0.02)`,
      actions: [{ mouse: "right", down: true }, { frames: 12 }],
      frames: 1,
      after: [{ mouse: "right", down: false }, { frames: 6 }],
    },
    {
      id: "firing",
      note: "mid-burst: muzzle flash, smoke, ejected brass, recoil",
      setup: `await ld.place(${APRON}, 300, -0.03)`,
      actions: [{ mouse: "left", down: true }, { frames: 3 }],
      frames: 0,
      after: [{ mouse: "left", down: false }, { frames: 4 }],
    },
    {
      id: "inspect-a",
      note: "inspect animation, early: the left side of the weapon",
      setup: `await ld.place(${APRON}, 300, -0.04)`,
      actions: [{ key: "KeyI" }, { frames: 12 }],
      frames: 0,
    },
    {
      id: "inspect-b",
      note: "inspect animation, later (continues inspect-a): the other side",
      setup: `await ld.place(${APRON}, 300, -0.04)`,
      frames: 16,
    },
    {
      id: "night-hip",
      note: "rifle at night",
      setup: `ld.night(true); await ld.place(${APRON}, 300, -0.04)`,
      frames: 5,
      after: [{ eval: "ld.night(false)" }],
    },
    {
      id: "reload",
      note: "mid-reload: magazine out, support hand",
      setup: `await ld.place(${APRON}, 300, -0.04)`,
      actions: [{ key: "KeyR" }, { frames: 14 }],
      frames: 0,
    },
    {
      id: "sidearm",
      note: "the secondary weapon at the hip",
      setup: `await ld.place(${APRON}, 300, -0.04)`,
      actions: [{ key: "Digit2" }, { frames: 18 }],
      frames: 0,
    },
  ],

  /** Soldiers: portrait lens on a staged subject, then in context. */
  characters: [
    {
      id: "front",
      note: "head to toe, facing camera, 28 deg lens",
      setup: "await ld.stageBot({ angle: 0, fov: 28, distance: 3.6, aim: 0.95 })",
      pin: "ld.pinBot()",
      frames: 6,
    },
    {
      id: "three-quarter",
      note: "the angle a player actually sees",
      setup: "await ld.stageBot({ angle: 40, fov: 28, distance: 3.6, aim: 0.95 })",
      pin: "ld.pinBot()",
      frames: 6,
    },
    {
      id: "side",
      note: "profile: pack depth, boots, spine",
      setup: "await ld.stageBot({ angle: 90, fov: 28, distance: 3.6, aim: 0.95 })",
      pin: "ld.pinBot()",
      frames: 6,
    },
    {
      id: "back",
      note: "pack, helmet rear, belt line",
      setup: "await ld.stageBot({ angle: 180, fov: 28, distance: 3.6, aim: 0.95 })",
      pin: "ld.pinBot()",
      frames: 6,
    },
    {
      id: "head",
      note: "helmet, face, NVG mount: a 9 deg head study",
      setup: "await ld.stageBot({ angle: 25, fov: 9, distance: 2.4, aim: 1.62 })",
      pin: "ld.pinBot()",
      frames: 6,
    },
    {
      id: "hands-weapon",
      note: "how the soldier holds the rifle",
      setup: "await ld.stageBot({ angle: 60, fov: 14, distance: 2.6, aim: 1.25 })",
      pin: "ld.pinBot()",
      frames: 6,
    },
    {
      id: "crouch",
      note: "crouched three-quarter",
      setup:
        "await ld.stageBot({ angle: 35, fov: 28, distance: 3.6, aim: 0.6, stance: 'crouch' })",
      pin: "ld.pinBot()",
      frames: 8,
    },
    {
      id: "walking",
      note: "mid-stride in profile at 3 m, game lens",
      setup:
        "await ld.stageBot({ angle: 90, fov: 80, distance: 3.2, aim: 1.0, speed: 2.6 })",
      pin: "ld.pinBot({ keepMoving: true })",
      frames: 10,
    },
    {
      id: "firefight",
      note: "a live engagement at 15-35 m, player's lens",
      setup: "await ld.firefight()",
      frames: 4,
      hud: true,
    },
  ],

  /** Weapon and impact effects. */
  vfx: [
    {
      id: "muzzle-hip",
      note: "muzzle flash and smoke from the hip",
      setup: `await ld.place(${APRON}, 300, -0.03)`,
      actions: [{ mouse: "left", down: true }, { frames: 2 }],
      after: [{ mouse: "left", down: false }, { frames: 10 }],
    },
    {
      id: "muzzle-ads",
      note: "muzzle flash through the optic",
      setup: `await ld.place(${APRON}, 300, -0.02)`,
      actions: [
        { mouse: "right", down: true },
        { frames: 12 },
        { mouse: "left", down: true },
        { frames: 2 },
      ],
      after: [
        { mouse: "left", down: false },
        { mouse: "right", down: false },
        { frames: 10 },
      ],
    },
    {
      id: "impacts-wall",
      note: "a burst into the hangar wall at close range: puffs, sparks, decals",
      setup: `await ld.place(${HANGAR}, 80, 0.0)`,
      actions: [{ mouse: "left", down: true }, { frames: 10 }],
      after: [{ mouse: "left", down: false }, { frames: 10 }],
    },
    {
      id: "impacts-wall-after",
      note: "the same wall a moment later: decals and settling dust",
      setup: `await ld.place(${HANGAR}, 80, 0.0)`,
      actions: [
        { mouse: "left", down: true },
        { frames: 10 },
        { mouse: "left", down: false },
        { frames: 16 },
      ],
    },
    {
      id: "impacts-ground",
      note: "rounds into the lakebed: dust spurts",
      setup: `await ld.place(${DESERT}, 20, -0.32)`,
      actions: [{ mouse: "left", down: true }, { frames: 8 }],
      after: [{ mouse: "left", down: false }, { frames: 10 }],
    },
    {
      id: "night-fire",
      note: "firing at night: flash, tracers, light on the surroundings",
      setup: `ld.night(true); await ld.place(${APRON}, 300, -0.03)`,
      actions: [{ mouse: "left", down: true }, { frames: 3 }],
      after: [{ mouse: "left", down: false }, { eval: "ld.night(false)" }, { frames: 8 }],
    },
    {
      id: "firefight",
      note: "bots fighting: tracers, flashes, impacts in context",
      setup: "await ld.firefight()",
      frames: 4,
      hud: true,
    },
  ],

  /** The lakebed and the pavement: the bottom half of every frame. */
  terrain: [
    {
      id: "underfoot",
      note: "ground at the player's feet",
      setup: `await ld.place(${DESERT}, 20, -0.62)`,
      frames: 4,
    },
    {
      id: "lakebed-mid",
      note: "open lakebed from 2 m to 300 m",
      setup: `await ld.place(${DESERT}, 20, -0.14)`,
      frames: 4,
    },
    {
      id: "lakebed-horizon",
      note: "lakebed running to the horizon, sun behind",
      setup: `await ld.place(${DESERT}, 300, -0.03)`,
      frames: 4,
    },
    {
      id: "apron-concrete",
      note: "apron pavement close: slab joints, stains, wear",
      setup: `await ld.place(${APRON}, 45, -0.42)`,
      frames: 4,
    },
    {
      id: "pavement-edge",
      note: "where pavement meets lakebed",
      setup: `await ld.place(${APRON}, 225, -0.22)`,
      frames: 4,
    },
    {
      id: "aerial",
      note: "the twin's aerial oblique: the lakebed at site scale",
      route: "twin",
      setup: "await ld.twinOblique()",
      frames: 4,
    },
  ],

  /** Cover, crates, barrels, sandbags, cones. */
  props: [
    {
      id: "apron-props",
      note: "apron clutter at 3-15 m, sun behind",
      setup: `await ld.place(${APRON}, 45, -0.12)`,
      frames: 4,
    },
    {
      id: "apron-props-sun",
      note: "same clutter into the sun",
      setup: `await ld.place(${APRON}, 225, -0.05)`,
      frames: 4,
    },
    {
      id: "cover-close",
      note: "the nearest cover object at arm's length",
      setup: "await ld.nearestClutter(2.2, -0.25)",
      frames: 4,
    },
    {
      id: "cover-mid",
      note: "a cluster of cover at 8 m",
      setup: "await ld.nearestClutter(8, -0.08)",
      frames: 4,
    },
    {
      id: "desert-scatter",
      note: "scrub and stones on the open lakebed",
      setup: `await ld.place(${DESERT}, 20, -0.2)`,
      frames: 4,
    },
  ],

  /** Buildings, hangars, tanks, towers. */
  structures: [
    {
      id: "hangar-wall",
      note: "hangar wall at close range",
      setup: `await ld.place(${HANGAR}, 80, 0.02)`,
      frames: 4,
    },
    {
      id: "compound-mid",
      note: "the compound at 60-200 m from the flight line",
      setup: "await ld.place(null, null, null, -0.02)",
      frames: 4,
    },
    {
      id: "fuel-tanks",
      note: "the fuel tanks and the apron edge",
      setup: `await ld.place(${APRON}, 45, -0.04)`,
      frames: 4,
    },
    {
      id: "facade-sun",
      note: "a facade into the sun: silhouettes and rim",
      setup: `await ld.place(${APRON}, 225, 0.02)`,
      frames: 4,
    },
    {
      id: "aerial",
      note: "the twin's aerial oblique of the compound",
      route: "twin",
      setup: "await ld.twinOblique()",
      frames: 4,
    },
    {
      id: "night",
      note: "the compound at night",
      setup: "ld.night(true); await ld.place(null, null, null, -0.02)",
      frames: 6,
      after: [{ eval: "ld.night(false)" }, { frames: 4 }],
    },
  ],

  /** Sky, sun, haze, distant relief, and the light they cast. */
  sky: [
    {
      id: "spawn",
      note: "default spawn view (was black)",
      setup: "await ld.place(null, null, null, -0.02)",
      frames: 6,
      hud: true,
    },
    {
      id: "horizon",
      note: "sky and distant relief, sun behind",
      setup: `await ld.place(${DESERT}, 300, 0.05)`,
      frames: 4,
    },
    {
      id: "into-sun",
      note: "looking toward the sun",
      setup: `await ld.place(${APRON}, 240, 0.06)`,
      frames: 4,
    },
    {
      id: "sky-up",
      note: "clouds overhead",
      setup: `await ld.place(${DESERT}, 200, 0.55)`,
      frames: 4,
    },
    {
      id: "apron-light",
      note: "sunlit apron with shade and contact shadows",
      setup: `await ld.place(${APRON}, 45, -0.12)`,
      frames: 4,
    },
    {
      id: "night",
      note: "night sky and lighting",
      setup: `ld.night(true); await ld.place(${DESERT}, 300, 0.08)`,
      frames: 6,
      after: [{ eval: "ld.night(false)" }, { frames: 4 }],
    },
    {
      id: "twin-overview",
      note: "the analytical twin's overview",
      route: "twin",
      setup: "await ld.twinOblique()",
      frames: 4,
    },
  ],
};

/* ------------------------------------------------------------------ */
/* In-page helpers                                                     */
/* ------------------------------------------------------------------ */

/**
 * Installed before the app's own scripts. A stand-in pointer lock, then the
 * `ld` helpers every shot's setup receives.
 */
function installPageHelpers() {
  let lockTarget = null;
  Object.defineProperty(Document.prototype, "pointerLockElement", {
    configurable: true,
    get() {
      return lockTarget;
    },
  });
  Element.prototype.requestPointerLock = function requestPointerLock() {
    lockTarget = this;
    setTimeout(() => document.dispatchEvent(new Event("pointerlockchange")), 0);
    return Promise.resolve();
  };
  Document.prototype.exitPointerLock = function exitPointerLock() {
    lockTarget = null;
    setTimeout(() => document.dispatchEvent(new Event("pointerlockchange")), 0);
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const combat = () => globalThis.__combat;
  let subject = null;

  // A frame clock that works on every route: the combat handle counts
  // simulation frames, and everywhere else the browser's own animation frames
  // stand in for the renderer's (r3f draws once per rAF).
  let rafFrames = 0;
  const tick = () => {
    rafFrames += 1;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  function frame() {
    const h = combat();
    return h ? h.game.frame : rafFrames;
  }

  function setFov(deg) {
    const h = combat();
    if (!h || deg == null) return;
    h.store.setState({ fov: deg });
  }

  /** Stand the player at x,z (null keeps the spawn) facing `look` degrees. */
  async function place(x, z, look, pitch) {
    const { game } = combat();
    const p = game.player;
    if (x != null && z != null) {
      p.position.set(x, game.world.groundAt(x, z), z);
    }
    p.velocity.set(0, 0, 0);
    if (look != null) p.yaw = (look * Math.PI) / 180;
    if (pitch != null) p.pitch = pitch;
    p.alive = true;
    p.health = p.maxHealth;
    p.lastDamageTime = -999;
    setFov(80);
    return game.world.isPositionFree(p.position, 0.34, 1.8);
  }

  function night(on) {
    const store = globalThis.__twinStore;
    if (store && store.getState().night !== on) store.getState().toggleNight();
  }

  /** Step the match deterministically, the way tools/shots.mjs does. */
  function step(seconds) {
    const { game } = combat();
    const sim = globalThis.__combatSim;
    const mods = globalThis.__combatModules;
    if (!sim || !mods) return;
    const kills = [];
    const STEP = 1 / 60;
    for (let i = 0; i < seconds / STEP; i += 1) {
      game.time += STEP;
      sim.bots.setFocus(game.player.position);
      sim.bots.update(STEP, game.time);
      sim.director.update(STEP);
      mods.resolveDamage(game.time, kills);
      for (const k of kills) sim.director.onKill(k);
      kills.length = 0;
      mods.tickActorState(STEP, game.time);
      sim.characters.update(STEP, { position: game.player.position });
    }
  }

  /**
   * Stage a live bot in front of the camera on open ground near the spawn,
   * camera standing where the light is (see tools/portrait.mjs for why the
   * subject turns rather than the camera orbiting).
   */
  async function stageBot(opts) {
    const o = {
      angle: 0,
      fov: 28,
      distance: 3.6,
      aim: 0.95,
      stance: "stand",
      speed: 0,
      ...opts,
    };
    const { game } = combat();
    const bot = game.actors.find((a) => !a.isPlayer && a.alive);
    if (!bot) throw new Error("no live bot to stage");
    const p = game.player;
    if (!subject) {
      let spot = null;
      for (let i = 0; i < 24 && !spot; i += 1) {
        const yaw = p.yaw + i * 0.42;
        const x = p.position.x - Math.sin(yaw) * 6;
        const z = p.position.z - Math.cos(yaw) * 6;
        const y = game.world.groundAt(x, z);
        if (game.world.isPositionFree({ x, y, z, isVector3: true }, 0.5, 1.9)) {
          // The camera stands off the subject's +x/+z quarter; it needs clear
          // ground too or the frame is the inside of a wall.
          const cx = x + 0.707 * 3.6;
          const cz = z + 0.707 * 3.6;
          const cy = game.world.groundAt(cx, cz);
          if (
            game.world.isPositionFree({ x: cx, y: cy, z: cz, isVector3: true }, 0.34, 1.8)
          )
            spot = { x, y, z };
        }
      }
      if (!spot) throw new Error("nowhere clear to stand the subject");
      subject = { id: bot.id, at: spot };
    }
    subject.opts = o;
    pinBot();
    setFov(o.fov);
    return true;
  }

  function pinBot(extra = {}) {
    if (!subject) return;
    const { game } = combat();
    const bot = game.actorById.get(subject.id);
    if (!bot) return;
    const o = subject.opts;
    const theta = (o.angle * Math.PI) / 180;
    const moving = extra.keepMoving && o.speed > 0;
    bot.alive = true;
    bot.health = bot.maxHealth;
    bot.stance = o.stance;
    bot.pitch = 0;
    bot.suppression = 0;
    bot.yaw = Math.PI * 1.25 + theta;
    if (moving) {
      bot.state = o.speed > 5 ? "sprint" : o.speed > 0.4 ? "run" : "idle";
      bot.speed = o.speed;
      bot.velocity.set(-Math.sin(bot.yaw) * o.speed, 0, -Math.cos(bot.yaw) * o.speed);
    } else {
      bot.state = "idle";
      bot.speed = 0;
      bot.velocity.set(0, 0, 0);
    }
    bot.position.set(subject.at.x, subject.at.y, subject.at.z);
    const p = game.player;
    const x = bot.position.x + 0.707 * o.distance;
    const z = bot.position.z + 0.707 * o.distance;
    p.position.set(x, game.world.groundAt(x, z), z);
    p.velocity.set(0, 0, 0);
    p.alive = true;
    p.health = p.maxHealth;
    p.lastDamageTime = -999;
    p.yaw = Math.atan2(-(bot.position.x - x), -(bot.position.z - z));
    p.pitch = Math.atan2(bot.position.y + o.aim - (p.position.y + 1.62), o.distance);
  }

  /** Run the match forward and stand the player where the fighting is. */
  async function firefight() {
    const { game } = combat();
    const world = game.world;
    const player = game.player;
    step(30);
    let target = null;
    let closest = Infinity;
    for (const a of game.actors) {
      if (a.isPlayer || !a.alive || a.team === player.team) continue;
      const d = a.position.distanceTo(player.position);
      if (d < closest) {
        closest = d;
        target = a;
      }
    }
    if (!target) return false;
    const chest = target.position.clone();
    chest.y += 1.2;
    let eye = null;
    let best = -Infinity;
    for (const range of [15, 18, 22, 27, 34]) {
      for (let i = 0; i < 24; i += 1) {
        const angle = (i / 24) * Math.PI * 2;
        const c = target.position.clone();
        c.x += Math.cos(angle) * range;
        c.z += Math.sin(angle) * range;
        c.y = world.groundAt(c.x, c.z);
        if (!world.isPositionFree(c, 0.34, 1.8)) continue;
        const from = c.clone();
        from.y += 1.62;
        if (!world.hasLineOfSight(from, chest, 1 | 2, target.id)) continue;
        const sunAz = (112 * Math.PI) / 180;
        const toward = Math.atan2(chest.x - c.x, -(chest.z - c.z));
        const score = -range - Math.cos(toward - sunAz) * 16;
        if (score > best) {
          best = score;
          eye = c;
        }
      }
    }
    if (!eye) return false;
    player.position.copy(eye);
    player.velocity.set(0, 0, 0);
    step(0.5);
    const head = target.position.clone();
    head.y += 1.5;
    const look = head.clone().sub(player.position);
    player.yaw = Math.atan2(-look.x, -look.z);
    player.pitch = Math.atan2(
      head.y - (player.position.y + 1.62),
      Math.hypot(look.x, look.z),
    );
    player.alive = true;
    player.health = player.maxHealth;
    player.lastDamageTime = -999;
    setFov(80);
    return true;
  }

  /** Face the nearest collidable clutter at roughly `dist` metres. */
  async function nearestClutter(dist, pitch) {
    const { game, r3f } = combat();
    const scene = r3f.scene;
    const p = game.player;
    const group = scene.getObjectByName("ground-clutter");
    if (!group) return false;
    const candidates = [];
    group.updateMatrixWorld(true);
    group.traverse((o) => {
      if (!o.isMesh || o.userData?.noCollide) return;
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      const c = o.geometry.boundingSphere.center.clone().applyMatrix4(o.matrixWorld);
      candidates.push(c);
    });
    candidates.sort(
      (a, b) => Math.hypot(a.x - 1290, a.z - 1350) - Math.hypot(b.x - 1290, b.z - 1350),
    );
    for (const c of candidates) {
      for (let k = 0; k < 12; k += 1) {
        const ang = (k / 12) * Math.PI * 2 + 0.4;
        const x = c.x + Math.cos(ang) * dist;
        const z = c.z + Math.sin(ang) * dist;
        const y = game.world.groundAt(x, z);
        if (!game.world.isPositionFree({ x, y, z, isVector3: true }, 0.34, 1.8)) continue;
        p.position.set(x, y, z);
        p.velocity.set(0, 0, 0);
        p.yaw = Math.atan2(-(c.x - x), -(c.z - z));
        p.pitch = pitch;
        setFov(80);
        return true;
      }
    }
    return false;
  }

  /** The twin's aerial oblique from the south-east (tools/shots.mjs). */
  async function twinOblique() {
    const ROT = 0.7679;
    const O = [1018, 1410];
    const compound = (u, v) => [
      O[0] + u * Math.cos(ROT) + v * Math.sin(ROT),
      O[1] - u * Math.sin(ROT) + v * Math.cos(ROT),
    ];
    const [tx, tz] = compound(20, 40);
    const [cx, cz] = compound(420, 520);
    // Reduced motion makes the rig snap instead of animating, so the frame is
    // the same every run however slowly it renders. A 9 s wall-clock wait for
    // the 1.5 s flight used to land mid-flight on a loaded machine.
    globalThis.__twinStore.setState({ reducedMotion: true });
    globalThis.__twinStore.getState().requestFlyTo([cx, 250, cz], [tx, 0, tz]);
  }

  globalThis.__ld = {
    sleep,
    frame,
    place,
    night,
    step,
    stageBot,
    pinBot,
    firefight,
    nearestClutter,
    twinOblique,
    fov: setFov,
  };
}

/* ------------------------------------------------------------------ */
/* Runner                                                              */
/* ------------------------------------------------------------------ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (flag("list")) {
  for (const [name, list] of Object.entries(SETS)) {
    console.log(`${name}:`);
    for (const s of list) console.log(`  ${s.id.padEnd(18)} ${s.note ?? ""}`);
  }
  process.exit(0);
}

/** `--wait <dir>`: block until a background run into <dir> has finished. */
const waitDir = arg("wait", null);
if (waitDir) {
  const limit = Date.now() + Number(arg("timeout", 540)) * 1000;
  while (Date.now() < limit) {
    let summary = null;
    try {
      summary = readFileSync(join(waitDir, ".done"), "utf8");
    } catch {
      summary = null;
    }
    if (summary !== null) {
      console.log(summary);
      process.exit(0);
    }
    await sleep(2000);
  }
  console.log(`still running: no ${waitDir}/.done yet (call --wait again)`);
  process.exit(3);
}

let shots = [];
if (checkName !== null || flag("recompare")) shots = [];
else if (inline) shots = JSON.parse(inline);
else if (setName === "all")
  shots = Object.entries(SETS).flatMap(([n, list]) =>
    list.map((x) => ({ ...x, id: `${n}-${x.id}` })),
  );
else if (setName && SETS[setName]) shots = SETS[setName];
else {
  console.error(
    `usage: --set <${Object.keys(SETS).join("|")}|all> | --shots '<json>' | --list | --wait <dir>`,
  );
  process.exit(2);
}
if (only) {
  const keep = new Set(only.split(","));
  shots = shots.filter((s) => keep.has(s.id));
}

/**
 * `--recompare`: rerun the comparison for an existing capture in --out
 * against --compare, without rendering anything.
 */
if (flag("recompare")) {
  if (!compareDir) {
    console.error("--recompare needs --compare <before-dir> and --out <after-dir>");
    process.exit(2);
  }
  const existing = JSON.parse(readFileSync(`${outDir}/manifest.json`, "utf8"));
  await compareRuns(existing.shots, "");
  process.exit(0);
}

/* ---------------------------------------------------- render slots */

// Next to the tool, not in the shared temp directory: every capture runs this
// one file, so the lock directory is machine-wide without being world-writable.
const SLOT_DIR = fileURLToPath(
  new URL("../node_modules/.cache/lookdev-slots", import.meta.url),
);
const SLOTS = Math.max(1, Number(arg("slots", 2)));
let heldSlot = null;
let heldIndex = -1;
let server = null;

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function acquireSlot() {
  mkdirSync(SLOT_DIR, { recursive: true });
  let announced = false;
  for (;;) {
    for (let i = 0; i < SLOTS; i += 1) {
      const path = `${SLOT_DIR}/slot-${i}.lock`;
      try {
        const fd = openSync(path, "wx");
        writeFileSync(fd, String(process.pid));
        closeSync(fd);
        heldSlot = path;
        heldIndex = i;
        return;
      } catch {
        // Taken: steal it if its owner is gone.
        try {
          const owner = Number(readFileSync(path, "utf8"));
          if (!owner || !pidAlive(owner)) unlinkSync(path);
        } catch {
          // Raced with its release; try again next pass.
        }
      }
    }
    if (!announced) {
      console.log(`waiting for a render slot (${SLOTS} in use)...`);
      announced = true;
    }
    await sleep(3000);
  }
}

function releaseSlot() {
  stopServer();
  if (!heldSlot) return;
  try {
    if (Number(readFileSync(heldSlot, "utf8")) === process.pid) unlinkSync(heldSlot);
  } catch {
    // Already gone.
  }
  heldSlot = null;
}
process.on("exit", releaseSlot);
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    releaseSlot();
    process.exit(130);
  });
}

await mkdir(outDir, { recursive: true });
await rm(`${outDir}/.done`, { force: true });
await acquireSlot();

/**
 * `--serve <worktree>`: start that checkout's dev server inside the render
 * slot and stop it afterwards. An idle vite server holds most of a gigabyte,
 * so keeping one up per worktree runs the machine out of memory; a server per
 * slot bounds it. The port is derived from the slot, so concurrent runs can
 * never collide.
 */
function stopServer() {
  if (!server) return;
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    // Already gone.
  }
  server = null;
}

if (serveDir) {
  const port = 5300 + heldIndex;
  // Whatever an earlier, killed run left on this slot's port.
  try {
    execFileSync("fuser", ["-k", `${port}/tcp`], { stdio: "ignore" });
  } catch {
    // Nothing listening.
  }
  try {
    execFileSync(
      process.execPath,
      ["scripts/run-ts.mjs", "scripts/generate-manifest.ts"],
      {
        cwd: serveDir,
        stdio: "ignore",
      },
    );
  } catch {
    // The page renders without the manifest; it only feeds a panel.
  }
  server = spawn(
    process.execPath,
    [
      join(serveDir, "node_modules", "vite", "bin", "vite.js"),
      "--port",
      String(port),
      "--strictPort",
    ],
    {
      cwd: serveDir,
      detached: true,
      stdio: "ignore",
    },
  );
  origin = `http://localhost:${port}`;
  let up = false;
  for (let i = 0; i < 120 && !up; i += 1) {
    try {
      const res = await fetch(origin);
      up = res.ok;
    } catch {
      await sleep(500);
    }
  }
  if (!up) {
    console.error(`dev server for ${serveDir} never came up on ${port}`);
    releaseSlot();
    process.exit(1);
  }
  console.log(`serving ${serveDir} on ${origin}`);
}

/**
 * `--check <name>`: run one of the repo's headless checks inside the slot
 * against the served worktree (or this checkout), passing it the origin.
 */
if (checkName !== null) {
  const script = CHECKS[checkName];
  console.log(`check: node ${script} ${origin}`);
  const run = spawnSync(process.execPath, [script, origin], {
    cwd: serveDir ?? process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  process.stdout.write(output);
  releaseSlot();
  await writeFile(join(outDir, ".done"), `${output}\nexit ${run.status}\n`);
  process.exit(run.status ?? 1);
}

const browser = await puppeteer.launch({
  headless: "shell",
  protocolTimeout: 30 * 60 * 1000,
  args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-gl=angle"],
});
const page = await browser.newPage();
await page.setViewport({ width, height, deviceScaleFactor: 1 });
await page.evaluateOnNewDocument(installPageHelpers);
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));

let currentUrl = null;

function urlFor(shot) {
  const extra = shot.params ? `&${shot.params}` : "";
  return shot.route === "twin"
    ? `${origin}/?quality=${quality}${extra}`
    : `${origin}/play?autoplay=1&quality=${quality}${extra}`;
}

async function waitReady(route) {
  const start = Date.now();
  while (Date.now() - start < 180000) {
    const ready = await page
      .evaluate((r) => {
        if (r === "twin")
          return !!globalThis.__twinStore && !!document.querySelector("canvas");
        const h = globalThis.__combat;
        return !!(
          h &&
          h.game.world &&
          h.r3f.scene.environment &&
          h.game.stats.drawCalls > 5
        );
      }, route)
      .catch(() => false);
    if (ready) {
      await waitFrames(route === "twin" ? 6 : 3);
      return;
    }
    await sleep(500);
  }
  throw new Error(`scene never became ready (${route})`);
}

/** Wait for n rendered frames, polled from here so no call can time out. */
async function waitFrames(n) {
  const read = () => page.evaluate(() => globalThis.__ld.frame()).catch(() => -1);
  const start = await read();
  if (start < 0) {
    await sleep(n * 1500);
    return;
  }
  const limit = Date.now() + 60000 + n * 45000;
  while (Date.now() < limit) {
    if ((await read()) >= start + n) return;
    await sleep(300);
  }
}

async function ensurePage(shot) {
  const url = urlFor(shot);
  const live = await page.evaluate(() => !!globalThis.__ld?.frame).catch(() => false);
  if (url === currentUrl && live) return;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
  currentUrl = url;
  await waitReady(shot.route === "twin" ? "twin" : "play");
}

async function runActions(list) {
  for (const a of list ?? []) {
    if (a.mouse) {
      const button =
        a.mouse === "right" ? "right" : a.mouse === "middle" ? "middle" : "left";
      await page.mouse.move(width / 2, height / 2);
      if (a.down) await page.mouse.down({ button });
      else await page.mouse.up({ button });
    } else if (a.key) {
      await page.keyboard.down(a.key);
      await sleep(30);
      await page.keyboard.up(a.key);
    } else if (a.frames) {
      await waitFrames(a.frames);
    } else if (a.wait) {
      await sleep(a.wait);
    } else if (a.eval) {
      await page.evaluate(`(async (ld) => { ${a.eval} })(globalThis.__ld)`);
    }
  }
}

/** Hide every overlay but the WebGL canvas the world is drawn into. */
async function setHud(visible) {
  await page.evaluate((show) => {
    let style = document.getElementById("__lookdev_hud");
    if (!style) {
      style = document.createElement("style");
      style.id = "__lookdev_hud";
      document.head.appendChild(style);
    }
    const gl = globalThis.__combat?.r3f?.gl?.domElement;
    let main = gl ?? null;
    if (!main) {
      let area = 0;
      for (const c of document.querySelectorAll("canvas")) {
        const a = c.clientWidth * c.clientHeight;
        if (a > area) {
          area = a;
          main = c;
        }
      }
    }
    for (const c of document.querySelectorAll("[data-ld-main]"))
      c.removeAttribute("data-ld-main");
    if (main) main.setAttribute("data-ld-main", "1");
    style.textContent = show
      ? ""
      : "body *{visibility:hidden !important} [data-ld-main]{visibility:visible !important}";
  }, visible);
}

async function frameStats(buffer) {
  return page.evaluate(
    async (dataUrl) => {
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
        image.src = dataUrl;
      });
      const c = document.createElement("canvas");
      c.width = image.width;
      c.height = image.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(image, 0, 0);
      const { data } = ctx.getImageData(0, 0, c.width, c.height);
      let sum = 0;
      let clip = 0;
      let crush = 0;
      let sat = 0;
      let n = 0;
      for (let i = 0; i < data.length; i += 16) {
        const r = data[i] / 255;
        const g = data[i + 1] / 255;
        const b = data[i + 2] / 255;
        const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        sum += l;
        if (l > 0.995) clip += 1;
        if (l < 0.005) crush += 1;
        const mx = Math.max(r, g, b);
        sat += mx > 0 ? (mx - Math.min(r, g, b)) / mx : 0;
        n += 1;
      }
      return {
        luma: +(sum / n).toFixed(4),
        clippedPct: +((clip / n) * 100).toFixed(2),
        crushedPct: +((crush / n) * 100).toFixed(2),
        saturation: +(sat / n).toFixed(4),
      };
    },
    `data:image/png;base64,${buffer.toString("base64")}`,
  );
}

const manifest = [];
const started = Date.now();
const lines = [];

// A fresh dev server optimises its dependencies on the first page load and
// then forces one full reload, which destroys the page mid-shot. A shot that
// dies to a navigation is retried once on a freshly loaded page.
const retried = new Set();
for (let si = 0; si < shots.length; si += 1) {
  const shot = shots[si];
  const t0 = Date.now();
  try {
    await ensurePage(shot);
    if (shot.setup)
      await page.evaluate(`(async (ld) => { ${shot.setup} })(globalThis.__ld)`);
    await runActions(shot.actions);
    if ((shot.frames ?? 3) > 0) await waitFrames(shot.frames ?? 3);
    if (shot.pin) {
      await page.evaluate(`(async (ld) => { ${shot.pin} })(globalThis.__ld)`);
      await waitFrames(1);
    }
    await setHud(shot.hud === true);
    const path = `${outDir}/${shot.id}.png`;
    const buffer = await page.screenshot({ path });
    await setHud(true);
    const stats = await frameStats(buffer);
    const perf = await page
      .evaluate(() => {
        const h = globalThis.__combat;
        return h
          ? {
              draws: h.game.stats.drawCalls,
              tris: h.game.stats.triangles,
              frameMs: Math.round(h.game.stats.frameMs),
            }
          : {};
      })
      .catch(() => ({}));
    await runActions(shot.after);
    const secs = Math.round((Date.now() - t0) / 1000);
    manifest.push({ id: shot.id, note: shot.note ?? "", ...stats, ...perf, secs });
    const line =
      `${shot.id.padEnd(20)} luma ${String(stats.luma).padEnd(6)} clip ${String(stats.clippedPct).padEnd(5)}% ` +
      `crush ${String(stats.crushedPct).padEnd(5)}% sat ${String(stats.saturation).padEnd(6)} ` +
      `${perf.draws ?? "-"} draws ${perf.tris ?? "-"} tris  ${secs}s  -> ${path}`;
    lines.push(line);
    console.log(line);
  } catch (error) {
    currentUrl = null;
    if (
      /context was destroyed|navigation|Target closed/i.test(String(error)) &&
      !retried.has(si)
    ) {
      retried.add(si);
      console.log(`${shot.id.padEnd(20)} page reloaded mid-shot; retrying`);
      si -= 1;
      continue;
    }
    const line = `${shot.id.padEnd(20)} FAILED: ${String(error).slice(0, 300)}`;
    lines.push(line);
    console.log(line);
    manifest.push({ id: shot.id, error: String(error).slice(0, 300) });
    currentUrl = null;
  }
}

await browser.close();
releaseSlot();
await writeFile(
  `${outDir}/manifest.json`,
  `${JSON.stringify({ origin, quality, shots: manifest, pageErrors: errors.slice(0, 20) }, null, 2)}\n`,
);
const summary =
  `${lines.join("\n")}\n` +
  (errors.length ? `\n${errors.length} page error(s); first: ${errors[0]}\n` : "") +
  `\n${manifest.length} shots in ${Math.round((Date.now() - started) / 1000)}s -> ${outDir}\n`;
if (errors.length) console.log(`\n${errors.length} page error(s); first: ${errors[0]}`);
console.log(
  `\n${manifest.length} shots in ${Math.round((Date.now() - started) / 1000)}s -> ${outDir}`,
);
if (!compareDir) await writeFile(`${outDir}/.done`, summary);

/**
 * `--compare <dir>`: how far each frame moved from an earlier capture of the
 * same set. Statistics first (exposure, clipping, crush), then the mean
 * absolute pixel difference, which is the number that says whether a change
 * reached a frame it was not meant to touch.
 */
if (compareDir) await compareRuns(manifest, summary);

async function compareRuns(manifest, summary) {
  let before = null;
  try {
    before = JSON.parse(readFileSync(`${compareDir}/manifest.json`, "utf8"));
  } catch {
    console.log(`\nno manifest in ${compareDir}; nothing to compare`);
    await writeFile(`${outDir}/.done`, summary);
  }
  if (before) {
    const probe = await puppeteer.launch({ headless: "shell", args: ["--no-sandbox"] });
    const p2 = await probe.newPage();
    const lines2 = [`\nagainst ${compareDir}:`];
    for (const now of manifest) {
      const then = before.shots.find((x) => x.id === now.id);
      if (!then || now.error || then.error) continue;
      const a = readFileSync(`${compareDir}/${now.id}.png`).toString("base64");
      const b = readFileSync(`${outDir}/${now.id}.png`).toString("base64");
      const diff = await p2.evaluate(
        async (aUrl, bUrl) => {
          const load = (src) =>
            new Promise((resolve, reject) => {
              const im = new Image();
              im.onload = () => resolve(im);
              im.onerror = reject;
              im.src = src;
            });
          const [ia, ib] = await Promise.all([load(aUrl), load(bUrl)]);
          const w = Math.min(ia.width, ib.width);
          const h = Math.min(ia.height, ib.height);
          const pixels = (im) => {
            const c = document.createElement("canvas");
            c.width = w;
            c.height = h;
            const ctx = c.getContext("2d");
            ctx.drawImage(im, 0, 0, w, h);
            return ctx.getImageData(0, 0, w, h).data;
          };
          const da = pixels(ia);
          const db = pixels(ib);
          let sum = 0;
          let changed = 0;
          let n = 0;
          for (let i = 0; i < da.length; i += 4) {
            const d =
              (Math.abs(da[i] - db[i]) +
                Math.abs(da[i + 1] - db[i + 1]) +
                Math.abs(da[i + 2] - db[i + 2])) /
              3;
            sum += d;
            if (d > 12) changed += 1;
            n += 1;
          }
          return {
            mad: +(sum / n).toFixed(2),
            changedPct: +((changed / n) * 100).toFixed(1),
          };
        },
        `data:image/png;base64,${a}`,
        `data:image/png;base64,${b}`,
      );
      const moved = ["luma", "clippedPct", "crushedPct", "saturation"]
        .filter(
          (k) => Math.abs(now[k] - then[k]) > Math.max(0.0005, Math.abs(then[k]) * 0.02),
        )
        .map((k) => `${k} ${then[k]} -> ${now[k]}`);
      lines2.push(
        `  ${now.id.padEnd(16)} pixels changed ${String(diff.changedPct).padStart(5)}%  mean diff ${String(diff.mad).padStart(5)}  ` +
          `draws ${then.draws ?? "-"} -> ${now.draws ?? "-"}  ${moved.join(", ") || "stats steady"}`,
      );
    }
    await probe.close();
    const text = lines2.join("\n");
    console.log(text);
    await writeFile(`${outDir}/compare.txt`, `${text}\n`);
    await writeFile(`${outDir}/.done`, `${summary}${text}\n`);
  }
}
