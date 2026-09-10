import { expect, it } from "vitest";
import { getCommandPages, paletteShortcut } from "../command-palette-model";
import { canAccessRoute, hasPermission } from "@/lib/auth/rbac";
const session = (role: string) => ({ userId: "test", email: "test@example.invalid", role });
it("shows uploaders delivery and thumbnails without administrative or keyword navigation", () => {
  const pages = getCommandPages(session("UPLOADER_VA"));
  expect(pages.map(page => page.href)).toContain("/tutorial-studio?tab=uploads");
  expect(pages.map(page => page.href)).toContain("/thumbnails");
  for (const path of ["/settings", "/team", "/channels", "/system-health", "/tutorial-studio?tab=keywords", "/tutorial-studio/video-stitcher"]) expect(pages.map(page => page.href)).not.toContain(path);
});
it.each(["ADMIN", "TUTORIAL_VA", "UPLOADER_VA", "SCRIPT_VA", "unknown"])("keeps palette entries within sidebar permissions for %s", role => {
  for (const page of getCommandPages(session(role))) {
    expect(canAccessRoute(session(role), page.href)).toBe(true);
    if (page.href.endsWith("tab=keywords")) expect(hasPermission(session(role), "view:production")).toBe(true);
    expect(page.href).not.toContain("stitcher");
  }
});
it("retains admin settings and matches the Accounts sidebar label", () => {
  const pages = getCommandPages(session("ADMIN"));
  expect(pages.find(page => page.href === "/team")?.label).toBe("Accounts");
  expect(pages.some(page => page.href === "/settings")).toBe(true);
});
it.each([{ctrlKey:true,metaKey:false,key:"k"},{ctrlKey:false,metaKey:true,key:"K"}])("recognizes the header shortcut %j", modifiers => {
  expect(paletteShortcut({ ...modifiers, altKey:false, repeat:false })).toBe("toggle");
});
it("closes on Escape, ignores plain typing and repeated keydown toggles", () => {
  const event = { key:"k", ctrlKey:false, metaKey:false, altKey:false, repeat:false };
  expect(paletteShortcut(event)).toBe(null);
  expect(paletteShortcut({...event,key:"Escape"})).toBe("close");
  expect(paletteShortcut({...event,ctrlKey:true,repeat:true})).toBe(null);
});
