import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { session, update, remote } = vi.hoisted(() => ({ session: vi.fn(), update: vi.fn(), remote: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: session }));
vi.mock("@/lib/auth/rbac", () => ({ hasPermission: () => true }));
vi.mock("@repo/db", () => ({ getSecret: vi.fn() }));
vi.mock("@/lib/uploader/settings", () => ({ getUploaderSettings: async () => ({ dashboardApiUrl: "http://127.0.0.1:9999/test", operationsUrl: "/uploader-ops/" }) }));
vi.mock("@/lib/db", () => ({ db: { select: () => ({ from: () => ({ where: async () => [] }) }), update }, channels: {}, tutorialJobs: {}, tutorialJobEvents: {} }));
import { GET } from "@/app/api/production/uploader-status/route";
describe("dashboard observations are not verified receipts", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("fetch", remote); });
  afterEach(() => vi.unstubAllGlobals());
  it("does not fetch or expose the channel network to a VA", async () => {
    session.mockResolvedValue({ userId: "va", role: "TUTORIAL_VA" });
    expect(await (await GET()).json()).toMatchObject({ channels: [], jobs: [], inspectionOnly: true });
    expect(remote).not.toHaveBeenCalled();
  });
  it("does not overwrite tutorial publication state from a succeeded dashboard job", async () => {
    session.mockResolvedValue({ userId: "admin", role: "ADMIN" });
    remote.mockResolvedValue(new Response(JSON.stringify({ jobs: [{ id: "11111111-2222-4333-8444-555555555551-reconcile", state: "succeeded", outcome: { video_id: "abcdefghijk", visibility: "public" } }] }), { status: 200 }));
    const response = await (await GET()).json();
    expect(response).toMatchObject({ connected: true, inspectionOnly: true });
    expect(response.jobs).toHaveLength(1); expect(update).not.toHaveBeenCalled();
  });
});
