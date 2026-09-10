import { describe, expect, it } from "vitest";
import { parseKeywordCsv } from "../keyword-csv";

describe("keyword CSV intake", () => {
  it("parses quoted commas and optional columns", () => {
    expect(parseKeywordCsv('keyword,channel,steps\n"Fix Drive, fast",English,"open, click"')[0]).toMatchObject({
      keyword: "Fix Drive, fast", channel: "English", steps: "open, click",
    });
  });
  it("requires the keyword header", () => {
    expect(() => parseKeywordCsv("title,channel\nTest,English")).toThrow('required "keyword"');
  });
  it("reports an unfinished quote", () => {
    expect(() => parseKeywordCsv('keyword\n"unfinished')).toThrow("quoted field");
  });
});
