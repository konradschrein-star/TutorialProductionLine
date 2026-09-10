import { expect, it } from "vitest";
import { registerWorkspaceNavigationGuard, requestWorkspaceNavigation } from "../workspace-navigation-guard";

it("allows clean navigation and respects an editor's refusal", () => {
  const target = new EventTarget();
  expect(requestWorkspaceNavigation(target)).toBe(true);
  let dirty = true;
  const dispose = registerWorkspaceNavigationGuard(() => !dirty, target);
  expect(requestWorkspaceNavigation(target)).toBe(false);
  dirty = false;
  expect(requestWorkspaceNavigation(target)).toBe(true);
  dirty = true;
  dispose();
  expect(requestWorkspaceNavigation(target)).toBe(true);
});
