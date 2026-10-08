/**
 * The subset of JSON Schema 2020-12 that R.A.I.N.'s experiment contracts use,
 * validated without a schema library: `type` (including type lists), `const`,
 * `enum`, `pattern`, `minLength`/`maxLength`, `minimum`/`maximum`,
 * `minItems`/`maxItems`, `items`, `properties`, `required`,
 * `additionalProperties` (boolean or schema), `propertyNames`,
 * `maxProperties`, `oneOf` and local `$ref`s into `$defs`.
 *
 * Only the repository's own schemas (`./schemas/*.json`) are loaded; a caller
 * never supplies one. Messages follow python-jsonschema's wording, which the
 * contracts' documentation and tests quote.
 *
 * Shared with the server: imports nothing.
 */

export type Schema = Record<string, unknown>;

const repr = (value: unknown): string => {
  if (typeof value === "string") return `'${value}'`;
  if (value === null) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (Array.isArray(value)) return `[${value.map(repr).join(", ")}]`;
  if (typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${repr(k)}: ${repr(v)}`)
      .join(", ")}}`;
  return String(value);
};

const typeOf = (value: unknown, type: string): boolean => {
  switch (type) {
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      return false;
  }
};

/** Every problem with `value` under `schema`, as `path: message`, sorted by path. */
export function schemaErrors(value: unknown, schema: Schema): string[] {
  const root = schema;
  const errors: { path: (string | number)[]; message: string }[] = [];
  const resolve = (s: Schema): Schema => {
    const ref = s.$ref;
    if (typeof ref !== "string") return s;
    if (!ref.startsWith("#/$defs/")) throw new Error(`unsupported $ref ${ref}`);
    const target = (root.$defs as Record<string, Schema> | undefined)?.[ref.slice("#/$defs/".length)];
    if (!target) throw new Error(`unresolved $ref ${ref}`);
    return resolve(target);
  };
  const check = (v: unknown, s: Schema, path: (string | number)[]): void => {
    s = resolve(s);
    const fail = (message: string) => errors.push({ path, message });
    if ("type" in s) {
      const types = Array.isArray(s.type) ? (s.type as string[]) : [s.type as string];
      if (!types.some((t) => typeOf(v, t))) {
        fail(`${repr(v)} is not of type ${types.map((t) => `'${t}'`).join(", ")}`);
        return;
      }
    }
    if ("const" in s && JSON.stringify(v) !== JSON.stringify(s.const))
      fail(`${repr(s.const)} was expected`);
    if (Array.isArray(s.enum) && !s.enum.some((e) => JSON.stringify(e) === JSON.stringify(v)))
      fail(`${repr(v)} is not one of ${repr(s.enum)}`);
    if (typeof v === "string") {
      if (typeof s.pattern === "string" && !new RegExp(s.pattern, "u").test(v))
        fail(`${repr(v)} does not match ${repr(s.pattern)}`);
      if (typeof s.minLength === "number" && [...v].length < s.minLength) fail(`${repr(v)} is too short`);
      if (typeof s.maxLength === "number" && [...v].length > s.maxLength) fail(`${repr(v)} is too long`);
    }
    if (typeof v === "number") {
      if (typeof s.minimum === "number" && v < s.minimum)
        fail(`${repr(v)} is less than the minimum of ${s.minimum}`);
      if (typeof s.maximum === "number" && v > s.maximum)
        fail(`${repr(v)} is greater than the maximum of ${s.maximum}`);
    }
    if (Array.isArray(v)) {
      if (typeof s.minItems === "number" && v.length < s.minItems) fail(`${repr(v)} is too short`);
      if (typeof s.maxItems === "number" && v.length > s.maxItems) fail(`${repr(v)} is too long`);
      if (s.items && typeof s.items === "object")
        v.forEach((item, i) => check(item, s.items as Schema, [...path, i]));
    }
    if (typeOf(v, "object")) {
      const o = v as Record<string, unknown>;
      const properties = (s.properties ?? {}) as Record<string, Schema>;
      for (const key of (s.required as string[] | undefined) ?? [])
        if (!Object.hasOwn(o, key)) fail(`'${key}' is a required property`);
      if (typeof s.maxProperties === "number" && Object.keys(o).length > s.maxProperties)
        fail(`${repr(v)} has too many properties`);
      // Own keys only: `in` would see Object.prototype, so a "constructor",
      // "toString" or "__proto__" key would pass a closed object unexamined.
      for (const [key, sub] of Object.entries(properties)) if (Object.hasOwn(o, key)) check(o[key], sub, [...path, key]);
      const extra = Object.keys(o).filter((k) => !Object.hasOwn(properties, k));
      if (s.additionalProperties === false && extra.length)
        fail(
          `Additional properties are not allowed (${extra.map((k) => `'${k}'`).join(", ")} ${extra.length === 1 ? "was" : "were"} unexpected)`,
        );
      else if (s.additionalProperties && typeof s.additionalProperties === "object")
        for (const key of extra) check(o[key], s.additionalProperties as Schema, [...path, key]);
      if (s.propertyNames && typeof s.propertyNames === "object")
        for (const key of Object.keys(o)) {
          const before = errors.length;
          check(key, s.propertyNames as Schema, path);
          if (errors.length > before) errors.splice(before, errors.length - before, { path, message: `${repr(key)} is not a valid property name` });
        }
    }
    if (Array.isArray(s.oneOf)) {
      const valid = (s.oneOf as Schema[]).filter((sub) => schemaErrors(v, { ...sub, $defs: root.$defs }).length === 0);
      if (valid.length !== 1)
        fail(
          valid.length === 0
            ? `${repr(v)} is not valid under any of the given schemas`
            : `${repr(v)} is valid under each of ${valid.length} schemas`,
        );
    }
  };
  check(value, schema, []);
  return errors
    .sort((a, b) => {
      const pa = a.path.join("/"),
        pb = b.path.join("/");
      return pa < pb ? -1 : pa > pb ? 1 : 0;
    })
    .map((e) => `${e.path.length ? e.path.join("/") : "(root)"}: ${e.message}`);
}
