// Drawing routines from the user-owned live garden, retrieved 2026-10-25.
// Read-only presentation of a recorded observation; never advances simulation state.
export function drawObservation(ctx, state, time, reduced = false) {
  const noise = (n) => {
    const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return v - Math.floor(v);
  };
  function ellipse(x, y, rx, ry, color, rotation = 0) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, rotation, 0, Math.PI * 2);
    ctx.fill();
  }
  function line(points, color, lineWidth = 1) {
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    points.forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p)));
    ctx.stroke();
  }
  function path(draw, color, stroke = null, sw = 1) {
    ctx.beginPath();
    draw(ctx);
    if (color) {
      ctx.fillStyle = color;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = sw;
      ctx.stroke();
    }
  }
  function leaf(x, y, size, angle, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    path((c) => {
      c.moveTo(-size, 0);
      c.bezierCurveTo(-size * 0.3, -size * 0.72, size * 0.55, -size * 0.6, size, 0);
      c.bezierCurveTo(size * 0.5, size * 0.65, -size * 0.5, size * 0.7, -size, 0);
    }, color);
    line(
      [
        [-size * 0.8, 0],
        [size * 0.8, 0],
      ],
      "#c5d3a03b",
      0.8,
    );
    for (let i = -2; i < 3; i++) {
      const sx = i * size * 0.24;
      line(
        [
          [sx, 0],
          [sx + size * 0.2, -size * 0.26],
        ],
        "#c5d3a01a",
        0.7,
      );
      line(
        [
          [sx, 0],
          [sx + size * 0.2, size * 0.23],
        ],
        "#c5d3a01a",
        0.7,
      );
    }
    ctx.restore();
  }
  function flower(x, y, r, night, seed) {
    const stem = night ? "#526149" : "#6d8653";
    line(
      [
        [x, y + 36],
        [x + 4, y + 12],
        [x, y],
      ],
      stem,
      2,
    );
    leaf(x + 6, y + 24, 9, -0.5, stem);
    for (let j = 0; j < 9; j++) {
      const a = (j * Math.PI * 2) / 9;
      ellipse(
        x + Math.cos(a) * r * 0.64,
        y + Math.sin(a) * r * 0.64,
        r * 0.58,
        r * 0.19,
        night ? "#9196a6" : "#b1a2c4",
        a,
      );
    }
    ellipse(x, y, r * 0.3, r * 0.28, night ? "#c9a963" : "#ddaf5e");
    ellipse(x - 1, y - 1, r * 0.12, r * 0.1, "#e6c57b");
  }

  function garden(t, night) {
    const sky = ctx.createLinearGradient(0, 0, 0, 640);
    sky.addColorStop(0, night ? "#152f35" : "#a6b9a5");
    sky.addColorStop(0.55, night ? "#344a42" : "#d0d3b5");
    sky.addColorStop(1, night ? "#405342" : "#8c9c72");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, 1200, 640);
    if (night) {
      for (let i = 0; i < 36; i++) {
        const x = noise(i + 3) * 1200,
          y = noise(i + 93) * 225;
        ellipse(
          x,
          y,
          i % 5 === 0 ? 1.2 : 0.7,
          i % 5 === 0 ? 1.2 : 0.7,
          `rgba(236,232,191,${0.15 + noise(i + 1) * 0.35})`,
        );
      }
      ellipse(619, 96, 25, 25, "#e0dfb4");
      ellipse(629, 89, 24, 24, "#1b3439");
    } else {
      const glow = ctx.createRadialGradient(522, 90, 10, 522, 90, 180);
      glow.addColorStop(0, "#f9edc167");
      glow.addColorStop(1, "#f9edc100");
      ctx.fillStyle = glow;
      ctx.fillRect(300, 0, 440, 300);
      ellipse(522, 90, 28, 28, "#f2e4ad");
    }
    // Quiet houses beyond the garden, not a map or a claim to a particular address.
    path(
      (c) => {
        c.moveTo(50, 300);
        c.lineTo(50, 183);
        c.lineTo(160, 111);
        c.lineTo(285, 185);
        c.lineTo(285, 300);
      },
      night ? "#2d4141" : "#9aa897",
    );
    path(
      (c) => {
        c.moveTo(379, 295);
        c.lineTo(379, 217);
        c.lineTo(457, 162);
        c.lineTo(546, 217);
        c.lineTo(546, 295);
      },
      night ? "#304743" : "#a4b19b",
    );
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = night ? (i % 3 === 0 ? "#b9a366" : "#45564c") : "#d4d1ad";
      ctx.fillRect(105 + (i % 2) * 82, 193 + Math.floor(i / 2) * 33, 16, 22);
    }
    // Cedar fence and a shallow, leafy garden floor.
    ctx.fillStyle = night ? "#46584a" : "#9aa37c";
    ctx.fillRect(0, 248, 1200, 178);
    for (let i = 0; i < 30; i++) {
      let x = i * 43;
      path(
        (c) => {
          c.moveTo(x, 424);
          c.lineTo(x, 251 + noise(i) * 12);
          c.lineTo(x + 18, 237 + noise(i) * 12);
          c.lineTo(x + 37, 251 + noise(i) * 12);
          c.lineTo(x + 37, 424);
        },
        night ? (i % 2 ? "#4b5d4b" : "#53634f") : i % 2 ? "#a5ad87" : "#aeb18a",
      );
      line(
        [
          [x + 38, 260],
          [x + 38, 420],
        ],
        night ? "#2d4239" : "#929c71",
        2,
      );
      line(
        [
          [x + 10, 290],
          [x + 12, 374],
        ],
        "#283e2c16",
      );
    }
    ctx.fillStyle = night ? "#3b5041" : "#869866";
    ctx.fillRect(0, 404, 1200, 236);
    path(
      (c) => {
        c.moveTo(715, 640);
        c.bezierCurveTo(780, 560, 748, 484, 960, 440);
        c.lineTo(1200, 476);
        c.lineTo(1200, 640);
      },
      night ? "#5c6552" : "#b9b69a",
    );
    for (let i = 0; i < 80; i++) {
      const x = noise(i + 55) * 1200,
        y = 416 + noise(i + 83) * 224;
      leaf(
        x,
        y,
        3 + noise(i + 7) * 8,
        noise(i) * 6.3,
        night
          ? ["#526044", "#68704c", "#7b714a"][i % 3]
          : ["#9d9c62", "#b3a168", "#81905d"][i % 3],
      );
    }
    // The back wall and its warm, sheltered windowsill.
    ctx.fillStyle = night ? "#57604f" : "#b7bda0";
    ctx.fillRect(865, 43, 335, 425);
    for (let row = 0; row < 14; row++) {
      line(
        [
          [865, 57 + row * 28],
          [1200, 57 + row * 28],
        ],
        "#28352b1e",
        1,
      );
    }
    ctx.fillStyle = night ? "#2c3d32" : "#7a896b";
    ctx.fillRect(925, 90, 176, 150);
    const light = ctx.createLinearGradient(934, 100, 1089, 226);
    light.addColorStop(0, night ? "#e6c679" : "#c7d5c4");
    light.addColorStop(1, night ? "#b69c5c" : "#a4bdba");
    ctx.fillStyle = light;
    ctx.fillRect(934, 99, 158, 130);
    ctx.fillStyle = night ? "#6d7255" : "#829274";
    ctx.fillRect(1009, 99, 7, 131);
    ctx.fillRect(934, 158, 158, 6);
    ctx.fillRect(916, 233, 194, 12);
    if (night) {
      path((c) => {
        c.moveTo(933, 243);
        c.lineTo(1090, 243);
        c.lineTo(1180, 479);
        c.lineTo(860, 470);
      }, "#dfbb6810");
    }
    // Asters spilling from a terracotta pot.
    ellipse(803, 482, 97, 20, night ? "#293f3480" : "#61734d44");
    path(
      (c) => {
        c.moveTo(748, 407);
        c.lineTo(857, 407);
        c.lineTo(844, 484);
        c.quadraticCurveTo(801, 501, 764, 481);
      },
      night ? "#866b4e" : "#bb8660",
    );
    ellipse(803, 408, 61, 14, night ? "#a17c55" : "#cf9a6b");
    ellipse(803, 407, 50, 8, night ? "#4b4c35" : "#76704b");
    for (let i = 0; i < 23; i++) {
      const x = 739 + noise(i + 134) * 130,
        y = 345 + noise(i + 9) * 75;
      flower(x, y, 7 + noise(i + 17) * 7, night, i);
    }
    // Rain saucer, stepping stones and a fallen pear.
    ellipse(613, 547, 71, 20, night ? "#2d4136" : "#6c7857");
    ellipse(612, 536, 61, 16, night ? "#8d8c70" : "#b9b89c");
    ellipse(612, 533, 52, 10, night ? "#657e77" : "#a7bcb0");
    line(
      [
        [584, 531],
        [618, 529],
      ],
      "#e1e6c660",
      1,
    );
    ellipse(922, 559, 59, 18, night ? "#7c826c" : "#cdcab1");
    ellipse(1129, 490, 45, 14, night ? "#737b65" : "#c4c7a8");
    ellipse(286, 529, 40, 11, night ? "#253b2b55" : "#465b3a44");
    path(
      (c) => {
        c.moveTo(287, 481);
        c.bezierCurveTo(270, 473, 280, 492, 260, 511);
        c.bezierCurveTo(237, 550, 326, 554, 316, 515);
        c.bezierCurveTo(311, 497, 301, 490, 297, 482);
        c.closePath();
      },
      night ? "#a7a16b" : "#c6bd6b",
    );
    path(
      (c) => {
        c.moveTo(291, 484);
        c.quadraticCurveTo(289, 474, 296, 469);
      },
      null,
      "#6c6c42",
      3,
    );
    leaf(306, 478, 11, -0.3, night ? "#687448" : "#8e9f57");
    ellipse(298, 530, 9, 10, "#806c4340");
    // Maple branch in the foreground: the fly's quiet shelter.
    path(
      (c) => {
        c.moveTo(-20, 75);
        c.bezierCurveTo(126, 137, 205, 145, 358, 234);
      },
      null,
      night ? "#5b5e45" : "#7d7952",
      14,
    );
    path(
      (c) => {
        c.moveTo(153, 143);
        c.quadraticCurveTo(196, 87, 260, 65);
      },
      null,
      night ? "#596148" : "#7a8056",
      7,
    );
    const sway = reduced ? 0 : Math.sin(t * 0.00045) * 0.016;
    [
      [53, 104, 90, 0.3],
      [132, 143, 83, 0.55],
      [216, 184, 87, 0.5],
      [303, 223, 80, 0.27],
      [373, 238, 73, -0.1],
      [211, 89, 65, -0.6],
      [284, 74, 61, -0.4],
    ].forEach((v, i) =>
      leaf(
        v[0],
        v[1],
        v[2],
        v[3] + sway,
        night
          ? ["#55704b", "#637a4f", "#71865b"][i % 3]
          : ["#718e52", "#809e59", "#99ad6a"][i % 3],
      ),
    );
    // A few low, soft plants; individual blades move only in the observer's picture.
    for (let i = 0; i < 26; i++) {
      const x = noise(i + 700) * 1200,
        y = 570 + noise(i + 33) * 70;
      path(
        (c) => {
          c.moveTo(x, y + 28);
          c.quadraticCurveTo(
            x - 15,
            y - 18,
            x - 20 + Math.sin(t * 0.0007 + i) * 2,
            y - 32,
          );
          c.quadraticCurveTo(x + 1, y - 8, x + 4, y + 28);
        },
        night ? "#344e39" : "#718d50",
      );
    }
    if (night) {
      const vignette = ctx.createRadialGradient(600, 320, 110, 600, 320, 690);
      vignette.addColorStop(0, "#081b1600");
      vignette.addColorStop(1, "#0b21172e");
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, 1200, 640);
    }
  }

  function flyPosition(state) {
    return [state.position[0] * 1200, state.position[1] * 640];
  }
  function drawFly(x, y, t, activity) {
    const flying = activity === "flying";
    ctx.save();
    ctx.translate(x, y);
    let angle = flying ? Math.sin(t * 0.001) * 0.2 : -0.35;
    ctx.rotate(angle);
    ellipse(1, 7, 10, 3, "#11251b30");
    for (let i = 0; i < 3; i++) {
      const yy = -3 + i * 3;
      line(
        [
          [-2, yy],
          [-6, yy + 1],
          [-9, yy + 4],
        ],
        "#1d2825",
        0.8,
      );
      line(
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
    ellipse(-4, -1, 3.5, 7, "#dce8d199", -0.5 - wing);
    ellipse(4, -1, 3.5, 7, "#dce8d199", 0.5 + wing);
    ellipse(0, 4, 3.7, 6.4, "#253b35");
    ellipse(-0.6, 2.8, 1.7, 4, "#789082");
    ellipse(0, -2.7, 3.1, 3.5, "#263d35");
    ellipse(0, -6.8, 3.7, 2.9, "#25352f");
    ellipse(-2.2, -7.1, 1.7, 1.7, "#b36e54");
    ellipse(2.2, -7.1, 1.7, 1.7, "#b36e54");
    line(
      [
        [-1, -8],
        [-2, -11],
      ],
      "#293a31",
      0.8,
    );
    line(
      [
        [1, -8],
        [2, -11],
      ],
      "#293a31",
      0.8,
    );
    ctx.restore();
  }

  garden(time * 1000, !state.weather.is_day);
  const p = flyPosition(state);
  drawFly(p[0], p[1], time * 1000, state.activity);
}
