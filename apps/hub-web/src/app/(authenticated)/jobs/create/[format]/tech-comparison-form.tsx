"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createJob } from "@/app/actions/create-job";
import { SubmitButton } from "../_components/submit-button";
import {
  labelStyle,
  inputStyle,
  selectStyle,
  sectionStyle,
} from "../_components/form-field-styles";
import {
  saveJobCreationSession,
  loadJobCreationSession,
} from "@/lib/session-storage";

interface Channel {
  id: string;
  name: string;
  language: string;
}
interface Template {
  id: string;
  name: string;
  format: string;
  description: string | null;
}

interface TechComparisonFormProps {
  channels: Channel[];
  templates: Template[];
}

const SUBFORMATS = [
  { value: "TECH_SOFTWARE", label: "Software / Apps" },
  { value: "TECH_HARDWARE", label: "Hardware / Devices" },
  { value: "TECH_SERVICE", label: "Services / Platforms" },
  { value: "TECH_GENERAL", label: "General Comparison" },
];

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "de", label: "German" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
];

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function TechComparisonForm({
  channels,
  templates,
}: TechComparisonFormProps) {
  const router = useRouter();
  const [productAName, setProductAName] = useState("");
  const [productBName, setProductBName] = useState("");
  const [productCName, setProductCName] = useState("");
  const [includeC, setIncludeC] = useState(false);
  const [subformat, setSubformat] = useState("TECH_SOFTWARE");
  const [channelId, setChannelId] = useState(channels[0]?.id ?? "");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [language, setLanguage] = useState("en");
  const [skipImageQc, setSkipImageQc] = useState(false);
  const [skipFinalQc, setSkipFinalQc] = useState(false);
  // Research gate. Default false = the job parks at AWAITING_RESEARCH until an
  // operator uploads Perplexity research. Mirrors the toggle on the
  // /formats/tech-comparison ingestion panel, which was previously the ONLY
  // surface that could set it — so every job created here parked silently.
  const [skipResearch, setSkipResearch] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const saved = loadJobCreationSession();
    if (!saved) return;
    if (saved.channel_id && channels.find((c) => c.id === saved.channel_id))
      setChannelId(saved.channel_id);
    if (saved.template_id && templates.find((t) => t.id === saved.template_id))
      setTemplateId(saved.template_id);
    if (saved.language) setLanguage(saved.language);
    if (saved.skip_image_qc !== undefined) setSkipImageQc(saved.skip_image_qc!);
    if (saved.skip_final_qc !== undefined) setSkipFinalQc(saved.skip_final_qc!);
  }, []);

  useEffect(() => {
    saveJobCreationSession({
      selectedFormat: "TECH_COMPARISON",
      channel_id: channelId,
      template_id: templateId,
      language,
      skip_image_qc: skipImageQc,
      skip_final_qc: skipFinalQc,
    });
  }, [channelId, templateId, language, skipImageQc, skipFinalQc]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!productAName.trim() || !productBName.trim()) {
      setError("Product A and B names are required");
      return;
    }
    if (!templateId) {
      setError("Please select a template");
      return;
    }
    setLoading(true);
    setError(null);

    const makeProduct = (slot: "A" | "B" | "C", name: string) => ({
      slot,
      name: name.trim(),
      identifier_type: "product",
      identifier_value: slugify(name),
      price_usd: null,
      official_url: null,
      hero_asset_key: null,
      hero_asset_candidates: [],
    });

    const products = [
      makeProduct("A", productAName),
      makeProduct("B", productBName),
      ...(includeC && productCName.trim()
        ? [makeProduct("C", productCName)]
        : []),
    ];

    const result = await createJob({
      channel_id: channelId,
      format: "TECH_COMPARISON",
      template_id: templateId,
      initial_topic: `${productAName.trim()} vs ${productBName.trim()}${includeC && productCName.trim() ? ` vs ${productCName.trim()}` : ""}`,
      language,
      skip_image_qc: skipImageQc,
      skip_final_qc: skipFinalQc,
      skip_research: skipResearch,
      // `products[{slot,name}]` is the canonical shape — the renderer reads it
      // directly. Ingest (validator + processor) normalizes it via
      // @repo/domain's normalizeComparison, which also accepts the flat
      // product_a_name/product_b_name form used by CLI injectors.
      metadata: { comparison: { subformat, products } },
    });

    if (result.success) {
      router.push("/jobs");
    } else {
      setError(result.error ?? "Failed to create job");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={sectionStyle}>
      <div>
        <label style={labelStyle}>Comparison Type</label>
        <select
          value={subformat}
          onChange={(e) => setSubformat(e.target.value)}
          style={selectStyle}
        >
          {SUBFORMATS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <label style={labelStyle}>Product A *</label>
          <input
            type="text"
            value={productAName}
            onChange={(e) => setProductAName(e.target.value)}
            placeholder="e.g. iPhone 16 Pro"
            style={inputStyle}
            required
          />
        </div>
        <div>
          <label style={labelStyle}>Product B *</label>
          <input
            type="text"
            value={productBName}
            onChange={(e) => setProductBName(e.target.value)}
            placeholder="e.g. Samsung S25 Ultra"
            style={inputStyle}
            required
          />
        </div>
      </div>

      <div>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            cursor: "pointer",
            marginBottom: 8,
          }}
        >
          <input
            type="checkbox"
            checked={includeC}
            onChange={(e) => setIncludeC(e.target.checked)}
          />
          <span style={{ fontSize: 12, color: "#cdc3d7" }}>
            Include a third product (C)
          </span>
        </label>
        {includeC && (
          <input
            type="text"
            value={productCName}
            onChange={(e) => setProductCName(e.target.value)}
            placeholder="e.g. Google Pixel 9 Pro"
            style={inputStyle}
          />
        )}
      </div>

      {templates.length > 1 && (
        <div>
          <label style={labelStyle}>Template</label>
          <select
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            style={selectStyle}
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label style={labelStyle}>Channel</label>
        <select
          value={channelId}
          onChange={(e) => setChannelId(e.target.value)}
          style={selectStyle}
        >
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <label style={labelStyle}>Language</label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            style={selectStyle}
          >
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-end",
            gap: 8,
          }}
        >
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={skipImageQc}
              onChange={(e) => setSkipImageQc(e.target.checked)}
            />
            <span style={{ fontSize: 12, color: "#cdc3d7" }}>
              Skip Image QC
            </span>
          </label>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={skipFinalQc}
              onChange={(e) => setSkipFinalQc(e.target.checked)}
            />
            <span style={{ fontSize: 12, color: "#cdc3d7" }}>
              Skip Final QC
            </span>
          </label>
        </div>
      </div>

      {/* Research gate — the difference between a job that runs and a job
          that sits at AWAITING_RESEARCH waiting for a human. */}
      <div
        style={{
          padding: 14,
          borderRadius: 10,
          border: "1px solid rgba(var(--v2-accent-rgb), 0.2)",
          background: "rgba(var(--v2-accent-rgb), 0.04)",
        }}
      >
        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={skipResearch}
            onChange={(e) => setSkipResearch(e.target.checked)}
            style={{ marginTop: 2 }}
          />
          <span>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#e5e2e1" }}>
              Skip research (write the script from the model&apos;s own
              knowledge)
            </span>
            <span
              style={{
                display: "block",
                fontSize: 11,
                color: "rgba(205,195,215,0.6)",
                marginTop: 3,
              }}
            >
              {skipResearch
                ? "The job goes straight to SCRIPTING. Faster, but no sourced facts — check the script before render."
                : "Off: the job stops at AWAITING_RESEARCH and waits for you to run the generated Perplexity prompts and upload the results."}
            </span>
          </span>
        </label>
      </div>

      {error && (
        <div
          style={{
            padding: "10px 14px",
            background: "rgba(255,80,80,0.08)",
            border: "1px solid rgba(255,80,80,0.2)",
            borderRadius: 8,
            fontSize: 12,
            color: "#ff8080",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
            error
          </span>
          {error}
        </div>
      )}

      <SubmitButton
        loading={loading}
        disabled={!productAName.trim() || !productBName.trim()}
      />
    </form>
  );
}
