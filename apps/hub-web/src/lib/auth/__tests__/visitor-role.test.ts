import { describe, it, expect } from "vitest";
import {
  canAccessRoute,
  hasPermission,
  isVisitorRole,
  isVisitorAllowedApi,
  getRolePermissions,
  type Permission,
} from "../rbac";

/**
 * The TUTORIAL_VISITOR role is handed to people outside the company, so these
 * are disclosure tests, not behaviour tests. Each one names the thing a
 * prospective buyer would walk away with if the rule regressed.
 */

const visitor = { role: "TUTORIAL_VISITOR", userId: "demo", email: "d@e.f" };

describe("TUTORIAL_VISITOR — what it may reach", () => {
  it("is recognised as an untrusted outsider", () => {
    expect(isVisitorRole("TUTORIAL_VISITOR")).toBe(true);
    expect(isVisitorRole("TUTORIAL_VA")).toBe(false);
    expect(isVisitorRole("ADMIN")).toBe(false);
    expect(isVisitorRole(undefined)).toBe(false);
  });

  it("reaches the Studio and nothing else", () => {
    expect(canAccessRoute(visitor as never, "/tutorial-studio")).toBe(true);

    for (const path of [
      "/dashboard",
      "/jobs",
      "/channels",
      "/analytics",
      "/team",
      "/settings",
      "/templates",
      "/system-health",
      "/thumbnails",
    ]) {
      expect(canAccessRoute(visitor as never, path)).toBe(false);
    }
  });

  it("cannot open the knowledge base, which a TUTORIAL_VA can", () => {
    // Both are tutorial-scoped, so this rule is the only thing separating them
    // on /knowledge — internal SOPs and training material.
    const va = { role: "TUTORIAL_VA", userId: "u", email: "v@a.com" };
    expect(canAccessRoute(va as never, "/knowledge")).toBe(true);
    expect(canAccessRoute(visitor as never, "/knowledge")).toBe(false);
    expect(canAccessRoute(visitor as never, "/knowledge/some-course")).toBe(
      false,
    );
  });
});

describe("TUTORIAL_VISITOR — what it may do", () => {
  it("holds exactly one permission, and it is a read", () => {
    expect(getRolePermissions("TUTORIAL_VISITOR")).toEqual(["view:production"]);
  });

  it("cannot spend money or change anything", () => {
    const forbidden: Permission[] = [
      "create:tutorial-job",
      "create:job",
      "edit:job",
      "delete:job",
      "retry:job",
      "upload:youtube-video",
      "edit:settings",
      "manage:templates",
      "manage:channels",
      "create:user",
      "manage:thumbnails",
    ];
    for (const p of forbidden) {
      expect(hasPermission(visitor as never, p)).toBe(false);
    }
  });

  it("cannot read the surfaces that expose the operation", () => {
    // VIEWER carries all four of these. Granting them here would hand a
    // prospect every job title, the real channel names, which niches perform,
    // and the infrastructure.
    for (const p of [
      "view:jobs",
      "view:channels",
      "view:analytics",
      "view:system-health",
    ] as Permission[]) {
      expect(hasPermission(visitor as never, p)).toBe(false);
    }
  });
});

describe("TUTORIAL_VISITOR — the API allowlist", () => {
  it("permits only the user-scoped GET endpoints", () => {
    expect(isVisitorAllowedApi("/api/production/jobs", "GET")).toBe(true);
    expect(isVisitorAllowedApi("/api/production/jobs/abc-123", "GET")).toBe(
      true,
    );
    expect(isVisitorAllowedApi("/api/production/keywords/mine", "GET")).toBe(
      true,
    );
  });

  it("refuses every other endpoint Tutorial Studio calls", () => {
    // These are real paths from the Studio. None filters by created_by, so any
    // one of them reaching a visitor is a live-data leak.
    for (const path of [
      "/api/production/ranking/jobs",
      "/api/production/transcript",
      "/api/production/tutorial-review/1",
      "/api/thumbnails/select",
      "/api/thumbnails/overview",
      "/api/video-stitch/jobs",
      "/api/music-library",
      "/api/production/keywords/embed-url",
      "/api/channels",
      "/api/team",
    ]) {
      expect(isVisitorAllowedApi(path, "GET")).toBe(false);
    }
  });

  it("refuses writes even to allowlisted paths", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(isVisitorAllowedApi("/api/production/jobs", method)).toBe(false);
      expect(isVisitorAllowedApi("/api/production/jobs/abc", method)).toBe(
        false,
      );
    }
  });

  it("anchors on segment boundaries, so a lookalike prefix does not inherit access", () => {
    expect(isVisitorAllowedApi("/api/production/jobsecret", "GET")).toBe(false);
    expect(isVisitorAllowedApi("/api/production/jobs-export", "GET")).toBe(
      false,
    );
  });
});
