"use client";

import { useEffect, useState } from "react";
import { Card, PersonaChip, StatusPill } from "../_components/atoms";
import { IngestModal } from "../_components/ingest-modal";
import type { CfData, CfSource } from "../_lib/types";
import { personaMeta } from "../_lib/display";

interface Props {
  data: CfData;
  onChange: () => void;
  onOpenSource: (fullId: string) => void;
}

export function SourcesScreen({ data, onChange, onOpenSource }: Props) {
  const sources = data.sources;
  const [selId, setSelId] = useState<string>(sources[0]?.id ?? "");
  const [ingestOpen, setIngestOpen] = useState(false);

  // Keep the selected row in sync as the live feed updates.
  useEffect(() => {
    if (!selId && sources[0]) setSelId(sources[0].id);
  }, [sources, selId]);

  const sel: CfSource | undefined = sources.find((s) => s.id === selId);

  return (
    <div style={{ display: "flex", height: "100%" }}>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          borderRight: "1px solid #1d232a",
        }}
      >
        <div
          style={{
            flex: "0 0 auto",
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "9px 16px",
            borderBottom: "1px solid #1d232a",
            background: "#0b0e12",
          }}
        >
          <span style={{ fontSize: 11, fontWeight: 600 }}>Ingest Sources</span>
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 10,
              color: "#7d8893",
            }}
          >
            {sources.length} total
          </span>
          <span style={{ flex: 1 }} />
          <span
            style={{
              fontSize: 10,
              color: "#7d8893",
              fontFamily: "'IBM Plex Mono', monospace",
            }}
          >
            tip: double-click a row to see every clip from that source
          </span>
          <button
            onClick={() => setIngestOpen(true)}
            style={{
              border: "1px solid #3f4954",
              background: "#1a212a",
              color: "#eef1f4",
              borderRadius: 5,
              padding: "4px 11px",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 11,
            }}
          >
            + add source · URL or upload
          </button>
        </div>
        <IngestModal
          open={ingestOpen}
          onClose={() => setIngestOpen(false)}
          onIngested={onChange}
        />
        <div
          style={{
            flex: "0 0 auto",
            display: "grid",
            gridTemplateColumns:
              "minmax(170px,1fr) 124px 64px 100px 50px 124px 86px",
            padding: "7px 16px",
            borderBottom: "1px solid #1d232a",
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 9,
            letterSpacing: ".06em",
            color: "#59616a",
            background: "#0b0e12",
          }}
        >
          <span>SOURCE TITLE</span>
          <span>PERSONA</span>
          <span>DUR</span>
          <span>STATUS</span>
          <span>CLIPS</span>
          <span>DEDUP</span>
          <span style={{ textAlign: "right" }}>DATE</span>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          {sources.length === 0 ? (
            <EmptySources />
          ) : (
            sources.map((s) => {
              const pm = personaMeta(s.persona);
              const active = s.id === selId;
              return (
                <div
                  key={s.id}
                  onClick={() => setSelId(s.id)}
                  onDoubleClick={() => onOpenSource(s.fullId)}
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "minmax(170px,1fr) 124px 64px 100px 50px 124px 86px",
                    alignItems: "center",
                    padding: "7px 16px 7px 14px",
                    borderBottom: "1px solid #14181d",
                    borderLeft: `2px solid ${pm.color}`,
                    cursor: "pointer",
                    background: active ? "#13181f" : "transparent",
                  }}
                  title="Double-click to open all clips for this source"
                >
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 11.5,
                      color: "#cfd4da",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {s.title}
                  </span>
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 7,
                      minWidth: 0,
                    }}
                  >
                    <PersonaChip name={s.persona} size={18} />
                    <span
                      style={{
                        fontSize: 10.5,
                        color: "#9aa1a9",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {s.persona}
                    </span>
                  </span>
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 10.5,
                      color: "#7d8893",
                    }}
                  >
                    {fmtDur(s.dur)}
                  </span>
                  <span>
                    <StatusPill status={s.status} />
                  </span>
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 11,
                      color: "#cfd4da",
                    }}
                  >
                    {s.clips}
                  </span>
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 10,
                      color: "#b388c9",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {s.dupOf ?? ""}
                  </span>
                  <span
                    style={{
                      textAlign: "right",
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 10,
                      color: "#7d8893",
                    }}
                  >
                    {s.date}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div style={{ width: 344, flex: "0 0 344px", overflow: "auto" }}>
        {sel ? (
          <SourceInspector
            sel={sel}
            onOpenSource={() => onOpenSource(sel.fullId)}
          />
        ) : null}
      </div>
    </div>
  );
}

function fmtDur(sec: number) {
  if (!sec) return "—";
  const m = Math.floor(sec / 60);
  return m + "m";
}

function EmptySources() {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding: "40px 20px",
        textAlign: "center",
      }}
    >
      <span style={{ fontSize: 14, fontWeight: 600, color: "#cfd4da" }}>
        No sources yet
      </span>
      <span
        style={{
          fontSize: 12,
          color: "#7d8893",
          maxWidth: 360,
          lineHeight: 1.5,
        }}
      >
        Click <span style={{ color: "#eef1f4" }}>+ add source</span> at the top
        right to paste a YouTube watch URL or a Twitch VOD link (
        <span
          style={{ fontFamily: "'IBM Plex Mono', monospace", color: "#9aa1a9" }}
        >
          twitch.tv/videos/&lt;id&gt;
        </span>
        ). The worker will download, transcribe, and surface clippable moments.
      </span>
    </div>
  );
}

function SourceInspector({
  sel,
  onOpenSource,
}: {
  sel: CfSource;
  onOpenSource: () => void;
}) {
  const [mining, setMining] = useState(false);
  const [mineStatus, setMineStatus] = useState<string>("");

  async function onMineClips() {
    setMining(true);
    setMineStatus("");
    try {
      const r = await fetch(`/api/v1/clip-forge/sources/${sel.fullId}/mine`, {
        method: "POST",
      });
      if (!r.ok) {
        const t = await r.text();
        throw new Error(t.slice(0, 200) || r.statusText);
      }
      setMineStatus("Mining queued — clips will appear in the Pool shortly.");
    } catch (e) {
      setMineStatus(`Failed: ${String(e)}`);
    } finally {
      setMining(false);
    }
  }
  return (
    <div
      style={{
        padding: "15px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div>
        <div
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 14,
            fontWeight: 600,
            color: "#eef1f4",
            marginBottom: 5,
          }}
        >
          {sel.title}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <PersonaChip name={sel.persona} size={18} />
          <span style={{ fontSize: 11, color: "#9aa1a9" }}>{sel.persona}</span>
          <StatusPill status={sel.status} />
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 10.5,
              color: "#7d8893",
            }}
          >
            {fmtDur(sel.dur)} · {sel.date}
          </span>
        </div>
        <div
          style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}
        >
          <button
            onClick={onOpenSource}
            style={{
              border: "1px solid #3f4954",
              background: "#1a212a",
              color: "#eef1f4",
              borderRadius: 5,
              padding: "5px 12px",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 11,
              fontWeight: 500,
            }}
          >
            → open {sel.clips} clips
          </button>
          <button
            onClick={onMineClips}
            disabled={mining || (sel.status !== "extracted" && !sel.words)}
            title={
              sel.status === "ingested"
                ? "Source is still ingesting — wait for transcription"
                : "Re-mine clips from this source's transcript"
            }
            style={{
              border: "1px solid #3f4954",
              background: mining ? "#10141a" : "#1a212a",
              color: mining ? "#7d8893" : "#eef1f4",
              borderRadius: 5,
              padding: "5px 12px",
              cursor: mining ? "default" : "pointer",
              fontFamily: "inherit",
              fontSize: 11,
              fontWeight: 500,
              opacity: sel.status === "ingested" || !sel.words ? 0.5 : 1,
            }}
          >
            {mining ? "queuing…" : "⛏ mine clips"}
          </button>
          {mineStatus && (
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10.5,
                color: mineStatus.startsWith("Failed") ? "#cf7468" : "#9bb1e0",
                alignSelf: "center",
              }}
            >
              {mineStatus}
            </span>
          )}
        </div>
      </div>

      {sel.downloaded ? (
        <div
          style={{
            position: "relative",
            width: "100%",
            height: 176,
            borderRadius: 7,
            overflow: "hidden",
            backgroundImage:
              "repeating-linear-gradient(135deg,#171c23 0 7px,#12161c 7px 14px)",
            border: "1px solid #232a32",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: 0,
              height: 0,
              borderLeft: "17px solid #6b7480",
              borderTop: "11px solid transparent",
              borderBottom: "11px solid transparent",
              marginLeft: 5,
            }}
          />
          <span
            style={{
              position: "absolute",
              top: 8,
              left: 9,
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 8.5,
              color: "#7d8893",
            }}
          >
            {sel.res} · {sel.fps}fps
          </span>
          <span
            style={{
              position: "absolute",
              bottom: 8,
              right: 9,
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 8.5,
              color: "#7d8893",
            }}
          >
            {fmtDur(sel.dur)}
          </span>
        </div>
      ) : (
        <div
          style={{
            width: "100%",
            height: 176,
            borderRadius: 7,
            border: "1px dashed #2b333c",
            background: "#0c0f13",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 11,
          }}
        >
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 10.5,
              color: "#7d8893",
            }}
          >
            queued — worker has not downloaded yet
          </span>
          <a
            href={`https://${sel.url}`}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              textDecoration: "none",
              border: "1px solid #34425c",
              background: "rgba(123,147,212,.08)",
              color: "#9bb1e0",
              borderRadius: 6,
              padding: "7px 14px",
              fontSize: 11.5,
              fontFamily: "'IBM Plex Mono', monospace",
            }}
          >
            ↗ open original · {sel.url}
          </a>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
        {[
          ["RESOLUTION", sel.res],
          ["CODEC · FPS", sel.fps ? `${sel.codec} · ${sel.fps}` : sel.codec],
          ["SIZE", sel.sizeMB ? `${sel.sizeMB} MB` : "—"],
          ["SOURCE TYPE", sel.kind],
        ].map(([label, value]) => (
          <Card key={label} pad={10} style={{ borderRadius: 6 }}>
            <div
              style={{
                fontSize: 8.5,
                letterSpacing: ".1em",
                color: "#59616a",
                fontFamily: "'IBM Plex Mono', monospace",
              }}
            >
              {label}
            </div>
            <div
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 11.5,
                color: "#cfd4da",
                marginTop: 2,
              }}
            >
              {value || "—"}
            </div>
          </Card>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 10,
          }}
        >
          <span style={{ color: "#59616a", width: 78 }}>audio fp</span>
          <span style={{ color: "#9aa1a9", flex: 1 }}>{sel.fp}</span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 10,
          }}
        >
          <span style={{ color: "#59616a", width: 78 }}>original</span>
          <a
            href={`https://${sel.url}`}
            target="_blank"
            rel="noreferrer"
            style={{
              color: "#7b93d4",
              flex: 1,
              textDecoration: "none",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            ↗ {sel.url}
          </a>
        </div>
      </div>

      <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
        {sel.deleted && (
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 10,
              color: "#7d8893",
              border: "1px solid #2b333c",
              borderRadius: 4,
              padding: "3px 9px",
            }}
          >
            ⊘ source video deleted
          </span>
        )}
        {sel.words && (
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 10,
              color: "#7fc79b",
              border: "1px solid #2c5e42",
              borderRadius: 4,
              padding: "3px 9px",
            }}
          >
            ✓ word-timing available
          </span>
        )}
        {sel.dupOf && (
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 10,
              color: "#c89dd6",
              border: "1px solid #5a4654",
              borderRadius: 4,
              padding: "3px 9px",
            }}
          >
            ⎘ fingerprint dupe of {sel.dupOf}
          </span>
        )}
      </div>
    </div>
  );
}
