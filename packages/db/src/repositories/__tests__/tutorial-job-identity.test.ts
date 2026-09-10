import { describe, expect, it, vi } from "vitest";
import { createOrReuseTutorialJob } from "../tutorial-job-repository";

const source = "keyword-tool.omar";
const run = "30000000-0000-4000-8000-000000000001";
const request = "30000000-0000-4000-8000-000000000002";
const channel = "30000000-0000-4000-8000-000000000003";
const owner = "30000000-0000-4000-8000-000000000004";

function input(overrides: Record<string, unknown> = {}) {
  return {
    created_by: owner,
    title: "Test",
    mode: "THREE_MIN" as const,
    script_provider: "test",
    tts_provider: "test",
    tts_voice: "test",
    channel_id: channel,
    external_source: source,
    external_production_run_id: run,
    external_opportunity_id: "30000000-0000-4000-8000-000000000005",
    external_family_id: "30000000-0000-4000-8000-000000000006",
    external_evidence_id: "30000000-0000-4000-8000-000000000007",
    external_route_decision_id: "30000000-0000-4000-8000-000000000008",
    intake_request_id: request,
    intake_request_hash: "a".repeat(64),
    ...overrides,
  };
}

function fakeDb(selectRows: unknown[][]) {
  const execute = vi.fn().mockResolvedValue([]);
  const insert = vi.fn(() => ({ values: () => ({ returning: async () => [{ id: "new-job", ...input() }] }) }));
  const select = vi.fn(() => {
    const chain = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: async () => selectRows.shift() ?? [],
    };
    return chain;
  });
  const tx = { execute, select, insert };
  return {
    db: { transaction: (callback: (value: typeof tx) => unknown) => callback(tx) },
    execute,
    insert,
  };
}

describe("external tutorial intake identity", () => {
  it("serializes both run and request before deciding", async () => {
    const existing = { id: "existing", ...input() };
    const fixture = fakeDb([[], [existing]]);
    const result = await createOrReuseTutorialJob(fixture.db as never, input({ external_production_run_id: "30000000-0000-4000-8000-000000000099" }));
    expect(result).toEqual({ job: null, created: false });
    expect(fixture.execute).toHaveBeenCalledTimes(2);
    expect(fixture.insert).not.toHaveBeenCalled();
  });

  it("returns an exact replay without inserting", async () => {
    const existing = { id: "existing", ...input() };
    const fixture = fakeDb([[existing], [existing]]);
    const result = await createOrReuseTutorialJob(fixture.db as never, input());
    expect(result).toEqual({ job: existing, created: false });
    expect(fixture.insert).not.toHaveBeenCalled();
  });

  it("allows the same numeric keyword in an independent source namespace", async () => {
    const fixture = fakeDb([[], []]);
    const result = await createOrReuseTutorialJob(fixture.db as never, input({ keyword_ref: "42", external_source: "keyword-tool.other" }));
    expect(result.created).toBe(true);
    expect(fixture.insert).toHaveBeenCalledOnce();
  });
});
