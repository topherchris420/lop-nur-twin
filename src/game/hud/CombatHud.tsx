import { useEffect, useRef } from "react";
import { game } from "../core/gameState";
import { useGameStore } from "../core/gameStore";
import { COMBAT } from "../core/combat";

/**
 * The in-game overlay.
 *
 * Every element is painted into one canvas from a `requestAnimationFrame`
 * loop that reads the mutable `game.hud` block directly. No React state is
 * touched per frame — the house rule for this repo — so the HUD costs one
 * canvas clear and a few hundred drawing calls, and React only re-renders when
 * a discrete thing like the killfeed changes.
 */

const BLUE = "#4da3ff";
const RED = "#ff5a4d";
const AMBER = "#ffb648";
const INK = "rgba(9,10,12,0.72)";
const COMBAT_RESPAWN_SECONDS = COMBAT.respawnDelay;

interface Painted {
  width: number;
  height: number;
  dpr: number;
}

function setupCanvas(canvas: HTMLCanvasElement, painted: Painted): CanvasRenderingContext2D {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (painted.width !== width || painted.height !== height || painted.dpr !== dpr) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    painted.width = width;
    painted.height = height;
    painted.dpr = dpr;
  }
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return ctx;
}

/** Chamfered tactical frame — the corner cut is what makes it read military. */
function chamferPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  cut: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + cut, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h - cut);
  ctx.lineTo(x + w - cut, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + cut);
  ctx.closePath();
}

/* ------------------------------------------------------------------ */
/* Painters                                                            */
/* ------------------------------------------------------------------ */

function paintCrosshair(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  style: "dot" | "cross" | "chevron",
): void {
  const hud = game.hud;
  const cx = w / 2;
  const cy = h / 2;
  const ads = game.adsProgress;
  const alpha = 1 - Math.min(1, ads * 1.6);

  // Hitmarker sits above ADS fade — you always see confirmation.
  if (hud.hitmarker > 0) {
    const t = Math.min(1, hud.hitmarker / 240);
    const pop = 1 + (1 - t) * 0.5;
    const gap = 7 * pop;
    const len = 7 * pop;
    ctx.save();
    ctx.globalAlpha = Math.min(1, t * 1.6);
    ctx.strokeStyle = hud.hitmarkerKill ? RED : "#ffffff";
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      ctx.beginPath();
      ctx.moveTo(cx + sx * gap, cy + sy * gap);
      ctx.lineTo(cx + sx * (gap + len), cy + sy * (gap + len));
      ctx.stroke();
    }
    ctx.restore();
  }

  if (alpha <= 0.01) return;

  // Gap tracks the actual cone half-angle projected to pixels, so the
  // crosshair is an honest readout of where rounds can land.
  const halfAngle = (hud.spreadDeg * Math.PI) / 180;
  const focal = h / 2 / Math.tan((game.cameraFov * Math.PI) / 180 / 2);
  const gap = Math.max(3, Math.min(120, Math.tan(halfAngle) * focal));

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = "rgba(0,0,0,0.85)";
  ctx.shadowBlur = 3;
  ctx.strokeStyle = "rgba(236,242,248,0.95)";
  ctx.fillStyle = "rgba(236,242,248,0.95)";
  ctx.lineWidth = 1.8;
  ctx.lineCap = "butt";

  if (style === "dot") {
    ctx.beginPath();
    ctx.arc(cx, cy, 1.7, 0, Math.PI * 2);
    ctx.fill();
  } else if (style === "chevron") {
    ctx.beginPath();
    ctx.moveTo(cx - 7, cy + gap * 0.4 + 6);
    ctx.lineTo(cx, cy + gap * 0.4 - 2);
    ctx.lineTo(cx + 7, cy + gap * 0.4 + 6);
    ctx.stroke();
  } else {
    const len = 6;
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
      ctx.beginPath();
      ctx.moveTo(cx + dx * gap, cy + dy * gap);
      ctx.lineTo(cx + dx * (gap + len), cy + dy * (gap + len));
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(cx, cy, 1.1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function paintAmmo(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const hud = game.hud;
  const right = w - 46;
  const bottom = h - 46;
  const low = hud.ammo <= Math.max(1, Math.ceil(hud.magSize * 0.25));
  const empty = hud.ammo === 0;
  const pulse = empty
    ? 0.55 + 0.45 * Math.sin(performance.now() / 140)
    : low
      ? 0.75 + 0.25 * Math.sin(performance.now() / 260)
      : 1;

  ctx.save();
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";

  ctx.shadowColor = "rgba(0,0,0,0.9)";
  ctx.shadowBlur = 8;
  ctx.fillStyle = empty ? RED : low ? AMBER : "#f2f5f8";
  ctx.globalAlpha = pulse;
  ctx.font = "600 46px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(String(hud.ammo).padStart(2, "0"), right, bottom);
  ctx.globalAlpha = 1;

  ctx.fillStyle = "rgba(226,232,240,0.55)";
  ctx.font = "500 18px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(`/ ${hud.reserve}`, right, bottom + 20);

  ctx.fillStyle = "rgba(226,232,240,0.82)";
  ctx.font = "600 13px ui-sans-serif, system-ui, sans-serif";
  ctx.letterSpacing = "2px";
  ctx.fillText(hud.weaponName.toUpperCase(), right, bottom - 52);
  ctx.letterSpacing = "0px";

  // Fire-mode chip.
  ctx.font = "600 10px ui-monospace, monospace";
  const label = hud.fireMode;
  const chipW = ctx.measureText(label).width + 14;
  ctx.fillStyle = INK;
  chamferPath(ctx, right - chipW, bottom - 44, chipW, 16, 4);
  ctx.fill();
  ctx.strokeStyle = "rgba(226,232,240,0.25)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = "rgba(226,232,240,0.9)";
  ctx.fillText(label, right - 7, bottom - 32);

  // Magazine bar: one tick per round, up to a sensible cap.
  const ticks = Math.min(hud.magSize, 40);
  const barW = 128;
  const tickW = barW / ticks;
  const y = bottom + 30;
  for (let i = 0; i < ticks; i += 1) {
    const filled = i < Math.round((hud.ammo / Math.max(1, hud.magSize)) * ticks);
    ctx.fillStyle = filled
      ? empty
        ? RED
        : low
          ? AMBER
          : "rgba(226,232,240,0.9)"
      : "rgba(226,232,240,0.16)";
    ctx.fillRect(right - barW + i * tickW, y, Math.max(1, tickW - 1.4), 4);
  }

  // Reload arc.
  if (hud.reloading) {
    const cx = right - barW / 2;
    const cy = y + 26;
    ctx.strokeStyle = "rgba(226,232,240,0.2)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, 13, -Math.PI / 2, Math.PI * 1.5);
    ctx.stroke();
    ctx.strokeStyle = AMBER;
    ctx.beginPath();
    ctx.arc(cx, cy, 13, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * hud.reloadProgress);
    ctx.stroke();
  }
  ctx.restore();
}

function paintHealth(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const hud = game.hud;
  const ratio = Math.max(0, Math.min(1, hud.health / hud.maxHealth));
  if (ratio > 0.92) return;
  // No bar: the screen itself tells you. Below 40% it becomes urgent.
  const severity = 1 - ratio;
  const inner = Math.min(w, h) * (0.28 + ratio * 0.24);
  const gradient = ctx.createRadialGradient(w / 2, h / 2, inner, w / 2, h / 2, Math.max(w, h) * 0.72);
  const alpha = Math.pow(severity, 1.6) * 0.85;
  gradient.addColorStop(0, "rgba(120,10,6,0)");
  gradient.addColorStop(0.55, `rgba(120,10,6,${alpha * 0.4})`);
  gradient.addColorStop(1, `rgba(96,6,4,${alpha})`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);

  if (ratio < 0.35) {
    const beat = 0.5 + 0.5 * Math.sin(performance.now() / 320);
    ctx.fillStyle = `rgba(160,14,8,${(0.35 - ratio) * beat * 0.7})`;
    ctx.fillRect(0, 0, w, h);
  }
}

function paintDamageDirs(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const hud = game.hud;
  if (hud.damageDirs.length === 0) return;
  const cx = w / 2;
  const cy = h / 2;
  const camYaw = Math.atan2(game.cameraForward.x, game.cameraForward.z);
  ctx.save();
  for (let i = hud.damageDirs.length - 1; i >= 0; i -= 1) {
    const entry = hud.damageDirs[i]!;
    const age = game.time - entry.time;
    if (age > 1.6) {
      hud.damageDirs.splice(i, 1);
      continue;
    }
    const alpha = Math.max(0, 1 - age / 1.6);
    const relative = entry.angle - camYaw;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(relative);
    ctx.strokeStyle = `rgba(255,64,48,${alpha * 0.92})`;
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(0, 0, Math.min(w, h) * 0.18, -Math.PI / 2 - 0.34, -Math.PI / 2 + 0.34);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

/**
 * The eliminated card: who killed you, with what, and how long until you are
 * back in. Until the player could be hurt at all this had nothing to show, so
 * a death was just the controls quietly ceasing to work for five seconds.
 */
function paintEliminated(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const hud = game.hud;
  if (hud.alive) return;

  ctx.save();
  ctx.fillStyle = "rgba(24,4,3,0.45)";
  ctx.fillRect(0, 0, w, h);

  const cx = w / 2;
  const top = h * 0.3;

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = RED;
  ctx.font = "700 13px ui-monospace, monospace";
  ctx.letterSpacing = "6px";
  ctx.fillText("KILLED IN ACTION", cx, top);
  ctx.letterSpacing = "0px";

  if (hud.killedBy) {
    ctx.fillStyle = "rgba(226,232,240,0.94)";
    ctx.font = "600 30px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText(hud.killedBy, cx, top + 40);

    ctx.fillStyle = "rgba(148,163,184,0.85)";
    ctx.font = "500 12px ui-monospace, monospace";
    const weapon = hud.killedByWeapon.toUpperCase().replace(/-/g, " ");
    ctx.fillText(
      hud.killedByHeadshot ? `${weapon}  ·  HEADSHOT` : weapon,
      cx,
      top + 68,
    );
  }

  // A countdown bar, so the wait is legible rather than indefinite.
  const total = Math.max(0.001, COMBAT_RESPAWN_SECONDS);
  const remaining = Math.max(0, hud.respawnIn);
  const barW = Math.min(280, w * 0.4);
  const barY = top + 104;
  ctx.fillStyle = "rgba(226,232,240,0.14)";
  ctx.fillRect(cx - barW / 2, barY, barW, 3);
  ctx.fillStyle = AMBER;
  ctx.fillRect(cx - barW / 2, barY, barW * (1 - remaining / total), 3);

  ctx.fillStyle = "rgba(226,232,240,0.7)";
  ctx.font = "500 11px ui-monospace, monospace";
  ctx.letterSpacing = "3px";
  ctx.fillText(
    remaining > 0.05 ? `RESPAWN IN ${remaining.toFixed(1)}` : "REDEPLOYING",
    cx,
    barY + 22,
  );
  ctx.letterSpacing = "0px";
  ctx.restore();
}

const COMPASS_POINTS: [number, string][] = [
  [0, "N"], [45, "NE"], [90, "E"], [135, "SE"],
  [180, "S"], [225, "SW"], [270, "W"], [315, "NW"],
];

function paintCompass(ctx: CanvasRenderingContext2D, w: number): void {
  // North is -z in the world frame, so the heading is measured off that.
  const heading =
    ((Math.atan2(game.cameraForward.x, -game.cameraForward.z) * 180) / Math.PI + 360) % 360;
  const width = Math.min(520, w * 0.42);
  const cx = w / 2;
  const top = 22;
  const pxPerDeg = width / 90;

  ctx.save();
  ctx.beginPath();
  ctx.rect(cx - width / 2, top - 6, width, 30);
  ctx.clip();

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let d = -60; d <= 60; d += 5) {
    const bearing = heading + d;
    const x = cx + d * pxPerDeg;
    const fade = 1 - Math.abs(d) / 62;
    const major = Math.round(((bearing % 360) + 360) % 360) % 45 === 0;
    ctx.strokeStyle = `rgba(226,232,240,${0.16 + fade * 0.4})`;
    ctx.lineWidth = major ? 1.6 : 1;
    ctx.beginPath();
    ctx.moveTo(x, top + 12);
    ctx.lineTo(x, top + (major ? 20 : 17));
    ctx.stroke();
  }
  for (const [deg, label] of COMPASS_POINTS) {
    let delta = deg - heading;
    while (delta > 180) delta -= 360;
    while (delta < -180) delta += 360;
    if (Math.abs(delta) > 62) continue;
    const x = cx + delta * pxPerDeg;
    const fade = 1 - Math.abs(delta) / 62;
    ctx.fillStyle = `rgba(240,245,250,${0.25 + fade * 0.72})`;
    ctx.font = label.length === 1 ? "600 13px ui-sans-serif, system-ui" : "600 10px ui-sans-serif, system-ui";
    ctx.fillText(label, x, top - 2);
  }
  ctx.restore();

  // Centre marker.
  ctx.fillStyle = "rgba(240,245,250,0.95)";
  ctx.beginPath();
  ctx.moveTo(cx, top + 24);
  ctx.lineTo(cx - 5, top + 32);
  ctx.lineTo(cx + 5, top + 32);
  ctx.closePath();
  ctx.fill();
}

function paintScore(ctx: CanvasRenderingContext2D, w: number): void {
  const hud = game.hud;
  const cx = w / 2;
  const y = 62;
  const minutes = Math.floor(Math.max(0, hud.timeRemaining) / 60);
  const seconds = Math.floor(Math.max(0, hud.timeRemaining) % 60);
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = "600 15px ui-monospace, monospace";
  ctx.fillStyle = "rgba(226,232,240,0.9)";
  ctx.fillText(`${minutes}:${String(seconds).padStart(2, "0")}`, cx, y);
  ctx.font = "700 22px ui-monospace, monospace";
  ctx.textAlign = "right";
  ctx.fillStyle = BLUE;
  ctx.fillText(String(hud.scoreBlue), cx - 46, y - 4);
  ctx.textAlign = "left";
  ctx.fillStyle = RED;
  ctx.fillText(String(hud.scoreRed), cx + 46, y - 4);
  ctx.restore();
}

function paintEquipment(ctx: CanvasRenderingContext2D, h: number): void {
  const hud = game.hud;
  const x = 46;
  const y = h - 58;
  ctx.save();
  ctx.font = "600 12px ui-sans-serif, system-ui";
  ctx.textBaseline = "middle";
  const chip = (label: string, count: number, offset: number, color: string): void => {
    ctx.fillStyle = INK;
    chamferPath(ctx, x + offset, y, 54, 24, 6);
    ctx.fill();
    ctx.strokeStyle = "rgba(226,232,240,0.18)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = count > 0 ? color : "rgba(226,232,240,0.28)";
    ctx.textAlign = "left";
    ctx.fillText(label, x + offset + 9, y + 12);
    ctx.textAlign = "right";
    ctx.fillStyle = count > 0 ? "rgba(240,245,250,0.95)" : "rgba(226,232,240,0.3)";
    ctx.fillText(String(count), x + offset + 45, y + 12);
  };
  chip("LTH", hud.grenades, 0, AMBER);
  chip("TAC", hud.tacticals, 62, BLUE);
  ctx.restore();
}

function paintStats(ctx: CanvasRenderingContext2D, w: number): void {
  const stats = game.stats;
  ctx.save();
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  ctx.font = "500 11px ui-monospace, monospace";
  ctx.fillStyle = "rgba(226,232,240,0.55)";
  const lines = [
    `${stats.fps.toFixed(0)} fps · ${stats.frameMs.toFixed(1)} ms`,
    `${stats.drawCalls} calls · ${(stats.triangles / 1000).toFixed(0)}k tris`,
    `${stats.colliders} colliders · ${stats.actorsAlive} live`,
  ];
  lines.forEach((line, i) => ctx.fillText(line, w - 16, 16 + i * 14));
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function CombatHud() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const crosshairStyle = useGameStore((s) => s.crosshairStyle);
  const showFps = useGameStore((s) => s.showFps);
  const styleRef = useRef(crosshairStyle);
  const fpsRef = useRef(showFps);
  styleRef.current = crosshairStyle;
  fpsRef.current = showFps;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const painted: Painted = { width: 0, height: 0, dpr: 0 };
    let raf = 0;
    const draw = (): void => {
      raf = requestAnimationFrame(draw);
      const ctx = setupCanvas(canvas, painted);
      const { width: w, height: h } = painted;
      paintHealth(ctx, w, h);
      paintCrosshair(ctx, w, h, styleRef.current);
      paintDamageDirs(ctx, w, h);
      paintCompass(ctx, w);
      paintScore(ctx, w);
      paintAmmo(ctx, w, h);
      paintEquipment(ctx, h);
      paintEliminated(ctx, w, h);
      if (fpsRef.current) paintStats(ctx, w);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 z-20 h-full w-full"
      aria-hidden
    />
  );
}
