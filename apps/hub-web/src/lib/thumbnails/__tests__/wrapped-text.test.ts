import { expect, it } from "vitest";
import { fitWrappedThumbnailText } from "../fit-text";
const measure = (text: string, size: number) => ({ width: text.length * size * .55, height: size });
it("wraps localized words to retain large readable copy", () => { const result = fitWrappedThumbnailText("DATEIEN TEILEN", { width: 350, height: 120, preferredSize: 68, minimumSize: 40 }, measure); expect(result.text).toBe("DATEIEN\nTEILEN"); expect(result.fontSize).toBeGreaterThan(54); });
it("retains a short single line at its large preferred size", () => { const result = fitWrappedThumbnailText("SHARE", { width: 450, height: 110, preferredSize: 68, minimumSize: 40 }, measure); expect(result.text).toBe("SHARE"); expect(result.fontSize).toBeGreaterThan(67); });
it("blocks export instead of silently making unreadable text", () => { expect(() => fitWrappedThumbnailText("UNBREAKABLESUPERLONGWORD", { width: 300, height: 100, preferredSize: 68, minimumSize: 40 }, measure)).toThrow(/320×180/); });
