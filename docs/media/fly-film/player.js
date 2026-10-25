import { createFilm, duration } from "./film.js";
const el = (id) => document.getElementById(id),
  canvas = el("film"),
  audio = el("audio"),
  play = el("play"),
  seek = el("seek"),
  still = el("still"),
  cc = el("captions");
const preference = matchMedia("(prefers-reduced-motion: reduce)");
still.checked = preference.matches;
let film,
  cues,
  raf = 0;
const starts = [0, 7, 15, 24, 32, 41, 50],
  ends = [7, 15, 24, 32, 41, 50, 58];
function paint() {
  const t = audio.currentTime;
  const index = Math.max(
    0,
    starts.findLastIndex((s) => t >= s),
  );
  if (film)
    film.draw(
      still.checked ? (starts[index] + ends[index]) / 2 : t,
      canvas.width,
      canvas.height,
      { captions: cc.checked && !still.checked },
    );
  const cue = cues?.find((c) => t >= c[0] && t < c[1]);
  el("caption").textContent = still.checked && cc.checked && cue ? cue[2] : "";
  el("caption").style.cssText = still.checked
    ? "position:absolute;bottom:10px;left:3%;width:94%;padding:10px;background:#133634ed;color:#f4efdf;text-align:center;font:16px/1.4 Arial;"
    : "";
  seek.value = String(t);
  el("time").textContent = `0:${Math.floor(t).toString().padStart(2, "0")} / 0:58`;
}
function resize() {
  const vertical = innerWidth < 650;
  canvas.width = vertical ? 1080 : 1920;
  canvas.height = vertical ? 1920 : 1080;
  paint();
}
function loop() {
  paint();
  if (!audio.paused && !audio.ended) raf = requestAnimationFrame(loop);
}
play.addEventListener("click", async () => {
  if (!audio.paused) {
    audio.pause();
    return;
  }
  if (audio.ended) audio.currentTime = 0;
  try {
    await audio.play();
  } catch {
    el("status").textContent =
      "Audio could not start. Please use the MP4 download below.";
  }
});
audio.addEventListener("play", () => {
  play.textContent = "Pause";
  el("status").textContent = "Playing · synthetic narration and original music";
  cancelAnimationFrame(raf);
  loop();
});
audio.addEventListener("pause", () => {
  play.textContent = "Play with sound";
  cancelAnimationFrame(raf);
  paint();
});
audio.addEventListener("ended", () => {
  play.textContent = "Replay with sound";
  el("status").textContent = "The film has ended. The garden carries on.";
  paint();
});
audio.addEventListener("error", () => {
  el("status").textContent = "The soundtrack could not load. Use the MP4 download below.";
});
el("restart").addEventListener("click", () => {
  audio.currentTime = 0;
  paint();
});
seek.addEventListener("input", () => {
  audio.currentTime = Number(seek.value);
  paint();
});
cc.addEventListener("change", paint);
still.addEventListener("change", paint);
preference.addEventListener("change", (event) => {
  still.checked = event.matches;
  paint();
});
addEventListener("resize", resize);
try {
  const [observation, captions] = await Promise.all(
    ["observation.json", "cues.json"].map(async (name) => {
      const r = await fetch(name);
      if (!r.ok) throw Error("Asset unavailable");
      return r.json();
    }),
  );
  cues = captions;
  const garden = new Image();
  garden.src = "garden.jpg";
  await garden.decode();
  film = createFilm(canvas.getContext("2d"), { garden, observation, cues });
  resize();
  film.draw(53, canvas.width, canvas.height, { captions: false });
  for (const [, , str] of cues) {
    const p = document.createElement("p");
    p.textContent = str;
    el("transcript").append(p);
  }
  play.disabled = false;
  play.textContent = "Play with sound";
  el("status").textContent = still.checked
    ? "Reduced motion is on. Scenes remain still while the narration plays."
    : "Ready. Sound starts when you press Play.";
} catch {
  play.textContent = "Film unavailable";
  el("status").textContent =
    "Please open this folder through a web server, or use the MP4 download below.";
}
