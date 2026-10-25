/** Publish the isolated film as real static files, outside the SPA fallback. */
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const source = new URL("../docs/media/fly-film/", import.meta.url);
const destination = new URL("../dist/film/", import.meta.url);
const files = [
  ["watch.html", "index.html"],
  ["index.html", "animation.html"],
  ...[
    "player.css",
    "player.js",
    "film.js",
    "garden-observation.js",
    "garden.jpg",
    "observation.json",
    "cues.json",
    "soundtrack.m4a",
    "poster.jpg",
    "poster-vertical.jpg",
    "captions.vtt",
    "captions.srt",
    "a-life-three-millimeters-long.mp4",
    "a-life-three-millimeters-long-vertical.mp4",
  ].map((name) => [name, name]),
];
// Do not silently ship a page with a missing source or empty media file.
for (const [name] of files) {
  const bytes = await readFile(new URL(name, source));
  if (!bytes.length) throw new Error(`Empty film asset: ${name}`);
}
await mkdir(destination, { recursive: true });
for (const [from, to] of files) {
  await copyFile(new URL(from, source), new URL(to, destination));
}
console.log(
  `fly-film: ${files.length} static files published to ${fileURLToPath(destination)}`,
);
