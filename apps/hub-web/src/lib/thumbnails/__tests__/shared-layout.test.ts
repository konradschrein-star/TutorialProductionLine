import { expect, it } from "vitest";
import { inheritThumbnailLayout } from "../shared-layout";
it("shares geometry and added logos without replacing localized copy or host", () => {
  const base = { x: 20, y: 30, width: 200, height: 100, zIndex: 1 };
  const shared = [{ ...base, id: "text-top", type: "TEXT" as const, text: "CREATE ACCOUNT" }, { ...base, id: "person-1", type: "PERSON" as const, url: "/en.png" }, { ...base, id: "logo-1", type: "LOGO" as const, url: "/logo.png" }];
  const local = [{ ...shared[0]!, x: 99, text: "KONTO ERSTELLEN" }, { ...shared[1]!, url: "/de.png" }];
  const result = inheritThumbnailLayout(shared, local);
  expect(result[0]).toMatchObject({ x: 20, text: "KONTO ERSTELLEN" });
  expect(result[1]?.url).toBe("/de.png");
  expect(result[2]?.url).toBe("/logo.png");
  expect(local[0]?.x).toBe(99);
});
