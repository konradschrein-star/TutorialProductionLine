import { describe, expect, it } from "vitest";

import {
  CanonicalJsonError,
  canonicalStringify,
  isJsonValue,
  type JsonValue,
} from "../canonical-json.js";

describe("canonicalStringify — key order stability", () => {
  it("produces identical output for objects built in different key orders", () => {
    const a = {
      element: "FormulaReveal",
      layout: "framed-chart",
      grade: "cool",
    };
    const b = {
      grade: "cool",
      layout: "framed-chart",
      element: "FormulaReveal",
    };

    // Guard the premise: naive JSON.stringify is NOT stable here.
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    expect(canonicalStringify(a)).toBe(canonicalStringify(b));
  });

  it("sorts keys recursively, not just at the top level", () => {
    const a = {
      data: {
        steps: [
          { label: "noi", value: 1 },
          { value: 2, label: "debt" },
        ],
      },
      element: "FormulaReveal",
    };
    const b = {
      element: "FormulaReveal",
      data: {
        steps: [
          { value: 1, label: "noi" },
          { label: "debt", value: 2 },
        ],
      },
    };

    expect(canonicalStringify(a)).toBe(canonicalStringify(b));
    expect(canonicalStringify(a)).toBe(
      '{"data":{"steps":[{"label":"noi","value":1},{"label":"debt","value":2}]},' +
        '"element":"FormulaReveal"}',
    );
  });

  it("preserves array order — array order is meaningful data", () => {
    expect(canonicalStringify([1, 2, 3])).not.toBe(
      canonicalStringify([3, 2, 1]),
    );
  });

  it("sorts by UTF-16 code unit, not by locale", () => {
    // Under a locale-aware sort "a" would collate before "B"; code-unit order
    // puts uppercase first.
    expect(canonicalStringify({ a: 1, B: 2 })).toBe('{"B":2,"a":1}');
  });

  it("is stable across deeply nested insertion-order permutations", () => {
    const forward: JsonValue = { a: { b: { c: { d: [1, { x: 1, y: 2 }] } } } };
    const backward: JsonValue = { a: { b: { c: { d: [1, { y: 2, x: 1 }] } } } };
    expect(canonicalStringify(forward)).toBe(canonicalStringify(backward));
  });

  it("treats an undefined property as an absent property", () => {
    expect(canonicalStringify({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(canonicalStringify({ a: 1 })).toBe(
      canonicalStringify({ a: 1, b: undefined }),
    );
  });

  it("round-trips through JSON.parse to the same value", () => {
    const spec = { z: [1, "two", null, true], a: { nested: false } };
    expect(JSON.parse(canonicalStringify(spec))).toEqual(spec);
  });
});

describe("canonicalStringify — fail-closed on non-JSON values", () => {
  it("throws on NaN instead of writing null like JSON.stringify", () => {
    expect(JSON.stringify({ v: NaN })).toBe('{"v":null}');
    expect(() => canonicalStringify({ v: NaN })).toThrow(CanonicalJsonError);
  });

  it("throws on Infinity", () => {
    expect(() => canonicalStringify({ v: Infinity })).toThrow(
      CanonicalJsonError,
    );
  });

  it("throws on undefined inside an array instead of coercing it to null", () => {
    const holed = [1, undefined, 3];
    expect(JSON.stringify(holed)).toBe("[1,null,3]");
    expect(() => canonicalStringify(holed)).toThrow(
      /undefined inside an array/,
    );
  });

  it("throws on undefined at the root", () => {
    expect(() => canonicalStringify(undefined)).toThrow(CanonicalJsonError);
  });

  it("throws on a Date rather than silently hashing its ISO string", () => {
    expect(() => canonicalStringify({ at: new Date(0) })).toThrow(
      /not a plain object/,
    );
  });

  it("throws on Map, Set and class instances", () => {
    class Widget {
      public n = 1;
    }
    expect(() => canonicalStringify(new Map())).toThrow(CanonicalJsonError);
    expect(() => canonicalStringify(new Set())).toThrow(CanonicalJsonError);
    expect(() => canonicalStringify(new Widget())).toThrow(/Widget instance/);
  });

  it("throws on bigint, symbol and function values", () => {
    expect(() => canonicalStringify({ v: 1n })).toThrow(/bigint/);
    expect(() => canonicalStringify({ v: Symbol("s") })).toThrow(/symbol/);
    expect(() => canonicalStringify({ v: () => 1 })).toThrow(/function/);
  });

  it("throws on a circular reference", () => {
    const cyclic: Record<string, unknown> = { name: "loop" };
    cyclic.self = cyclic;
    expect(() => canonicalStringify(cyclic)).toThrow(/Circular reference/);
  });

  it("allows a repeated (non-circular) reference in a DAG", () => {
    const shared = { n: 1 };
    expect(canonicalStringify({ a: shared, b: shared })).toBe(
      '{"a":{"n":1},"b":{"n":1}}',
    );
  });

  it("throws past the depth limit", () => {
    let deep: JsonValue = 1;
    for (let i = 0; i < 80; i++) deep = { d: deep };
    expect(() => canonicalStringify(deep)).toThrow(/nests deeper/);
  });

  it("reports the JSON path of the offending value", () => {
    let caught: unknown;
    try {
      canonicalStringify({ data: { steps: [{ value: NaN }] } });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CanonicalJsonError);
    expect((caught as CanonicalJsonError).path).toBe("$.data.steps[0].value");
  });

  it("quotes path segments that are not identifiers", () => {
    let caught: unknown;
    try {
      canonicalStringify({ "odd key": NaN });
    } catch (err) {
      caught = err;
    }
    expect((caught as CanonicalJsonError).path).toBe('$["odd key"]');
  });
});

describe("isJsonValue", () => {
  it("accepts JSON values", () => {
    expect(isJsonValue({ a: [1, "x", null, true] })).toBe(true);
    expect(isJsonValue(null)).toBe(true);
    expect(isJsonValue("s")).toBe(true);
  });

  it("rejects non-JSON values", () => {
    expect(isJsonValue(new Date())).toBe(false);
    expect(isJsonValue(undefined)).toBe(false);
    expect(isJsonValue({ v: NaN })).toBe(false);
  });
});
