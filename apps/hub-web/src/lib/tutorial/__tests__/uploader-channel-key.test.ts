import { describe, expect, it } from "vitest";
import {
  normalizeUploaderChannelKey,
  validateTutorialUploaderChannelKey,
} from "../uploader-channel-key";

describe("normalizeUploaderChannelKey", () => {
  it("uses null as the fail-closed representation of no mapping", () => {
    expect(normalizeUploaderChannelKey(undefined)).toBeNull();
    expect(normalizeUploaderChannelKey("   ")).toBeNull();
  });

  it("trims and accepts provider-neutral safe keys", () => {
    expect(normalizeUploaderChannelKey("  english_us-1  ")).toBe(
      "english_us-1",
    );
  });

  it.each(["English", "1english", "english us", "english/us", "a".repeat(65)])(
    "rejects unsafe mapping %s",
    (value) => {
      expect(() => normalizeUploaderChannelKey(value)).toThrow(
        /uploader channel key/i,
      );
    },
  );
});

describe("validateTutorialUploaderChannelKey", () => {
  it("accepts explicit mappings for the five active languages", () => {
    expect(
      validateTutorialUploaderChannelKey("German", "tutorial_german"),
    ).toBe("tutorial_german");
  });

  it("keeps Dutch as archive-only", () => {
    expect(() =>
      validateTutorialUploaderChannelKey("nl", "tutorial_dutch"),
    ).toThrow("nl is archive-only");
    expect(validateTutorialUploaderChannelKey("nl", "")).toBeNull();
  });
});
