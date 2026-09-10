import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  permission: vi.fn(),
  where: vi.fn(),
  channel: vi.fn(),
  settings: vi.fn(),
  presets: vi.fn(),
  create: vi.fn(),
  add: vi.fn(),
  quit: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getSession: mocks.session }));
vi.mock("@/lib/auth/rbac", () => ({ hasPermission: mocks.permission }));
vi.mock("@/lib/db", () => {
  const chain = { from: () => chain, where: mocks.where };
  return {
    db: { select: () => chain },
    channels: {
      id: {},
      name: {},
      language: {},
      accepts_tutorials: {},
      is_primary: {},
    },
  };
});
vi.mock("@/lib/tutorial/channel-access", () => ({
  getProductionChannelAccess: mocks.channel,
}));
vi.mock("@repo/db", () => ({
  channels: {
    id: {},
    name: {},
    language: {},
    accepts_tutorials: {},
    is_primary: {},
  },
  createOrReuseTutorialJob: mocks.create,
  getTutorialSettings: mocks.settings,
  listPromptPresets: mocks.presets,
}));
vi.mock("@repo/queue", () => ({
  createRedisConnection: () => ({ quit: mocks.quit }),
  createTutorialGenerateQueue: () => ({ add: mocks.add }),
}));

import { POST } from "../route";

const channelId = "11111111-1111-4111-8111-111111111111";
const batchKey = "22222222-2222-4222-8222-222222222222";
const row = {
  keyword: "How to fix Drive",
  channel: "",
  steps: "Open settings",
  reference_url: "",
  mode: "THREE_MIN",
  source_mode: "FROM_SCRATCH",
};
const request = (rows = [row]) =>
  new NextRequest("http://localhost/api/production/keywords/bulk-intake", {
    method: "POST",
    body: JSON.stringify({ batchKey, defaultChannelId: channelId, rows }),
  });

describe("direct keyword intake", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("REDIS_URL", "redis://127.0.0.1:1");
    mocks.session.mockResolvedValue({ userId: "va" });
    mocks.permission.mockReturnValue(true);
    mocks.where.mockResolvedValue([
      { id: channelId, name: "Guide Realm", language: "en" },
    ]);
    mocks.channel.mockResolvedValue({ id: channelId, language: "en" });
    mocks.settings.mockResolvedValue({
      default_script_provider: "script",
      default_script_model: "model",
      default_tts_provider: "tts",
      default_tts_voice: "voice",
    });
    mocks.presets.mockResolvedValue([
      { id: "33333333-3333-4333-8333-333333333333", is_default: true },
    ]);
    mocks.create.mockResolvedValue({
      job: { id: "44444444-4444-4444-8444-444444444444" },
      created: true,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requires create permission", async () => {
    mocks.permission.mockReturnValue(false);
    expect((await POST(request())).status).toBe(403);
    expect(mocks.where).not.toHaveBeenCalled();
  });

  it("queues a valid row with Studio-owned defaults and stable intake identity", async () => {
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(mocks.create.mock.calls[0]?.[1]).toMatchObject({
      created_by: "va",
      title: row.keyword,
      channel_id: channelId,
      language: "en",
      keyword_ref: `seed:csv:${batchKey}:1`,
      prompt_preset_id: "33333333-3333-4333-8333-333333333333",
    });
    expect(mocks.add).toHaveBeenCalledWith(
      "tutorial-generate",
      expect.objectContaining({ stage: "script" }),
      expect.objectContaining({
        jobId: expect.stringContaining("tutorial-script-"),
      }),
    );
    expect(mocks.quit).toHaveBeenCalledOnce();
  });

  it("keeps durable intake identities tied to original CSV row positions", async () => {
    mocks.create
      .mockResolvedValueOnce({
        job: { id: "44444444-4444-4444-8444-444444444444" },
        created: true,
      })
      .mockResolvedValueOnce({
        job: { id: "55555555-5555-4555-8555-555555555555" },
        created: true,
      });

    const response = await POST(
      request([row, { ...row, keyword: "How to recover Drive files" }]),
    );

    expect(response.status).toBe(201);
    expect(mocks.create.mock.calls.map((call) => call[1].keyword_ref)).toEqual([
      `seed:csv:${batchKey}:1`,
      `seed:csv:${batchKey}:2`,
    ]);
  });

  it("rejects an unusable transcript rewrite before creating anything", async () => {
    const response = await POST(
      request([{ ...row, source_mode: "TRANSCRIPT_REWRITE" }]),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      errors: [expect.objectContaining({ row: 2, field: "reference_url" })],
    });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it("rejects duplicates after channel names and defaults resolve to the same destination", async () => {
    const response = await POST(
      request([
        row,
        { ...row, keyword: "how to FIX drive", channel: "Guide Realm" },
      ]),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      errors: [
        expect.objectContaining({
          row: 3,
          field: "keyword",
          message: expect.stringContaining("duplicates row 2"),
        }),
      ],
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("returns a retryable row receipt when persistence succeeds but queueing fails", async () => {
    mocks.add.mockRejectedValueOnce(new Error("queue offline"));
    const response = await POST(request());
    expect(response.status).toBe(207);
    expect(await response.json()).toMatchObject({
      created: [],
      errors: [
        expect.objectContaining({
          row: 2,
          field: "keyword",
          message: expect.stringContaining("saved"),
        }),
      ],
    });
    expect(mocks.quit).toHaveBeenCalledOnce();
  });
});
