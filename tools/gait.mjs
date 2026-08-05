#!/usr/bin/env node
/**
 * Gait measurement harness.
 *
 * A screenshot cannot tell you whether a knee bends the right way. The last
 * version of this rig drove the knee with a positive rotation on a model that
 * faces -z, which hyperextended it through every step, and it survived several
 * rounds of visual review because a still frame of a bent leg looks like a bent
 * leg whichever way it is bent.
 *
 * So this measures instead. It drives one bot's animator directly with a fixed
 * delta — the render loop is useless here, since a headless capture advances a
 * handful of frames and a stride takes about sixty — and samples the skeleton
 * across several full cycles at walking, jogging and sprinting speed. Four
 * properties have to hold at every sample:
 *
 *   1. The knee is always forward of the hip-to-ankle line. This is the one
 *      that was broken.
 *   2. The leg never straightens through: hip-to-ankle stays below full reach.
 *   3. Feet reach the ground — the lower ankle sits near ankle height, not
 *      hovering above it or buried under it.
 *   4. A planted foot does not slide. Over one step the slowest foot must move
 *      far less than the body does.
 *
 *   node tools/gait.mjs
 *   node tools/gait.mjs http://localhost:5173
 *
 * Exits non-zero if any check fails.
 */

import puppeteer from "puppeteer";

const origin = process.argv[2] ?? "http://localhost:5173";
const url = `${origin}/play?autoplay=1&quality=2`;

const browser = await puppeteer.launch({
  headless: "shell",
  args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-gl=angle"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
await new Promise((resolve) => setTimeout(resolve, 10000));

const report = await page.evaluate(() => {
  const handle = globalThis.__combat;
  if (!handle) return { error: "globalThis.__combat missing" };
  const { game } = handle;
  if (!game.characters) return { error: "character rig not bound" };

  const actor = game.actors.find((a) => !a.isPlayer && a.alive);
  if (!actor) return { error: "no live bot to measure" };

  const bones = game.characters.bonesOf(actor.id);
  if (!bones) return { error: "actor has no bones" };

  // Bone indices, mirroring `B` in rig.ts.
  const idx = {};
  bones.forEach((b, i) => {
    idx[b.name] = i;
  });

  // Read world positions straight out of the bone matrices, so the harness
  // needs nothing from three beyond what the page already built.
  const world = (i) => {
    const e = bones[i].matrixWorld.elements;
    return { x: e[12], y: e[13], z: e[14] };
  };
  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

  const thighLen = dist(world(idx.thighL), world(idx.shinL));
  const shinLen = dist(world(idx.shinL), world(idx.footL));

  const speeds = [
    { name: "walk", speed: 1.3 },
    { name: "jog", speed: 3.2 },
    { name: "sprint", speed: 6.0 },
  ];
  const results = [];

  for (const trial of speeds) {
    // Park the actor somewhere flat and open, and drive it forward at a fixed
    // speed. Position advances by hand: the point is to test the animation
    // against motion, not to run the physics.
    actor.position.set(
      game.player.position.x + 6,
      game.player.position.y,
      game.player.position.z,
    );
    actor.yaw = 0;
    actor.pitch = 0;
    actor.stance = "stand";
    actor.state = trial.speed > 5 ? "sprint" : "run";
    actor.speed = trial.speed;
    actor.velocity.set(0, 0, -trial.speed);
    actor.suppression = 0;

    const dt = 1 / 60;
    // Settle the damped speed and the body yaw before measuring.
    for (let i = 0; i < 90; i += 1) {
      actor.position.z -= trial.speed * dt;
      game.characters.poseOnly(actor.id, dt, true);
    }

    let worstKneeBack = -Infinity; // >0 means the knee bent backward
    let worstExtension = 0; // fraction of full reach
    let closestContact = Infinity; // how near a foot ever gets to the ground
    let worstSlip = 0; // planted-foot horizontal travel per body step
    let plantedSamples = 0;

    const last = [world(idx.footL), world(idx.footR)];
    const wasPlanted = [false, false];

    const samples = 240;
    for (let i = 0; i < samples; i += 1) {
      actor.position.z -= trial.speed * dt;
      game.characters.poseOnly(actor.id, dt, true);

      for (const side of ["L", "R"]) {
        const hip = world(idx["thigh" + side]);
        const knee = world(idx["shin" + side]);
        const ankle = world(idx["foot" + side]);

        // Perpendicular offset of the knee from the hip-to-ankle line, in the
        // character's own frame. Forward is -z at yaw 0, so a correct knee has
        // a negative z here.
        const line = sub(ankle, hip);
        const len = Math.hypot(line.x, line.y, line.z);
        const t = dot(sub(knee, hip), line) / Math.max(1e-6, len * len);
        worstKneeBack = Math.max(worstKneeBack, knee.z - (hip.z + line.z * t));

        worstExtension = Math.max(worstExtension, len / (thighLen + shinLen));
      }

      // Contact and slip are per foot, and only meaningful while a foot is
      // actually down. A run has a flight phase where neither foot is on the
      // ground, and through heel strike and toe-off the ankle rides above the
      // sole on purpose — neither is a fault, so neither is measured as one.
      for (let leg = 0; leg < 2; leg += 1) {
        const ankle = world(idx[leg === 0 ? "footL" : "footR"]);
        const above = ankle.y - (game.world.groundAt(ankle.x, ankle.z) + 0.086);
        const planted = above < 0.025;
        closestContact = Math.min(closestContact, Math.abs(above));
        if (planted) plantedSamples += 1;
        // Both ends of the interval have to be planted, or this measures the
        // foot arriving rather than the foot sliding. Horizontal only: a
        // planted foot may roll, it may not travel.
        if (planted && wasPlanted[leg]) {
          const slid = Math.hypot(ankle.x - last[leg].x, ankle.z - last[leg].z);
          worstSlip = Math.max(worstSlip, slid / (trial.speed * dt));
        }
        last[leg] = ankle;
        wasPlanted[leg] = planted;
      }
    }

    results.push({
      name: trial.name,
      speed: trial.speed,
      kneeBack: +worstKneeBack.toFixed(4),
      extension: +worstExtension.toFixed(4),
      contact: +closestContact.toFixed(4),
      slip: +worstSlip.toFixed(3),
      plantedFraction: +(plantedSamples / (samples * 2)).toFixed(3),
    });
  }

  return { results, legLength: +(thighLen + shinLen).toFixed(3) };
});

if (report.error) {
  console.error(`gait: ${report.error}`);
  await browser.close();
  process.exit(1);
}

const checks = [];
for (const r of report.results) {
  checks.push({
    name: `${r.name}: knee bends forward`,
    // A correct knee sits forward of the hip-to-ankle line, so its offset is
    // negative. Allow a hair of slack for the near-straight stance pose.
    pass: r.kneeBack < 0.004,
    detail: `worst offset ${r.kneeBack >= 0 ? "+" : ""}${r.kneeBack} m (negative = forward)`,
  });
  checks.push({
    name: `${r.name}: leg never locks out`,
    pass: r.extension < 0.995,
    detail: `${(r.extension * 100).toFixed(1)}% of full reach`,
  });
  checks.push({
    name: `${r.name}: feet reach the ground`,
    pass: r.contact < 0.01,
    detail: `closest approach ${(r.contact * 1000).toFixed(0)} mm`,
  });
  checks.push({
    name: `${r.name}: foot is down often enough`,
    // Below about a third of the cycle per foot the gait is bounding, not
    // running; above two thirds nothing ever leaves the ground.
    pass: r.plantedFraction > 0.2 && r.plantedFraction < 0.75,
    detail: `${(r.plantedFraction * 100).toFixed(0)}% of samples planted`,
  });
  checks.push({
    name: `${r.name}: planted foot does not slide`,
    // A foot in contact should hold still while the body moves past it.
    pass: r.slip < 0.12,
    detail: `${(r.slip * 100).toFixed(1)}% of body travel`,
  });
}

let failed = 0;
for (const c of checks) {
  if (!c.pass) failed += 1;
  console.log(`${c.pass ? "  ok  " : " FAIL "} ${c.name.padEnd(36)} ${c.detail}`);
}
console.log(`\nleg length ${report.legLength} m`);
console.log(`${checks.length - failed}/${checks.length} checks passed`);

await browser.close();
process.exit(failed === 0 ? 0 : 1);
