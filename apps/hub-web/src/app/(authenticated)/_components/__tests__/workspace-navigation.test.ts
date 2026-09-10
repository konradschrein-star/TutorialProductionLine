import { describe, expect, it } from "vitest";
import { activeWorkspaceHref, getWorkspaceNavigation } from "../workspace-navigation";
const session = (role: string) => ({ userId: "fixture", email: "fixture@example.invalid", role });
describe("single production navigation", () => {
  it("makes the full library first-class without duplicate destinations", () => {
    const items = getWorkspaceNavigation(session("TUTORIAL_VA"));
    expect(items[1].label).toBe("All tutorials");
    expect(new Set(items.map(item => item.href)).size).toBe(items.length);
    expect(items.filter(item => item.group === "Management")).toHaveLength(0);
    expect(items.some(item => /ranking|stitch/.test(item.href))).toBe(false);
    expect(items.some(item => item.href === "/tutorial-studio?tab=uploads")).toBe(true);
  });
  it("does not expose producer queues to the manual uploader", () => {
    expect(getWorkspaceNavigation(session("UPLOADER_VA")).map(item => item.href)).toEqual([
      "/thumbnails", "/tutorial-studio?tab=uploads",
    ]);
  });
  it.each(["VIEWER", "TUTORIAL_VISITOR"])("does not offer mutation workspaces to %s", role => {
    const links = getWorkspaceNavigation(session(role)).map(item => item.href);
    expect(links).toContain("/tutorial-studio?tab=library");
    for (const tab of ["create", "studio", "review", "localize", "keywords", "uploads"]) expect(links).not.toContain(`/tutorial-studio?tab=${tab}`);
  });
  it("keeps every query destination independently selected", () => {
    for (const tab of ["dashboard", "library", "keywords", "create", "studio", "localize", "review", "uploads", "activity", "settings"]) {
      expect(activeWorkspaceHref("/tutorial-studio", tab, true)).toBe(`/tutorial-studio?tab=${tab}`);
    }
    expect(activeWorkspaceHref("/tutorial-studio", null, false)).toBe("/tutorial-studio?tab=uploads");
    expect(activeWorkspaceHref("/thumbnails", null, true)).toBe("/thumbnails");
  });
});
