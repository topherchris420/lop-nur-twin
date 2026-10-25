/** Offline rendering; install @napi-rs/canvas, and put ffmpeg on PATH. */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { createFilm, duration } from "./film.js";
const require = createRequire(import.meta.url);
let canvasLib;
try {
  canvasLib = require("@napi-rs/canvas");
} catch {
  canvasLib = require(
    `${process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES}/@napi-rs/canvas`,
  );
}
const { createCanvas, loadImage, GlobalFonts } = canvasLib;
for (const [path, name] of [
  ["/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf", "Georgia"],
  ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "Arial"],
]) {
  try {
    GlobalFonts.registerFromPath(path, name);
  } catch {
    /* system fallback */
  }
}
const root = fileURLToPath(new URL(".", import.meta.url));
const assets = {
  garden: await loadImage(root + "garden.jpg"),
  observation: JSON.parse(readFileSync(root + "observation.json")),
  cues: JSON.parse(readFileSync(root + "cues.json")),
};
const vertical = process.argv.includes("--vertical"),
  W = vertical ? 1080 : 1920,
  H = vertical ? 1920 : 1080;
const canvas = createCanvas(W, H),
  ctx = canvas.getContext("2d"),
  film = createFilm(ctx, assets);
if (process.argv.includes("--preview")) {
  for (const s of [3, 10, 19, 28, 36, 45, 54]) {
    film.draw(s, W, H);
    writeFileSync(
      root + `preview-${vertical ? "v" : "h"}-${s}.jpg`,
      canvas.toBuffer("image/jpeg", 90),
    );
  }
  film.draw(53, W, H, { captions: false });
  writeFileSync(
    root + (vertical ? "poster-vertical.jpg" : "poster.jpg"),
    canvas.toBuffer("image/jpeg", 92),
  );
} else {
  const output = vertical
    ? "a-life-three-millimeters-long-vertical.mp4"
    : "a-life-three-millimeters-long.mp4";
  const fps = 30;
  const ff = spawn(
    "ffmpeg",
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgba",
      "-s",
      `${W}x${H}`,
      "-r",
      String(fps),
      "-i",
      "pipe:0",
      "-i",
      root + "soundtrack.m4a",
      "-i",
      root + "captions.srt",
      "-map",
      "0:v",
      "-map",
      "1:a",
      "-map",
      "2:s",
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "24",
      "-threads",
      "4",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "copy",
      "-c:s",
      "mov_text",
      "-metadata:s:s:0",
      "language=eng",
      "-t",
      String(duration),
      "-movflags",
      "+faststart",
      root + output,
    ],
    { stdio: ["pipe", "inherit", "inherit"] },
  );
  const exited = once(ff, "exit");
  ff.stdin.on("error", (e) => {
    if (e.code !== "EPIPE") throw e;
  });
  for (let i = 0; i < fps * duration; i++) {
    film.draw(i / fps, W, H);
    const data = ctx.getImageData(0, 0, W, H).data;
    if (!ff.stdin.write(Buffer.from(data.buffer, data.byteOffset, data.byteLength)))
      await once(ff.stdin, "drain");
    if (i % 300 === 0) console.log(`${output}: ${i / fps}s`);
  }
  ff.stdin.end();
  const [code] = await exited;
  if (code !== 0) throw new Error(`ffmpeg exited ${code}`);
  console.log(output + " complete");
}
