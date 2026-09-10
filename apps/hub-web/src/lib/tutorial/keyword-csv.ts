export const KEYWORD_CSV_COLUMNS = [
  "keyword",
  "channel",
  "steps",
  "reference_url",
  "mode",
  "source_mode",
] as const;

export interface KeywordCsvRow {
  keyword: string;
  channel: string;
  steps: string;
  reference_url: string;
  mode: string;
  source_mode: string;
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
      if (char === '"' && input[index + 1] === '"') { field += '"'; index++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { record.push(field); field = ""; }
    else if (char === "\n") { record.push(field.replace(/\r$/, "")); records.push(record); record = []; field = ""; }
    else field += char;
  }
  if (quoted) throw new Error("The CSV ends inside a quoted field. Close the final quote and try again.");
  if (field || record.length) { record.push(field.replace(/\r$/, "")); records.push(record); }
  const nonEmpty = records.filter(row => row.some(cell => cell.trim()));
  if (!nonEmpty.length) return [];
  const headers = nonEmpty[0]!.map(value => value.trim().toLowerCase().replace(/[\s-]+/g, "_"));
  if (!headers.includes("keyword")) throw new Error('The required "keyword" column is missing. Download the template to see the accepted format.');
  const indexOf = (name: string) => headers.indexOf(name);
  return nonEmpty.slice(1).map((cells) => ({
    keyword: cells[indexOf("keyword")]?.trim() ?? "",
    channel: cells[indexOf("channel")]?.trim() ?? "",
    steps: cells[indexOf("steps")]?.trim() ?? "",
    reference_url: cells[indexOf("reference_url")]?.trim() ?? "",
    mode: cells[indexOf("mode")]?.trim().toUpperCase() ?? "",
    source_mode: cells[indexOf("source_mode")]?.trim().toUpperCase() ?? "",
  }));
}

export function keywordCsvTemplate(): string {
  return [
    KEYWORD_CSV_COLUMNS.join(","),
    'How to add radio buttons in DocuSign,GuideRealm,"Open Templates; add radio buttons; save",,THREE_MIN,FROM_SCRATCH',
    'How to import a Canva design,GuideRealm,,,THREE_MIN,FROM_SCRATCH',
  ].join("\r\n");
}
