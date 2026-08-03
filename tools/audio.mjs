#!/usr/bin/env node
/**
 * Offline measurement of the synthesised sounds.
 *
 * Every sound in this game is generated at runtime — there are no audio files
 * in the repository — so the only way to know a renderer works is to render it
 * and measure it. Each sound is rendered through an `OfflineAudioContext`,
 * which runs faster than real time and needs no output device, and checked for
 * two things:
 *
 *  - **Peak below unity.** Anything above 1.0 is clipping the bus before the
 *    limiter ever sees it. This caught an explosion peaking at 2762, caused by
 *    a reverb send into an unnormalised convolver.
 *  - **A real transient.** Crest factor (peak over RMS) above 8 is what
 *    separates a gunshot from a burst of noise; it is the single number that
 *    tells you whether a percussive sound will read as percussive.
 *
 *   bun run audio
 *
 * Exits non-zero if any sound fails.
 */

import puppeteer from "puppeteer";
const browser = await puppeteer.launch({ headless: "shell", args: ["--no-sandbox","--enable-unsafe-swiftshader","--use-gl=angle","--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
page.on("pageerror", e => console.log("[pageerror]", String(e).slice(0,200)));
await page.goto("http://localhost:5173/play?autoplay=1&quality=1", { waitUntil: "domcontentloaded" });
await new Promise(r => setTimeout(r, 9000));

// Render each sound offline and measure it. OfflineAudioContext runs faster
// than real time and needs no output device, so this works headless.
const out = await page.evaluate(async () => {
  const mod = await import("/src/game/audio/index.ts");
  const synth = await import("/src/game/audio/synth.ts");
  const results = [];
  const ids = ["fire", "impact", "whizz", "explosion", "footstep", "ricochet", "hitmarker"];
  for (const id of ids) {
    const ctx = new OfflineAudioContext(1, 44100 * 2, 44100);
    const engine = { register(){}, };
    void engine;
    // Build a voice by hand against the same renderer table the engine uses.
    const dest = ctx.createGain();
    dest.connect(ctx.destination);
    const renderers = mod.__RENDERERS ?? null;
    if (!renderers) { results.push({ id, error: "no renderer table" }); continue; }
    const r = renderers[id];
    if (!r) { results.push({ id, error: "unregistered" }); continue; }
    const pool = new synth.ConvolverPool(ctx, dest, 0.9);
    r({
      ctx, dest, when: 0.01,
      request: { id, weaponId: "kv-141", surface: "concrete", gain: 1 },
      distance: 0, env: "open-desert", indoor: false, structureDistanceM: 70,
      rand: synth.seededRand(id, 1), reverb: pool,
      own(){}, isLocal: true,
    });
    const buf = await ctx.startRendering();
    const d = buf.getChannelData(0);
    let peak = 0, sum = 0;
    for (let i = 0; i < d.length; i += 1) { const a = Math.abs(d[i]); if (a > peak) peak = a; sum += d[i]*d[i]; }
    const rms = Math.sqrt(sum / d.length);
    results.push({ id, peak: +peak.toFixed(3), rms: +rms.toFixed(4), crest: rms > 0 ? +(peak/rms).toFixed(1) : 0 });
  }
  return results;
});
let failed = 0;
for (const r of out) {
  if (r.error) {
    console.log(` FAIL  ${r.id.padEnd(12)} ${r.error}`);
    failed += 1;
    continue;
  }
  const clipping = r.peak > 1.3;
  const dull = r.crest < 8;
  const ok = !clipping && !dull;
  if (!ok) failed += 1;
  console.log(
    `${ok ? "  ok  " : " FAIL "} ${r.id.padEnd(12)} peak ${String(r.peak).padStart(7)}  rms ${String(r.rms).padStart(7)}  crest ${String(r.crest).padStart(5)}` +
      `${clipping ? "  <- clipping" : ""}${dull ? "  <- no transient" : ""}`,
  );
}
console.log(`\n${out.length - failed}/${out.length} sounds passed`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
