import { useEffect, useRef } from "react";
import { game } from "../core/gameState";
import { useGameStore } from "../core/gameStore";
import { COMBAT } from "../core/combat";
import { STRUCTURES, RUNWAYS, TAXIWAYS, APRONS } from "@/lib/layout";

/**
 * Modern Warfare-Style AAA Tactical HUD.
 *
 * Every element is painted into one canvas from a `requestAnimationFrame`
 * loop that reads the mutable `game.hud` block directly. No React state is
 * touched per frame — the HUD costs one canvas clear and a few hundred drawing calls.
 *
 * Features:
 *  - Tactical Compass with degree numbers, cardinal labels & red diamond enemy fire indicators
 *  - Radar Minimap with 360° sweep line, site structures outline, player heading & gunfire pings
 *  - CoD XP Score Popups & animated medals (+100 ELIMINATED, HEADSHOT, LONGSHOT, DOUBLE KILL)
 *  - Critical Health Screen with bloody pulsing vignette & heartbeat sync
 *  - Directional Damage Indicators with curved red damage arcs
 *  - Tactical Squad Radio Feed
 */

const BLUE = "#4da3ff";
const RED = "#ff5a4d";
const AMBER = "#ffb648";
const GOLD = "#ffd700";
const CYAN = "#4df0ff";
const INK = "rgba(9,10,12,0.85)";
const COMBAT_RESPAWN_SECONDS = COMBAT.respawnDelay;

interface Painted {
  width: number;
  height: number;
  dpr: number;
}

function setupCanvas(
  canvas: HTMLCanvasElement,
  painted: Painted,
): CanvasRenderingContext2D {
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

/** Chamfered tactical frame — cut corners provide an authentic military HUD aesthetic. */
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
  ctx.lineTo(x + w - cut, y);
  ctx.lineTo(x + w, y + cut);
  ctx.lineTo(x + w, y + h - cut);
  ctx.lineTo(x + w - cut, y + h);
  ctx.lineTo(x + cut, y + h);
  ctx.lineTo(x, y + h - cut);
  ctx.lineTo(x, y + cut);
  ctx.closePath();
}

/* ------------------------------------------------------------------ */
/* 1. Critical Health Screen (Bloody Pulsing Vignette)                */
/* ------------------------------------------------------------------ */

function paintHealth(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const hud = game.hud;
  const ratio = Math.max(0, Math.min(1, hud.health / hud.maxHealth));
  if (ratio > 0.88) return;

  const severity = 1 - ratio;
  const now = performance.now();

  // Pulse faster and harder as health drops below 35%
  const isCritical = ratio < 0.35;
  const bpm = isCritical ? 75 + (0.35 - ratio) * 190 : 60;
  const heartbeatPulse = Math.pow(
    Math.max(0, Math.sin((now / 1000) * (bpm / 60) * Math.PI)),
    2.8,
  );

  const inner = Math.min(w, h) * (0.24 + ratio * 0.28);
  const outer = Math.max(w, h) * 0.74;

  const gradient = ctx.createRadialGradient(w / 2, h / 2, inner, w / 2, h / 2, outer);
  const baseAlpha = Math.pow(severity, 1.4) * 0.75;
  const pulseAlpha = isCritical
    ? baseAlpha + (0.35 - ratio) * heartbeatPulse * 0.85
    : baseAlpha;

  gradient.addColorStop(0, "rgba(80,4,4,0)");
  gradient.addColorStop(0.55, `rgba(130,8,6,${pulseAlpha * 0.45})`);
  gradient.addColorStop(0.85, `rgba(90,4,4,${pulseAlpha * 0.82})`);
  gradient.addColorStop(1, `rgba(20,2,2,${Math.min(0.96, pulseAlpha * 1.1)})`);

  ctx.save();
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);

  // Organic arterial blood spatters on borders when critical
  if (isCritical) {
    ctx.fillStyle = `rgba(160,10,8,${(0.35 - ratio) * (0.4 + 0.6 * heartbeatPulse)})`;
    // Corner blood patches
    const cornerSize = Math.min(w, h) * 0.22;
    // Top-left
    ctx.beginPath();
    ctx.arc(0, 0, cornerSize * (0.8 + 0.2 * heartbeatPulse), 0, Math.PI / 2);
    ctx.fill();
    // Top-right
    ctx.beginPath();
    ctx.arc(w, 0, cornerSize * (0.75 + 0.25 * heartbeatPulse), Math.PI / 2, Math.PI);
    ctx.fill();
    // Bottom-left
    ctx.beginPath();
    ctx.arc(0, h, cornerSize * (0.85 + 0.15 * heartbeatPulse), -Math.PI / 2, 0);
    ctx.fill();
    // Bottom-right
    ctx.beginPath();
    ctx.arc(w, h, cornerSize * (0.9 + 0.2 * heartbeatPulse), Math.PI, -Math.PI / 2);
    ctx.fill();

    // Critical low health flash text
    if (ratio < 0.2) {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "700 11px ui-monospace, monospace";
      ctx.letterSpacing = "4px";
      ctx.fillStyle = `rgba(255,70,60,${0.4 + 0.5 * heartbeatPulse})`;
      ctx.fillText("CRITICAL DAMAGE", w / 2, h - 84);
    }
  }

  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* 2. Directional Damage Indicators (Curved Red Damage Arcs)          */
/* ------------------------------------------------------------------ */

function paintDamageDirs(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const hud = game.hud;
  if (hud.damageDirs.length === 0) return;
  const cx = w / 2;
  const cy = h / 2;
  const camYaw = Math.atan2(game.cameraForward.x, game.cameraForward.z);
  const radius = Math.min(w, h) * 0.19;

  ctx.save();
  for (let i = hud.damageDirs.length - 1; i >= 0; i -= 1) {
    const entry = hud.damageDirs[i]!;
    const age = game.time - entry.time;
    if (age > 1.8) {
      hud.damageDirs.splice(i, 1);
      continue;
    }
    const alpha = Math.max(0, 1 - age / 1.8);
    const relative = entry.angle - camYaw;
    const thickness = Math.min(9, 4.5 + (entry.amount ?? 30) / 18);
    const arcSpan = 0.38;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(relative);

    // Glowing damage arc shadow
    ctx.shadowColor = "rgba(255,20,20,0.85)";
    ctx.shadowBlur = 10;
    ctx.strokeStyle = `rgba(255,42,42,${alpha * 0.95})`;
    ctx.lineWidth = thickness;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(0, 0, radius, -Math.PI / 2 - arcSpan, -Math.PI / 2 + arcSpan);
    ctx.stroke();

    // Sharp center notch
    ctx.fillStyle = `rgba(255,240,240,${alpha * 0.9})`;
    ctx.beginPath();
    ctx.moveTo(0, -radius - thickness * 1.3);
    ctx.lineTo(-4, -radius + thickness * 0.6);
    ctx.lineTo(4, -radius + thickness * 0.6);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* 3. Crosshair & Hitmarker Confirmation                             */
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

  // Hitmarker sits above ADS fade — crisp kill/hit confirmation
  if (hud.hitmarker > 0) {
    const t = Math.min(1, hud.hitmarker / 240);
    const pop = 1 + (1 - t) * 0.55;
    const gap = 7.5 * pop;
    const len = 7.5 * pop;
    ctx.save();
    ctx.globalAlpha = Math.min(1, t * 1.6);
    ctx.strokeStyle = hud.hitmarkerKill ? RED : "#ffffff";
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(cx + sx * gap, cy + sy * gap);
      ctx.lineTo(cx + sx * (gap + len), cy + sy * (gap + len));
      ctx.stroke();
    }
    // Kill confirmation red center pip
    if (hud.hitmarkerKill) {
      ctx.fillStyle = RED;
      ctx.beginPath();
      ctx.arc(cx, cy, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  if (alpha <= 0.01) return;

  const halfAngle = (hud.spreadDeg * Math.PI) / 180;
  const focal = h / 2 / Math.tan((game.cameraFov * Math.PI) / 180 / 2);
  const gap = Math.max(3.5, Math.min(120, Math.tan(halfAngle) * focal));

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
    ctx.arc(cx, cy, 1.8, 0, Math.PI * 2);
    ctx.fill();
  } else if (style === "chevron") {
    ctx.beginPath();
    ctx.moveTo(cx - 7, cy + gap * 0.4 + 6);
    ctx.lineTo(cx, cy + gap * 0.4 - 2);
    ctx.lineTo(cx + 7, cy + gap * 0.4 + 6);
    ctx.stroke();
  } else {
    const len = 6;
    for (const [dx, dy] of [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ] as const) {
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

/* ------------------------------------------------------------------ */
/* 4. Tactical Floating Compass Tape & Enemy Gunfire Diamonds        */
/* ------------------------------------------------------------------ */

const COMPASS_POINTS: [number, string][] = [
  [0, "N"],
  [45, "NE"],
  [90, "E"],
  [135, "SE"],
  [180, "S"],
  [225, "SW"],
  [270, "W"],
  [315, "NW"],
];

function paintCompass(ctx: CanvasRenderingContext2D, w: number): void {
  // Heading measured from world North (-z)
  const heading =
    ((Math.atan2(game.cameraForward.x, -game.cameraForward.z) * 180) / Math.PI + 360) %
    360;
  const width = Math.min(540, w * 0.46);
  const cx = w / 2;
  const top = 26;
  const pxPerDeg = width / 95;

  ctx.save();

  // Top digital numeric bearing readout badge
  const headingStr = `${Math.round(heading).toString().padStart(3, "0")}°`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "700 12px ui-monospace, monospace";
  ctx.fillStyle = INK;
  chamferPath(ctx, cx - 34, top - 24, 68, 19, 4);
  ctx.fill();
  ctx.strokeStyle = "rgba(77,163,255,0.45)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = CYAN;
  ctx.fillText(headingStr, cx, top - 14);

  // Compass tape clipping window
  ctx.beginPath();
  ctx.rect(cx - width / 2, top - 6, width, 36);
  ctx.clip();

  // Background subtle gradient tape
  const tapeGrad = ctx.createLinearGradient(cx - width / 2, 0, cx + width / 2, 0);
  tapeGrad.addColorStop(0, "rgba(9,10,12,0)");
  tapeGrad.addColorStop(0.2, "rgba(9,10,12,0.45)");
  tapeGrad.addColorStop(0.8, "rgba(9,10,12,0.45)");
  tapeGrad.addColorStop(1, "rgba(9,10,12,0)");
  ctx.fillStyle = tapeGrad;
  ctx.fillRect(cx - width / 2, top - 4, width, 32);

  // Degree ticks and numeric labels
  ctx.textBaseline = "top";
  for (let d = -60; d <= 60; d += 5) {
    const bearing = (Math.round(heading + d) + 360) % 360;
    const x = cx + d * pxPerDeg;
    const fade = 1 - Math.abs(d) / 62;
    const isMajor = bearing % 15 === 0;
    const isCardinal = bearing % 45 === 0;

    ctx.strokeStyle = isCardinal
      ? `rgba(77,200,255,${0.3 + fade * 0.65})`
      : `rgba(226,232,240,${0.15 + fade * 0.45})`;
    ctx.lineWidth = isCardinal ? 1.8 : isMajor ? 1.3 : 0.9;
    ctx.beginPath();
    ctx.moveTo(x, top + 13);
    ctx.lineTo(x, top + (isCardinal ? 23 : isMajor ? 19 : 15));
    ctx.stroke();

    // Numeric degree labels on 15-degree increments (excluding cardinal letters)
    if (isMajor && !isCardinal && Math.abs(d) <= 52) {
      ctx.font = "600 9px ui-monospace, monospace";
      ctx.fillStyle = `rgba(200,215,230,${0.25 + fade * 0.65})`;
      ctx.fillText(bearing.toString().padStart(3, "0"), x, top - 3);
    }
  }

  // Cardinal letters (N, NE, E, SE, S, SW, W, NW)
  for (const [deg, label] of COMPASS_POINTS) {
    let delta = deg - heading;
    while (delta > 180) delta -= 360;
    while (delta < -180) delta += 360;
    if (Math.abs(delta) > 60) continue;

    const x = cx + delta * pxPerDeg;
    const fade = 1 - Math.abs(delta) / 62;
    const isNorth = label === "N";

    ctx.fillStyle = isNorth
      ? `rgba(255,90,77,${0.4 + fade * 0.6})`
      : label.length === 1
        ? `rgba(77,200,255,${0.35 + fade * 0.65})`
        : `rgba(240,245,250,${0.25 + fade * 0.65})`;
    ctx.font =
      label.length === 1
        ? "700 13px ui-sans-serif, system-ui"
        : "600 10px ui-sans-serif, system-ui";
    ctx.fillText(label, x, top - 4);
  }

  // Red Diamond Enemy Gunfire Indicators on Compass Tape
  const pings = game.hud.gunfirePings ?? [];
  const now = game.time;
  const playerPos = game.player.position;

  for (const ping of pings) {
    if (ping.shooterTeam === game.player.team) continue;
    const age = now - ping.time;
    if (age > 3.2) continue;

    let delta = ping.bearing - heading;
    while (delta > 180) delta -= 360;
    while (delta < -180) delta += 360;
    if (Math.abs(delta) > 58) continue;

    const x = cx + delta * pxPerDeg;
    const alpha = Math.max(0, 1 - age / 3.2);
    const pulse = 1 + 0.25 * Math.sin(age * 14);
    const diaSize = 6 * pulse;
    const diaY = top + 17;

    // Glowing Red Diamond
    ctx.save();
    ctx.shadowColor = "rgba(255,40,40,0.9)";
    ctx.shadowBlur = 8;
    ctx.fillStyle = `rgba(255,50,45,${alpha * 0.95})`;
    ctx.strokeStyle = `rgba(255,255,255,${alpha * 0.85})`;
    ctx.lineWidth = 1.2;

    ctx.beginPath();
    ctx.moveTo(x, diaY - diaSize);
    ctx.lineTo(x + diaSize, diaY);
    ctx.lineTo(x, diaY + diaSize);
    ctx.lineTo(x - diaSize, diaY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Elevation indicator chevron (▲ if above, ▼ if below)
    const dy = ping.y - (playerPos.y + 1.6);
    if (Math.abs(dy) > 3.5) {
      ctx.fillStyle = `rgba(255,255,255,${alpha * 0.9})`;
      ctx.font = "700 8px ui-sans-serif, system-ui";
      ctx.fillText(dy > 0 ? "▲" : "▼", x, diaY + (dy > 0 ? -diaSize - 7 : diaSize + 2));
    }
    ctx.restore();
  }

  ctx.restore();

  // Center Reticle Marker (Tactical Amber/Cyan Arrow)
  ctx.save();
  ctx.fillStyle = AMBER;
  ctx.beginPath();
  ctx.moveTo(cx, top + 26);
  ctx.lineTo(cx - 5, top + 34);
  ctx.lineTo(cx + 5, top + 34);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* 5. Modern Tactical Radar Minimap with 360° Sweep & Geometry        */
/* ------------------------------------------------------------------ */

function paintRadarMinimap(ctx: CanvasRenderingContext2D): void {
  const hud = game.hud;
  if (!hud.alive) return;

  const mapX = 36;
  const mapY = 36;
  const mapSize = 190;
  const cx = mapX + mapSize / 2;
  const cy = mapY + mapSize / 2;
  const radius = mapSize / 2 - 6;
  const mapRangeM = 145; // 145m map view radius
  const scale = radius / mapRangeM;

  const player = game.player;
  const px = player.position.x;
  const pz = player.position.z;

  // Heading-up rotation angle: minimap rotates so player always looks UP
  const camHeadingRad = Math.atan2(game.cameraForward.x, -game.cameraForward.z);
  const cosH = Math.cos(-camHeadingRad);
  const sinH = Math.sin(-camHeadingRad);

  const worldToMap = (wx: number, wz: number): [number, number] => {
    const dx = wx - px;
    const dz = wz - pz;
    const rx = dx * cosH - dz * sinH;
    const rz = dx * sinH + dz * cosH;
    return [cx + rx * scale, cy + rz * scale];
  };

  ctx.save();

  // Tactical Frame Box Background
  chamferPath(ctx, mapX, mapY, mapSize, mapSize, 12);
  ctx.fillStyle = INK;
  ctx.fill();
  ctx.strokeStyle = "rgba(77,163,255,0.3)";
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // Telemetry Header
  ctx.font = "700 9px ui-monospace, monospace";
  ctx.letterSpacing = "1.5px";
  ctx.fillStyle = "rgba(148,163,184,0.8)";
  ctx.textAlign = "left";
  ctx.fillText("RADAR // UAV-SCAN", mapX + 12, mapY + 16);
  ctx.textAlign = "right";
  ctx.fillStyle = CYAN;
  ctx.fillText("150M", mapX + mapSize - 12, mapY + 16);
  ctx.letterSpacing = "0px";

  // Circular Clip for Radar Display
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy + 4, radius, 0, Math.PI * 2);
  ctx.clip();

  // Radar Grid Background
  ctx.fillStyle = "rgba(6,10,16,0.92)";
  ctx.fillRect(cx - radius, cy + 4 - radius, radius * 2, radius * 2);

  // Range rings (50m, 100m, 140m)
  ctx.strokeStyle = "rgba(77,163,255,0.14)";
  ctx.lineWidth = 1;
  for (const rM of [50, 100, 140]) {
    ctx.beginPath();
    ctx.arc(cx, cy + 4, rM * scale, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Crosshair axes
  ctx.strokeStyle = "rgba(77,163,255,0.12)";
  ctx.beginPath();
  ctx.moveTo(cx - radius, cy + 4);
  ctx.lineTo(cx + radius, cy + 4);
  ctx.moveTo(cx, cy + 4 - radius);
  ctx.lineTo(cx, cy + 4 + radius);
  ctx.stroke();

  // Runways / Taxiways Outline
  ctx.strokeStyle = "rgba(148,163,184,0.22)";
  ctx.lineWidth = 3.5;
  for (const rwy of RUNWAYS) {
    const [x1, y1] = worldToMap(rwy.from[0], rwy.from[1]);
    const [x2, y2] = worldToMap(rwy.to[0], rwy.to[1]);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  for (const twy of TAXIWAYS) {
    const [x1, y1] = worldToMap(twy.from[0], twy.from[1]);
    const [x2, y2] = worldToMap(twy.to[0], twy.to[1]);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  // Aprons & Hardstands
  ctx.fillStyle = "rgba(77,163,255,0.06)";
  for (const apron of APRONS) {
    const [ax, ay] = worldToMap(apron.center[0], apron.center[1]);
    const aw = apron.size[0] * scale;
    const ah = apron.size[1] * scale;
    ctx.fillRect(ax - aw / 2, ay - ah / 2, aw, ah);
  }

  // Airfield Site Structures Footprints
  ctx.fillStyle = "rgba(148,163,184,0.18)";
  ctx.strokeStyle = "rgba(148,163,184,0.4)";
  ctx.lineWidth = 1;
  for (const s of STRUCTURES) {
    const [sx, sy] = worldToMap(s.position[0], s.position[1]);
    const sw = Math.max(3, s.size[0] * scale);
    const sd = Math.max(3, s.size[2] * scale);
    // Draw structure box
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(s.rotation - camHeadingRad);
    ctx.fillRect(-sw / 2, -sd / 2, sw, sd);
    ctx.strokeRect(-sw / 2, -sd / 2, sw, sd);
    ctx.restore();
  }

  // 360° Radar Sweep Line with Phosphor Glow Trail
  const sweepAngle = ((performance.now() / 1400) * Math.PI * 2) % (Math.PI * 2);
  const sweepGrad = ctx.createRadialGradient(cx, cy + 4, 0, cx, cy + 4, radius);
  sweepGrad.addColorStop(0, "rgba(77,200,255,0.22)");
  sweepGrad.addColorStop(1, "rgba(77,200,255,0.02)");

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx, cy + 4);
  ctx.arc(cx, cy + 4, radius, sweepAngle - 0.45, sweepAngle);
  ctx.closePath();
  ctx.fillStyle = sweepGrad;
  ctx.fill();

  // Sweep leading beam
  ctx.strokeStyle = "rgba(77,240,255,0.85)";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(cx, cy + 4);
  ctx.lineTo(cx + Math.cos(sweepAngle) * radius, cy + 4 + Math.sin(sweepAngle) * radius);
  ctx.stroke();
  ctx.restore();

  // Objective markers on minimap
  for (const zone of hud.objectiveZones) {
    const [zx, zy] = worldToMap(zone.x, zone.z);
    ctx.save();
    ctx.fillStyle =
      zone.owner === "blue"
        ? BLUE
        : zone.owner === "red"
          ? RED
          : "rgba(240,245,250,0.85)";
    ctx.beginPath();
    ctx.arc(zx, zy, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = "700 8px ui-sans-serif, system-ui";
    ctx.fillStyle = "#05070a";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(zone.label, zx, zy);
    ctx.restore();
  }

  // Friendly Teammates (Blue Chevrons)
  for (const actor of game.actors) {
    if (!actor.alive || actor.isPlayer || actor.team !== player.team) continue;
    const [ax, ay] = worldToMap(actor.position.x, actor.position.z);
    const relYaw = actor.yaw - camHeadingRad;
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(relYaw);
    ctx.fillStyle = BLUE;
    ctx.beginPath();
    ctx.moveTo(0, -5);
    ctx.lineTo(4, 4);
    ctx.lineTo(0, 2);
    ctx.lineTo(-4, 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Enemy Gunfire Blips (Red Sonar Pings)
  const pings = hud.gunfirePings ?? [];
  const now = game.time;
  for (const ping of pings) {
    if (ping.shooterTeam === player.team) continue;
    const age = now - ping.time;
    if (age > 2.8) continue;
    const [gx, gy] = worldToMap(ping.x, ping.z);
    const alpha = Math.max(0, 1 - age / 2.8);
    const ripple = 3 + (age / 2.8) * 18;

    ctx.save();
    // Expanding sonar ring
    ctx.strokeStyle = `rgba(255,60,50,${alpha * 0.75})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(gx, gy, ripple, 0, Math.PI * 2);
    ctx.stroke();

    // Center gunshot blip
    ctx.fillStyle = `rgba(255,45,40,${alpha * 0.95})`;
    ctx.shadowColor = "rgba(255,30,30,0.9)";
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(gx, gy, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Player at Center (Cyan Arrow + Forward Vision Cone Arc)
  ctx.save();
  // Vision cone arc
  ctx.fillStyle = "rgba(77,240,255,0.08)";
  ctx.beginPath();
  ctx.moveTo(cx, cy + 4);
  ctx.arc(cx, cy + 4, 38, -Math.PI / 2 - 0.42, -Math.PI / 2 + 0.42);
  ctx.closePath();
  ctx.fill();

  // Cyan player chevron pointing straight UP
  ctx.fillStyle = CYAN;
  ctx.shadowColor = "rgba(77,240,255,0.85)";
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.moveTo(cx, cy + 4 - 6.5);
  ctx.lineTo(cx + 5, cy + 4 + 4.5);
  ctx.lineTo(cx, cy + 4 + 2);
  ctx.lineTo(cx - 5, cy + 4 + 4.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.restore(); // End of circular clip

  ctx.restore(); // End of minimap frame
}

/* ------------------------------------------------------------------ */
/* 6. CoD XP Score Popups & Medals (+100 ELIMINATED, HEADSHOT, etc.)  */
/* ------------------------------------------------------------------ */

function paintScoreEvents(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const hud = game.hud;
  const events = hud.scoreEvents;
  if (!events || events.length === 0) return;

  const now = game.time;
  // Positioned in center-right (Modern Warfare style)
  const x = w * 0.62;
  let baseY = h * 0.42;

  ctx.save();
  ctx.textBaseline = "middle";

  // Prune expired events
  while (events.length > 0 && now - events[0]!.time > 2.8) {
    events.shift();
  }

  for (const event of events) {
    const age = now - event.time;
    if (age < 0) continue;
    const alpha = Math.max(0, Math.min(1, (2.8 - age) / 0.8));
    const pop = Math.min(1, age * 8); // Scale pop in
    const slideOffset = (1 - pop) * 24;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, baseY - slideOffset);

    // Medal Background Plate
    const isMedal = event.medal !== false;
    const cardW = 210;
    const cardH = 32;

    chamferPath(ctx, 0, -cardH / 2, cardW, cardH, 6);
    ctx.fillStyle = isMedal ? "rgba(18,22,28,0.85)" : INK;
    ctx.fill();
    ctx.strokeStyle = isMedal ? "rgba(255,215,0,0.45)" : "rgba(77,163,255,0.3)";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Gold / White XP Points Badge
    ctx.textAlign = "left";
    ctx.font = "800 16px ui-monospace, monospace";
    ctx.fillStyle = isMedal ? GOLD : "#f0f4f8";
    ctx.shadowColor = isMedal ? "rgba(255,215,0,0.6)" : "rgba(0,0,0,0.8)";
    ctx.shadowBlur = 6;
    ctx.fillText(`+${event.points}`, 12, 0);

    // Medal Title (e.g. ELIMINATED, HEADSHOT, LONGSHOT)
    ctx.font = "700 11px ui-sans-serif, system-ui, sans-serif";
    ctx.letterSpacing = "1.5px";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(event.label.toUpperCase(), 72, event.subtext ? -5 : 0);

    // Subtext (e.g. victim name or distance)
    if (event.subtext) {
      ctx.font = "600 9px ui-monospace, monospace";
      ctx.fillStyle = "rgba(148,163,184,0.9)";
      ctx.letterSpacing = "1px";
      ctx.fillText(event.subtext.toUpperCase(), 72, 8);
    }

    ctx.restore();
    baseY += 38;
  }

  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* 7. Tactical Squad Radio Callout Feed                               */
/* ------------------------------------------------------------------ */

function paintSquadRadioFeed(ctx: CanvasRenderingContext2D, h: number): void {
  const hud = game.hud;
  const callouts = hud.radioCallouts;
  if (!callouts || callouts.length === 0) return;

  const now = game.time;
  const x = 36;
  let y = h - 145;

  ctx.save();
  ctx.textBaseline = "middle";

  // Prune expired callouts
  while (callouts.length > 0 && now - callouts[0]!.time > 4.2) {
    callouts.shift();
  }

  for (const callout of callouts) {
    const age = now - callout.time;
    const alpha = Math.max(0, Math.min(1, (4.2 - age) / 0.8));

    ctx.save();
    ctx.globalAlpha = alpha;

    ctx.font = "700 11px ui-monospace, monospace";
    const speakerText = `[${callout.speaker}]`;
    const speakerW = ctx.measureText(speakerText).width;

    ctx.fillStyle = callout.team === "blue" ? BLUE : RED;
    ctx.fillText(speakerText, x, y);

    ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
    ctx.fillStyle = "rgba(236,242,248,0.95)";
    ctx.fillText(` ${callout.text}`, x + speakerW + 4, y);

    ctx.restore();
    y -= 20;
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* 8. Ammo & Weapon Readout                                           */
/* ------------------------------------------------------------------ */

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

  ctx.fillStyle = "rgba(226,232,240,0.85)";
  ctx.font = "700 13px ui-sans-serif, system-ui, sans-serif";
  ctx.letterSpacing = "2px";
  ctx.fillText(hud.weaponName.toUpperCase(), right, bottom - 52);
  ctx.letterSpacing = "0px";

  // Fire-mode chip
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

  // Magazine bar: one tick per round
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

  // Reload arc
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

/* ------------------------------------------------------------------ */
/* 9. Match Score & Objectives                                        */
/* ------------------------------------------------------------------ */

function paintScore(ctx: CanvasRenderingContext2D, w: number): void {
  const hud = game.hud;
  const cx = w / 2;
  const y = 66;
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

function paintObjectives(ctx: CanvasRenderingContext2D, w: number): void {
  const hud = game.hud;
  const zones = hud.objectiveZones;
  if (zones.length === 0) return;

  const cx = w / 2;
  const baseY = 94;
  const chipW = 56;
  const chipH = 26;
  const gap = 8;
  const totalW = zones.length * chipW + (zones.length - 1) * gap;
  const startX = cx - totalW / 2;

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (let i = 0; i < zones.length; i++) {
    const zone = zones[i]!;
    const x = startX + i * (chipW + gap);
    const y = baseY;

    chamferPath(ctx, x, y, chipW, chipH, 5);
    ctx.fillStyle = zone.contested
      ? "rgba(255,182,72,0.2)"
      : zone.owner === "blue"
        ? "rgba(77,163,255,0.2)"
        : zone.owner === "red"
          ? "rgba(255,90,77,0.2)"
          : INK;
    ctx.fill();

    const barH = 3;
    ctx.fillStyle = zone.contested
      ? AMBER
      : zone.owner === "blue"
        ? BLUE
        : zone.owner === "red"
          ? RED
          : "rgba(226,232,240,0.25)";
    ctx.fillRect(x + 2, y + chipH - barH - 1, (chipW - 4) * zone.progress, barH);

    ctx.font = "700 12px ui-sans-serif, system-ui, sans-serif";
    ctx.fillStyle = zone.contested
      ? AMBER
      : zone.owner === "blue"
        ? BLUE
        : zone.owner === "red"
          ? RED
          : "rgba(226,232,240,0.8)";
    ctx.fillText(zone.label, x + chipW / 2, y + chipH / 2 - 2);
  }

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
    ctx.fillText(hud.killedByHeadshot ? `${weapon}  ·  HEADSHOT` : weapon, cx, top + 68);
  }

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
/* Main CombatHud Canvas Component                                    */
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
      paintRadarMinimap(ctx);
      paintCompass(ctx, w);
      paintScore(ctx, w);
      paintObjectives(ctx, w);
      paintAmmo(ctx, w, h);
      paintEquipment(ctx, h);
      paintScoreEvents(ctx, w, h);
      paintSquadRadioFeed(ctx, h);
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
