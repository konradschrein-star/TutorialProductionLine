"use client";

import { useState } from "react";
import { PersonaChip } from "../_components/atoms";
import type { CfData } from "../_lib/types";

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <span
      onClick={onClick}
      style={{
        width: 26,
        height: 15,
        borderRadius: 9,
        background: on ? "#3a5e47" : "#2b333c",
        position: "relative",
        cursor: "pointer",
        flex: "0 0 auto",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 1,
          left: on ? 12 : 1,
          width: 12,
          height: 12,
          borderRadius: "50%",
          background: "#dfe3e8",
          transition: "left .12s",
        }}
      />
    </span>
  );
}

function Section({
  dot,
  title,
  sub,
  fullWidth,
  children,
}: {
  dot: string;
  title: string;
  sub?: string;
  fullWidth?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        gridColumn: fullWidth ? "1 / -1" : undefined,
        border: "1px solid #1d232a",
        borderRadius: 8,
        background: "#0e1217",
        padding: "15px 16px",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: ".02em",
          marginBottom: sub ? 4 : 13,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span
          style={{ width: 6, height: 6, borderRadius: "50%", background: dot }}
        />
        {title}
        {sub && (
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 9.5,
              color: "#59616a",
              fontWeight: 400,
            }}
          >
            · {sub}
          </span>
        )}
      </div>
      {sub && (
        <div style={{ fontSize: 10.5, color: "#6b727b", marginBottom: 13 }} />
      )}
      {children}
    </div>
  );
}

export function ConfigScreen({ data }: { data: CfData }) {
  const [scope, setScope] = useState<"persona" | "global">("persona");
  const [score, setScore] = useState(30);
  const [cutPauses, setCutPauses] = useState(true);
  const [pauseMin, setPauseMin] = useState(400);
  const [fadeMs, setFadeMs] = useState(60);
  const [blurBars, setBlurBars] = useState(true);
  const [splitDetect, setSplitDetect] = useState(true);
  const [saturation, setSaturation] = useState(true);
  const [satAmt, setSatAmt] = useState(18);
  const [sharpness, setSharpness] = useState(true);
  const [sharpAmt, setSharpAmt] = useState(25);
  const [subtitles, setSubtitles] = useState(true);
  const [genCaption, setGenCaption] = useState(true);
  const [ppd, setPpd] = useState(1);
  const [jitter, setJitter] = useState(36);
  const [slotSpread, setSlotSpread] = useState(true);
  const [ttl, setTtl] = useState(48);
  const [watermark, setWatermark] = useState(80);
  const [telegram, setTelegram] = useState(true);
  const [discord, setDiscord] = useState(false);
  const [tts, setTts] = useState(false);
  const [ttsSpeed, setTtsSpeed] = useState(100);
  const [ttsStability, setTtsStability] = useState(55);

  const afterFilter = `saturate(${1 + satAmt / 100}) contrast(${1 + sharpAmt / 200}) brightness(${1 + sharpAmt / 400})`;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div
        style={{
          flex: "0 0 auto",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "9px 16px",
          borderBottom: "1px solid #1d232a",
          background: "#0b0e12",
        }}
      >
        <div
          style={{
            display: "flex",
            border: "1px solid #2b333c",
            borderRadius: 6,
            overflow: "hidden",
          }}
        >
          {(["persona", "global"] as const).map((s, i) => {
            const active = scope === s;
            return (
              <button
                key={s}
                onClick={() => setScope(s)}
                style={{
                  border: 0,
                  borderLeft: i > 0 ? "1px solid #2b333c" : 0,
                  background: active ? "#1a212a" : "transparent",
                  color: active ? "#eef1f4" : "#7d8893",
                  padding: "5px 13px",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: 11,
                }}
              >
                {s === "persona" ? "per persona" : s}
              </button>
            );
          })}
        </div>
        <span style={{ flex: 1 }} />
        <span
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 10,
            color: "#59616a",
          }}
        >
          last change · Konrad · 2h ago · all edits versioned &amp; auditable
        </span>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          padding: 16,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 14,
          alignContent: "start",
        }}
      >
        <Section dot="#7b93d4" title="Detection" fullWidth>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "300px 1fr",
              gap: 20,
              alignItems: "start",
            }}
          >
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 6,
                }}
              >
                <span style={{ fontSize: 11.5, color: "#cfd4da", flex: 1 }}>
                  Score threshold
                </span>
                <span
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 13,
                    color: "#eef1f4",
                  }}
                >
                  {(score / 100).toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={score}
                onChange={(e) => setScore(+e.target.value)}
                style={{ width: "100%" }}
              />
              <div style={{ fontSize: 10.5, color: "#6b727b", marginTop: 5 }}>
                moments below this score are rejected, never rendered
              </div>
            </div>
            <div>
              <div
                style={{
                  fontSize: 9,
                  letterSpacing: ".1em",
                  color: "#59616a",
                  fontFamily: "'IBM Plex Mono', monospace",
                  marginBottom: 7,
                }}
              >
                DEEPSEEK MOMENT-DETECTION PROMPT
              </div>
              <textarea
                defaultValue="Identify clippable moments in this transcript. For each moment return {start, end, score 0..1, reasonCategory (controversial|wisdom|funny|story|hot_take|other), suggestedCaption}. Cuts must land on clean word boundaries. Skip filler."
                style={{
                  width: "100%",
                  height: 72,
                  resize: "none",
                  background: "#0a0d11",
                  border: "1px solid #232a32",
                  borderRadius: 6,
                  color: "#aeb4bb",
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 11,
                  padding: "9px 11px",
                  lineHeight: 1.5,
                  outline: "none",
                }}
              />
            </div>
          </div>
        </Section>

        <Section dot="#b388c9" title="Raw Render" fullWidth>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 296px",
              gap: 24,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ flex: 1, fontSize: 12, color: "#cfd4da" }}>
                    Cut out pauses
                  </span>
                  <Toggle
                    on={cutPauses}
                    onClick={() => setCutPauses(!cutPauses)}
                  />
                </div>
                {cutPauses && (
                  <div
                    style={{
                      marginTop: 9,
                      paddingLeft: 2,
                      display: "flex",
                      flexDirection: "column",
                      gap: 9,
                    }}
                  >
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 10 }}
                    >
                      <span
                        style={{ width: 150, fontSize: 11, color: "#9aa1a9" }}
                      >
                        min pause to cut
                      </span>
                      <input
                        type="range"
                        min={100}
                        max={1500}
                        step={50}
                        value={pauseMin}
                        onChange={(e) => setPauseMin(+e.target.value)}
                        style={{ flex: 1 }}
                      />
                      <span
                        style={{
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: 11,
                          color: "#cfd4da",
                          width: 54,
                          textAlign: "right",
                        }}
                      >
                        {pauseMin}ms
                      </span>
                    </div>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 10 }}
                    >
                      <span
                        style={{ width: 150, fontSize: 11, color: "#9aa1a9" }}
                      >
                        fade attack
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={300}
                        step={10}
                        value={fadeMs}
                        onChange={(e) => setFadeMs(+e.target.value)}
                        style={{ flex: 1 }}
                      />
                      <span
                        style={{
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: 11,
                          color: "#cfd4da",
                          width: 54,
                          textAlign: "right",
                        }}
                      >
                        {fadeMs}ms
                      </span>
                    </div>
                  </div>
                )}
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  borderTop: "1px solid #1d232a",
                  paddingTop: 11,
                }}
              >
                <span style={{ flex: 1, fontSize: 12, color: "#cfd4da" }}>
                  Gaussian blur bars (vs black)
                </span>
                <Toggle on={blurBars} onClick={() => setBlurBars(!blurBars)} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ flex: 1, fontSize: 12, color: "#cfd4da" }}>
                  Split-screen detection
                </span>
                <Toggle
                  on={splitDetect}
                  onClick={() => setSplitDetect(!splitDetect)}
                />
              </div>
              <div style={{ borderTop: "1px solid #1d232a", paddingTop: 11 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ flex: 1, fontSize: 12, color: "#cfd4da" }}>
                    Saturation boost
                  </span>
                  <Toggle
                    on={saturation}
                    onClick={() => setSaturation(!saturation)}
                  />
                </div>
                {saturation && (
                  <div
                    style={{
                      marginTop: 9,
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    <span
                      style={{ width: 150, fontSize: 11, color: "#9aa1a9" }}
                    >
                      amount
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={60}
                      value={satAmt}
                      onChange={(e) => setSatAmt(+e.target.value)}
                      style={{ flex: 1 }}
                    />
                    <span
                      style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: 11,
                        color: "#cfd4da",
                        width: 54,
                        textAlign: "right",
                      }}
                    >
                      +{satAmt}%
                    </span>
                  </div>
                )}
              </div>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ flex: 1, fontSize: 12, color: "#cfd4da" }}>
                    Sharpness boost
                  </span>
                  <Toggle
                    on={sharpness}
                    onClick={() => setSharpness(!sharpness)}
                  />
                </div>
                {sharpness && (
                  <div
                    style={{
                      marginTop: 9,
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    <span
                      style={{ width: 150, fontSize: 11, color: "#9aa1a9" }}
                    >
                      amount
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={80}
                      value={sharpAmt}
                      onChange={(e) => setSharpAmt(+e.target.value)}
                      style={{ flex: 1 }}
                    />
                    <span
                      style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: 11,
                        color: "#cfd4da",
                        width: 54,
                        textAlign: "right",
                      }}
                    >
                      +{sharpAmt}%
                    </span>
                  </div>
                )}
              </div>
            </div>
            <div>
              <div
                style={{
                  fontSize: 9,
                  letterSpacing: ".1em",
                  color: "#59616a",
                  fontFamily: "'IBM Plex Mono', monospace",
                  marginBottom: 8,
                }}
              >
                SATURATION + SHARPNESS PREVIEW
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      height: 150,
                      borderRadius: 6,
                      border: "1px solid #232a32",
                      background:
                        "linear-gradient(135deg,#3d5a73 0%,#6b5340 48%,#3f6b4d 100%)",
                    }}
                  />
                  <div
                    style={{
                      textAlign: "center",
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 9,
                      color: "#59616a",
                      marginTop: 5,
                    }}
                  >
                    before
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      height: 150,
                      borderRadius: 6,
                      border: "1px solid #34425c",
                      background:
                        "linear-gradient(135deg,#3d5a73 0%,#6b5340 48%,#3f6b4d 100%)",
                      filter: afterFilter,
                    }}
                  />
                  <div
                    style={{
                      textAlign: "center",
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 9,
                      color: "#7b93d4",
                      marginTop: 5,
                    }}
                  >
                    after · live
                  </div>
                </div>
              </div>
              <div
                style={{
                  fontSize: 10.5,
                  color: "#6b727b",
                  marginTop: 9,
                  lineHeight: 1.5,
                }}
              >
                preview applies the current saturation &amp; sharpness amounts
                to a sample frame
              </div>
            </div>
          </div>
        </Section>

        <Section dot="#57a578" title="Finishing">
          <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ flex: 1, fontSize: 12, color: "#cfd4da" }}>
                Burn subtitles
              </span>
              <Toggle on={subtitles} onClick={() => setSubtitles(!subtitles)} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ flex: 1, fontSize: 12, color: "#cfd4da" }}>
                Generate caption (DeepSeek)
              </span>
              <Toggle
                on={genCaption}
                onClick={() => setGenCaption(!genCaption)}
              />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ flex: 1, fontSize: 12, color: "#cfd4da" }}>
                Default style preset
              </span>
              <span
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 10.5,
                  color: "#9aa1a9",
                  border: "1px solid #2b333c",
                  borderRadius: 4,
                  padding: "3px 9px",
                }}
              >
                white caps · black border
              </span>
            </div>
            <div style={{ borderTop: "1px solid #1d232a", paddingTop: 11 }}>
              <div
                style={{
                  fontSize: 9,
                  letterSpacing: ".1em",
                  color: "#59616a",
                  fontFamily: "'IBM Plex Mono', monospace",
                  marginBottom: 8,
                }}
              >
                PLATFORM SAFE-ZONE INSETS
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 48px 56px 48px",
                  gap: 5,
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 9,
                  color: "#59616a",
                  marginBottom: 5,
                }}
              >
                <span />
                <span style={{ textAlign: "right" }}>TOP</span>
                <span style={{ textAlign: "right" }}>BOTTOM</span>
                <span style={{ textAlign: "right" }}>RIGHT</span>
              </div>
              {[
                { plat: "TikTok", top: "5%", bottom: "21%", right: "16%" },
                { plat: "Instagram", top: "3%", bottom: "18%", right: "14%" },
                { plat: "YT Shorts", top: "8%", bottom: "22%", right: "14%" },
              ].map((z) => (
                <div
                  key={z.plat}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 48px 56px 48px",
                    gap: 5,
                    padding: "4px 0",
                    alignItems: "center",
                  }}
                >
                  <span style={{ fontSize: 11, color: "#cfd4da" }}>
                    {z.plat}
                  </span>
                  <span
                    style={{
                      textAlign: "right",
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 11,
                      color: "#9aa1a9",
                    }}
                  >
                    {z.top}
                  </span>
                  <span
                    style={{
                      textAlign: "right",
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 11,
                      color: "#9aa1a9",
                    }}
                  >
                    {z.bottom}
                  </span>
                  <span
                    style={{
                      textAlign: "right",
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 11,
                      color: "#9aa1a9",
                    }}
                  >
                    {z.right}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Section>

        <Section dot="#7b93d4" title="Scheduler">
          <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 5,
                }}
              >
                <span style={{ flex: 1, fontSize: 12, color: "#cfd4da" }}>
                  Posts per day / account
                </span>
                <span
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 13,
                    color: "#eef1f4",
                  }}
                >
                  {ppd}
                </span>
              </div>
              <input
                type="range"
                min={1}
                max={8}
                value={ppd}
                onChange={(e) => setPpd(+e.target.value)}
                style={{ width: "100%" }}
              />
            </div>
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 5,
                }}
              >
                <span style={{ flex: 1, fontSize: 12, color: "#cfd4da" }}>
                  Same-clip jitter across accounts
                </span>
                <span
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 13,
                    color: "#eef1f4",
                  }}
                >
                  {jitter}h
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={72}
                value={jitter}
                onChange={(e) => setJitter(+e.target.value)}
                style={{ width: "100%" }}
              />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ flex: 1, fontSize: 12, color: "#cfd4da" }}>
                Spread across daily slots
              </span>
              <Toggle
                on={slotSpread}
                onClick={() => setSlotSpread(!slotSpread)}
              />
            </div>
          </div>
        </Section>

        <Section dot="#cf7468" title="Storage / GC &amp; Alerting">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 5,
                }}
              >
                <span style={{ flex: 1, fontSize: 12, color: "#cfd4da" }}>
                  Finished-clip TTL
                </span>
                <span
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 13,
                    color: "#eef1f4",
                  }}
                >
                  {ttl}h
                </span>
              </div>
              <input
                type="range"
                min={12}
                max={96}
                value={ttl}
                onChange={(e) => setTtl(+e.target.value)}
                style={{ width: "100%" }}
              />
            </div>
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 5,
                }}
              >
                <span style={{ flex: 1, fontSize: 12, color: "#cfd4da" }}>
                  Disk watermark alarm
                </span>
                <span
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 13,
                    color: "#eef1f4",
                  }}
                >
                  {watermark}%
                </span>
              </div>
              <input
                type="range"
                min={60}
                max={95}
                value={watermark}
                onChange={(e) => setWatermark(+e.target.value)}
                style={{ width: "100%", accentColor: "#b388c9" }}
              />
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                borderTop: "1px solid #1d232a",
                paddingTop: 11,
              }}
            >
              <span style={{ flex: 1, fontSize: 12, color: "#cfd4da" }}>
                Telegram alerts
              </span>
              <Toggle on={telegram} onClick={() => setTelegram(!telegram)} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ flex: 1, fontSize: 12, color: "#cfd4da" }}>
                Discord webhook
              </span>
              <Toggle on={discord} onClick={() => setDiscord(!discord)} />
            </div>
          </div>
        </Section>

        <Section
          dot="#6f9e8f"
          title="Text-to-Speech &amp; Voice-over"
          sub="narrated hooks &amp; AI voice captions"
          fullWidth
        >
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ flex: 1, fontSize: 12, color: "#cfd4da" }}>
                  Enable TTS voice-over
                </span>
                <Toggle on={tts} onClick={() => setTts(!tts)} />
              </div>
              <div
                style={{ display: "flex", alignItems: "flex-start", gap: 10 }}
              >
                <span
                  style={{
                    width: 70,
                    fontSize: 11,
                    color: "#9aa1a9",
                    paddingTop: 4,
                  }}
                >
                  voice
                </span>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {[
                    "Rhys · calm",
                    "Avery · upbeat",
                    "Jordan · warm",
                    "Cass · deadpan",
                  ].map((v, i) => (
                    <button
                      key={v}
                      style={{
                        fontSize: 10.5,
                        fontFamily: "'IBM Plex Mono', monospace",
                        border: `1px solid ${i === 0 ? "#3f4954" : "#2b333c"}`,
                        background: i === 0 ? "#1a212a" : "transparent",
                        color: i === 0 ? "#eef1f4" : "#7d8893",
                        borderRadius: 5,
                        padding: "3px 9px",
                        cursor: "pointer",
                      }}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 70, fontSize: 11, color: "#9aa1a9" }}>
                  model
                </span>
                <div
                  style={{
                    display: "flex",
                    border: "1px solid #2b333c",
                    borderRadius: 5,
                    overflow: "hidden",
                  }}
                >
                  {["eleven_v3", "minimax", "edge"].map((m, i) => (
                    <button
                      key={m}
                      style={{
                        border: 0,
                        borderLeft: i > 0 ? "1px solid #2b333c" : 0,
                        background: i === 0 ? "#1a212a" : "transparent",
                        color: i === 0 ? "#eef1f4" : "#7d8893",
                        padding: "3px 11px",
                        cursor: "pointer",
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: 10,
                      }}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
              <div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginBottom: 5,
                  }}
                >
                  <span style={{ flex: 1, fontSize: 12, color: "#cfd4da" }}>
                    Speaking rate
                  </span>
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 13,
                      color: "#eef1f4",
                    }}
                  >
                    {ttsSpeed}%
                  </span>
                </div>
                <input
                  type="range"
                  min={70}
                  max={140}
                  value={ttsSpeed}
                  onChange={(e) => setTtsSpeed(+e.target.value)}
                  style={{ width: "100%" }}
                />
              </div>
              <div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginBottom: 5,
                  }}
                >
                  <span style={{ flex: 1, fontSize: 12, color: "#cfd4da" }}>
                    Voice stability
                  </span>
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 13,
                      color: "#eef1f4",
                    }}
                  >
                    {ttsStability}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={ttsStability}
                  onChange={(e) => setTtsStability(+e.target.value)}
                  style={{ width: "100%" }}
                />
              </div>
              <div
                style={{ fontSize: 10.5, color: "#6b727b", lineHeight: 1.5 }}
              >
                lower stability = more expressive but less consistent across a
                creator&apos;s clips
              </div>
            </div>
          </div>
        </Section>

        <Section dot="#7b93d4" title="Per-account scheduling" fullWidth>
          <div style={{ fontSize: 10.5, color: "#6b727b", marginBottom: 13 }}>
            global jitter standard is{" "}
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                color: "#9aa1a9",
              }}
            >
              {jitter}h
            </span>{" "}
            — accounts below override it where set
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "minmax(140px,1.4fr) 84px 50px 86px 50px 96px 1fr 56px",
              padding: "6px 4px",
              borderBottom: "1px solid #1d232a",
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 9,
              letterSpacing: ".06em",
              color: "#59616a",
            }}
          >
            <span>ACCOUNT</span>
            <span>PLATFORM</span>
            <span>PPD</span>
            <span>JITTER</span>
            <span>SLOTS</span>
            <span>NICHE</span>
            <span>PRESET</span>
            <span style={{ textAlign: "right" }}>STATE</span>
          </div>
          {data.accounts.map((a) => (
            <div
              key={a.id}
              style={{
                display: "grid",
                gridTemplateColumns:
                  "minmax(140px,1.4fr) 84px 50px 86px 50px 96px 1fr 56px",
                alignItems: "center",
                padding: "6px 4px",
                borderBottom: "1px solid #14181d",
              }}
            >
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  minWidth: 0,
                }}
              >
                <PersonaChip name={a.persona} size={19} />
                <span
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 11,
                    color: "#cfd4da",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {a.handle}
                </span>
              </span>
              <span style={{ fontSize: 10.5, color: "#9aa1a9" }}>
                {a.platform}
              </span>
              <span
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 11,
                  color: "#cfd4da",
                }}
              >
                {a.ppd}
              </span>
              <span
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 10.5,
                  color: a.jitter ? "#b388c9" : "#515b66",
                }}
              >
                {a.jitter ? a.jitter + "h" : "default"}
              </span>
              <span
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 11,
                  color: "#cfd4da",
                }}
              >
                {a.slots}
              </span>
              <span
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 10,
                  color: "#9aa1a9",
                }}
              >
                {a.niche}
              </span>
              <span
                style={{
                  fontSize: 10.5,
                  color: "#9aa1a9",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  paddingRight: 8,
                }}
              >
                {a.presetId}
              </span>
              <span
                style={{
                  textAlign: "right",
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 10,
                  color: a.active ? "#57a578" : "#515b66",
                }}
              >
                {a.active ? "active" : "paused"}
              </span>
            </div>
          ))}
        </Section>
      </div>
    </div>
  );
}
