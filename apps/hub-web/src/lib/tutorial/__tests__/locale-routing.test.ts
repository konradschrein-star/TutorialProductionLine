import { describe, expect, it } from "vitest";
import { resolveLocaleChannel } from "../locale-routing";

const channels = [{ id: "brand-a-de", language: "de" }, { id: "brand-b-de", language: "German" }, { id: "en", language: "en" }];
describe("predetermined locale channels", () => {
  it("uses the explicitly configured brand in a multi-brand network", () => {
    expect(resolveLocaleChannel("de", channels, { de: "brand-b-de" }).id).toBe("brand-b-de");
  });
  it("does not randomly pick among same-language channels", () => {
    expect(() => resolveLocaleChannel("de", channels, {})).toThrow("multiple destination");
  });
  it("never silently reroutes an invalid explicit mapping", () => {
    expect(() => resolveLocaleChannel("de", channels, { de: "en" })).toThrow("wrong language");
  });
  it("supports an existing unambiguous single-network channel", () => {
    expect(resolveLocaleChannel("de", channels.slice(0, 1), null).id).toBe("brand-a-de");
  });
});
