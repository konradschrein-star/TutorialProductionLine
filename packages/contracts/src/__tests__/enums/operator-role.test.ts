import { describe, it, expect } from "vitest";
import { OperatorRole } from "../../enums/operator-role.js";

const EXPECTED_VALUES = [
  "ADMIN",
  "MANAGER",
  "PRODUCTION_VA",
  "UPLOADER_VA",
  "VIEWER",
] as const;

describe("OperatorRole enum", () => {
  it("has exactly 8 values (guards against accidental deletion)", () => {
    // 7 → 8: TUTORIAL_VISITOR was added in commit 0d877513 (a read-only sales
    // demo account) without bumping this guard, which has failed ever since.
    expect(OperatorRole.options.length).toBe(8);
  });

  it("contains no duplicate values", () => {
    const unique = new Set(OperatorRole.options);
    expect(unique.size).toBe(OperatorRole.options.length);
  });

  it("rejects an unknown operator role", () => {
    expect(OperatorRole.safeParse("SUPER_ADMIN").success).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(OperatorRole.safeParse("").success).toBe(false);
  });

  it("contains all expected role values", () => {
    for (const value of EXPECTED_VALUES) {
      expect(
        OperatorRole.safeParse(value).success,
        `${value} should be valid`,
      ).toBe(true);
    }
  });

  it("accepts ADMIN (full control)", () => {
    expect(OperatorRole.safeParse("ADMIN").success).toBe(true);
  });

  it("accepts MANAGER (operational oversight)", () => {
    expect(OperatorRole.safeParse("MANAGER").success).toBe(true);
  });

  it("accepts PRODUCTION_VA (external UI operator)", () => {
    expect(OperatorRole.safeParse("PRODUCTION_VA").success).toBe(true);
  });

  it("accepts UPLOADER_VA (YouTube upload operator)", () => {
    expect(OperatorRole.safeParse("UPLOADER_VA").success).toBe(true);
  });

  it("accepts VIEWER (read-only access)", () => {
    expect(OperatorRole.safeParse("VIEWER").success).toBe(true);
  });

  it("rejects lowercase role name", () => {
    expect(OperatorRole.safeParse("admin").success).toBe(false);
  });

  it("rejects a partial role name", () => {
    expect(OperatorRole.safeParse("VA").success).toBe(false);
  });
});
