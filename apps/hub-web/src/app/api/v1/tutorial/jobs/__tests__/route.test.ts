import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(), limit: vi.fn(), producer: vi.fn(), channel: vi.fn(),
  settings: vi.fn(), presets: vi.fn(), create: vi.fn(), add: vi.fn(), quit: vi.fn(),
}));
vi.mock("@/app/api/_lib/auth", () => ({
  resolvePrincipal: mocks.auth, ApiAuthError: class extends Error { status = 401; },
}));
vi.mock("@/lib/db", () => {
  const chain = { from: () => chain, where: () => chain, orderBy: () => chain, limit: mocks.limit };
  return { db: { select: () => chain }, users: { id: {} }, tutorialJobs: { keyword_ref: {}, source_job_id: {}, created_at: {} } };
});
vi.mock("@repo/db", () => ({ createOrReuseTutorialJob: mocks.create, getTutorialSettings: mocks.settings, listPromptPresets: mocks.presets }));
vi.mock("@repo/queue", () => ({ createRedisConnection: () => ({ quit: mocks.quit }), createTutorialGenerateQueue: () => ({ add: mocks.add }) }));
vi.mock("@/lib/repositories/user-repository", () => ({ findUserByEmail: mocks.producer }));
vi.mock("@/lib/tutorial/channel-access", () => ({ getProductionChannelAccess: mocks.channel }));
import { POST } from "../route";
const channel = "11111111-1111-4111-8111-111111111111";
const job = { id: "22222222-2222-4222-8222-222222222222", created_by: "producer", channel_id: channel, status: "QUEUED" };
const transcript = "Open settings and create a new account. ".repeat(12);
const request = (extra: Record<string, unknown> = {}) => new NextRequest("http://localhost/api/v1/tutorial/jobs", {
  method: "POST", body: JSON.stringify({ keyword_ref: "42", title: "Test", claimed_by_email: "va@test.invalid", language: "en", ...extra }),
});
describe("machine intake contract", () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.stubEnv("REDIS_URL", "redis://127.0.0.1:1");
    mocks.auth.mockResolvedValue({ kind: "machine" });
    mocks.producer.mockResolvedValue({ id: "producer", isActive: true });
    mocks.limit.mockResolvedValueOnce([{ default_tutorial_channel_id: channel }]).mockResolvedValue([]);
    mocks.channel.mockResolvedValue({ language: "en" });
    mocks.settings.mockResolvedValue({ default_script_provider: "admin-script", default_tts_provider: "admin-tts", default_tts_voice: "admin-voice" });
    mocks.presets.mockResolvedValue([{ id: "preset", is_default: true }]);
    mocks.create.mockResolvedValue({ job, created: true });
  });
  it("preserves rewrite, transcript and steps while using Studio-owned defaults", async () => {
    const response = await POST(request({ source_mode: "TRANSCRIPT_REWRITE", reference_transcript: transcript, steps_input: "Step 1" }));
    expect(response.status).toBe(201);
    expect(mocks.create.mock.calls[0]?.[1]).toMatchObject({ source_mode: "TRANSCRIPT_REWRITE", reference_transcript: transcript, steps_input: "Step 1", script_provider: "admin-script", tts_voice: "admin-voice" });
  });
  it("rejects rewrite without a source", async () => { expect((await POST(request({ source_mode: "TRANSCRIPT_REWRITE" }))).status).toBe(400); expect(mocks.create).not.toHaveBeenCalled(); });
  it("rejects a short transcript before queuing", async () => { expect((await POST(request({ source_mode: "TRANSCRIPT_REWRITE", reference_transcript: "Too short" }))).status).toBe(400); });
  it("rejects unsupported automatic transcript sources", async () => { expect((await POST(request({ source_mode: "TRANSCRIPT_REWRITE", reference_url: "https://example.com/video" }))).status).toBe(400); });
  it("rejects unsupported provider overrides explicitly", async () => { expect((await POST(request({ tts_voice: "unexpected" }))).status).toBe(400); });
  it("rejects non-http reference URLs", async () => { expect((await POST(request({ reference_url: "file:///secret" }))).status).toBe(400); });
  it("returns400 for malformed rewrite URLs without throwing", async () => { expect((await POST(request({ source_mode: "TRANSCRIPT_REWRITE", reference_url: "not-a-url" }))).status).toBe(400); });
  it("reuses frozen existing jobs even after defaults disappear", async () => {
    mocks.limit.mockReset().mockResolvedValueOnce([{ default_tutorial_channel_id: channel }]).mockResolvedValueOnce([job]);
    mocks.presets.mockResolvedValue([]);
    const response = await POST(request({ title: "Changed input" }));
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ jobId: job.id, duplicate: true });
    expect(mocks.settings).not.toHaveBeenCalled(); expect(mocks.presets).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("rejects another owner's existing keyword", async () => {
    mocks.limit.mockReset().mockResolvedValueOnce([{ default_tutorial_channel_id: channel }]).mockResolvedValueOnce([{ ...job, created_by: "someone-else" }]);
    expect((await POST(request())).status).toBe(409); expect(mocks.add).not.toHaveBeenCalled();
  });
  it("rejects unauthorized channels before creating work", async () => { mocks.channel.mockResolvedValue(null); expect((await POST(request())).status).toBe(403); expect(mocks.create).not.toHaveBeenCalled(); });
  it("rejects missing active producer", async () => { mocks.producer.mockResolvedValue(null); expect((await POST(request())).status).toBe(422); });
});
