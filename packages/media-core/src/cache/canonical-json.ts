/**
 * Canonical JSON serialisation for content-addressed cache keys.
 *
 * `JSON.stringify` is NOT a stable serialiser: object property order follows
 * insertion order, so two structurally identical specs built by different code
 * paths hash differently and silently miss the cache. At the volume this format
 * targets (hundreds of videos sharing the same explainer beats) a silent miss
 * is the difference between rendering a segment once and rendering it hundreds
 * of times.
 *
 * `canonicalStringify` fixes that by sorting object keys RECURSIVELY, and fails
 * closed on any value JSON cannot represent losslessly instead of quietly
 * coercing it (`NaN` -> `null`, `undefined` in an array -> `null`, a `Date` ->
 * an ISO string, a class instance -> its own enumerable props). Every one of
 * those coercions would produce a key that does not describe the input.
 */

/** A JSON primitive: everything `JSON.parse` can produce that is not a container. */
export type JsonPrimitive = string | number | boolean | null;

/** Any value that survives a `JSON.parse(JSON.stringify(x))` round trip unchanged. */
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * Thrown when a value cannot be canonically serialised.
 *
 * Carries the JSON path of the offending value so the caller can find it in a
 * large scene spec without bisecting by hand.
 */
export class CanonicalJsonError extends Error {
  public readonly path: string;

  constructor(message: string, path: string) {
    super(`${message} (at ${path})`);
    this.name = "CanonicalJsonError";
    this.path = path;
  }
}

/**
 * Maximum nesting depth. A spec deeper than this is a bug (or a cycle the
 * cycle detector cannot see because the graph is a very deep DAG), not data.
 */
const MAX_DEPTH = 64;

function formatPath(segments: ReadonlyArray<string | number>): string {
  let out = "$";
  for (const segment of segments) {
    out +=
      typeof segment === "number"
        ? `[${segment}]`
        : /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment)
          ? `.${segment}`
          : `[${JSON.stringify(segment)}]`;
  }
  return out;
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  const t = typeof value;
  if (t !== "object") return t;
  const proto: unknown = Object.getPrototypeOf(value as object);
  if (proto === null) return "null-prototype object";
  const ctor: unknown = (value as { constructor?: unknown }).constructor;
  if (typeof ctor === "function" && typeof ctor.name === "string") {
    return `${ctor.name} instance`;
  }
  return "object";
}

/**
 * Serialise a value to a deterministic JSON string with object keys sorted
 * recursively.
 *
 * Guarantees:
 * - Object key order never affects the output. `{a:1,b:2}` and `{b:2,a:1}`
 *   produce a byte-identical string.
 * - Array order IS preserved — array order is meaningful data.
 * - Keys are sorted by UTF-16 code unit (plain `<`), never by locale, so the
 *   output does not vary with the machine's locale.
 * - An object property whose value is `undefined` is omitted, exactly as
 *   `JSON.stringify` does. Omitting a key and setting it to `undefined` are
 *   therefore the same key. This is the only permitted coercion.
 *
 * @param value - The value to serialise.
 * @returns A canonical JSON string.
 * @throws {CanonicalJsonError} If the value contains `undefined` at the root or
 *   inside an array, a non-finite number (`NaN`, `Infinity`), a `bigint`,
 *   `symbol`, function, a non-plain object (`Date`, `Map`, `Set`, class
 *   instance, boxed primitive), a circular reference, or nesting deeper than
 *   64 levels.
 */
export function canonicalStringify(value: unknown): string {
  return write(value, [], new Set<object>());
}

function write(
  value: unknown,
  path: ReadonlyArray<string | number>,
  seen: Set<object>,
): string {
  if (path.length > MAX_DEPTH) {
    throw new CanonicalJsonError(
      `Value nests deeper than the ${MAX_DEPTH}-level limit`,
      formatPath(path),
    );
  }

  const valueType = typeof value;
  switch (valueType) {
    case "string":
      return JSON.stringify(value);

    case "boolean":
      return value ? "true" : "false";

    case "number":
      if (!Number.isFinite(value)) {
        throw new CanonicalJsonError(
          `Non-finite number ${String(value)} cannot be represented in JSON; ` +
            `JSON.stringify would silently write null`,
          formatPath(path),
        );
      }
      return JSON.stringify(value);

    case "undefined":
      throw new CanonicalJsonError(
        "undefined is not a JSON value; supply the real value or omit the property",
        formatPath(path),
      );

    case "bigint":
      throw new CanonicalJsonError(
        "bigint is not a JSON value; convert it to a string or number explicitly",
        formatPath(path),
      );

    case "function":
    case "symbol":
      throw new CanonicalJsonError(
        `${typeof value} is not a JSON value`,
        formatPath(path),
      );

    case "object":
      break;

    default: {
      // Exhaustiveness: every `typeof` result is handled above. If a future
      // JS revision adds a new primitive type tag, this stops compiling.
      const unhandled: never = valueType;
      throw new CanonicalJsonError(
        `Unsupported value of type ${String(unhandled)}`,
        formatPath(path),
      );
    }
  }

  if (value === null) return "null";

  const obj = value as object;

  if (seen.has(obj)) {
    throw new CanonicalJsonError(
      "Circular reference — a cache key cannot be computed for a cyclic spec",
      formatPath(path),
    );
  }
  seen.add(obj);

  try {
    if (Array.isArray(value)) {
      const parts: string[] = [];
      for (let i = 0; i < value.length; i++) {
        const element: unknown = value[i];
        if (element === undefined) {
          throw new CanonicalJsonError(
            "undefined inside an array; JSON.stringify would silently write null, " +
              "changing the meaning of the array",
            formatPath([...path, i]),
          );
        }
        parts.push(write(element, [...path, i], seen));
      }
      return `[${parts.join(",")}]`;
    }

    const proto: unknown = Object.getPrototypeOf(obj);
    if (proto !== Object.prototype && proto !== null) {
      throw new CanonicalJsonError(
        `${describe(value)} is not a plain object; convert it to plain JSON data ` +
          `before hashing so the key describes what was actually rendered`,
        formatPath(path),
      );
    }

    const record = obj as Record<string, unknown>;
    // Sort by UTF-16 code unit — deterministic across engines and locales.
    const keys = Object.keys(record).sort((a, b) =>
      a < b ? -1 : a > b ? 1 : 0,
    );

    const parts: string[] = [];
    for (const key of keys) {
      const child: unknown = record[key];
      // Mirrors JSON.stringify: an undefined property is an absent property.
      if (child === undefined) continue;
      parts.push(
        `${JSON.stringify(key)}:${write(child, [...path, key], seen)}`,
      );
    }
    return `{${parts.join(",")}}`;
  } finally {
    seen.delete(obj);
  }
}

/**
 * Runtime type guard for {@link JsonValue}, used when reading untrusted data
 * back off disk (cache sidecars) where the static type is `unknown`.
 *
 * Note: consistent with {@link canonicalStringify}, an object property set to
 * `undefined` is treated as absent and therefore does not fail the guard.
 *
 * @param value - The value to test.
 * @returns True when the value can be canonically serialised.
 */
export function isJsonValue(value: unknown): value is JsonValue {
  try {
    canonicalStringify(value);
    return true;
  } catch {
    return false;
  }
}
