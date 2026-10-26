/**
 * The plain garden, for browsers without WebGL 2 or when the 3D picture
 * cannot run: the live page's previous 2D painting (its `app.js` drawing,
 * carried over with types), so every visitor still sees where the fly is and
 * what it is doing. Like the clay garden it only reads the state on screen.
 */
import type { Observation } from "../core/observation.js";

const W = 1200,
  H = 640;
type Ctx = CanvasRenderingContext2D;
type Pt = [number, number];

const noise = (n: number) => {
  const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
};

export class Fallback2D {
  private readonly ctx: Ctx;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private shown: Pt | null = null;
  private last = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas unavailable");
    this.ctx = ctx;
  }

  resize(width: number, height: number, dpr: number) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.dpr = Math.min(dpr, 2);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
  }

  /** Paints the garden; returns the fly's position on the canvas (CSS px), or null. */
  draw(
    view: Observation | null,
    nowMs: number,
    follow: boolean,
    reduced: boolean,
    paused: boolean,
  ): Pt | null {
    const { ctx, width, height } = this;
    const dt = Math.min((nowMs - this.last) / 1000, 0.1);
    this.last = nowMs;
    const t = reduced || paused ? 0 : nowMs;
    const night = view ? !view.weather.isDay : true;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = night ? "#243d35" : "#b1c09c";
    ctx.fillRect(0, 0, width, height);
    const p: Pt = view ? [view.position[0] * W, view.position[1] * H] : [600, 320];
    if (!this.shown) this.shown = [...p];
    const easing = reduced || paused ? 1 : 1 - Math.exp(-8 * dt);
    this.shown[0] += (p[0] - this.shown[0]) * easing;
    this.shown[1] += (p[1] - this.shown[1]) * easing;
    const [sx, sy] = this.shown;
    const scale = follow
      ? Math.max(width / 750, height / 490)
      : Math.min(width / W, height / H);
    const ox = follow
      ? Math.min(0, Math.max(width - W * scale, width / 2 - sx * scale))
      : (width - W * scale) / 2;
    const oy = follow
      ? Math.min(0, Math.max(height - H * scale, height / 2 - sy * scale))
      : (height - H * scale) / 2;
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);
    this.garden(t, night, reduced);
    for (const o of view?.learning?.nearby ?? []) {
      const [x, y] = o.position;
      if (o.name === "swaying_leaf")
        this.leaf(x * W, y * H, 12, -0.3, night ? "#8b9865" : "#607c3f");
      else {
        this.ellipse(x * W, y * H, 2.3, 2.3, night ? "#e6d6a6" : "#494c38");
        this.ellipse(x * W - 2, y * H - 2, 3, 1, "#e3e9cd88");
      }
    }
    if (view) this.fly(sx, sy, t, view.activity, reduced);
    // Rain belongs to the weather; it never advances the fly's life.
    if (view && (view.weather.rainMm ?? 0) > 0.1) {
      const color = night ? "#d0dfd125" : "#eef2de66";
      for (let i = 0; i < 60; i++) {
        const x = noise(i + 880) * W,
          y = ((reduced ? noise(i) * H : t * 0.18) + noise(i + 90) * H) % H;
        this.line(
          [
            [x, y],
            [x - 5, y + 15],
          ],
          color,
          0.8,
        );
      }
    }
    ctx.restore();
    return view ? [ox + sx * scale, oy + sy * scale] : null;
  }

  private ellipse(
    x: number,
    y: number,
    rx: number,
    ry: number,
    color: string,
    rotation = 0,
  ) {
    const c = this.ctx;
    c.fillStyle = color;
    c.beginPath();
    c.ellipse(x, y, rx, ry, rotation, 0, Math.PI * 2);
    c.fill();
  }

  private line(points: Pt[], color: string, lineWidth = 1) {
    const c = this.ctx;
    c.strokeStyle = color;
    c.lineWidth = lineWidth;
    c.beginPath();
    points.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
    c.stroke();
  }

  private path(
    draw: (c: Ctx) => void,
    color: string | null,
    stroke: string | null = null,
    sw = 1,
  ) {
    const c = this.ctx;
    c.beginPath();
    draw(c);
    if (color) {
      c.fillStyle = color;
      c.fill();
    }
    if (stroke) {
      c.strokeStyle = stroke;
      c.lineWidth = sw;
      c.stroke();
    }
  }

  private leaf(x: number, y: number, size: number, angle: number, color: string) {
    const c = this.ctx;
    c.save();
    c.translate(x, y);
    c.rotate(angle);
    this.path((g) => {
      g.moveTo(-size, 0);
      g.bezierCurveTo(-size * 0.3, -size * 0.72, size * 0.55, -size * 0.6, size, 0);
      g.bezierCurveTo(size * 0.5, size * 0.65, -size * 0.5, size * 0.7, -size, 0);
    }, color);
    this.line(
      [
        [-size * 0.8, 0],
        [size * 0.8, 0],
      ],
      "#c5d3a03b",
      0.8,
    );
    for (let i = -2; i < 3; i++) {
      const sx = i * size * 0.24;
      this.line(
        [
          [sx, 0],
          [sx + size * 0.2, -size * 0.26],
        ],
        "#c5d3a01a",
        0.7,
      );
      this.line(
        [
          [sx, 0],
          [sx + size * 0.2, size * 0.23],
        ],
        "#c5d3a01a",
        0.7,
      );
    }
    c.restore();
  }

  private flower(x: number, y: number, r: number, night: boolean) {
    const stem = night ? "#526149" : "#6d8653";
    this.line(
      [
        [x, y + 36],
        [x + 4, y + 12],
        [x, y],
      ],
      stem,
      2,
    );
    this.leaf(x + 6, y + 24, 9, -0.5, stem);
    for (let j = 0; j < 9; j++) {
      const a = (j * Math.PI * 2) / 9;
      this.ellipse(
        x + Math.cos(a) * r * 0.64,
        y + Math.sin(a) * r * 0.64,
        r * 0.58,
        r * 0.19,
        night ? "#9196a6" : "#b1a2c4",
        a,
      );
    }
    this.ellipse(x, y, r * 0.3, r * 0.28, night ? "#c9a963" : "#ddaf5e");
    this.ellipse(x - 1, y - 1, r * 0.12, r * 0.1, "#e6c57b");
  }

  private garden(t: number, night: boolean, reduced: boolean) {
    const c = this.ctx;
    const sky = c.createLinearGradient(0, 0, 0, 640);
    sky.addColorStop(0, night ? "#152f35" : "#a6b9a5");
    sky.addColorStop(0.55, night ? "#344a42" : "#d0d3b5");
    sky.addColorStop(1, night ? "#405342" : "#8c9c72");
    c.fillStyle = sky;
    c.fillRect(0, 0, W, H);
    if (night) {
      for (let i = 0; i < 36; i++) {
        const x = noise(i + 3) * W,
          y = noise(i + 93) * 225;
        this.ellipse(
          x,
          y,
          i % 5 === 0 ? 1.2 : 0.7,
          i % 5 === 0 ? 1.2 : 0.7,
          `rgba(236,232,191,${0.15 + noise(i + 1) * 0.35})`,
        );
      }
      this.ellipse(619, 96, 25, 25, "#e0dfb4");
      this.ellipse(629, 89, 24, 24, "#1b3439");
    } else {
      const glow = c.createRadialGradient(522, 90, 10, 522, 90, 180);
      glow.addColorStop(0, "#f9edc167");
      glow.addColorStop(1, "#f9edc100");
      c.fillStyle = glow;
      c.fillRect(300, 0, 440, 300);
      this.ellipse(522, 90, 28, 28, "#f2e4ad");
    }
    // Quiet houses beyond the garden, not a map or a claim to a particular address.
    this.path(
      (g) => {
        g.moveTo(50, 300);
        g.lineTo(50, 183);
        g.lineTo(160, 111);
        g.lineTo(285, 185);
        g.lineTo(285, 300);
      },
      night ? "#2d4141" : "#9aa897",
    );
    this.path(
      (g) => {
        g.moveTo(379, 295);
        g.lineTo(379, 217);
        g.lineTo(457, 162);
        g.lineTo(546, 217);
        g.lineTo(546, 295);
      },
      night ? "#304743" : "#a4b19b",
    );
    for (let i = 0; i < 6; i++) {
      c.fillStyle = night ? (i % 3 === 0 ? "#b9a366" : "#45564c") : "#d4d1ad";
      c.fillRect(105 + (i % 2) * 82, 193 + Math.floor(i / 2) * 33, 16, 22);
    }
    // Cedar fence and a shallow, leafy garden floor.
    c.fillStyle = night ? "#46584a" : "#9aa37c";
    c.fillRect(0, 248, W, 178);
    for (let i = 0; i < 30; i++) {
      const x = i * 43;
      this.path(
        (g) => {
          g.moveTo(x, 424);
          g.lineTo(x, 251 + noise(i) * 12);
          g.lineTo(x + 18, 237 + noise(i) * 12);
          g.lineTo(x + 37, 251 + noise(i) * 12);
          g.lineTo(x + 37, 424);
        },
        night ? (i % 2 ? "#4b5d4b" : "#53634f") : i % 2 ? "#a5ad87" : "#aeb18a",
      );
      this.line(
        [
          [x + 38, 260],
          [x + 38, 420],
        ],
        night ? "#2d4239" : "#929c71",
        2,
      );
      this.line(
        [
          [x + 10, 290],
          [x + 12, 374],
        ],
        "#283e2c16",
      );
    }
    c.fillStyle = night ? "#3b5041" : "#869866";
    c.fillRect(0, 404, W, 236);
    this.path(
      (g) => {
        g.moveTo(715, 640);
        g.bezierCurveTo(780, 560, 748, 484, 960, 440);
        g.lineTo(1200, 476);
        g.lineTo(1200, 640);
      },
      night ? "#5c6552" : "#b9b69a",
    );
    for (let i = 0; i < 80; i++) {
      const x = noise(i + 55) * W,
        y = 416 + noise(i + 83) * 224;
      this.leaf(
        x,
        y,
        3 + noise(i + 7) * 8,
        noise(i) * 6.3,
        night
          ? ["#526044", "#68704c", "#7b714a"][i % 3]!
          : ["#9d9c62", "#b3a168", "#81905d"][i % 3]!,
      );
    }
    // The back wall and its warm, sheltered windowsill.
    c.fillStyle = night ? "#57604f" : "#b7bda0";
    c.fillRect(865, 43, 335, 425);
    for (let row = 0; row < 14; row++)
      this.line(
        [
          [865, 57 + row * 28],
          [1200, 57 + row * 28],
        ],
        "#28352b1e",
        1,
      );
    c.fillStyle = night ? "#2c3d32" : "#7a896b";
    c.fillRect(925, 90, 176, 150);
    const light = c.createLinearGradient(934, 100, 1089, 226);
    light.addColorStop(0, night ? "#e6c679" : "#c7d5c4");
    light.addColorStop(1, night ? "#b69c5c" : "#a4bdba");
    c.fillStyle = light;
    c.fillRect(934, 99, 158, 130);
    c.fillStyle = night ? "#6d7255" : "#829274";
    c.fillRect(1009, 99, 7, 131);
    c.fillRect(934, 158, 158, 6);
    c.fillRect(916, 233, 194, 12);
    if (night)
      this.path((g) => {
        g.moveTo(933, 243);
        g.lineTo(1090, 243);
        g.lineTo(1180, 479);
        g.lineTo(860, 470);
      }, "#dfbb6810");
    // Asters spilling from a terracotta pot.
    this.ellipse(803, 482, 97, 20, night ? "#293f3480" : "#61734d44");
    this.path(
      (g) => {
        g.moveTo(748, 407);
        g.lineTo(857, 407);
        g.lineTo(844, 484);
        g.quadraticCurveTo(801, 501, 764, 481);
      },
      night ? "#866b4e" : "#bb8660",
    );
    this.ellipse(803, 408, 61, 14, night ? "#a17c55" : "#cf9a6b");
    this.ellipse(803, 407, 50, 8, night ? "#4b4c35" : "#76704b");
    for (let i = 0; i < 23; i++)
      this.flower(
        739 + noise(i + 134) * 130,
        345 + noise(i + 9) * 75,
        7 + noise(i + 17) * 7,
        night,
      );
    // Rain saucer, stepping stones and a fallen pear.
    this.ellipse(613, 547, 71, 20, night ? "#2d4136" : "#6c7857");
    this.ellipse(612, 536, 61, 16, night ? "#8d8c70" : "#b9b89c");
    this.ellipse(612, 533, 52, 10, night ? "#657e77" : "#a7bcb0");
    this.line(
      [
        [584, 531],
        [618, 529],
      ],
      "#e1e6c660",
      1,
    );
    this.ellipse(922, 559, 59, 18, night ? "#7c826c" : "#cdcab1");
    this.ellipse(1129, 490, 45, 14, night ? "#737b65" : "#c4c7a8");
    this.ellipse(286, 529, 40, 11, night ? "#253b2b55" : "#465b3a44");
    this.path(
      (g) => {
        g.moveTo(287, 481);
        g.bezierCurveTo(270, 473, 280, 492, 260, 511);
        g.bezierCurveTo(237, 550, 326, 554, 316, 515);
        g.bezierCurveTo(311, 497, 301, 490, 297, 482);
        g.closePath();
      },
      night ? "#a7a16b" : "#c6bd6b",
    );
    this.path(
      (g) => {
        g.moveTo(291, 484);
        g.quadraticCurveTo(289, 474, 296, 469);
      },
      null,
      "#6c6c42",
      3,
    );
    this.leaf(306, 478, 11, -0.3, night ? "#687448" : "#8e9f57");
    this.ellipse(298, 530, 9, 10, "#806c4340");
    // Maple branch in the foreground: the fly's quiet shelter.
    this.path(
      (g) => {
        g.moveTo(-20, 75);
        g.bezierCurveTo(126, 137, 205, 145, 358, 234);
      },
      null,
      night ? "#5b5e45" : "#7d7952",
      14,
    );
    this.path(
      (g) => {
        g.moveTo(153, 143);
        g.quadraticCurveTo(196, 87, 260, 65);
      },
      null,
      night ? "#596148" : "#7a8056",
      7,
    );
    const sway = reduced ? 0 : Math.sin(t * 0.00045) * 0.016;
    const leaves: [number, number, number, number][] = [
      [53, 104, 90, 0.3],
      [132, 143, 83, 0.55],
      [216, 184, 87, 0.5],
      [303, 223, 80, 0.27],
      [373, 238, 73, -0.1],
      [211, 89, 65, -0.6],
      [284, 74, 61, -0.4],
    ];
    leaves.forEach((v, i) =>
      this.leaf(
        v[0],
        v[1],
        v[2],
        v[3] + sway,
        night
          ? ["#55704b", "#637a4f", "#71865b"][i % 3]!
          : ["#718e52", "#809e59", "#99ad6a"][i % 3]!,
      ),
    );
    // A few low, soft plants; individual blades move only in the observer's picture.
    for (let i = 0; i < 26; i++) {
      const x = noise(i + 700) * W,
        y = 570 + noise(i + 33) * 70;
      this.path(
        (g) => {
          g.moveTo(x, y + 28);
          g.quadraticCurveTo(
            x - 15,
            y - 18,
            x - 20 + Math.sin(t * 0.0007 + i) * 2,
            y - 32,
          );
          g.quadraticCurveTo(x + 1, y - 8, x + 4, y + 28);
        },
        night ? "#344e39" : "#718d50",
      );
    }
    if (night) {
      const v = c.createRadialGradient(600, 320, 110, 600, 320, 690);
      v.addColorStop(0, "#081b1600");
      v.addColorStop(1, "#0b21172e");
      c.fillStyle = v;
      c.fillRect(0, 0, W, H);
    }
  }

  private fly(x: number, y: number, t: number, activity: string, reduced: boolean) {
    const c = this.ctx;
    const flying = activity === "flying";
    c.save();
    c.translate(x, y);
    c.rotate(flying ? Math.sin(t * 0.001) * 0.2 : -0.35);
    this.ellipse(1, 7, 10, 3, "#11251b30");
    for (let i = 0; i < 3; i++) {
      const yy = -3 + i * 3;
      this.line(
        [
          [-2, yy],
          [-6, yy + 1],
          [-9, yy + 4],
        ],
        "#1d2825",
        0.8,
      );
      this.line(
        [
          [2, yy],
          [6, yy + 1],
          [9, yy + 4],
        ],
        "#1d2825",
        0.8,
      );
    }
    const wing = flying && !reduced ? Math.sin(t * 0.1) * 0.8 : 0;
    this.ellipse(-4, -1, 3.5, 7, "#dce8d199", -0.5 - wing);
    this.ellipse(4, -1, 3.5, 7, "#dce8d199", 0.5 + wing);
    this.ellipse(0, 4, 3.7, 6.4, "#253b35");
    this.ellipse(-0.6, 2.8, 1.7, 4, "#789082");
    this.ellipse(0, -2.7, 3.1, 3.5, "#263d35");
    this.ellipse(0, -6.8, 3.7, 2.9, "#25352f");
    this.ellipse(-2.2, -7.1, 1.7, 1.7, "#b36e54");
    this.ellipse(2.2, -7.1, 1.7, 1.7, "#b36e54");
    this.line(
      [
        [-1, -8],
        [-2, -11],
      ],
      "#293a31",
      0.8,
    );
    this.line(
      [
        [1, -8],
        [2, -11],
      ],
      "#293a31",
      0.8,
    );
    c.restore();
  }
}
