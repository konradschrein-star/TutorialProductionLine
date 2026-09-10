"use client";

import { useRef, useState, type CSSProperties } from "react";
import { toast } from "sonner";
import { V2Button } from "../../_components";
import {
  KEYWORD_INTAKE_MODES,
  KEYWORD_SOURCE_MODES,
  keywordCsvTemplate,
  parseKeywordCsv,
  validateKeywordCsvRows,
  type KeywordCsvRow,
  type KeywordCsvValidationError,
} from "@/lib/tutorial/keyword-csv";

type Row = KeywordCsvRow & { id: string };
type Channel = { id: string; name: string; language: string };
type IntakeMethod = "manual" | "csv";

const emptyRow = (): Row => ({
  id: crypto.randomUUID(),
  keyword: "",
  channel: "",
  steps: "",
  reference_url: "",
  mode: "THREE_MIN",
  source_mode: "FROM_SCRATCH",
});
const input: CSSProperties = {
  width: "100%",
  minHeight: 44,
  border: "1px solid var(--v2-border-1)",
  borderRadius: 8,
  background: "var(--v2-surface-1)",
  color: "var(--v2-text-1)",
  padding: "9px 11px",
  fontSize: 13,
};
const label: CSSProperties = {
  display: "grid",
  gap: 6,
  fontSize: 13,
  fontWeight: 700,
};

function errorId(error: Pick<KeywordCsvValidationError, "row" | "field">) {
  return `keyword-intake-error-${error.row}-${error.field}`;
}

export function KeywordDirectIntake({ channels }: { channels: Channel[] }) {
  const [method, setMethod] = useState<IntakeMethod>("manual");
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [defaultChannelId, setDefaultChannelId] = useState(
    channels[0]?.id ?? "",
  );
  const [errors, setErrors] = useState<KeywordCsvValidationError[]>([]);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<
    Array<{ row: number; jobId: string; duplicate: boolean }>
  >([]);
  const [batchKey, setBatchKey] = useState(() => crypto.randomUUID());
  const errorRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const meaningful = rows.filter(
    (row) =>
      row.keyword.trim() ||
      row.channel.trim() ||
      row.steps.trim() ||
      row.reference_url.trim() ||
      row.mode !== "THREE_MIN" ||
      row.source_mode !== "FROM_SCRATCH",
  );
  const readyCount = meaningful.filter((row) => row.keyword.trim()).length;
  const manualRow = rows[0] ?? emptyRow();
  const patchRow = (id: string, patch: Partial<Row>) => {
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
    setErrors([]);
    setCreated([]);
  };
  const fieldErrors = (row: number, field: keyof KeywordCsvRow) =>
    errors.filter((error) => error.row === row && error.field === field);

  function reset(nextMethod = method) {
    setRows([emptyRow()]);
    setErrors([]);
    setCreated([]);
    setBatchKey(crypto.randomUUID());
    setMethod(nextMethod);
  }

  function switchMethod(nextMethod: IntakeMethod) {
    if (nextMethod === method) return true;
    if (
      meaningful.length &&
      !window.confirm("Discard the keyword intake you have not submitted?")
    )
      return false;
    reset(nextMethod);
    return true;
  }

  async function readFile(file: File) {
    if (file.size > 2_000_000) {
      toast.error("CSV files are limited to 2 MB.");
      return;
    }
    try {
      const parsed = parseKeywordCsv(await file.text());
      if (!parsed.length)
        throw new Error("The CSV has headers but no keyword rows.");
      if (parsed.length > 200)
        throw new Error("Import at most 200 keywords at a time.");
      const nextRows = parsed.map((row) => ({
        ...row,
        id: crypto.randomUUID(),
      }));
      const nextErrors = validateKeywordCsvRows(nextRows);
      setRows(nextRows);
      setErrors(nextErrors);
      setCreated([]);
      setBatchKey(crypto.randomUUID());
      if (nextErrors.length) {
        toast.error(
          `${nextErrors.length} issue${nextErrors.length === 1 ? "" : "s"} must be fixed before import.`,
        );
        queueMicrotask(() => errorRef.current?.focus());
      } else
        toast.success(
          `${parsed.length} keyword${parsed.length === 1 ? "" : "s"} ready to review.`,
        );
    } catch (error) {
      setRows([emptyRow()]);
      setErrors([]);
      setCreated([]);
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  function downloadTemplate() {
    const url = URL.createObjectURL(
      new Blob([keywordCsvTemplate()], { type: "text/csv;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "tutorial-keywords-template.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function submit() {
    if (!defaultChannelId) {
      toast.error("Choose the default destination channel first.");
      return;
    }
    if (!meaningful.length) {
      toast.error(
        method === "manual"
          ? "Enter a keyword first."
          : "Choose a CSV file first.",
      );
      return;
    }
    const clientErrors = validateKeywordCsvRows(meaningful);
    if (clientErrors.length) {
      setErrors(clientErrors);
      queueMicrotask(() => errorRef.current?.focus());
      return;
    }
    setBusy(true);
    setErrors([]);
    setCreated([]);
    try {
      const response = await fetch("/api/production/keywords/bulk-intake", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          batchKey,
          defaultChannelId,
          rows: meaningful.map(({ id: _id, ...row }) => row),
        }),
      });
      const body = await response.json();
      if (!response.ok && response.status !== 207) {
        setErrors(
          body.errors ?? [
            {
              row: 0,
              field: "keyword",
              message: body.error ?? "Import failed.",
            },
          ],
        );
        queueMicrotask(() => errorRef.current?.focus());
        return;
      }
      setCreated(body.created ?? []);
      setErrors(body.errors ?? []);
      if ((body.created?.length ?? 0) > 0)
        toast.success(
          `${body.created.length} tutorial${body.created.length === 1 ? "" : "s"} sent to script preparation.`,
        );
      if (!body.errors?.length) {
        setRows([emptyRow()]);
        setBatchKey(crypto.randomUUID());
      } else queueMicrotask(() => errorRef.current?.focus());
    } catch (error) {
      setErrors([
        {
          row: 0,
          field: "keyword",
          message: error instanceof Error ? error.message : String(error),
        },
      ]);
      queueMicrotask(() => errorRef.current?.focus());
    } finally {
      setBusy(false);
    }
  }

  const describedBy = (row: number, field: keyof KeywordCsvRow) => {
    const found = fieldErrors(row, field);
    return found.length ? found.map(errorId).join(" ") : undefined;
  };
  const inlineErrors = (row: number, field: keyof KeywordCsvRow) =>
    fieldErrors(row, field).map((error) => (
      <span
        key={errorId(error)}
        id={errorId(error)}
        role="alert"
        style={{
          color: "var(--v2-error-soft)",
          fontSize: 11,
          lineHeight: 1.35,
        }}
      >
        {error.message}
      </span>
    ));

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div
        role="tablist"
        aria-label="Direct keyword intake method"
        style={{
          display: "flex",
          gap: 4,
          padding: 4,
          width: "fit-content",
          border: "1px solid var(--v2-border-1)",
          borderRadius: 10,
          background: "var(--v2-surface-2)",
        }}
      >
        {(
          [
            ["manual", "Create manually"],
            ["csv", "Upload CSV"],
          ] as const
        ).map(([value, text]) => (
          <button
            key={value}
            role="tab"
            aria-selected={method === value}
            aria-controls={`keyword-${value}-panel`}
            tabIndex={method === value ? 0 : -1}
            type="button"
            onClick={() => switchMethod(value)}
            onKeyDown={(event) => {
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              const next =
                event.key === "ArrowLeft" || event.key === "Home"
                  ? "manual"
                  : "csv";
              if (switchMethod(next))
                requestAnimationFrame(() =>
                  document
                    .querySelector<HTMLButtonElement>(
                      `[aria-controls="keyword-${next}-panel"]`,
                    )
                    ?.focus(),
                );
            }}
            style={{
              minHeight: 44,
              padding: "8px 14px",
              border: 0,
              borderRadius: 7,
              background: method === value ? "var(--v2-accent)" : "transparent",
              color:
                method === value
                  ? "var(--v2-on-accent, #081018)"
                  : "var(--v2-text-2)",
              fontWeight: 750,
              cursor: "pointer",
            }}
          >
            {text}
          </button>
        ))}
      </div>

      <label style={{ ...label, maxWidth: 460 }}>
        Default destination channel
        <select
          value={defaultChannelId}
          onChange={(event) => {
            setDefaultChannelId(event.target.value);
            setErrors([]);
          }}
          style={input}
        >
          {channels.length === 0 && (
            <option value="">No assigned channels</option>
          )}
          {channels.map((channel) => (
            <option key={channel.id} value={channel.id}>
              {channel.name} ({channel.language.toUpperCase()})
            </option>
          ))}
        </select>
        <span
          style={{ color: "var(--v2-text-2)", fontSize: 12, fontWeight: 400 }}
        >
          Every imported tutorial keeps this destination unless its CSV row
          names another assigned channel.
        </span>
      </label>

      {method === "manual" ? (
        <section
          id="keyword-manual-panel"
          role="tabpanel"
          aria-label="Create one keyword manually"
          style={{
            padding: 20,
            border: "1px solid var(--v2-border-1)",
            borderRadius: 12,
            background: "var(--v2-surface-2)",
            display: "grid",
            gap: 16,
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: 18 }}>Create one tutorial</h2>
            <p
              style={{
                margin: "6px 0 0",
                color: "var(--v2-text-2)",
                fontSize: 13,
                lineHeight: 1.55,
              }}
            >
              Use this when the Keyword Tool is unavailable or you already know
              the topic. The script is generated in the background and still
              requires normal review before recording.
            </p>
          </div>
          <label style={label}>
            Keyword or tutorial topic{" "}
            <span style={{ color: "var(--v2-error-soft)", fontWeight: 500 }}>
              Required
            </span>
            <input
              id="keyword-row-2-keyword"
              value={manualRow.keyword}
              aria-invalid={fieldErrors(2, "keyword").length > 0}
              aria-describedby={describedBy(2, "keyword")}
              onChange={(event) =>
                patchRow(manualRow.id, { keyword: event.target.value })
              }
              placeholder="How to add radio buttons in DocuSign"
              style={input}
            />
            {inlineErrors(2, "keyword")}
          </label>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 14,
            }}
          >
            <label style={label}>
              Tutorial length
              <select
                id="keyword-row-2-mode"
                value={manualRow.mode}
                aria-invalid={fieldErrors(2, "mode").length > 0}
                aria-describedby={describedBy(2, "mode")}
                onChange={(event) =>
                  patchRow(manualRow.id, { mode: event.target.value })
                }
                style={input}
              >
                {KEYWORD_INTAKE_MODES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
              {inlineErrors(2, "mode")}
            </label>
            <label style={label}>
              Source
              <select
                id="keyword-row-2-source_mode"
                value={manualRow.source_mode}
                aria-invalid={fieldErrors(2, "source_mode").length > 0}
                aria-describedby={describedBy(2, "source_mode")}
                onChange={(event) =>
                  patchRow(manualRow.id, { source_mode: event.target.value })
                }
                style={input}
              >
                {KEYWORD_SOURCE_MODES.map((value) => (
                  <option key={value} value={value}>
                    {value === "FROM_SCRATCH"
                      ? "Explain from scratch"
                      : "Rewrite a reference video"}
                  </option>
                ))}
              </select>
              {inlineErrors(2, "source_mode")}
            </label>
          </div>
          {manualRow.source_mode === "TRANSCRIPT_REWRITE" && (
            <label style={label}>
              YouTube reference URL{" "}
              <span style={{ color: "var(--v2-error-soft)", fontWeight: 500 }}>
                Required for rewrite
              </span>
              <input
                id="keyword-row-2-reference_url"
                type="url"
                value={manualRow.reference_url}
                aria-invalid={fieldErrors(2, "reference_url").length > 0}
                aria-describedby={describedBy(2, "reference_url")}
                onChange={(event) =>
                  patchRow(manualRow.id, { reference_url: event.target.value })
                }
                placeholder="https://www.youtube.com/watch?v=..."
                style={input}
              />
              {inlineErrors(2, "reference_url")}
            </label>
          )}
          <label style={label}>
            Steps or notes{" "}
            <span style={{ color: "var(--v2-text-2)", fontWeight: 400 }}>
              Optional
            </span>
            <textarea
              id="keyword-row-2-steps"
              value={manualRow.steps}
              aria-invalid={fieldErrors(2, "steps").length > 0}
              aria-describedby={describedBy(2, "steps")}
              onChange={(event) =>
                patchRow(manualRow.id, { steps: event.target.value })
              }
              rows={5}
              placeholder="One action per line helps the script match the real workflow."
              style={{ ...input, resize: "vertical" }}
            />
            {inlineErrors(2, "steps")}
          </label>
        </section>
      ) : (
        <section
          id="keyword-csv-panel"
          role="tabpanel"
          aria-label="Upload keyword CSV"
          style={{ display: "grid", gap: 16 }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit, minmax(min(100%, 320px), 1fr))",
              gap: 16,
              alignItems: "stretch",
            }}
          >
            <div
              style={{
                padding: 20,
                border: "1px solid var(--v2-border-1)",
                borderRadius: 12,
                background: "var(--v2-surface-2)",
              }}
            >
              <h2 style={{ margin: 0, fontSize: 18 }}>Upload and validate</h2>
              <p
                style={{
                  margin: "6px 0 16px",
                  color: "var(--v2-text-2)",
                  fontSize: 13,
                  lineHeight: 1.55,
                }}
              >
                Upload up to 200 rows. Nothing is created until every row passes
                validation and you confirm the reviewed preview.
              </p>
              <label style={label}>
                CSV file
                <input
                  ref={fileRef}
                  aria-label="Keyword CSV file"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void readFile(file);
                    event.currentTarget.value = "";
                  }}
                  style={{ ...input, padding: 7 }}
                />
              </label>
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  marginTop: 12,
                  flexWrap: "wrap",
                }}
              >
                <V2Button variant="outline" onClick={downloadTemplate}>
                  Download template
                </V2Button>
                <V2Button
                  variant="outline"
                  onClick={() => fileRef.current?.click()}
                >
                  Choose CSV
                </V2Button>
              </div>
            </div>
            <aside
              style={{
                padding: 20,
                border: "1px solid var(--v2-border-1)",
                borderRadius: 12,
                background: "var(--v2-surface-1)",
                fontSize: 12,
                lineHeight: 1.55,
              }}
            >
              <h2 style={{ margin: "0 0 10px", fontSize: 15 }}>
                Accepted columns
              </h2>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "110px 90px minmax(0,1fr)",
                  gap: "8px 10px",
                }}
              >
                <strong>keyword</strong>
                <span>Required</span>
                <span>Topic or tutorial title</span>
                <code>channel</code>
                <span>Optional</span>
                <span>Exact assigned channel name or ID</span>
                <code>steps</code>
                <span>Optional</span>
                <span>Semicolon or multiline instructions</span>
                <code>reference_url</code>
                <span>Optional</span>
                <span>HTTPS YouTube URL</span>
                <code>mode</code>
                <span>Optional</span>
                <span>Defaults to THREE_MIN</span>
                <code>source_mode</code>
                <span>Optional</span>
                <span>Inferred from reference URL</span>
              </div>
              <p style={{ margin: "12px 0 0", color: "var(--v2-text-2)" }}>
                Quoted commas and multiline cells work. A rewrite requires a
                YouTube URL. Duplicate topics for the same channel are rejected
                before any job is created.
              </p>
            </aside>
          </div>

          {meaningful.length > 0 && (
            <div
              style={{
                overflowX: "auto",
                border: "1px solid var(--v2-border-1)",
                borderRadius: 12,
              }}
            >
              <table
                style={{
                  width: "100%",
                  minWidth: 1080,
                  borderCollapse: "collapse",
                  fontSize: 12,
                }}
              >
                <caption
                  style={{
                    textAlign: "left",
                    padding: 12,
                    color: "var(--v2-text-2)",
                  }}
                >
                  Review imported rows before creating tutorials.
                </caption>
                <thead>
                  <tr
                    style={{
                      textAlign: "left",
                      background: "var(--v2-surface-2)",
                    }}
                  >
                    {[
                      "Row",
                      "Keyword (required)",
                      "Channel override",
                      "Steps",
                      "Reference URL",
                      "Mode",
                      "Source",
                      "Action",
                    ].map((text) => (
                      <th key={text} scope="col" style={{ padding: 10 }}>
                        {text}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => {
                    const rowNumber = index + 2;
                    return (
                      <tr
                        key={row.id}
                        style={{
                          borderTop: "1px solid var(--v2-border-1)",
                          verticalAlign: "top",
                        }}
                      >
                        <th
                          scope="row"
                          style={{ padding: 10, color: "var(--v2-text-2)" }}
                        >
                          {rowNumber}
                        </th>
                        <td style={{ padding: 8, minWidth: 260 }}>
                          <input
                            id={`keyword-row-${rowNumber}-keyword`}
                            aria-label={`Keyword row ${rowNumber}`}
                            aria-invalid={
                              fieldErrors(rowNumber, "keyword").length > 0
                            }
                            aria-describedby={describedBy(rowNumber, "keyword")}
                            value={row.keyword}
                            onChange={(event) =>
                              patchRow(row.id, { keyword: event.target.value })
                            }
                            style={input}
                          />
                          {inlineErrors(rowNumber, "keyword")}
                        </td>
                        <td style={{ padding: 8, minWidth: 190 }}>
                          <input
                            id={`keyword-row-${rowNumber}-channel`}
                            list="keyword-channel-options"
                            aria-label={`Channel row ${rowNumber}`}
                            aria-invalid={
                              fieldErrors(rowNumber, "channel").length > 0
                            }
                            aria-describedby={describedBy(rowNumber, "channel")}
                            value={row.channel}
                            placeholder="Use default"
                            onChange={(event) =>
                              patchRow(row.id, { channel: event.target.value })
                            }
                            style={input}
                          />
                          {inlineErrors(rowNumber, "channel")}
                        </td>
                        <td style={{ padding: 8, minWidth: 220 }}>
                          <input
                            id={`keyword-row-${rowNumber}-steps`}
                            aria-label={`Steps row ${rowNumber}`}
                            aria-invalid={
                              fieldErrors(rowNumber, "steps").length > 0
                            }
                            aria-describedby={describedBy(rowNumber, "steps")}
                            value={row.steps}
                            placeholder="Optional"
                            onChange={(event) =>
                              patchRow(row.id, { steps: event.target.value })
                            }
                            style={input}
                          />
                          {inlineErrors(rowNumber, "steps")}
                        </td>
                        <td style={{ padding: 8, minWidth: 240 }}>
                          <input
                            id={`keyword-row-${rowNumber}-reference_url`}
                            aria-label={`Reference URL row ${rowNumber}`}
                            aria-invalid={
                              fieldErrors(rowNumber, "reference_url").length > 0
                            }
                            aria-describedby={describedBy(
                              rowNumber,
                              "reference_url",
                            )}
                            type="url"
                            value={row.reference_url}
                            placeholder="Optional YouTube URL"
                            onChange={(event) =>
                              patchRow(row.id, {
                                reference_url: event.target.value,
                                ...(!row.source_mode ||
                                row.source_mode === "FROM_SCRATCH"
                                  ? {
                                      source_mode: event.target.value
                                        ? "TRANSCRIPT_REWRITE"
                                        : "FROM_SCRATCH",
                                    }
                                  : {}),
                              })
                            }
                            style={input}
                          />
                          {inlineErrors(rowNumber, "reference_url")}
                        </td>
                        <td style={{ padding: 8 }}>
                          <select
                            id={`keyword-row-${rowNumber}-mode`}
                            aria-label={`Mode row ${rowNumber}`}
                            aria-invalid={
                              fieldErrors(rowNumber, "mode").length > 0
                            }
                            aria-describedby={describedBy(rowNumber, "mode")}
                            value={row.mode || "THREE_MIN"}
                            onChange={(event) =>
                              patchRow(row.id, { mode: event.target.value })
                            }
                            style={input}
                          >
                            {KEYWORD_INTAKE_MODES.map((value) => (
                              <option key={value}>{value}</option>
                            ))}
                          </select>
                          {inlineErrors(rowNumber, "mode")}
                        </td>
                        <td style={{ padding: 8 }}>
                          <select
                            id={`keyword-row-${rowNumber}-source_mode`}
                            aria-label={`Source mode row ${rowNumber}`}
                            aria-invalid={
                              fieldErrors(rowNumber, "source_mode").length > 0
                            }
                            aria-describedby={describedBy(
                              rowNumber,
                              "source_mode",
                            )}
                            value={
                              row.source_mode ||
                              (row.reference_url
                                ? "TRANSCRIPT_REWRITE"
                                : "FROM_SCRATCH")
                            }
                            onChange={(event) =>
                              patchRow(row.id, {
                                source_mode: event.target.value,
                              })
                            }
                            style={input}
                          >
                            {KEYWORD_SOURCE_MODES.map((value) => (
                              <option key={value}>{value}</option>
                            ))}
                          </select>
                          {inlineErrors(rowNumber, "source_mode")}
                        </td>
                        <td style={{ padding: 8 }}>
                          <button
                            type="button"
                            aria-label={`Remove row ${rowNumber}`}
                            onClick={() => {
                              setRows((current) =>
                                current.length === 1
                                  ? [emptyRow()]
                                  : current.filter(
                                      (item) => item.id !== row.id,
                                    ),
                              );
                              setErrors([]);
                              setCreated([]);
                            }}
                            style={{
                              minWidth: 76,
                              minHeight: 44,
                              borderRadius: 8,
                              border: "1px solid var(--v2-border-1)",
                              background: "transparent",
                              color: "var(--v2-error-soft)",
                              cursor: "pointer",
                            }}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <datalist id="keyword-channel-options">
                {channels.map((channel) => (
                  <option key={channel.id} value={channel.name} />
                ))}
              </datalist>
            </div>
          )}
        </section>
      )}

      {errors.length > 0 && (
        <div
          ref={errorRef}
          tabIndex={-1}
          role="alert"
          aria-labelledby="keyword-intake-error-title"
          style={{
            padding: 14,
            border: "1px solid var(--v2-error-soft)",
            borderRadius: 10,
            background:
              "color-mix(in srgb, var(--v2-error-soft) 8%, transparent)",
          }}
        >
          <strong id="keyword-intake-error-title">
            {created.length
              ? "Some rows still need attention."
              : "Nothing was imported. Fix these issues first."}
          </strong>
          <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
            {errors.map((error, index) => (
              <li key={`${error.row}-${error.field}-${index}`}>
                {error.row ? (
                  <a
                    href={`#keyword-row-${error.row}-${error.field}`}
                    style={{ color: "inherit", textDecoration: "underline" }}
                  >
                    Row {error.row}, {error.field}
                  </a>
                ) : (
                  error.field
                )}
                : {error.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {created.length > 0 && (
        <div
          role="status"
          aria-live="polite"
          style={{
            padding: 14,
            border: "1px solid var(--v2-accent)",
            borderRadius: 10,
          }}
        >
          <strong>
            {created.length} tutorials entered script preparation.
          </strong>{" "}
          They remain in the normal script review and recording workflow.{" "}
          <a
            href="/tutorial-studio?tab=create"
            style={{ color: "var(--v2-accent)" }}
          >
            Open Prepare scripts
          </a>
        </div>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <span style={{ color: "var(--v2-text-2)", fontSize: 12 }}>
          {readyCount} keyword{readyCount === 1 ? "" : "s"} ready. Jobs are
          owned by your signed-in account; channel access is rechecked on the
          server.
        </span>
        <V2Button
          variant="accent"
          disabled={busy || !readyCount || !defaultChannelId}
          onClick={() => void submit()}
        >
          {busy
            ? "Validating and queueing..."
            : method === "manual"
              ? "Create tutorial"
              : `Import ${readyCount || ""} keyword${readyCount === 1 ? "" : "s"}`}
        </V2Button>
      </div>
    </div>
  );
}
