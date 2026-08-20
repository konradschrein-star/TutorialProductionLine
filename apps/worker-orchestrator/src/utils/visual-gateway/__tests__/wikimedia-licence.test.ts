/**
 * Offline tests for the Commons licence parser. The fixtures below are the
 * `extmetadata` shape the Commons API returns (HTML-bearing `value` strings);
 * no request is made.
 */
import { describe, it, expect } from "vitest";
import {
  parseCommonsAttribution,
  parseCommonsLicence,
} from "../providers/wikimedia.js";
import { isPublishable } from "../licence.js";

describe("parseCommonsLicence", () => {
  it("prefers LicenseShortName", () => {
    const licence = parseCommonsLicence({
      LicenseShortName: { value: "CC BY-SA 4.0" },
      License: { value: "cc-by-sa-4.0" },
      UsageTerms: { value: "Creative Commons Attribution-Share Alike 4.0" },
    });
    expect(licence).toBe("CC BY-SA 4.0");
    expect(isPublishable(licence!)).toBe(true);
  });

  it("falls back to the machine License key", () => {
    expect(parseCommonsLicence({ License: { value: "cc0" } })).toBe("cc0");
  });

  it("falls back to UsageTerms prose", () => {
    expect(
      parseCommonsLicence({
        UsageTerms: { value: "Public domain" },
      }),
    ).toBe("Public domain");
  });

  it("strips the HTML Commons wraps values in", () => {
    expect(
      parseCommonsLicence({
        LicenseShortName: {
          value: '<a href="https://creativecommons.org/">CC BY 4.0</a>',
        },
      }),
    ).toBe("CC BY 4.0");
  });

  it("returns null when Commons published no licence — the file is discarded", () => {
    expect(parseCommonsLicence({})).toBeNull();
    expect(parseCommonsLicence(undefined)).toBeNull();
    expect(
      parseCommonsLicence({ LicenseShortName: { value: "  " } }),
    ).toBeNull();
    expect(parseCommonsLicence({ LicenseShortName: { value: 42 } })).toBeNull();
  });

  it("does not invent a permissive licence for a restricted file", () => {
    const licence = parseCommonsLicence({
      LicenseShortName: { value: "CC BY-NC-ND 3.0" },
    });
    expect(licence).toBe("CC BY-NC-ND 3.0");
    expect(isPublishable(licence!)).toBe(false);
  });
});

describe("parseCommonsAttribution", () => {
  it("prefers the explicit Attribution field", () => {
    expect(
      parseCommonsAttribution({
        Attribution: { value: "Photo by A. Person" },
        Artist: { value: "<span>A. Person</span>" },
      }),
    ).toBe("Photo by A. Person");
  });

  it("falls back to Artist, HTML stripped", () => {
    expect(
      parseCommonsAttribution({ Artist: { value: "<span>A. Person</span>" } }),
    ).toBe("A. Person");
  });

  it("returns undefined when neither is published", () => {
    expect(parseCommonsAttribution({})).toBeUndefined();
  });
});
