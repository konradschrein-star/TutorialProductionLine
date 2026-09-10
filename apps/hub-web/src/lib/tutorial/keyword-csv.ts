export const KEYWORD_CSV_COLUMNS = [
  "keyword",
  "channel",
  "steps",
  "reference_url",
  "mode",
  "source_mode",
] as const;

export const KEYWORD_CSV_REQUIRED_COLUMNS = ["keyword"] as const;
export const KEYWORD_CSV_OPTIONAL_COLUMNS = [
  "channel",
  "steps",
  "reference_url",
  "mode",
  "source_mode",
] as const;

export const KEYWORD_INTAKE_MODES = [
  "THREE_MIN",
  "SIX_MIN",
  "SHORT_MATCH",
  "SHORT_PLUS",
] as const;

export const KEYWORD_SOURCE_MODES = [
  "FROM_SCRATCH",
  "TRANSCRIPT_REWRITE",
] as const;

export interface KeywordCsvRow {
  keyword: string;
  channel: string;
  steps: string;
  reference_url: string;
  mode: string;
  source_mode: string;
}

export interface KeywordCsvValidationError {
  /** Spreadsheet row number. Row 1 is the header. */
  row: number;
  field: keyof KeywordCsvRow;
  message: string;
}

function normalizedHeader(value: string, index: number): string {
  const withoutBom = index === 0 ? value.replace(/^\uFEFF/, "") : value;
  return withoutBom
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function isYouTubeReference(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  return (
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    (hostname === "youtu.be" ||
      hostname === "youtube.com" ||
      hostname.endsWith(".youtube.com"))
  );
}

/** RFC-4180-style parser: quoted commas, escaped quotes, and line breaks work. */
export function parseKeywordCsv(input: string): KeywordCsvRow[] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < input.length; index++) {
    const char = input[index]!;
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        field += '"';
        index++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      record.push(field);
      field = "";
    } else if (char === "\n") {
      record.push(field.replace(/\r$/, ""));
      records.push(record);
      record = [];
      field = "";
    } else field += char;
  }
  if (quoted)
    throw new Error(
      "The CSV ends inside a quoted field. Close the final quote and try again.",
    );
  if (field || record.length) {
    record.push(field.replace(/\r$/, ""));
    records.push(record);
  }
  const nonEmpty = records.filter((row) => row.some((cell) => cell.trim()));
  if (!nonEmpty.length) return [];
  const headers = nonEmpty[0]!.map(normalizedHeader);
  if (headers.some((header) => !header))
    throw new Error("Every CSV column needs a header.");
  const duplicateHeader = headers.find(
    (header, index) => headers.indexOf(header) !== index,
  );
  if (duplicateHeader)
    throw new Error(
      `The CSV contains the column "${duplicateHeader}" more than once.`,
    );
  if (!headers.includes("keyword"))
    throw new Error(
      'The required "keyword" column is missing. Download the template to see the accepted format.',
    );
  const unknown = headers.filter(
    (header) =>
      !KEYWORD_CSV_COLUMNS.includes(
        header as (typeof KEYWORD_CSV_COLUMNS)[number],
      ),
  );
  if (unknown.length)
    throw new Error(
      `Unknown CSV column${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}. Download the template for the accepted columns.`,
    );
  const indexOf = (name: string) => headers.indexOf(name);
  return nonEmpty.slice(1).map((cells, index) => {
    if (cells.slice(headers.length).some((cell) => cell.trim())) {
      throw new Error(
        `CSV row ${index + 2} has more values than the header. Quote values that contain commas.`,
      );
    }
    return {
      keyword: cells[indexOf("keyword")]?.trim() ?? "",
      channel: cells[indexOf("channel")]?.trim() ?? "",
      steps: cells[indexOf("steps")]?.trim() ?? "",
      reference_url: cells[indexOf("reference_url")]?.trim() ?? "",
      mode: cells[indexOf("mode")]?.trim().toUpperCase() ?? "",
      source_mode: cells[indexOf("source_mode")]?.trim().toUpperCase() ?? "",
    };
  });
}

/**
 * Fast, side-effect-free validation used before upload. The API repeats these
 * checks with channel authorization because browser validation is guidance,
 * never a trust boundary.
 */
export function validateKeywordCsvRows(
  rows: readonly KeywordCsvRow[],
): KeywordCsvValidationError[] {
  const errors: KeywordCsvValidationError[] = [];
  const seen = new Map<string, number>();
  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const keyword = row.keyword.trim();
    if (!keyword)
      errors.push({
        row: rowNumber,
        field: "keyword",
        message: "Enter a keyword or remove this row.",
      });
    else if (keyword.length > 300)
      errors.push({
        row: rowNumber,
        field: "keyword",
        message: "Keep the keyword at 300 characters or fewer.",
      });
    if (row.channel.length > 200)
      errors.push({
        row: rowNumber,
        field: "channel",
        message: "Keep the channel name at 200 characters or fewer.",
      });
    if (row.steps.length > 100_000)
      errors.push({
        row: rowNumber,
        field: "steps",
        message: "Keep steps and notes at 100,000 characters or fewer.",
      });
    if (row.reference_url.length > 2_000)
      errors.push({
        row: rowNumber,
        field: "reference_url",
        message: "Keep the reference URL at 2,000 characters or fewer.",
      });

    const duplicateKey = `${row.channel.trim().toLocaleLowerCase("en")}\u0000${keyword.toLocaleLowerCase("en")}`;
    const firstRow = keyword ? seen.get(duplicateKey) : undefined;
    if (firstRow)
      errors.push({
        row: rowNumber,
        field: "keyword",
        message: `This duplicates row ${firstRow} for the same channel.`,
      });
    else if (keyword) seen.set(duplicateKey, rowNumber);

    const selectedMode = row.mode.trim().toUpperCase();
    if (
      selectedMode &&
      !KEYWORD_INTAKE_MODES.includes(
        selectedMode as (typeof KEYWORD_INTAKE_MODES)[number],
      )
    ) {
      errors.push({
        row: rowNumber,
        field: "mode",
        message: `Use ${KEYWORD_INTAKE_MODES.join(", ")}.`,
      });
    }
    const selectedSource =
      row.source_mode.trim().toUpperCase() ||
      (row.reference_url.trim() ? "TRANSCRIPT_REWRITE" : "FROM_SCRATCH");
    if (
      !KEYWORD_SOURCE_MODES.includes(
        selectedSource as (typeof KEYWORD_SOURCE_MODES)[number],
      )
    ) {
      errors.push({
        row: rowNumber,
        field: "source_mode",
        message: `Use ${KEYWORD_SOURCE_MODES.join(" or ")}.`,
      });
    }
    const reference = row.reference_url.trim();
    if (reference && !isYouTubeReference(reference)) {
      errors.push({
        row: rowNumber,
        field: "reference_url",
        message: "Use a complete HTTPS YouTube URL.",
      });
    }
    if (selectedSource === "TRANSCRIPT_REWRITE" && !reference) {
      errors.push({
        row: rowNumber,
        field: "reference_url",
        message: "Transcript rewrite requires a YouTube reference URL.",
      });
    } else if (selectedSource === "FROM_SCRATCH" && reference) {
      errors.push({
        row: rowNumber,
        field: "source_mode",
        message: "Choose TRANSCRIPT_REWRITE when a reference URL is present.",
      });
    }
  });
  return errors;
}

export function keywordCsvTemplate(): string {
  return [
    KEYWORD_CSV_COLUMNS.join(","),
    'How to add radio buttons in DocuSign,GuideRealm,"Open Templates; add radio buttons; save",,THREE_MIN,FROM_SCRATCH',
    "How to import a Canva design,GuideRealm,,,THREE_MIN,FROM_SCRATCH",
  ].join("\r\n");
}
