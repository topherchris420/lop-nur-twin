// Original deterministic Canvas 2D animation. Marketing illustration, not a simulation.
import { drawObservation } from "./garden-observation.js";
export const duration = 58;
const C = {
  paper: "#f4efdf",
  ink: "#183a38",
  teal: "#0b5d63",
  gold: "#bc8950",
  green: "#67805a",
  copper: "#a95d42",
};
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const ease = (x) => {
  x = clamp(x);
  return x * x * (3 - 2 * x);
};
const mix = (a, b, t) => a + (b - a) * t;
export function createFilm(ctx, assets) {
  let W = 1920,
    H = 1080,
    V = false,
    t = 0;
  function ellipse(x, y, rx, ry, fill, rot = 0, stroke = null, lw = 1) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lw;
      ctx.stroke();
    }
  }
  function path(points, color, lw = 2, dash = []) {
    ctx.beginPath();
    points.forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p)));
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.setLineDash(dash);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  function text(str, x, y, size = 32, color = C.ink, face = "sans", align = "left") {
    ctx.textAlign = align;
    ctx.textBaseline = "alphabetic";
    ctx.font = `${face === "italic" ? "italic " : ""}${size}px ${face === "sans" ? "Arial, sans-serif" : face === "mono" ? "monospace" : "Georgia, serif"}`;
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }
  function small(str, x, y, color = C.teal, align = "left") {
    text(str, x, y, 18, color, "mono", align);
  }
  function title(lines, x, y, size = 90, color = C.ink) {
    lines.forEach((s, i) => text(s, x, y + i * size * 1.07, size, color, "serif"));
  }
  function card(x, y, w, h, fill = C.paper) {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
  }
  function leaf(x, y, s, rot, fill = C.green) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.moveTo(-s, 0);
    ctx.bezierCurveTo(-s * 0.3, -s * 0.65, s * 0.65, -s * 0.8, s, 0);
    ctx.bezierCurveTo(s * 0.5, s * 0.7, -s * 0.5, s * 0.7, -s, 0);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = C.ink + "50";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    path(
      [
        [-s, 0],
        [s, 0],
      ],
      "#dce0b3",
      1.5,
    );
    for (let i = -3; i < 4; i++) {
      const q = i * s * 0.2;
      path(
        [
          [q, 0],
          [q + s * 0.3, -s * 0.25],
        ],
        "#e5e9bd66",
        1,
      );
      path(
        [
          [q, 0],
          [q + s * 0.3, s * 0.25],
        ],
        "#e5e9bd66",
        1,
      );
    }
    ctx.restore();
  }
  function fly(x, y, scale = 1, angle = 0, flying = false, groom = false) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(scale, scale);
    ellipse(10, 38, 83, 15, "#183a3818");
    // Exactly six articulated legs, one pair of wings, red compound eyes.
    for (let side of [-1, 1])
      for (let i = 0; i < 3; i++) {
        const phase = t * 9 + i * 2 + (side > 0 ? 1 : 0),
          walk = flying ? 0 : Math.sin(phase) * 4;
        const yy = -17 + i * 22;
        path(
          [
            [side * 15, yy],
            [side * (40 + i * 5), yy - 15 + walk],
            [side * (65 + i * 8), yy + 18 + walk],
            [side * (76 + i * 7), yy + 22 + walk],
          ],
          "#2a3831",
          2.5,
        );
        if (groom && i === 0)
          path(
            [
              [side * 14, -24],
              [side * 27, -67 + Math.sin(t * 18) * 6],
              [side * 8, -76],
            ],
            "#2a3831",
            2.5,
          );
      }
    ellipse(0, 24, 27, 53, "#aa8755", 0, C.ink, 2);
    for (let j = 0; j < 5; j++) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(0, 24, 27, 53, 0, 0, Math.PI * 2);
      ctx.clip();
      path(
        [
          [-32, j * 16 + 1],
          [32, j * 16 + 7],
        ],
        "#594e34",
        5,
      );
      ctx.restore();
    }
    for (let side of [-1, 1]) {
      ctx.save();
      ctx.translate(side * 14, -24);
      ctx.rotate(side * (flying ? 0.85 + Math.sin(t * 43) * 0.32 : 0.33));
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(side * 45, -58, side * 91, -64, side * 61, 18);
      ctx.bezierCurveTo(side * 39, 58, side * 12, 66, 0, 0);
      ctx.fillStyle = flying ? "#eef3dba8" : "#e2ead9ce";
      ctx.fill();
      ctx.strokeStyle = "#596f6277";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      for (let j = 1; j < 5; j++) {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(side * j * 12, -j * 8, side * (20 + j * 8), j * 8);
        ctx.stroke();
      }
      ctx.restore();
    }
    ellipse(0, -22, 25, 29, "#7d7950", 0, C.ink, 2);
    ellipse(-7, -28, 8, 20, "#c0ad73");
    ellipse(0, -55, 24, 18, "#696644", 0, C.ink, 2);
    for (let side of [-1, 1]) {
      ellipse(side * 18, -58, 13, 16, C.copper, side * 0.18, C.ink, 1.5);
      for (let j = 0; j < 17; j++) {
        const a = j * 2.4,
          r = Math.sqrt(j) * 2.2;
        ellipse(side * 18 + Math.cos(a) * r, -58 + Math.sin(a) * r, 1, 1, "#e4ba7e99");
      }
      path(
        [
          [side * 6, -68],
          [side * 10, -79],
          [side * 18, -83],
        ],
        C.ink,
        1.5,
      );
    }
    // Fine thorax bristles.
    for (let j = 0; j < 12; j++) {
      const a = (j / 12) * Math.PI * 2;
      path(
        [
          [Math.cos(a) * 21, -22 + Math.sin(a) * 24],
          [Math.cos(a) * 29, -22 + Math.sin(a) * 32],
        ],
        "#26382d",
        0.8,
      );
    }
    ctx.restore();
  }
  function garden(alpha = 1, night = false) {
    ctx.save();
    ctx.globalAlpha *= alpha;
    const sw = assets.garden.width,
      sh = assets.garden.height;
    const z = 1.03 + Math.sin(t * 0.1) * 0.015,
      s = Math.max(W / sw, H / sh) * z;
    ctx.drawImage(
      assets.garden,
      (W - sw * s) / 2 + Math.sin(t * 0.09) * 16,
      (H - sh * s) / 2,
      sw * s,
      sh * s,
    );
    if (night) {
      card(0, 0, W, H, "#073239a8");
    }
    // Separate botanical foreground gives the plate true animated parallax.
    leaf(
      W - 28,
      H - 190,
      180,
      2.6 + Math.sin(t * 0.4) * 0.025,
      night ? "#17463e" : "#4c6a48",
    );
    leaf(
      W - 35,
      H - 66,
      140,
      3.6 + Math.sin(t * 0.5) * 0.035,
      night ? "#224e45" : "#6b854c",
    );
    for (let i = 0; i < 19; i++) {
      const x = ((i * 173.1 + t * (6 + (i % 3))) % (W + 100)) - 50,
        y = ((i * 97.3) % H) + Math.sin(t * 0.5 + i) * 18;
      ellipse(x, y, 1.5 + (i % 3), 1.5 + (i % 3), night ? "#e8cf8880" : "#fff8cf99");
    }
    ctx.restore();
  }
  function header(index, label, dark = false) {
    const color = dark ? "#d8e5d9" : C.teal;
    card(0, 0, W, 146, dark ? "#0c3539e8" : "#f4efdfec");
    small("VERS3DYNAMICS  /  FIELD FILM 01", V ? 64 : 96, 66, color);
    small(`${index} / ${label}`, V ? 64 : 96, V ? 112 : 108, color);
    path(
      [
        [V ? 64 : 96, 132],
        [W - (V ? 64 : 96), 132],
      ],
      dark ? "#d8e5d940" : "#183a3828",
      1,
    );
  }
  function scene0(u) {
    garden();
    const gx = V ? W * 0.5 : W * 0.66,
      gy = H * 0.6;
    fly(gx + Math.sin(t) * 25, gy + Math.cos(t * 0.8) * 12, 0.15, 1.1, true);
    ctx.save();
    ctx.globalAlpha = ease(u / 1.2);
    card(V ? 40 : 70, V ? H * 0.18 : 240, V ? W - 80 : 850, V ? 420 : 435, "#f4efdfed");
    small("BETHESDA, MARYLAND", V ? 76 : 110, V ? H * 0.18 + 60 : 300);
    title(
      ["There is a fly", "in Bethesda."],
      V ? 76 : 110,
      V ? H * 0.18 + 150 : 402,
      V ? 76 : 91,
    );
    text(
      "An enormous world. A very small beginning.",
      V ? 76 : 110,
      V ? H * 0.18 + 350 : 593,
      V ? 25 : 30,
      C.ink,
      "italic",
    );
    ctx.restore();
    header("01", "THE WORLD");
  }
  function scene1(u) {
    header("02", "THE DISCOVERY");
    const x = V ? W * 0.5 : W * 0.72,
      y = V ? H * 0.58 : H * 0.48;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.18 + Math.sin(t * 0.5) * 0.035);
    ellipse(0, 0, V ? 360 : 355, V ? 360 : 355, "#e7e3ce");
    for (let i = 0; i < 4; i++) {
      ctx.strokeStyle = "#0b5d6313";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, 100 + i * 70, 0, 6.29);
      ctx.stroke();
    }
    ctx.restore();
    fly(x, y, 3.5 + ease(u / 4) * 0.25, -0.35, u > 3 && u < 5);
    const tx = V ? 64 : 96,
      ty = V ? 240 : 330;
    title(["A life three", "millimeters long."], tx, ty, V ? 75 : 89);
    text("A DAY IN THE LIFE", tx, ty + 230, 20, C.teal, "mono");
    text("Body. Senses. Surroundings.", tx, ty + 280, V ? 29 : 32, C.ink, "italic");
    path(
      [
        [x - 140, y + 305],
        [x + 140, y + 305],
      ],
      C.teal,
      2,
    );
    path(
      [
        [x - 140, y + 295],
        [x - 140, y + 315],
      ],
      C.teal,
      2,
    );
    path(
      [
        [x + 140, y + 295],
        [x + 140, y + 315],
      ],
      C.teal,
      2,
    );
    small("≈ 3 mm BODY · DRAWN ENLARGED", x, y + 348, C.teal, "center");
    small("ILLUSTRATION / ANATOMY-INSPIRED", tx, H - 125);
  }
  function scene2(u) {
    garden(1);
    card(0, 0, W, H, "#f4efdf45");
    const x = V ? W * 0.5 : W * 0.7,
      y = H * 0.57;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.12);
    ellipse(0, 90, 300, 30, "#273f2925");
    leaf(20, 0, V ? 340 : 440, 0.12, "#6c8e59");
    ctx.restore();
    const land = ease((u - 1) / 2),
      fx = mix(-150, x, land),
      fy = mix(H * 0.36, y - 35, land);
    fly(fx, fy, 1.4, 1.4, u < 3, u > 5);
    card(V ? 40 : 70, V ? 200 : 230, V ? W - 80 : 770, 330, "#f4efdfed");
    small("SMALL NEEDS. A WIDE WORLD.", V ? 76 : 110, V ? 260 : 290);
    title(
      ["A little sweetness.", "A little shelter."],
      V ? 76 : 110,
      V ? 350 : 390,
      V ? 67 : 76,
    );
    text(
      "Explore. Feed. Rest. Begin again.",
      V ? 76 : 110,
      V ? 470 : 520,
      28,
      C.ink,
      "italic",
    );
    header("03", "A DAY IN ITS WORLD");
  }
  function scene3(u) {
    header("04", "LEARNING THROUGH MOVEMENT");
    const tx = V ? 64 : 96;
    title(["Every movement,", "a small experiment."], tx, V ? 250 : 310, V ? 70 : 80);
    text("Predict. Try. Notice. Adjust.", tx, V ? 435 : 525, 31, C.teal, "italic");
    const ox = V ? W * 0.5 : W * 0.73,
      oy = V ? H * 0.63 : H * 0.47,
      rx = V ? 300 : 290,
      ry = V ? 260 : 220;
    for (let j = 0; j < 3; j++) {
      ellipse(
        ox + Math.cos(j * 2.1) * rx,
        oy + Math.sin(j * 2.1) * ry,
        18,
        18,
        C.gold + "55",
      );
      small(
        ["SHELTER", "WATER", "SWEETNESS"][j],
        ox + Math.cos(j * 2.1) * rx,
        oy + Math.sin(j * 2.1) * ry + 42,
        C.teal,
        "center",
      );
    }
    const points = [];
    for (let k = 0; k < 160; k++) {
      const a = (k / 159) * 6.283;
      points.push([ox + Math.cos(a) * rx, oy + Math.sin(a) * ry]);
    }
    path(points, C.teal + "70", 2, [6, 8]);
    const a = -Math.PI / 2 + u * 0.55;
    fly(ox + Math.cos(a) * rx, oy + Math.sin(a) * ry, 0.75, a + Math.PI, true);
    ctx.save();
    ctx.globalAlpha = ease((u - 1) / 2);
    const cy = V ? H - 390 : 760;
    card(tx, cy, V ? W - 128 : 730, 135, "#e5e4d0");
    small("MEMORY IS PART OF THE MODEL", tx + 24, cy + 43);
    text(
      "Experience changes its estimates.",
      tx + 24,
      cy + 92,
      V ? 27 : 31,
      C.ink,
      "serif",
    );
    ctx.restore();
    small("ILLUSTRATIVE PATH · NOT MEASURED TELEMETRY", tx, H - 125);
  }
  function scene4(u) {
    garden(1, true);
    card(0, 0, W, H, "#07323975");
    header("05", "NO AUDIENCE REQUIRED", true);
    const tx = V ? 64 : 96;
    ctx.save();
    ctx.globalAlpha = ease(u / 0.8);
    title(
      ["You can leave.", "The garden", "carries on."],
      tx,
      V ? H * 0.25 : 320,
      V ? 86 : 101,
      "#f4efdf",
    );
    text(
      "The same fly, every time you return.",
      tx,
      V ? H * 0.25 + 360 : 690,
      V ? 29 : 34,
      "#e6dec8",
      "italic",
    );
    ctx.restore();
    const x = V ? W * 0.55 : W * 0.77,
      y = V ? H * 0.72 : H * 0.55;
    leaf(x, y, V ? 270 : 290, -0.3, "#496b4c");
    fly(x, y - 26, 1.1, -0.3, false, true);
    const clock = assets.observation.born_at + u * 3500;
    small("SERVER-SIDE LIFE · SAVED MEMORIES", tx, H - 150, "#e4d4ad");
    small(
      `BETHESDA  /  ${new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" }).format(new Date(clock * 1000))}`,
      tx,
      H - 115,
      "#c5d4c6",
    );
  }
  function scene5(u) {
    header("06", "THE OPEN EXPERIMENT");
    const tx = V ? 64 : 96;
    title(["A small life.", "An open question."], tx, V ? 245 : 300, V ? 74 : 83);
    text("Built by Christopher Woodyard", tx, V ? 440 : 560, V ? 29 : 32, C.ink, "serif");
    text("at Vers3Dynamics.", tx, V ? 490 : 607, V ? 29 : 32, C.teal, "serif");
    const bx = V ? 64 : 920,
      by = V ? 650 : 230,
      bw = V ? W - 128 : 900,
      bh = (bw * 640) / 1200;
    ctx.save();
    ctx.shadowColor = "#183a382a";
    ctx.shadowBlur = 26;
    ctx.shadowOffsetY = 16;
    card(bx - 10, by - 10, bw + 20, bh + 20, "#fffdf3");
    ctx.restore();
    ctx.save();
    ctx.translate(bx, by);
    ctx.scale(bw / 1200, bw / 1200);
    ctx.beginPath();
    ctx.rect(0, 0, 1200, 640);
    ctx.clip();
    drawObservation(ctx, assets.observation, u, false);
    ctx.restore();
    small("DEPLOYED GARDEN RENDERER · RECORDED OBSERVATION", bx, by + bh + 48, C.teal);
    const sy = V ? by + bh + 140 : 820;
    text("Simulated behavior. Inspectable rules.", tx, sy, V ? 31 : 34, C.ink, "serif");
    text(
      "An experiment in behavior; no claim of consciousness.",
      tx,
      sy + 55,
      V ? 23 : 25,
      C.teal,
    );
  }
  function scene6(u) {
    garden(0.36);
    card(0, 0, W, H, "#f4efdfad");
    header("07", "THE INVITATION");
    const tx = V ? 64 : 96,
      ty = V ? H * 0.24 : 320;
    small("A DAY IN THE LIFE", tx, ty - 65);
    title(["A life three", "millimeters long."], tx, ty, V ? 84 : 104);
    text("What will it do next?", tx, ty + 250, V ? 37 : 43, C.ink, "italic");
    const buttonY = ty + 330;
    card(tx, buttonY, V ? W - 128 : 560, 100, C.teal);
    text("WATCH THE FLY LIVE  ↗", tx + 32, buttonY + 64, V ? 35 : 38, C.paper, "sans");
    text("150.136.49.49", tx, buttonY + 155, 30, C.teal, "mono");
    text(
      "An open experiment by Vers3Dynamics.",
      tx,
      H - 170,
      V ? 28 : 32,
      C.ink,
      "serif",
    );
    small("github.com/topherchris420/lop-nur-twin", tx, H - 115, C.teal);
    const px = V ? W * 0.7 : W * 0.81,
      py = V ? H * 0.72 : H * 0.46;
    const q = ease((u - 3) / 2);
    fly(px + q * W * 0.5, py - q * H * 0.45, 1.1 * (1 - q * 0.75), 0.6, q > 0);
  }
  const scenes = [scene0, scene1, scene2, scene3, scene4, scene5, scene6],
    starts = [0, 7, 15, 24, 32, 41, 50],
    ends = [7, 15, 24, 32, 41, 50, 58];
  function draw(sec, width = 1920, height = 1080, { captions = true } = {}) {
    W = width;
    H = height;
    V = height > width;
    t = clamp(sec, 0, duration);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    card(0, 0, W, H, C.paper);
    const i = Math.min(
        6,
        starts.findLastIndex((s) => t >= s),
      ),
      u = t - starts[i];
    ctx.save();
    const fade = ease(u / 0.6) * ease((ends[i] - t) / 0.45);
    ctx.globalAlpha = fade;
    scenes[i](u);
    ctx.restore();
    // Subtle deterministic paper fibers, not frame-random noise.
    ctx.save();
    ctx.globalAlpha = 0.045;
    for (let j = 0; j < 350; j++) {
      const x = (j * 173.31) % W,
        y = (j * 251.91) % H;
      path(
        [
          [x, y],
          [x + 9, y + 0.6],
        ],
        C.ink,
        0.7,
      );
    }
    ctx.restore();
    if (captions) {
      const cue = assets.cues.find((c) => t >= c[0] && t < c[1]);
      if (cue) {
        const max = V ? 56 : 106,
          words = cue[2].split(" "),
          lines = [""];
        for (let word of words) {
          if ((lines.at(-1) + " " + word).length > max) lines.push(word);
          else lines[lines.length - 1] += (lines.at(-1) ? " " : "") + word;
        }
        const fs = V ? 27 : 28,
          lh = fs * 1.3,
          boxW = V ? W - 48 : Math.min(W - 180, 1550),
          boxH = lines.length * lh + 27;
        card((W - boxW) / 2, H - boxH - 18, boxW, boxH, "#133634ed");
        lines.forEach((l, j) =>
          text(l, W / 2, H - boxH + 15 + j * lh, fs, C.paper, "sans", "center"),
        );
      }
    }
    // Quiet timeline.
    card(0, H - 3, (W * t) / duration, 3, C.gold);
  }
  return { draw };
}
