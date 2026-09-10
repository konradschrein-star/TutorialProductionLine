import { describe, expect, it } from "vitest";
import { channelSetupCheck, setupProbeTargets, setupSummary } from "../setup-checks";

describe("installation-independent setup", () => {
  it.each([1, 3, 5, 12, 20])("accepts %i configured channels", (count) => {
    expect(channelSetupCheck(count).ready).toBe(true);
  });
  it("distinguishes a failed inventory read from an empty network", () => {
    expect(channelSetupCheck(null).ready).toBe(false);
    expect(channelSetupCheck(null).detail).toContain("Could not read");
    expect(channelSetupCheck(0).detail).toContain("first channel");
  });
  it("does not count or probe a deliberately disabled optional uploader", () => {
    const checks = [channelSetupCheck(1), {
      id: "uploader", label: "Uploader", ready: false, optional: true,
      probe: false, detail: "Manual delivery", href: "#uploader",
    }];
    expect(setupSummary(checks)).toEqual({ configured: 1, total: 1 });
    expect(setupProbeTargets(checks)).toEqual(["db", "redis"]);
    expect(setupProbeTargets([{ ...checks[1]!, probe: true }])).toContain("uploader");
  });
});
