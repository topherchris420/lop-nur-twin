import * as THREE from "three";
import { mulberry32 } from "@/lib/noise";
import type { WeaponClass, WeaponDef } from "../core/types";
import {
  createCollimatedReticleMaterial,
  getWeaponMaterials,
  type WeaponMaterials,
} from "./materials";
import { buildArms } from "./arms";
import {
  chamferedBox,
  curvedMagazine,
  flutes,
  lathe,
  mergeAndDispose,
  mirrorX,
  mlokSlots,
  picatinnyRail,
  place,
  portRing,
  shell,
  tube,
} from "./geometry";

/**
 * Procedural weapon models.
 *
 * The viewmodel is the only asset the player looks at for the entire match, so
 * it gets the geometry budget. Each weapon is assembled from 90–180 solids at
 * true scale (an assault rifle is 0.78 m from muzzle to butt plate) and then
 * merged down by material, which keeps the draw-call count at five or six
 * while preserving every chamfer, port and rail slot.
 *
 * Local frame: the muzzle points along −Z, +Y is up, +X is the ejection side.
 * The origin sits at the firing-hand grip reference, which is what the
 * animation layer springs around.
 */

export interface WeaponModelParts {
  receiver: THREE.Object3D;
  barrel: THREE.Object3D;
  magazine: THREE.Object3D;
  bolt: THREE.Object3D;
  chargingHandle: THREE.Object3D;
  trigger: THREE.Object3D;
  /** Empty at the muzzle: world position drives flashes, tracers and smoke. */
  muzzleTip: THREE.Object3D;
  ejectionPort: THREE.Object3D;
  optic: THREE.Object3D | null;
  opticReticle: THREE.Object3D | null;
  /** Empty on the optical axis, used to derive the aim-down-sight transform. */
  sightAxis: THREE.Object3D;
  /** Tactical laser beam emitter anchor on the barrel/rail. */
  laserEmitter: THREE.Object3D;
  stock: THREE.Object3D;
  foregrip: THREE.Object3D | null;
  /** IK targets for the hands. */
  leftHand: THREE.Object3D;
  rightHand: THREE.Object3D;
  /** Metres the bolt travels on each shot. */
  boltTravel: number;
  /** Metres the charging handle travels on a chambering pull. */
  chargingTravel: number;
}

export interface WeaponModel {
  root: THREE.Group;
  parts: WeaponModelParts;
  /**
   * Sight-line position in the model's own space. The aim pose is solved from
   * this every frame rather than baked, so it stays correct as the field of
   * view changes through the aim blend.
   */
  sightOffset: THREE.Vector3;
  /** Where the grip sits in eye space at the hip, before FOV compensation. */
  hipPosition: THREE.Vector3;
  hipRotation: THREE.Euler;
  /** Eye-to-optic distance when fully aimed, in metres (negative is forward). */
  adsDistance: number;
  adsRotation: THREE.Euler;
  triangleCount: number;
  dispose(): void;
}

/* ------------------------------------------------------------------ */
/* Per-class dimensions                                                */
/* ------------------------------------------------------------------ */

interface LongGunSpec {
  /** Distance from the grip origin to the muzzle, negative Z. */
  muzzleZ: number;
  /** Where the handguard ends and the exposed barrel begins. */
  handguardFront: number;
  handguardRadius: number;
  barrelRadius: number;
  receiverTop: number;
  receiverBack: number;
  stockBack: number;
  stockKind: "collapsible" | "fixed" | "skeleton" | "folding" | "none";
  magKind: "curved" | "straight" | "box" | "drum" | "tube" | "none";
  magLength: number;
  magWidth: number;
  railLength: number;
  bipod: boolean;
  carryHandle: boolean;
  heatShield: boolean;
  /** Muzzle device profile. */
  muzzle: "flash-hider" | "brake" | "comp" | "thread" | "choke";
}

function specForClass(weaponClass: WeaponClass): LongGunSpec {
  const base: LongGunSpec = {
    muzzleZ: -0.5,
    handguardFront: -0.36,
    handguardRadius: 0.0235,
    barrelRadius: 0.0058,
    receiverTop: 0.072,
    receiverBack: 0.06,
    stockBack: 0.28,
    stockKind: "collapsible",
    magKind: "curved",
    magLength: 0.19,
    magWidth: 0.0255,
    railLength: 0.42,
    bipod: false,
    carryHandle: false,
    heatShield: false,
    muzzle: "flash-hider",
  };
  switch (weaponClass) {
    case "smg":
      return {
        ...base,
        muzzleZ: -0.35,
        handguardFront: -0.26,
        handguardRadius: 0.021,
        barrelRadius: 0.005,
        stockBack: 0.235,
        stockKind: "folding",
        magLength: 0.165,
        magWidth: 0.024,
        railLength: 0.3,
        muzzle: "comp",
      };
    case "lmg":
      return {
        ...base,
        muzzleZ: -0.585,
        handguardFront: -0.42,
        handguardRadius: 0.026,
        barrelRadius: 0.0072,
        receiverTop: 0.078,
        stockBack: 0.31,
        stockKind: "fixed",
        magKind: "box",
        magLength: 0.14,
        magWidth: 0.062,
        railLength: 0.46,
        bipod: true,
        carryHandle: true,
        heatShield: true,
        muzzle: "flash-hider",
      };
    case "marksman":
      return {
        ...base,
        muzzleZ: -0.56,
        handguardFront: -0.4,
        barrelRadius: 0.0068,
        stockBack: 0.3,
        stockKind: "skeleton",
        magLength: 0.15,
        railLength: 0.46,
        muzzle: "brake",
      };
    case "sniper":
      return {
        ...base,
        muzzleZ: -0.66,
        handguardFront: -0.44,
        handguardRadius: 0.027,
        barrelRadius: 0.0092,
        receiverTop: 0.076,
        stockBack: 0.33,
        stockKind: "skeleton",
        magKind: "straight",
        magLength: 0.12,
        magWidth: 0.03,
        railLength: 0.44,
        bipod: true,
        muzzle: "brake",
      };
    case "shotgun":
      return {
        ...base,
        muzzleZ: -0.53,
        handguardFront: -0.44,
        handguardRadius: 0.024,
        barrelRadius: 0.0125,
        stockBack: 0.3,
        stockKind: "fixed",
        magKind: "tube",
        magLength: 0.34,
        railLength: 0.24,
        heatShield: true,
        muzzle: "choke",
      };
    default:
      return base;
  }
}

/* ------------------------------------------------------------------ */
/* Builder                                                             */
/* ------------------------------------------------------------------ */

interface Bucket {
  material: THREE.Material;
  parts: THREE.BufferGeometry[];
}

class Assembler {
  private readonly buckets = new Map<THREE.Material, Bucket>();

  add(material: THREE.Material, geometry: THREE.BufferGeometry): void {
    let bucket = this.buckets.get(material);
    if (!bucket) {
      bucket = { material, parts: [] };
      this.buckets.set(material, bucket);
    }
    bucket.parts.push(geometry);
  }

  /** Merge each material bucket into one mesh and parent it to `target`. */
  flushInto(target: THREE.Object3D, castShadow = true): number {
    let triangles = 0;
    for (const bucket of this.buckets.values()) {
      if (bucket.parts.length === 0) continue;
      const merged = mergeAndDispose(bucket.parts);
      const mesh = new THREE.Mesh(merged, bucket.material);
      mesh.castShadow = castShadow;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      target.add(mesh);
      const index = merged.getIndex();
      triangles += index ? index.count / 3 : merged.getAttribute("position").count / 3;
    }
    this.buckets.clear();
    return triangles;
  }
}

/** Standard rail-mounted red-dot / holographic sight. */
function buildOptic(
  m: WeaponMaterials,
  kind: "reddot" | "holo" | "acog" | "scope",
  railTop: number,
  z: number,
): {
  group: THREE.Group;
  reticle: THREE.Object3D;
  axis: THREE.Object3D;
  triangles: number;
} {
  const group = new THREE.Group();
  const asm = new Assembler();
  let axisY = railTop;

  if (kind === "reddot") {
    const bodyH = 0.038;
    const tubeR = 0.0155;
    axisY = railTop + 0.0285;
    // Mount base + throw lever.
    asm.add(
      m.optic,
      place(chamferedBox(0.026, 0.014, 0.052, { radius: 0.002 }), 0, railTop + 0.007, 0),
    );
    asm.add(
      m.optic,
      place(
        chamferedBox(0.0075, 0.011, 0.03, { radius: 0.002 }),
        0.016,
        railTop + 0.008,
        0.004,
      ),
    );
    // Body: an open-emitter housing — two uprights and a hood.
    asm.add(
      m.optic,
      place(
        chamferedBox(0.0055, bodyH, 0.05, { radius: 0.0015 }),
        -0.0155,
        railTop + bodyH / 2 + 0.012,
        0,
      ),
    );
    asm.add(
      m.optic,
      place(
        chamferedBox(0.0055, bodyH, 0.05, { radius: 0.0015 }),
        0.0155,
        railTop + bodyH / 2 + 0.012,
        0,
      ),
    );
    asm.add(
      m.optic,
      place(
        chamferedBox(0.036, 0.006, 0.05, { radius: 0.0015 }),
        0,
        railTop + bodyH + 0.014,
        0,
      ),
    );
    // Windage / elevation turrets.
    asm.add(
      m.optic,
      place(tube(0.0055, 0.006, 0.009, 14), 0.017, axisY, 0.019, 0, Math.PI / 2, 0),
    );
    asm.add(
      m.optic,
      place(tube(0.0055, 0.006, 0.009, 14), 0, axisY + 0.014, 0.019, Math.PI / 2, 0, 0),
    );
    // Lens: a large flat window, slightly reclined like a real reflex sight.
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(tubeR * 1.85, bodyH * 0.82),
      m.lens,
    );
    glass.position.set(0, axisY, 0.004);
    glass.rotation.x = -0.14;
    group.add(glass);
  } else if (kind === "holo") {
    axisY = railTop + 0.031;
    asm.add(
      m.optic,
      place(
        chamferedBox(0.03, 0.016, 0.095, { radius: 0.002 }),
        0,
        railTop + 0.008,
        0.012,
      ),
    );
    asm.add(
      m.optic,
      place(
        chamferedBox(0.042, 0.042, 0.052, { radius: 0.003 }),
        0,
        railTop + 0.033,
        -0.014,
      ),
    );
    asm.add(
      m.optic,
      place(
        chamferedBox(0.036, 0.026, 0.042, { radius: 0.002 }),
        0,
        railTop + 0.028,
        0.042,
      ),
    );
    asm.add(
      m.optic,
      place(
        tube(0.004, 0.004, 0.006, 10),
        0.019,
        railTop + 0.026,
        0.05,
        0,
        Math.PI / 2,
        0,
      ),
    );
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.031, 0.026), m.lens);
    glass.position.set(0, axisY, -0.038);
    group.add(glass);
  } else {
    // Magnified optic: a turned tube with an objective bell and a sunshade.
    const isScope = kind === "scope";
    const tubeR = isScope ? 0.0152 : 0.0135;
    const objR = isScope ? 0.026 : 0.019;
    const length = isScope ? 0.26 : 0.16;
    axisY = railTop + (isScope ? 0.038 : 0.032);
    const profile: [number, number][] = [
      [tubeR * 0.92, length / 2],
      [tubeR * 1.12, length / 2 - 0.012],
      [tubeR, length / 2 - 0.02],
      [tubeR, 0.03],
      [tubeR * 1.16, 0.024],
      [tubeR * 1.16, 0.006],
      [tubeR, 0],
      [tubeR, -length / 2 + 0.075],
      [objR * 0.82, -length / 2 + 0.05],
      [objR, -length / 2 + 0.03],
      [objR, -length / 2 + 0.004],
      [objR * 0.93, -length / 2],
    ];
    asm.add(m.optic, place(lathe(profile, 28), 0, axisY, 0));
    // Rings.
    for (const ringZ of [-length / 2 + 0.085, length / 2 - 0.05]) {
      asm.add(
        m.optic,
        place(shell(tubeR + 0.0055, tubeR - 0.0002, 0.017, 22), 0, axisY, ringZ),
      );
      asm.add(
        m.optic,
        place(
          chamferedBox(0.03, 0.03, 0.016, { radius: 0.002 }),
          0,
          axisY - tubeR - 0.012,
          ringZ,
        ),
      );
      asm.add(
        m.steel,
        place(
          tube(0.0018, 0.0018, 0.012, 8),
          0.011,
          axisY - tubeR - 0.006,
          ringZ,
          Math.PI / 2,
          0,
          0,
        ),
      );
      asm.add(
        m.steel,
        place(
          tube(0.0018, 0.0018, 0.012, 8),
          -0.011,
          axisY - tubeR - 0.006,
          ringZ,
          Math.PI / 2,
          0,
          0,
        ),
      );
    }
    // Turrets with knurled caps.
    asm.add(
      m.optic,
      place(
        tube(0.011, 0.012, 0.019, 18),
        0,
        axisY + tubeR + 0.008,
        0.012,
        Math.PI / 2,
        0,
        0,
      ),
    );
    asm.add(
      m.optic,
      place(tube(0.0105, 0.0115, 0.017, 18), 0.019, axisY, 0.012, 0, Math.PI / 2, 0),
    );
    asm.add(
      m.optic,
      place(tube(0.0105, 0.0115, 0.014, 18), -0.017, axisY, 0.012, 0, Math.PI / 2, 0),
    );
    // Magnification ring.
    asm.add(
      m.optic,
      place(shell(tubeR + 0.0032, tubeR, 0.022, 24), 0, axisY, length / 2 - 0.055),
    );
    // Ocular and objective glass.
    const ocular = new THREE.Mesh(new THREE.CircleGeometry(tubeR * 0.86, 24), m.lens);
    ocular.position.set(0, axisY, length / 2 - 0.004);
    group.add(ocular);
    const objective = new THREE.Mesh(new THREE.CircleGeometry(objR * 0.86, 28), m.lens);
    objective.position.set(0, axisY, -length / 2 + 0.006);
    objective.rotation.y = Math.PI;
    group.add(objective);
  }

  // Reticle: an emissive collimated reticle shader locked to the optical axis with aperture clipping & parallax
  const reticleSize = kind === "scope" ? 0.032 : 0.026;
  const reticleTexture = makeReticleTexture(kind);
  const collimatedMaterial = createCollimatedReticleMaterial(
    reticleTexture,
    kind === "scope" ? 0x22ff55 : 0xff2a18,
  );
  const reticle = new THREE.Mesh(
    new THREE.PlaneGeometry(reticleSize, reticleSize),
    collimatedMaterial,
  );
  reticle.position.set(0, axisY, kind === "holo" ? -0.04 : -0.02);
  reticle.renderOrder = 8;
  reticle.visible = false;
  group.add(reticle);

  const axis = new THREE.Object3D();
  axis.position.set(0, axisY, 0);
  group.add(axis);
  group.position.z = z;

  const triangles = asm.flushInto(group, false);
  return { group, reticle, axis, triangles };
}

const reticleCache = new Map<string, THREE.CanvasTexture>();

function makeReticleTexture(kind: string): THREE.Texture {
  const existing = reticleCache.get(kind);
  if (existing) return existing;
  if (typeof document === "undefined") {
    const dummy = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    dummy.needsUpdate = true;
    return dummy;
  }
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, size, size);
  const c = size / 2;
  ctx.strokeStyle = "#ffffff";
  ctx.fillStyle = "#ffffff";
  ctx.lineCap = "butt";

  if (kind === "reddot") {
    const glow = ctx.createRadialGradient(c, c, 0, c, c, 22);
    glow.addColorStop(0, "rgba(255,255,255,1)");
    glow.addColorStop(0.35, "rgba(255,255,255,0.55)");
    glow.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);
  } else if (kind === "holo") {
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(c, c, 54, 0, Math.PI * 2);
    ctx.stroke();
    // Tick marks at the cardinal points of the ring.
    for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(angle) * 44, c + Math.sin(angle) * 44);
      ctx.lineTo(c + Math.cos(angle) * 54, c + Math.sin(angle) * 54);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(c, c, 5, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === "acog") {
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(c, c - 8);
    ctx.lineTo(c - 9, c + 12);
    ctx.lineTo(c + 9, c + 12);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(c, c + 12);
    ctx.lineTo(c, c + 96);
    ctx.stroke();
    for (let i = 1; i <= 3; i += 1) {
      const y = c + 12 + i * 21;
      const w = 16 - i * 3;
      ctx.beginPath();
      ctx.moveTo(c - w, y);
      ctx.lineTo(c + w, y);
      ctx.stroke();
    }
  } else {
    // Mil-dot crosshair with a fine centre and heavy outer posts.
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(c, 34);
    ctx.lineTo(c, size - 34);
    ctx.moveTo(34, c);
    ctx.lineTo(size - 34, c);
    ctx.stroke();
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(c, 10);
    ctx.lineTo(c, 46);
    ctx.moveTo(c, size - 46);
    ctx.lineTo(c, size - 10);
    ctx.moveTo(10, c);
    ctx.lineTo(46, c);
    ctx.moveTo(size - 46, c);
    ctx.lineTo(size - 10, c);
    ctx.stroke();
    for (let i = 1; i <= 4; i += 1) {
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(c + s * i * 21, c, 2.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(c, c + s * i * 21, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  reticleCache.set(kind, texture);
  return texture;
}

/* ------------------------------------------------------------------ */
/* Long guns                                                           */
/* ------------------------------------------------------------------ */

function buildLongGun(
  def: WeaponDef,
  spec: LongGunSpec,
  m: WeaponMaterials,
): WeaponModel {
  const root = new THREE.Group();
  const asm = new Assembler();
  const rand = mulberry32(def.seed >>> 0);
  const railTop = spec.receiverTop + 0.0085;

  /* ------------------------------------------------- lower receiver */
  const lowerLen = 0.17;
  const lowerZ = -0.03;
  asm.add(
    m.receiver,
    place(
      chamferedBox(0.038, 0.05, lowerLen, { radius: 0.004, curveSegments: 4 }),
      0,
      0.008,
      lowerZ,
    ),
  );
  // Magwell flare.
  asm.add(
    m.receiver,
    place(
      chamferedBox(0.046, 0.028, 0.052, { radius: 0.004, curveSegments: 4 }),
      0,
      -0.006,
      -0.078,
    ),
  );
  asm.add(
    m.receiver,
    place(chamferedBox(0.05, 0.008, 0.058, { radius: 0.003 }), 0, -0.02, -0.078),
  );
  // Trigger guard: an arc of small segments.
  for (let i = 0; i <= 9; i += 1) {
    const t = i / 9;
    const angle = Math.PI * (0.08 + t * 0.84);
    asm.add(
      m.receiver,
      place(
        chamferedBox(0.0075, 0.006, 0.011, { radius: 0.0018 }),
        0,
        -0.019 - Math.sin(angle) * 0.019,
        -0.028 + Math.cos(angle) * 0.023,
        Math.PI / 2 - angle,
      ),
    );
  }
  // Selector, magazine release, bolt catch, takedown pins.
  asm.add(
    m.steel,
    place(tube(0.0072, 0.0072, 0.044, 14), 0, 0.012, -0.012, 0, Math.PI / 2, 0),
  );
  asm.add(
    m.steel,
    place(
      chamferedBox(0.019, 0.0075, 0.011, { radius: 0.002 }),
      -0.026,
      0.012,
      -0.006,
      0,
      0,
      0.35,
    ),
  );
  asm.add(
    m.steel,
    place(tube(0.0058, 0.0058, 0.012, 12), 0.024, 0.004, -0.062, 0, Math.PI / 2, 0),
  );
  asm.add(
    m.steel,
    place(chamferedBox(0.008, 0.017, 0.02, { radius: 0.002 }), -0.023, 0.006, -0.058),
  );
  asm.add(
    m.steel,
    place(tube(0.0035, 0.0035, 0.042, 10), 0, 0.026, -0.098, 0, Math.PI / 2, 0),
  );
  asm.add(
    m.steel,
    place(tube(0.0035, 0.0035, 0.042, 10), 0, 0.026, 0.036, 0, Math.PI / 2, 0),
  );

  /* ------------------------------------------------- upper receiver */
  const upperLen = 0.2 + spec.receiverBack;
  const upperZ = -0.05;
  asm.add(
    m.receiver,
    place(
      chamferedBox(0.041, 0.042, upperLen, { radius: 0.006, curveSegments: 5 }),
      0,
      spec.receiverTop - 0.021,
      upperZ,
    ),
  );
  // Brass deflector and forward assist on the ejection side.
  asm.add(
    m.receiver,
    place(
      chamferedBox(0.012, 0.024, 0.03, { radius: 0.005 }),
      0.023,
      spec.receiverTop - 0.018,
      -0.026,
      0,
      0,
      -0.3,
    ),
  );
  asm.add(
    m.steel,
    place(
      tube(0.0062, 0.0062, 0.02, 12),
      0.021,
      spec.receiverTop - 0.03,
      -0.006,
      0,
      Math.PI / 2,
      0,
    ),
  );
  // Ejection port with a dust cover hinged below it.
  const ejectionPort = new THREE.Group();
  const portAsm = new Assembler();
  portAsm.add(
    m.nitride,
    place(
      chamferedBox(0.004, 0.021, 0.038, { radius: 0.003 }),
      0.0205,
      spec.receiverTop - 0.022,
      -0.036,
    ),
  );
  portAsm.add(
    m.receiver,
    place(
      chamferedBox(0.005, 0.024, 0.042, { radius: 0.003 }),
      0.0225,
      spec.receiverTop - 0.022,
      -0.036,
    ),
  );
  portAsm.flushInto(ejectionPort);
  ejectionPort.position.set(0.024, spec.receiverTop - 0.022, -0.036);
  root.add(ejectionPort);

  /* ------------------------------------------------------- rail */
  asm.add(
    m.receiver,
    place(
      picatinnyRail(spec.railLength),
      0,
      spec.receiverTop,
      -0.05 - spec.railLength / 2 + 0.1,
    ),
  );

  /* -------------------------------------------------- handguard */
  const hgLength = spec.handguardFront - -0.135;
  const hgCenter = (-0.135 + spec.handguardFront) / 2;
  const hgLen = Math.abs(hgLength);
  if (spec.heatShield) {
    // Perforated shroud: a shell plus rings of vent holes.
    asm.add(
      m.receiver,
      place(
        shell(spec.handguardRadius, spec.handguardRadius - 0.0035, hgLen, 22),
        0,
        spec.receiverTop - 0.028,
        hgCenter,
      ),
    );
    for (let ring = 0; ring < 6; ring += 1) {
      const z = hgCenter - hgLen / 2 + 0.03 + (ring * (hgLen - 0.06)) / 5;
      asm.add(
        m.nitride,
        place(
          portRing(10, spec.handguardRadius - 0.001, 0.0035, 0.004),
          0,
          spec.receiverTop - 0.028,
          z,
        ),
      );
    }
  } else {
    asm.add(
      m.receiver,
      place(
        shell(spec.handguardRadius, spec.handguardRadius - 0.004, hgLen, 20),
        0,
        spec.receiverTop - 0.028,
        hgCenter,
      ),
    );
    // M-LOK slot rows at 3, 6 and 9 o'clock.
    const slots = Math.max(3, Math.floor(hgLen / 0.048));
    for (const angle of [0, Math.PI / 2, -Math.PI / 2, Math.PI]) {
      const g = mlokSlots(slots, hgLen / slots);
      g.rotateZ(angle);
      g.translate(
        Math.sin(angle) * (spec.handguardRadius - 0.0008),
        spec.receiverTop - 0.028 + Math.cos(angle) * (spec.handguardRadius - 0.0008),
        hgCenter,
      );
      asm.add(m.nitride, g);
    }
    // Anti-rotation flats top and bottom keep the section from reading round.
    asm.add(
      m.receiver,
      place(
        chamferedBox(0.028, 0.005, hgLen, { radius: 0.002 }),
        0,
        spec.receiverTop - 0.028 + spec.handguardRadius - 0.001,
        hgCenter,
      ),
    );
  }
  // Barrel nut.
  asm.add(
    m.steel,
    place(
      tube(spec.handguardRadius * 0.86, spec.handguardRadius * 0.86, 0.02, 20),
      0,
      spec.receiverTop - 0.028,
      -0.128,
    ),
  );

  /* ------------------------------------------------------ barrel */
  const barrelY = spec.receiverTop - 0.028;
  const exposed = spec.handguardFront - spec.muzzleZ;
  asm.add(
    m.steel,
    place(
      tube(
        spec.barrelRadius,
        spec.barrelRadius * 1.14,
        Math.abs(spec.muzzleZ - -0.13) - 0.03,
        18,
      ),
      0,
      barrelY,
      (spec.muzzleZ + -0.13) / 2,
    ),
  );
  if (exposed > 0.02) {
    asm.add(
      m.steel,
      place(
        flutes(6, spec.barrelRadius, exposed * 0.7),
        0,
        barrelY,
        spec.handguardFront - exposed * 0.45,
      ),
    );
  }
  // Gas block with a low-profile journal, and the gas tube running back.
  const gasZ = spec.handguardFront + 0.03;
  asm.add(
    m.steel,
    place(chamferedBox(0.019, 0.019, 0.026, { radius: 0.002 }), 0, barrelY, gasZ),
  );
  asm.add(
    m.steel,
    place(
      tube(0.0022, 0.0022, Math.abs(gasZ - -0.12), 8),
      0,
      barrelY + 0.0105,
      (gasZ + -0.12) / 2,
    ),
  );

  /* ----------------------------------------------- muzzle device */
  const muzzleLen =
    spec.muzzle === "brake" ? 0.075 : spec.muzzle === "choke" ? 0.05 : 0.06;
  const muzzleR = spec.barrelRadius * (spec.muzzle === "choke" ? 1.24 : 1.9);
  const muzzleCenter = spec.muzzleZ + muzzleLen / 2;
  if (spec.muzzle === "flash-hider") {
    asm.add(
      m.nitride,
      place(
        lathe(
          [
            [spec.barrelRadius * 1.2, muzzleLen / 2],
            [muzzleR * 0.86, muzzleLen / 2 - 0.008],
            [muzzleR * 0.86, muzzleLen / 2 - 0.016],
            [muzzleR, muzzleLen / 2 - 0.02],
            [muzzleR, -muzzleLen / 2 + 0.006],
            [muzzleR * 0.92, -muzzleLen / 2],
            [spec.barrelRadius * 0.75, -muzzleLen / 2],
          ],
          22,
        ),
        0,
        barrelY,
        muzzleCenter,
      ),
    );
    // Prong slots.
    for (let i = 0; i < 4; i += 1) {
      const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
      asm.add(
        m.nitride,
        place(
          chamferedBox(0.0028, muzzleR * 1.1, 0.03, { radius: 0.001 }),
          Math.sin(angle) * muzzleR * 0.5,
          barrelY + Math.cos(angle) * muzzleR * 0.5,
          muzzleCenter - 0.012,
          0,
          0,
          -angle,
        ),
      );
    }
  } else if (spec.muzzle === "brake") {
    asm.add(
      m.nitride,
      place(
        chamferedBox(muzzleR * 2, muzzleR * 1.8, muzzleLen, { radius: 0.0025 }),
        0,
        barrelY,
        muzzleCenter,
      ),
    );
    for (let i = 0; i < 3; i += 1) {
      const z = muzzleCenter - muzzleLen / 2 + 0.014 + i * 0.018;
      asm.add(
        m.steel,
        place(
          chamferedBox(muzzleR * 2.2, 0.0035, 0.006, { radius: 0.001 }),
          0,
          barrelY + muzzleR * 0.55,
          z,
        ),
      );
      asm.add(
        m.steel,
        place(
          chamferedBox(muzzleR * 2.2, 0.0035, 0.006, { radius: 0.001 }),
          0,
          barrelY - muzzleR * 0.55,
          z,
        ),
      );
    }
  } else if (spec.muzzle === "comp") {
    asm.add(
      m.nitride,
      place(tube(muzzleR, muzzleR * 1.05, muzzleLen, 20), 0, barrelY, muzzleCenter),
    );
    asm.add(
      m.nitride,
      place(
        portRing(6, muzzleR * 0.62, 0.0022, muzzleR * 2.2),
        0,
        barrelY,
        muzzleCenter - 0.012,
      ),
    );
    asm.add(
      m.nitride,
      place(
        portRing(6, muzzleR * 0.62, 0.0022, muzzleR * 2.2),
        0,
        barrelY,
        muzzleCenter + 0.008,
      ),
    );
  } else {
    asm.add(
      m.nitride,
      place(tube(muzzleR, muzzleR * 1.04, muzzleLen, 20), 0, barrelY, muzzleCenter),
    );
  }

  /* --------------------------------------------- front sight post */
  const foldedSight = spec.railLength > 0.3;
  if (foldedSight) {
    asm.add(
      m.steel,
      place(
        chamferedBox(0.014, 0.026, 0.009, { radius: 0.0015 }),
        0,
        railTop + 0.012,
        spec.handguardFront + 0.012,
      ),
    );
    asm.add(
      m.steel,
      place(
        tube(0.0012, 0.0012, 0.018, 8),
        0,
        railTop + 0.02,
        spec.handguardFront + 0.012,
      ),
    );
    asm.add(
      m.steel,
      place(
        chamferedBox(0.019, 0.02, 0.008, { radius: 0.004 }),
        0,
        railTop + 0.014,
        -0.02,
      ),
    );
    asm.add(m.steel, place(shell(0.008, 0.0062, 0.007, 14), 0, railTop + 0.015, -0.02));
  }

  /* ----------------------------------------------------- magazine */
  const magazine = new THREE.Group();
  if (spec.magKind !== "none" && spec.magKind !== "tube") {
    const magAsm = new Assembler();
    if (spec.magKind === "curved") {
      magAsm.add(
        m.polymer,
        place(
          curvedMagazine(spec.magWidth, 0.035, spec.magLength, 0.34, 9),
          0,
          -spec.magLength / 2 - 0.014,
          0,
        ),
      );
      // Witness holes down the spine.
      for (let i = 0; i < 5; i += 1) {
        magAsm.add(
          m.nitride,
          place(
            tube(0.0022, 0.0022, 0.004, 8),
            spec.magWidth / 2 - 0.001,
            -0.05 - i * 0.028,
            0.006 + i * 0.0035,
            0,
            Math.PI / 2,
            0,
          ),
        );
      }
      magAsm.add(
        m.polymer,
        place(
          chamferedBox(spec.magWidth * 1.12, 0.011, 0.042, { radius: 0.002 }),
          0,
          -spec.magLength - 0.014,
          0.03,
        ),
      );
    } else if (spec.magKind === "box") {
      magAsm.add(
        m.receiver,
        place(
          chamferedBox(spec.magWidth, spec.magLength, 0.13, {
            radius: 0.005,
            curveSegments: 4,
          }),
          0,
          -spec.magLength / 2 - 0.016,
          -0.02,
        ),
      );
      magAsm.add(
        m.receiver,
        place(
          chamferedBox(spec.magWidth * 0.5, 0.012, 0.05, { radius: 0.004 }),
          0,
          -0.02,
          -0.02,
        ),
      );
      // Belt feed lip and a few visible linked rounds.
      for (let i = 0; i < 4; i += 1) {
        magAsm.add(
          m.brass,
          place(
            tube(0.0042, 0.0042, 0.03, 10),
            -0.02 + i * 0.011,
            -0.026,
            0.03,
            Math.PI / 2,
            0,
            0,
          ),
        );
      }
    } else {
      magAsm.add(
        m.polymer,
        place(
          chamferedBox(spec.magWidth, spec.magLength, 0.05, { radius: 0.003 }),
          0,
          -spec.magLength / 2 - 0.014,
          0,
        ),
      );
      magAsm.add(
        m.polymer,
        place(
          chamferedBox(spec.magWidth * 1.1, 0.01, 0.056, { radius: 0.002 }),
          0,
          -spec.magLength - 0.014,
          0,
        ),
      );
    }
    // Follower + top round, visible in the magwell gap.
    magAsm.add(
      m.brass,
      place(tube(0.0038, 0.0038, 0.024, 10), 0, -0.014, -0.004, Math.PI / 2, 0, 0),
    );
    magAsm.flushInto(magazine);
  }
  magazine.position.set(0, -0.012, -0.078);
  root.add(magazine);

  if (spec.magKind === "tube") {
    // Shotgun: a magazine tube under the barrel with a support ring.
    asm.add(
      m.steel,
      place(
        tube(0.0105, 0.0105, spec.magLength, 18),
        0,
        barrelY - 0.023,
        spec.handguardFront + 0.05,
      ),
    );
    asm.add(
      m.steel,
      place(shell(0.017, 0.0104, 0.012, 18), 0, barrelY - 0.023, spec.muzzleZ + 0.05),
    );
  }

  /* --------------------------------------------------- pistol grip */
  const gripAngle = 0.34;
  asm.add(
    m.grip,
    place(
      chamferedBox(0.032, 0.098, 0.042, { radius: 0.011, curveSegments: 5 }),
      0,
      -0.062,
      0.03,
      gripAngle,
    ),
  );
  asm.add(
    m.grip,
    place(
      chamferedBox(0.036, 0.016, 0.046, { radius: 0.006 }),
      0,
      -0.108,
      0.046,
      gripAngle,
    ),
  );
  // Beavertail where the web of the hand sits.
  asm.add(
    m.grip,
    place(chamferedBox(0.03, 0.02, 0.02, { radius: 0.008 }), 0, -0.018, 0.05, gripAngle),
  );

  /* ------------------------------------------------------- trigger */
  const trigger = new THREE.Group();
  const trigAsm = new Assembler();
  trigAsm.add(
    m.steel,
    place(chamferedBox(0.0065, 0.024, 0.008, { radius: 0.0025 }), 0, -0.012, 0, 0.22),
  );
  trigAsm.flushInto(trigger, false);
  trigger.position.set(0, -0.012, -0.028);
  root.add(trigger);

  /* --------------------------------------------------------- bolt */
  const bolt = new THREE.Group();
  const boltAsm = new Assembler();
  boltAsm.add(m.nitride, place(tube(0.0092, 0.0092, 0.05, 16), 0, 0, 0));
  boltAsm.add(m.bareMetal, place(tube(0.0072, 0.0072, 0.012, 14), 0, 0, -0.028));
  boltAsm.flushInto(bolt, false);
  bolt.position.set(0.004, spec.receiverTop - 0.022, -0.03);
  root.add(bolt);

  /* --------------------------------------------- charging handle */
  const chargingHandle = new THREE.Group();
  const chAsm = new Assembler();
  chAsm.add(
    m.receiver,
    place(chamferedBox(0.052, 0.0085, 0.024, { radius: 0.002 }), 0, 0, 0),
  );
  chAsm.add(
    m.receiver,
    place(chamferedBox(0.014, 0.014, 0.03, { radius: 0.003 }), -0.024, -0.002, 0.004),
  );
  chAsm.add(m.steel, place(tube(0.0055, 0.0055, 0.06, 12), 0, -0.006, -0.03));
  chAsm.flushInto(chargingHandle, false);
  chargingHandle.position.set(0, spec.receiverTop - 0.012, upperZ + upperLen / 2 - 0.006);
  root.add(chargingHandle);

  /* -------------------------------------------------------- stock */
  const stockZ0 = upperZ + upperLen / 2;
  if (spec.stockKind !== "none") {
    const bufferLen = spec.stockBack - stockZ0 - 0.02;
    asm.add(
      m.receiver,
      place(
        chamferedBox(0.036, 0.036, 0.03, { radius: 0.006 }),
        0,
        spec.receiverTop - 0.03,
        stockZ0 + 0.012,
      ),
    );
    asm.add(
      m.steel,
      place(
        tube(0.0158, 0.0158, bufferLen, 20),
        0,
        spec.receiverTop - 0.032,
        stockZ0 + 0.02 + bufferLen / 2,
      ),
    );
    // Castellations on the buffer tube.
    for (let i = 0; i < 5; i += 1) {
      asm.add(
        m.steel,
        place(
          shell(0.0172, 0.0157, 0.006, 18),
          0,
          spec.receiverTop - 0.032,
          stockZ0 + 0.05 + i * 0.026,
        ),
      );
    }
    const buttZ = spec.stockBack - 0.02;
    if (spec.stockKind === "skeleton") {
      asm.add(
        m.polymer,
        place(
          chamferedBox(0.03, 0.055, 0.09, { radius: 0.006 }),
          0,
          spec.receiverTop - 0.028,
          buttZ - 0.045,
        ),
      );
      asm.add(
        m.polymer,
        place(
          chamferedBox(0.026, 0.07, 0.016, { radius: 0.005 }),
          0,
          spec.receiverTop - 0.05,
          buttZ + 0.006,
        ),
      );
      // Cheek riser on posts.
      asm.add(
        m.polymer,
        place(
          chamferedBox(0.028, 0.014, 0.07, { radius: 0.005 }),
          0,
          spec.receiverTop + 0.006,
          buttZ - 0.05,
        ),
      );
      asm.add(
        m.steel,
        place(
          tube(0.003, 0.003, 0.03, 8),
          0.008,
          spec.receiverTop - 0.008,
          buttZ - 0.03,
          Math.PI / 2,
          0,
          0,
        ),
      );
      asm.add(
        m.steel,
        place(
          tube(0.003, 0.003, 0.03, 8),
          -0.008,
          spec.receiverTop - 0.008,
          buttZ - 0.03,
          Math.PI / 2,
          0,
          0,
        ),
      );
    } else if (spec.stockKind === "folding") {
      asm.add(
        m.receiver,
        place(
          chamferedBox(0.02, 0.05, 0.11, { radius: 0.005 }),
          0.02,
          spec.receiverTop - 0.03,
          buttZ - 0.05,
        ),
      );
      asm.add(
        m.polymer,
        place(
          chamferedBox(0.024, 0.062, 0.014, { radius: 0.005 }),
          0.02,
          spec.receiverTop - 0.03,
          buttZ + 0.006,
        ),
      );
    } else {
      asm.add(
        m.polymer,
        place(
          chamferedBox(0.038, 0.06, 0.11, { radius: 0.008, curveSegments: 5 }),
          0,
          spec.receiverTop - 0.03,
          buttZ - 0.055,
        ),
      );
      asm.add(
        m.polymer,
        place(
          chamferedBox(0.03, 0.02, 0.075, { radius: 0.006 }),
          0,
          spec.receiverTop + 0.004,
          buttZ - 0.05,
        ),
      );
    }
    // Butt pad + QD sling socket.
    asm.add(
      m.rubber,
      place(
        chamferedBox(0.034, 0.062, 0.012, { radius: 0.005 }),
        0,
        spec.receiverTop - 0.03,
        buttZ + 0.012,
      ),
    );
    asm.add(
      m.steel,
      place(
        tube(0.005, 0.005, 0.008, 10),
        0.016,
        spec.receiverTop - 0.03,
        buttZ - 0.07,
        0,
        Math.PI / 2,
        0,
      ),
    );
  }

  /* ------------------------------------------------------- bipod */
  if (spec.bipod) {
    for (const side of [-1, 1]) {
      asm.add(
        m.steel,
        place(
          tube(0.0032, 0.0042, 0.11, 10),
          side * 0.02,
          barrelY - 0.075,
          spec.handguardFront + 0.06,
          0.32,
          0,
          side * 0.28,
        ),
      );
      asm.add(
        m.rubber,
        place(
          tube(0.006, 0.006, 0.012, 10),
          side * 0.036,
          barrelY - 0.13,
          spec.handguardFront + 0.078,
          Math.PI / 2,
          0,
          0,
        ),
      );
    }
    asm.add(
      m.receiver,
      place(
        chamferedBox(0.026, 0.02, 0.04, { radius: 0.003 }),
        0,
        barrelY - 0.026,
        spec.handguardFront + 0.06,
      ),
    );
  }

  /* ------------------------------------------------ carry handle */
  if (spec.carryHandle) {
    asm.add(
      m.receiver,
      place(
        chamferedBox(0.016, 0.008, 0.1, { radius: 0.003 }),
        0.03,
        railTop + 0.03,
        -0.14,
      ),
    );
    asm.add(
      m.receiver,
      place(
        chamferedBox(0.014, 0.03, 0.012, { radius: 0.003 }),
        0.03,
        railTop + 0.016,
        -0.185,
      ),
    );
    asm.add(
      m.receiver,
      place(
        chamferedBox(0.014, 0.03, 0.012, { radius: 0.003 }),
        0.03,
        railTop + 0.016,
        -0.095,
      ),
    );
  }

  /* ----------------------------------------------------- foregrip */
  let foregrip: THREE.Object3D | null = null;
  if (!spec.bipod && !spec.heatShield) {
    const fg = new THREE.Group();
    const fgAsm = new Assembler();
    fgAsm.add(
      m.grip,
      place(
        chamferedBox(0.026, 0.055, 0.03, { radius: 0.01, curveSegments: 5 }),
        0,
        -0.03,
        0,
        -0.12,
      ),
    );
    fgAsm.add(
      m.grip,
      place(chamferedBox(0.03, 0.012, 0.034, { radius: 0.005 }), 0, -0.058, 0.006),
    );
    fgAsm.flushInto(fg);
    fg.position.set(0, barrelY - spec.handguardRadius, spec.handguardFront + 0.075);
    root.add(fg);
    foregrip = fg;
  }

  /* -------------------------------------------------------- optic */
  const opticKind: "reddot" | "holo" | "acog" | "scope" =
    def.weaponClass === "sniper"
      ? "scope"
      : def.weaponClass === "marksman"
        ? "acog"
        : rand() > 0.55
          ? "holo"
          : "reddot";
  const optic = buildOptic(m, opticKind, railTop, -0.03);
  root.add(optic.group);

  /* -------------------------------------------------------- flush */
  const triangles = asm.flushInto(root) + optic.triangles;

  /* ------------------------------------------------------ anchors */
  const muzzleTip = new THREE.Object3D();
  muzzleTip.position.set(0, barrelY, spec.muzzleZ - 0.005);
  root.add(muzzleTip);

  const rightHand = new THREE.Object3D();
  rightHand.position.set(0, -0.05, 0.026);
  root.add(rightHand);
  const leftHand = new THREE.Object3D();
  leftHand.position.set(
    0,
    barrelY - spec.handguardRadius - 0.01,
    spec.handguardFront + 0.08,
  );
  root.add(leftHand);

  // Hands, parented to the anchors rather than solved against them. In a first
  // person view the hands never move relative to the gun, so making them
  // children of it gets recoil, sway, aim-down-sights and the reload for free.
  const arms = buildArms();
  rightHand.add(arms.right);
  leftHand.add(arms.left);

  // The optic group is parented at `-0.03` along Z and its axis empty sits at
  // the optical height, so the sight line is the sum of the two local offsets.
  // Reading it this way avoids depending on a world matrix that has not been
  // updated yet, which is what silently produced a zeroed aim pose before.
  const sightAxis = new THREE.Object3D();
  sightAxis.position.set(
    optic.group.position.x + optic.axis.position.x,
    optic.group.position.y + optic.axis.position.y,
    optic.group.position.z + optic.axis.position.z,
  );
  root.add(sightAxis);

  const laserEmitter = new THREE.Object3D();
  laserEmitter.position.set(0.024, barrelY + 0.012, spec.handguardFront + 0.02);
  root.add(laserEmitter);

  const model: WeaponModel = {
    root,
    parts: {
      receiver: root,
      barrel: root,
      magazine,
      bolt,
      chargingHandle,
      trigger,
      muzzleTip,
      ejectionPort,
      optic: optic.group,
      opticReticle: optic.reticle,
      sightAxis,
      laserEmitter,
      stock: root,
      foregrip,
      leftHand,
      rightHand,
      boltTravel: 0.052,
      chargingTravel: 0.075,
    },
    sightOffset: new THREE.Vector3(),
    hipPosition: new THREE.Vector3(),
    hipRotation: new THREE.Euler(),
    adsDistance: -0.3,
    adsRotation: new THREE.Euler(),
    triangleCount: triangles + arms.triangleCount,
    dispose() {
      arms.dispose();
      root.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
    },
  };
  return model;
}

/* ------------------------------------------------------------------ */
/* Handguns and specials                                               */
/* ------------------------------------------------------------------ */

function buildPistol(m: WeaponMaterials, revolver: boolean): WeaponModel {
  const root = new THREE.Group();
  const asm = new Assembler();
  const slideY = 0.052;

  if (revolver) {
    asm.add(m.steel, place(tube(0.0135, 0.0135, 0.16, 20), 0, slideY, -0.075));
    asm.add(m.steel, place(shell(0.0165, 0.0136, 0.14, 20), 0, slideY, -0.08));
    // Fluted cylinder.
    asm.add(m.steel, place(tube(0.021, 0.021, 0.042, 22), 0, slideY - 0.004, 0.008));
    asm.add(
      m.nitride,
      place(flutes(8, 0.021, 0.034, 0.006, 0.0022), 0, slideY - 0.004, 0.008),
    );
    asm.add(
      m.receiver,
      place(chamferedBox(0.016, 0.05, 0.075, { radius: 0.005 }), 0, slideY - 0.03, 0.032),
    );
    asm.add(
      m.steel,
      place(chamferedBox(0.01, 0.02, 0.024, { radius: 0.004 }), 0, slideY + 0.008, 0.05),
    );
    asm.add(
      m.wood,
      place(
        chamferedBox(0.03, 0.085, 0.042, { radius: 0.012, curveSegments: 5 }),
        0,
        -0.028,
        0.062,
        0.28,
      ),
    );
    asm.add(
      m.steel,
      place(
        chamferedBox(0.008, 0.012, 0.03, { radius: 0.002 }),
        0,
        slideY - 0.02,
        -0.078,
      ),
    );
  } else {
    // Slide with front and rear cocking serrations.
    asm.add(
      m.nitride,
      place(
        chamferedBox(0.026, 0.03, 0.185, { radius: 0.004, curveSegments: 4 }),
        0,
        slideY,
        -0.05,
      ),
    );
    for (let i = 0; i < 7; i += 1) {
      asm.add(
        m.steel,
        place(
          chamferedBox(0.027, 0.022, 0.0032, { radius: 0.001 }),
          0,
          slideY,
          0.014 - i * 0.008,
        ),
      );
    }
    for (let i = 0; i < 4; i += 1) {
      asm.add(
        m.steel,
        place(
          chamferedBox(0.027, 0.02, 0.003, { radius: 0.001 }),
          0,
          slideY,
          -0.098 - i * 0.008,
        ),
      );
    }
    asm.add(m.nitride, place(tube(0.0072, 0.0072, 0.03, 14), 0, slideY - 0.016, -0.118));
    asm.add(m.steel, place(tube(0.0055, 0.0055, 0.026, 14), 0, slideY, -0.132));
    // Frame + accessory rail + trigger guard.
    asm.add(
      m.polymer,
      place(chamferedBox(0.024, 0.03, 0.13, { radius: 0.004 }), 0, slideY - 0.03, -0.032),
    );
    asm.add(
      m.polymer,
      place(
        chamferedBox(0.022, 0.008, 0.048, { radius: 0.002 }),
        0,
        slideY - 0.046,
        -0.09,
      ),
    );
    for (let i = 0; i <= 8; i += 1) {
      const t = i / 8;
      const angle = Math.PI * (0.1 + t * 0.8);
      asm.add(
        m.polymer,
        place(
          chamferedBox(0.007, 0.006, 0.01, { radius: 0.0018 }),
          0,
          slideY - 0.048 - Math.sin(angle) * 0.018,
          -0.03 + Math.cos(angle) * 0.021,
          Math.PI / 2 - angle,
        ),
      );
    }
    asm.add(
      m.grip,
      place(
        chamferedBox(0.028, 0.096, 0.038, { radius: 0.01, curveSegments: 5 }),
        0,
        -0.028,
        0.014,
        0.19,
      ),
    );
    asm.add(
      m.steel,
      place(
        chamferedBox(0.008, 0.008, 0.02, { radius: 0.002 }),
        -0.015,
        slideY - 0.024,
        -0.006,
      ),
    );
    // Sights.
    asm.add(
      m.steel,
      place(
        chamferedBox(0.012, 0.008, 0.005, { radius: 0.001 }),
        0,
        slideY + 0.019,
        -0.128,
      ),
    );
    asm.add(
      m.steel,
      place(
        chamferedBox(0.016, 0.009, 0.006, { radius: 0.001 }),
        0,
        slideY + 0.0195,
        0.03,
      ),
    );
  }

  const magazine = new THREE.Group();
  if (!revolver) {
    const magAsm = new Assembler();
    magAsm.add(
      m.nitride,
      place(chamferedBox(0.0195, 0.098, 0.03, { radius: 0.003 }), 0, -0.028, 0.014, 0.19),
    );
    magAsm.add(
      m.polymer,
      place(chamferedBox(0.024, 0.009, 0.036, { radius: 0.002 }), 0, -0.078, 0.024, 0.19),
    );
    magAsm.flushInto(magazine);
  }
  root.add(magazine);

  const bolt = new THREE.Group();
  const trigger = new THREE.Group();
  const trigAsm = new Assembler();
  trigAsm.add(
    m.steel,
    place(chamferedBox(0.005, 0.02, 0.007, { radius: 0.002 }), 0, 0, 0, 0.2),
  );
  trigAsm.flushInto(trigger, false);
  trigger.position.set(0, slideY - 0.056, -0.026);
  root.add(trigger);
  root.add(bolt);

  const triangles = asm.flushInto(root);

  const muzzleTip = new THREE.Object3D();
  muzzleTip.position.set(0, slideY, revolver ? -0.155 : -0.145);
  root.add(muzzleTip);
  const ejectionPort = new THREE.Object3D();
  ejectionPort.position.set(0.014, slideY + 0.008, -0.02);
  root.add(ejectionPort);
  const sightAxis = new THREE.Object3D();
  sightAxis.position.set(0, slideY + 0.022, -0.02);
  root.add(sightAxis);
  const laserEmitter = new THREE.Object3D();
  laserEmitter.position.set(0, slideY - 0.042, -0.08);
  root.add(laserEmitter);
  const rightHand = new THREE.Object3D();
  rightHand.position.set(0, -0.02, 0.02);
  root.add(rightHand);
  const leftHand = new THREE.Object3D();
  leftHand.position.set(-0.02, -0.03, 0.005);
  root.add(leftHand);

  const arms = buildArms();
  rightHand.add(arms.right);
  leftHand.add(arms.left);

  return {
    root,
    parts: {
      receiver: root,
      barrel: root,
      magazine,
      bolt,
      chargingHandle: bolt,
      trigger,
      muzzleTip,
      ejectionPort,
      optic: null,
      opticReticle: null,
      sightAxis,
      laserEmitter,
      stock: root,
      foregrip: null,
      leftHand,
      rightHand,
      boltTravel: revolver ? 0 : 0.028,
      chargingTravel: 0.028,
    },
    sightOffset: new THREE.Vector3(),
    hipPosition: new THREE.Vector3(),
    hipRotation: new THREE.Euler(),
    adsDistance: -0.3,
    adsRotation: new THREE.Euler(),
    triangleCount: triangles + arms.triangleCount,
    dispose() {
      arms.dispose();
      root.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
    },
  };
}

function buildKnife(m: WeaponMaterials): WeaponModel {
  const root = new THREE.Group();
  const asm = new Assembler();
  // Clip-point blade: a tapered plate with a ground bevel along the edge.
  asm.add(
    m.nitride,
    place(chamferedBox(0.004, 0.026, 0.14, { radius: 0.001 }), 0, 0, -0.09),
  );
  asm.add(
    m.bareMetal,
    place(chamferedBox(0.0022, 0.008, 0.13, { radius: 0.0008 }), 0, -0.012, -0.088),
  );
  asm.add(
    m.nitride,
    place(
      chamferedBox(0.0035, 0.02, 0.03, { radius: 0.008 }),
      0,
      0.004,
      -0.168,
      0,
      0,
      0.2,
    ),
  );
  asm.add(
    m.steel,
    place(chamferedBox(0.012, 0.03, 0.008, { radius: 0.002 }), 0, 0, -0.016),
  );
  for (let i = 0; i < 5; i += 1) {
    asm.add(
      m.rubber,
      place(
        chamferedBox(0.017, 0.026, 0.017, { radius: 0.006 }),
        0,
        0,
        0.002 + i * 0.019,
      ),
    );
  }
  asm.add(
    m.steel,
    place(chamferedBox(0.014, 0.02, 0.012, { radius: 0.003 }), 0, 0, 0.104),
  );

  const triangles = asm.flushInto(root);
  const anchor = (x: number, y: number, z: number): THREE.Object3D => {
    const o = new THREE.Object3D();
    o.position.set(x, y, z);
    root.add(o);
    return o;
  };
  const empty = new THREE.Group();
  root.add(empty);

  const leftHand = anchor(-0.04, -0.02, 0.04);
  const rightHand = anchor(0, 0, 0.05);
  const laserEmitter = anchor(0, 0, -0.16);
  const arms = buildArms();
  rightHand.add(arms.right);
  leftHand.add(arms.left);

  return {
    root,
    parts: {
      receiver: root,
      barrel: root,
      magazine: empty,
      bolt: empty,
      chargingHandle: empty,
      trigger: empty,
      muzzleTip: anchor(0, 0, -0.17),
      ejectionPort: anchor(0, 0, 0),
      optic: null,
      opticReticle: null,
      sightAxis: anchor(0, 0.01, -0.05),
      laserEmitter,
      stock: root,
      foregrip: null,
      leftHand,
      rightHand,
      boltTravel: 0,
      chargingTravel: 0,
    },
    sightOffset: new THREE.Vector3(),
    hipPosition: new THREE.Vector3(),
    hipRotation: new THREE.Euler(),
    adsDistance: -0.3,
    adsRotation: new THREE.Euler(),
    triangleCount: triangles + arms.triangleCount,
    dispose() {
      arms.dispose();
      root.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
    },
  };
}

function buildLauncher(m: WeaponMaterials): WeaponModel {
  const root = new THREE.Group();
  const asm = new Assembler();
  const axisY = 0.055;
  asm.add(m.polymerTan, place(tube(0.042, 0.044, 0.86, 24), 0, axisY, -0.28));
  asm.add(
    m.polymerTan,
    place(
      lathe(
        [
          [0.044, 0.16],
          [0.056, 0.13],
          [0.056, 0.09],
          [0.044, 0.06],
        ],
        24,
      ),
      0,
      axisY,
      0.19,
    ),
  );
  asm.add(m.nitride, place(shell(0.05, 0.043, 0.03, 24), 0, axisY, -0.68));
  asm.add(m.receiver, place(picatinnyRail(0.2), 0, axisY + 0.043, -0.24));
  asm.add(
    m.grip,
    place(
      chamferedBox(0.032, 0.1, 0.042, { radius: 0.011, curveSegments: 5 }),
      0,
      -0.012,
      0.03,
      0.3,
    ),
  );
  asm.add(
    m.grip,
    place(
      chamferedBox(0.028, 0.075, 0.036, { radius: 0.01, curveSegments: 5 }),
      0,
      0.002,
      -0.24,
      -0.15,
    ),
  );
  asm.add(
    m.receiver,
    place(chamferedBox(0.03, 0.03, 0.09, { radius: 0.006 }), 0, axisY - 0.05, 0.02),
  );
  asm.add(
    m.polymer,
    place(chamferedBox(0.09, 0.05, 0.06, { radius: 0.006 }), 0.05, axisY + 0.02, -0.1),
  );
  const optic = buildOptic(m, "acog", axisY + 0.052, -0.24);
  root.add(optic.group);

  const triangles = asm.flushInto(root) + optic.triangles;
  const anchor = (x: number, y: number, z: number): THREE.Object3D => {
    const o = new THREE.Object3D();
    o.position.set(x, y, z);
    root.add(o);
    return o;
  };
  const empty = new THREE.Group();
  root.add(empty);

  const leftHand = anchor(0, axisY - 0.05, -0.24);
  const rightHand = anchor(0, -0.02, 0.03);
  const laserEmitter = anchor(0.04, axisY + 0.03, -0.24);
  const arms = buildArms();
  rightHand.add(arms.right);
  leftHand.add(arms.left);

  return {
    root,
    parts: {
      receiver: root,
      barrel: root,
      magazine: empty,
      bolt: empty,
      chargingHandle: empty,
      trigger: empty,
      muzzleTip: anchor(0, axisY, -0.71),
      ejectionPort: anchor(0, axisY, 0.2),
      optic: optic.group,
      opticReticle: optic.reticle,
      sightAxis: anchor(0, axisY + 0.084, -0.24),
      laserEmitter,
      stock: root,
      foregrip: null,
      leftHand,
      rightHand,
      boltTravel: 0,
      chargingTravel: 0,
    },
    sightOffset: new THREE.Vector3(),
    hipPosition: new THREE.Vector3(),
    hipRotation: new THREE.Euler(),
    adsDistance: -0.3,
    adsRotation: new THREE.Euler(),
    triangleCount: triangles + arms.triangleCount,
    dispose() {
      arms.dispose();
      root.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
    },
  };
}

/* ------------------------------------------------------------------ */
/* Public entry point                                                  */
/* ------------------------------------------------------------------ */

/**
 * Derive the camera-space transforms.
 *
 * The aim-down-sight pose is *measured*, never hand-tuned: we read the sight
 * anchor's local position and place the weapon so that anchor lands exactly on
 * the camera's optical axis, a fixed eye-relief in front of the near plane.
 * Any change to an optic's height or a receiver's dimensions therefore stays
 * aligned automatically.
 */
function deriveTransforms(model: WeaponModel, weaponClass: WeaponClass): void {
  model.sightOffset.copy(model.parts.sightAxis.position);

  // Eye relief: how far in front of the eye the optic sits when aimed. A
  // magnified scope is held further out than a reflex sight.
  model.adsDistance =
    weaponClass === "sniper" ? -0.34 : weaponClass === "marksman" ? -0.32 : -0.29;
  model.adsRotation.set(0, 0, 0);

  // Hip carry: grip low and outboard so the receiver sits clear of the
  // crosshair, muzzle canted inboard so the weapon converges on the centre.
  const bulk = weaponClass === "pistol" || weaponClass === "melee" ? 0.72 : 1;
  model.hipPosition.set(
    0.185 * bulk,
    -0.255 * bulk,
    -0.4 - (weaponClass === "sniper" ? 0.06 : 0),
  );
  model.hipRotation.set(0.055, -0.088, 0.052);
}

export function buildWeaponModel(def: WeaponDef): WeaponModel {
  const m = getWeaponMaterials();
  let model: WeaponModel;
  switch (def.weaponClass) {
    case "pistol":
      model = buildPistol(m, def.magSize <= 8);
      break;
    case "melee":
      model = buildKnife(m);
      break;
    case "launcher":
      model = buildLauncher(m);
      break;
    default:
      model = buildLongGun(def, specForClass(def.weaponClass), m);
      break;
  }
  deriveTransforms(model, def.weaponClass);
  model.root.name = `weapon-${def.id}`;
  // The viewmodel renders in its own pass; nothing about it should collide.
  model.root.traverse((o) => {
    o.userData["noCollide"] = true;
  });
  return model;
}

/** Re-exported so previews can build the same materials the game uses. */
export { getWeaponMaterials };
export type { WeaponMaterials };
export { mirrorX };
