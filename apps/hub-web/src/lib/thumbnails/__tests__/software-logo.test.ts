import { expect, it } from "vitest";
import { findSoftwareLogo, applySoftwareLogo } from "../software-logo";
const layer = {
  id: "logo-1",
  type: "LOGO" as const,
  url: "/old.png",
  autoLogo: true,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  zIndex: 1,
};
it("matches software tokens and prefers the longest name and newest revision", () => {
  const logos = [
    { name: "Notion", url: "/new.png" },
    { name: "Notion", url: "/old.png" },
    { name: "Notion Calendar", url: "/calendar.png" },
    { name: "R", url: "/r.png" },
  ];
  expect(findSoftwareLogo("How to use Notion Calendar", logos)?.url).toBe(
    "/calendar.png",
  );
  expect(findSoftwareLogo("Notion: create account", logos)?.url).toBe(
    "/new.png",
  );
  expect(findSoftwareLogo("Chrome tutorial", logos)).toBeNull();
});
it("matches reusable asset labels without requiring decorative suffixes in the tutorial title", () => {
  const logos = [
    { name: "DocuSign Symbol", url: "/docusign.png" },
    { name: "Google Drive Logo.png", url: "/drive.png" },
  ];
  expect(
    findSoftwareLogo("Add witness requirements in DocuSign", logos)?.url,
  ).toBe("/docusign.png");
  expect(findSoftwareLogo("Recover a file in Google Drive", logos)?.url).toBe(
    "/drive.png",
  );
});
it("updates eligible automatic logo layers without mutating the source", () => {
  expect(applySoftwareLogo([layer], "/new.png", false)[0]?.url).toBe(
    "/new.png",
  );
  expect(layer.url).toBe("/old.png");
});
it("preserves approved, locale override, manual and legacy layouts", () => {
  expect(applySoftwareLogo([layer], "/new.png", true)[0]?.url).toBe("/old.png");
  expect(
    applySoftwareLogo([{ ...layer, autoLogo: false }], "/new.png", false)[0]
      ?.url,
  ).toBe("/old.png");
  expect(
    applySoftwareLogo([{ ...layer, autoLogo: undefined }], "/new.png", false)[0]
      ?.url,
  ).toBe("/old.png");
  expect(applySoftwareLogo([layer], null, false)[0]?.url).toBe("/old.png");
});
