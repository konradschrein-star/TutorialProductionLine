import { describe, expect, it } from "vitest";
import { inferKeywordChannel, keywordApiBase, keywordIntegrationState, keywordIsProduced } from "../workflow";

describe("keyword handoff", () => {
  it("supports a separate internal API without changing the browser embed address", () => {
    expect(keywordApiBase({ KT_API_URL: "http://127.0.0.1:17877", KT_EMBED_URL: "https://board.test" })).toBe("http://127.0.0.1:17877");
    expect(keywordApiBase({ KT_EMBED_URL: "https://board.test/" })).toBe("https://board.test");
  });
  it.each(["file:///private", "https://user:password@board.test", "https://board.test?key=secret", "https://board.test#fragment"])("rejects unsafe API address %s", (url) => {
    expect(() => keywordApiBase({ KT_API_URL: url })).toThrow();
  });
  it.each(["QUEUED", "READY_TO_RECORD", "FAILED_SCRIPT", "CANCELLED"])("does not call %s produced", (status) => {
    expect(keywordIsProduced({ status: "UPLOADED", job: { status } })).toBe(false);
  });
  it("distinguishes completion from binding and keeps historical manual production", () => {
    expect(keywordIsProduced({ status: "RENDERING", job: { status: "COMPLETED" } })).toBe(true);
    expect(keywordIsProduced({ status: "DONE", job: null })).toBe(true);
    expect(keywordIsProduced({ status: "CLAIMED", job: null })).toBe(false);
  });
  it("infers only one authorized destination or an explicit accessible binding", () => {
    expect(inferKeywordChannel([{ id: "a" }])).toBe("a");
    expect(inferKeywordChannel([{ id: "a" }, { id: "b" }])).toBe("");
    expect(inferKeywordChannel([{ id: "a" }, { id: "b" }], "b")).toBe("b");
    expect(inferKeywordChannel([{ id: "a" }], "forbidden")).toBe("");
  });
  it("distinguishes optional configuration from a configured outage", () => {
    expect(keywordIntegrationState({})).toBe("unconfigured");
    expect(keywordIntegrationState({ KT_EMBED_URL: "https://kt.test", KT_EMBED_SECRET: "synthetic" })).toBe("configured");
    expect(keywordIntegrationState({ KT_ENABLED: "false", KT_EMBED_URL: "https://kt.test", KT_EMBED_SECRET: "synthetic" })).toBe("disabled");
  });
});
