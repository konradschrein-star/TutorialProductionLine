/**
 * Result Type Tests
 *
 * Tests for the functional Result<T, E> discriminated union helpers.
 * These are pure functions with no IO - quick to test.
 */

import { describe, it, expect } from "vitest";
import { Result, type Success, type Failure } from "../../schemas/result.js";

describe("Result helpers", () => {
  describe("Result.success", () => {
    it("creates a success result with data", () => {
      const result = Result.success("hello");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe("hello");
      }
    });

    it("creates a success result with object data", () => {
      const data = { id: 1, name: "test" };
      const result = Result.success(data);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(data);
      }
    });

    it("creates a success result with null data", () => {
      const result = Result.success(null);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(null);
      }
    });

    it("creates a success result with undefined data", () => {
      const result = Result.success(undefined);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(undefined);
      }
    });

    it("has correct TypeScript type", () => {
      const result = Result.success(42);

      // TypeScript compile-time check: success result has 'data' property
      if (result.success) {
        const data: number = result.data;
        expect(data).toBe(42);
      }
    });
  });

  describe("Result.failure", () => {
    it("creates a failure result with error", () => {
      const error = new Error("something went wrong");
      const result = Result.failure(error);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe(error);
      }
    });

    it("creates a failure result with string error", () => {
      const result = Result.failure("error message");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("error message");
      }
    });

    it("creates a failure result with custom error object", () => {
      const error = { code: "AUTH_FAILED", message: "Invalid credentials" };
      const result = Result.failure(error);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toEqual(error);
      }
    });

    it("has correct TypeScript type", () => {
      const error = new Error("test");
      const result = Result.failure(error);

      // TypeScript compile-time check: failure result has 'error' property
      if (!result.success) {
        const err: Error = result.error;
        expect(err).toBe(error);
      }
    });
  });

  describe("discriminated union behavior", () => {
    it("allows exhaustive type narrowing", () => {
      const result: Result<number, string> = Math.random() > 0.5
        ? Result.success(42)
        : Result.failure("error");

      if (result.success) {
        // TypeScript knows result.data exists here
        expect(typeof result.data).toBe("number");
      } else {
        // TypeScript knows result.error exists here
        expect(typeof result.error).toBe("string");
      }
    });

    it("works with different generic types", () => {
      type UserData = { id: string; name: string };
      type UserError = { code: string; details: string };

      const successCase: Result<UserData, UserError> = Result.success({
        id: "123",
        name: "Alice",
      });

      const failureCase: Result<UserData, UserError> = Result.failure({
        code: "USER_NOT_FOUND",
        details: "No user with that ID",
      });

      expect(successCase.success).toBe(true);
      expect(failureCase.success).toBe(false);
    });
  });
});
