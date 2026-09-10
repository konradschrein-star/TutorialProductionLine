import { describe, expect, it } from "vitest";
import {
  assertExactTutorialThumbnailJobs,
  parseTutorialThumbnailJobAllowlist,
} from "../backfill-job-allowlist.js";

const first = "7d6cdc5d-23b8-4b51-8bf6-7224e26aa876";
const second = "11111111-1111-4111-8111-111111111111";

describe("manual thumbnail backfill job allowlist", () => {
  it("accepts and normalizes an explicit bounded UUID allowlist", () => {
    expect(parseTutorialThumbnailJobAllowlist(` ${first.toUpperCase()} , ${second} `)).toEqual([first, second]);
  });

  it.each([undefined, "", `${first},`, "not-a-uuid", `${first},${first}`])("fails closed for missing or malformed input: %s", (value) => {
    expect(() => parseTutorialThumbnailJobAllowlist(value)).toThrow();
  });

  it("rejects more than 50 jobs", () => {
    const values = Array.from({ length: 51 }, (_, index) => `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`);
    expect(() => parseTutorialThumbnailJobAllowlist(values.join(","))).toThrow("more than 50");
  });

  it("requires the query to return every requested job exactly once", () => {
    expect(() => assertExactTutorialThumbnailJobs([first, second], [{ id: second }, { id: first }])).not.toThrow();
    expect(() => assertExactTutorialThumbnailJobs([first, second], [{ id: first }])).toThrow("missing=1");
    expect(() => assertExactTutorialThumbnailJobs([first], [{ id: first }, { id: first }])).toThrow("duplicate");
    expect(() => assertExactTutorialThumbnailJobs([first], [{ id: second }])).toThrow("unexpected=1");
  });
});
