import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const getSession = vi.hoisted(() => vi.fn());
const select = vi.hoisted(() => vi.fn());
const limit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/session", () => ({ getSession }));
vi.mock("@/lib/db", () => {
  const chain = { from: () => chain, leftJoin: () => chain, where: () => chain, limit };
  return { db: { select: (...args: unknown[]) => { select(...args); return chain; } }, tutorialJobs: { id: {}, keyword_ref: {}, created_by: {}, channel_id: {}, status: {}, external_source: {}, intake_request_id: {}, external_production_run_id: {}, external_opportunity_id: {}, external_family_id: {}, external_evidence_id: {}, external_route_decision_id: {}, intake_request_hash: {} }, users: { id: {}, email: {} } };
});
import { GET } from "../route";
const id = "11111111-1111-4111-8111-111111111111";
const token = "synthetic-reconciliation-test-token";
const request = (credential?: string) => new NextRequest(`https://studio.example/api/v1/tutorial/jobs/${id}`, { headers: credential ? { Authorization: `Bearer ${credential}` } : {} });
const context = (value = id) => ({ params: Promise.resolve({ id: value }) });
describe("machine tutorial identity reconciliation", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("CF_API_TOKEN", token); getSession.mockResolvedValue(null); limit.mockResolvedValue([]); });
  afterEach(() => { vi.unstubAllEnvs(); });
  it("rejects missing credentials before querying", async () => { expect((await GET(request(), context())).status).toBe(401); expect(select).not.toHaveBeenCalled(); });
  it("rejects a browser Admin session", async () => { getSession.mockResolvedValue({ userId: id, role: "ADMIN" }); expect((await GET(request(), context())).status).toBe(401); expect(select).not.toHaveBeenCalled(); });
  it("rejects a wrong bearer token even with an Admin session", async () => { getSession.mockResolvedValue({ userId: id, role: "ADMIN" }); expect((await GET(request("wrong"), context())).status).toBe(401); expect(select).not.toHaveBeenCalled(); });
  it("fails closed when the machine integration is not configured", async () => { vi.stubEnv("CF_API_TOKEN", ""); expect((await GET(request(token), context())).status).toBe(503); expect(select).not.toHaveBeenCalled(); });
  it("validates a strict UUID", async () => { expect((await GET(request(token), context("not-a-uuid"))).status).toBe(400); expect(select).not.toHaveBeenCalled(); });
  it("returns 404 rather than fabricating a binding", async () => { expect((await GET(request(token), context())).status).toBe(404); });
  it("returns only exact identity fields and actual creator email", async () => {
    const identity = { jobId: id, keyword_ref: "keyword-17", claimed_by_email: "actual-owner@example.test", channel_id: "22222222-2222-4222-8222-222222222222", status: "READY_TO_RECORD" };
    limit.mockResolvedValue([{ ...identity, script_text: "never return this", credentials: "never return this" }]);
    const response = await GET(request(token), context()); expect(response.status).toBe(200); expect(await response.json()).toEqual(identity); expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(Object.keys(select.mock.calls[0]![0])).toEqual(["jobId", "keyword_ref", "claimed_by_email", "channel_id", "status", "external_source", "request_id", "production_run_id", "opportunity_id", "family_id", "evidence_id", "route_decision_id", "request_hash"]);
  });
  it("returns namespaced identity to its dedicated source only", async () => {
    vi.stubEnv("KT_INGEST_TOKEN", "dedicated"); vi.stubEnv("KT_EXTERNAL_SOURCE", "keyword-tool.omar");
    const identity = { external_source: "keyword-tool.omar", request_id: "r", production_run_id: "p", opportunity_id: "o", family_id: "f", evidence_id: "e", route_decision_id: "d", request_hash: "h" };
    limit.mockResolvedValue([{ jobId: id, keyword_ref: "17", claimed_by_email: "owner@test", channel_id: id, status: "QUEUED", ...identity }]);
    const response = await GET(request("dedicated"), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ identity: { schema_version: 2, ...identity } });
    limit.mockResolvedValue([{ jobId: id, keyword_ref: "17", claimed_by_email: "owner@test", channel_id: id, status: "QUEUED", ...identity, external_source: "keyword-tool.other" }]);
    expect((await GET(request("dedicated"), context())).status).toBe(404);
  });
  it("does not invent an owner when the creator join is absent", async () => { limit.mockResolvedValue([{ jobId: id, keyword_ref: null, claimed_by_email: null, channel_id: null, status: "CANCELLED" }]); expect(await (await GET(request(token), context())).json()).toMatchObject({ claimed_by_email: null, keyword_ref: null, channel_id: null }); });
  it("does not expose database errors", async () => { limit.mockRejectedValue(new Error("sensitive database URL")); const response = await GET(request(token), context()); expect(response.status).toBe(503); expect(await response.text()).not.toContain("sensitive"); });
});
