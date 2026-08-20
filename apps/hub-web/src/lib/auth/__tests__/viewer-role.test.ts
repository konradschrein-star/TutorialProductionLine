import { describe, it, expect } from "vitest";
import {
  canAccessRoute,
  hasPermission,
  isReadOnlyRole,
  isReadOnlyAllowedApiWrite,
  getRolePermissions,
  type Permission,
} from "../rbac";

/**
 * VIEWER is the investor / outside-stakeholder login: it is handed to someone
 * who is not staff, so these are disclosure-and-damage tests. Each one names
 * what that person could reach or break if the rule regressed.
 */

const viewer = { role: "VIEWER", userId: "v", email: "v@example.com" };

describe("VIEWER — what it may reach", () => {
  it("is recognised as a read-only login", () => {
    expect(isReadOnlyRole("VIEWER")).toBe(true);
    expect(isReadOnlyRole("MANAGER")).toBe(false);
    expect(isReadOnlyRole("TUTORIAL_VA")).toBe(false);
    expect(isReadOnlyRole(undefined)).toBe(false);
  });

  it("opens the knowledge base — the reason the account exists", () => {
    expect(canAccessRoute(viewer as never, "/knowledge")).toBe(true);
    expect(canAccessRoute(viewer as never, "/knowledge/some-course")).toBe(
      true,
    );
    expect(canAccessRoute(viewer as never, "/knowledge/course/lesson")).toBe(
      true,
    );
  });

  it("opens the read-only overview pages", () => {
    for (const path of [
      "/dashboard",
      "/jobs",
      "/jobs/abc-123",
      "/formats",
      "/analytics",
      "/channels",
      "/system-health",
      "/templates",
    ]) {
      expect(canAccessRoute(viewer as never, path)).toBe(true);
    }
  });

  it("cannot reach the tools that spend money or hold config", () => {
    for (const path of [
      "/jobs/create",
      "/jobs/create/casually-explained",
      "/factory",
      "/clip-forge",
      "/clip-library",
      "/tutorial-studio",
      "/thumbnails",
      "/subtitles",
      "/business-hub-studio",
      "/settings",
      "/settings/music",
      "/team",
    ]) {
      expect(canAccessRoute(viewer as never, path)).toBe(false);
    }
  });
});

describe("VIEWER — what it may do", () => {
  it("holds reads only", () => {
    const writeVerbs = [
      "create:",
      "edit:",
      "delete:",
      "manage:",
      "assign:",
      "upload:",
      "pause:",
      "resume:",
      "retry:",
      "review:",
    ];
    for (const permission of getRolePermissions("VIEWER")) {
      expect(
        writeVerbs.some((v) => permission.startsWith(v)),
        `VIEWER must not hold ${permission}`,
      ).toBe(false);
    }
  });

  it("holds none of the permissions that change state", () => {
    for (const permission of [
      "create:job",
      "edit:job",
      "delete:job",
      "retry:job",
      "review:qc",
      "create:tutorial-job",
      "manage:thumbnails",
      "manage:knowledge",
      "edit:settings",
      "manage:credentials",
      "create:user",
    ] as Permission[]) {
      expect(hasPermission(viewer as never, permission)).toBe(false);
    }
  });
});

describe("VIEWER — the API write chokepoint", () => {
  /**
   * These are the routes that authenticate with getSession() alone, i.e. any
   * logged-in role passes their own check. The middleware gate is the only
   * thing stopping a read-only account from calling them.
   */
  it("refuses every write outside the allowlist", () => {
    for (const [path, method] of [
      ["/api/v1/jobs", "POST"],
      ["/api/jobs/abc/cancel", "POST"],
      ["/api/music-library/generate", "POST"],
      ["/api/clip-library/lib-1", "DELETE"],
      ["/api/production/jobs", "POST"],
      ["/api/knowledge/admin/courses", "POST"],
      ["/api/sound-effect", "POST"],
      ["/api/providers/probe", "POST"],
    ] as const) {
      expect(
        isReadOnlyAllowedApiWrite(path, method),
        `${method} ${path} must be refused`,
      ).toBe(false);
    }
  });

  it("allows reads, and the viewer's own course-watching state", () => {
    expect(isReadOnlyAllowedApiWrite("/api/v1/jobs", "GET")).toBe(true);
    expect(isReadOnlyAllowedApiWrite("/api/knowledge/stream", "HEAD")).toBe(
      true,
    );
    expect(isReadOnlyAllowedApiWrite("/api/knowledge/progress", "POST")).toBe(
      true,
    );
    expect(isReadOnlyAllowedApiWrite("/api/knowledge/notes", "POST")).toBe(
      true,
    );
    expect(isReadOnlyAllowedApiWrite("/api/knowledge/notes", "DELETE")).toBe(
      true,
    );
  });

  it("does not let a prefix collision widen the allowlist", () => {
    expect(isReadOnlyAllowedApiWrite("/api/knowledge/notesFOO", "POST")).toBe(
      false,
    );
    expect(isReadOnlyAllowedApiWrite("/api/knowledge/admin", "POST")).toBe(
      false,
    );
  });
});
