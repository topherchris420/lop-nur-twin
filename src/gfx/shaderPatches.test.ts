/**
 * Every shader patch in the project, run against the three that is installed.
 *
 * A patch is three's shader text with GLSL spliced in at a line this project
 * chose. three rewords those lines between releases, and `package.json`
 * allows the next release. When r187 moved one, the clay material's module
 * threw on import and `/live` served an error page; nothing in the checks had
 * ever run the patch. This does, for all of them, with no renderer: it hands
 * each material the stock shader three would hand it and lets
 * `onBeforeCompile` do what it does in the browser. `patchShader`
 * (`shaderPatch.ts`) throws on an anchor that is gone, so the upgrade that
 * moves a line fails here, naming the file and the line.
 *
 * It checks that the splices still land, and that every `#include` the result
 * names still exists. It does not compile GLSL: a patch that lands and then
 * reads a variable three renamed is caught in a browser, by the route checks.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { PlateField } from "../bethesda/rain/ResonanceFace";
import { figureMaterial } from "../bethesda/rain/figures";
import { pull } from "../bethesda/live/diorama/cast";
import { FACADE_PATCH } from "../bethesda/live/diorama/city";
import { applySoldierShade } from "../game/characters/soldierShade";
import { installCascadeShadows } from "../game/render/shadowCascade";
import { armMaterial } from "../game/weapons/arms";
import { applyEdgeWear, getWeaponMaterials } from "../game/weapons/materials";
import { casterMaterial, clayify, withCascade } from "../garden/scene/clay";
import { EYE_PATCH } from "../garden/scene/fly";
import { rippleWater } from "../garden/scene/props";
import { applyHardSurface, HARD_SURFACE_PRESETS } from "./greeble";
import { applyGroundDetail, GROUND_DETAIL_PRESETS } from "./groundDetail";
import { patchShader, ShaderAnchorError } from "./shaderPatch";

const SRC = path.resolve(import.meta.dirname, "..");

/** The stock program three compiles for a material, before `onBeforeCompile`. */
const STOCK: Record<string, THREE.ShaderLibShader | undefined> = {
  MeshStandardMaterial: THREE.ShaderLib.standard,
  MeshPhysicalMaterial: THREE.ShaderLib.physical,
  MeshDepthMaterial: THREE.ShaderLib.depth,
};

function stock(material: THREE.Material): THREE.ShaderLibShader {
  const lib = STOCK[material.type];
  if (!lib) throw new Error(`no stock shader listed for ${material.type}`);
  return lib;
}

interface Patched {
  vertexShader: string;
  fragmentShader: string;
}

/** What `WebGLPrograms` does with a material's `onBeforeCompile`, without the GPU. */
function compile(material: THREE.Material): Patched {
  const lib = stock(material);
  const shader = {
    uniforms: THREE.UniformsUtils.clone(lib.uniforms),
    vertexShader: lib.vertexShader,
    fragmentShader: lib.fragmentShader,
    defines: { ...material.defines },
  } as unknown as THREE.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, null as unknown as THREE.WebGLRenderer);
  return { vertexShader: shader.vertexShader, fragmentShader: shader.fragmentShader };
}

/** Every chunk a shader names, followed through the chunks it names in turn. */
function unresolvedIncludes(source: string): string[] {
  const missing: string[] = [];
  const seen = new Set<string>();
  const walk = (text: string) => {
    for (const match of text.matchAll(/^[ \t]*#include +<([\w\d./]+)>/gm)) {
      const name = match[1];
      if (name === undefined || seen.has(name)) continue;
      seen.add(name);
      const chunk = (THREE.ShaderChunk as Record<string, string | undefined>)[name];
      if (chunk === undefined) missing.push(name);
      else walk(chunk);
    }
  };
  walk(source);
  return missing;
}

const standard = () => new THREE.MeshStandardMaterial();
const texture = () => new THREE.Texture();

/**
 * Every file under `src/` that patches a three shader, with the materials it
 * patches: each variant that changes which text is spliced in.
 */
const SITES: Record<string, () => THREE.Material[]> = {
  "garden/scene/clay.ts": () => {
    const shared = { detail: texture() };
    return [
      clayify(standard(), shared),
      clayify(standard(), shared, { objectSpace: true, unit: 0.01 }),
      clayify(standard(), shared, { wind: { axis: "y", length: 1, amount: 1 } }),
      clayify(standard(), shared, { map: texture(), reliefMap: texture() }),
      casterMaterial({ wind: { axis: "z", length: 1, amount: 1 } }),
    ];
  },
  // These two reach the shader through the clay material's `patch` setting,
  // after its own splices: the eye and the facade anchor on clay's lines too.
  "garden/scene/fly.ts": () => [
    clayify(standard(), { detail: texture() }, { objectSpace: true, patch: EYE_PATCH }),
  ],
  "bethesda/live/diorama/city.ts": () => [
    clayify(standard(), { detail: texture() }, { patch: FACADE_PATCH }),
  ],
  "garden/scene/props.ts": () => [withCascade(standard(), rippleWater)],
  "bethesda/live/diorama/cast.ts": () => {
    const puppet = clayify(standard(), { detail: texture() }, { objectSpace: true });
    pull(puppet);
    return [puppet];
  },
  "gfx/greeble.ts": () =>
    Object.values(HARD_SURFACE_PRESETS).map((preset) =>
      applyHardSurface(standard(), preset),
    ),
  "gfx/groundDetail.ts": () =>
    Object.values(GROUND_DETAIL_PRESETS).map((preset) =>
      applyGroundDetail(standard(), {
        ...preset,
        normalMap: texture(),
        surfaceMap: texture(),
      }),
    ),
  "game/weapons/materials.ts": () => [
    applyEdgeWear(standard(), {
      color: 0x888888,
      metalness: 1,
      roughness: 0.4,
      width: 0.002,
      strength: 1,
    }),
    getWeaponMaterials().lens,
  ],
  "game/weapons/arms.ts": () => [armMaterial("glove"), armMaterial("sleeve")],
  "game/characters/soldierShade.ts": () => [applySoldierShade(standard())],
  "bethesda/rain/figures.ts": () => [
    figureMaterial("lab", false),
    figureMaterial("city", true),
  ],
  "bethesda/rain/ResonanceFace.tsx": () => [
    new PlateField(1, 1, true, 1).material,
    new PlateField(1, 1, false, 1).material,
  ],
};

/** Patches `THREE.ShaderChunk` itself rather than a material; checked on its own below. */
const CHUNK_PATCHES = ["game/render/shadowCascade.ts"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe("patchShader", () => {
  it("splices in order, each into the result of the one before", () => {
    expect(
      patchShader("test", "a b a", [
        ["a", "a c"],
        ["c", "d"],
      ]),
    ).toBe("a d b a");
  });

  it("inserts the replacement as written", () => {
    expect(patchShader("test", "x", [["x", "$& $1 $$"]])).toBe("$& $1 $$");
  });

  it("throws on an anchor that is not there, naming the site and the line", () => {
    const attempt = () =>
      patchShader("clay (physical lighting)", "void main() {}", [
        ["#include <gone>", ""],
      ]);
    expect(attempt).toThrow(ShaderAnchorError);
    expect(attempt).toThrow(/clay \(physical lighting\): three r\d+.*#include <gone>/);
  });
});

/**
 * A file that rewrites a shader: it assigns a material's `onBeforeCompile`, a
 * program's source (a patch handed to another material's hook does only
 * that), or one of three's chunks.
 */
const REWRITES_A_SHADER =
  /\.onBeforeCompile\s*=[^=]|\.(?:vertexShader|fragmentShader)\s*=[^=]|ShaderChunk\.\w+\s*=[^=]/;
/** `shader.fragmentShader.replace(…)`: the unchecked splice `patchShader` replaces. */
const BARE_SPLICE = /\b(?:vertexShader|fragmentShader)\s*\.replace(?:All)?\(/;

describe("shader patches against the installed three", () => {
  const patching = sourceFiles(SRC)
    .map((file) => ({
      file: path.relative(SRC, file).split(path.sep).join("/"),
      text: readFileSync(file, "utf8"),
    }))
    .filter(({ text }) => REWRITES_A_SHADER.test(text));

  it("lists every file that patches a shader", () => {
    expect(patching.map(({ file }) => file).sort()).toEqual(
      [...Object.keys(SITES), ...CHUNK_PATCHES].sort(),
    );
  });

  it("splices through patchShader, never a bare replace", () => {
    expect(
      patching.filter(({ text }) => BARE_SPLICE.test(text)).map(({ file }) => file),
    ).toEqual([]);
  });

  for (const [file, materials] of Object.entries(SITES)) {
    it(`${file}: every splice lands`, () => {
      const built = materials();
      expect(built.length).toBeGreaterThan(0);
      for (const material of built) {
        const before = stock(material);
        const patched = compile(material);
        // A patch that changed nothing is a patch that no longer applies.
        expect(
          patched.vertexShader !== before.vertexShader ||
            patched.fragmentShader !== before.fragmentShader,
        ).toBe(true);
        expect(unresolvedIncludes(patched.vertexShader)).toEqual([]);
        expect(unresolvedIncludes(patched.fragmentShader)).toEqual([]);
      }
    });
  }

  it("game/render/shadowCascade.ts: the cascade installs", () => {
    // It skips itself, quietly in production, when three's light loop is not
    // the text it was written against: a look regression nobody is told about.
    expect(installCascadeShadows()).toBe(true);
    expect(unresolvedIncludes(THREE.ShaderChunk.lights_fragment_begin)).toEqual([]);
  });
});
