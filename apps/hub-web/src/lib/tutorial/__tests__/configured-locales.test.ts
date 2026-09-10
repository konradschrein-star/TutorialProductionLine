import { expect, it } from "vitest";
import { configuredTutorialLocales } from "../locale-routing";
it("uses configured Spanish instead of inventing four default locales", () => { expect(configuredTutorialLocales({ es: "channel" }, [])).toEqual(["es"]); });
it("retains existing family languages and removes duplicates and English", () => { expect(configuredTutorialLocales({ es: "channel", en: "source" }, [{ language: "de" }, { language: "es" }])).toEqual(["de", "es"]); });
it("an unconfigured workspace has no invented destinations", () => { expect(configuredTutorialLocales(null, [])).toEqual([]); });
