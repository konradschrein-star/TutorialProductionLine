import { describe, expect, it } from "vitest";
import { parseKeywordCsv, validateKeywordCsvRows } from "../keyword-csv";

describe("keyword CSV intake", () => {
  it("parses quoted commas and optional columns", () => {
    expect(
      parseKeywordCsv(
        'keyword,channel,steps\n"Fix Drive, fast",English,"open, click"',
      )[0],
    ).toMatchObject({
      keyword: "Fix Drive, fast",
      channel: "English",
      steps: "open, click",
    });
  });
  it("requires the keyword header", () => {
    expect(() => parseKeywordCsv("title,channel\nTest,English")).toThrow(
      'required "keyword"',
    );
  });
  it("reports an unfinished quote", () => {
    expect(() => parseKeywordCsv('keyword\n"unfinished')).toThrow(
      "quoted field",
    );
  });
  it("accepts a UTF-8 BOM but rejects misspelled and duplicate headers", () => {
    expect(
      parseKeywordCsv("\uFEFFkeyword,channel\nTest,English")[0]?.keyword,
    ).toBe("Test");
    expect(() => parseKeywordCsv("keyword,chanell\nTest,English")).toThrow(
      "Unknown CSV column",
    );
    expect(() => parseKeywordCsv("keyword,keyword\nTest,Other")).toThrow(
      "more than once",
    );
  });
  it("returns spreadsheet-addressable validation errors", () => {
    const errors = validateKeywordCsvRows([
      {
        keyword: "",
        channel: "",
        steps: "",
        reference_url: "",
        mode: "BAD",
        source_mode: "",
      },
      {
        keyword: "Fix Drive",
        channel: "English",
        steps: "",
        reference_url: "",
        mode: "THREE_MIN",
        source_mode: "TRANSCRIPT_REWRITE",
      },
      {
        keyword: "fix drive",
        channel: "English",
        steps: "",
        reference_url: "http://youtube.com/watch?v=x",
        mode: "",
        source_mode: "FROM_SCRATCH",
      },
    ]);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ row: 2, field: "keyword" }),
        expect.objectContaining({ row: 2, field: "mode" }),
        expect.objectContaining({
          row: 3,
          field: "reference_url",
          message: expect.stringContaining("requires"),
        }),
        expect.objectContaining({
          row: 4,
          field: "keyword",
          message: expect.stringContaining("duplicates row 3"),
        }),
        expect.objectContaining({
          row: 4,
          field: "reference_url",
          message: expect.stringContaining("HTTPS YouTube"),
        }),
        expect.objectContaining({ row: 4, field: "source_mode" }),
      ]),
    );
  });
  it("accepts a valid YouTube rewrite", () => {
    expect(
      validateKeywordCsvRows([
        {
          keyword: "Fix Drive",
          channel: "",
          steps: "",
          reference_url: "https://youtu.be/example",
          mode: "SIX_MIN",
          source_mode: "TRANSCRIPT_REWRITE",
        },
      ]),
    ).toEqual([]);
  });
});
