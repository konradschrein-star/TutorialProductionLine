"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BUSINESS_HUB_IMAGE_BACKENDS,
  BUSINESS_HUB_IMAGE_BACKEND_LABELS,
  DEFAULT_BUSINESS_HUB_IMAGE_MODEL,
  backendHonoursImageModel,
  defaultModelForBackend,
  fallbackModelsForBackend,
  modelSupportsAspect,
  resolutionForModel,
  type BusinessHubFamily,
  type BusinessHubImageBackend,
} from "@repo/contracts";
import { createJob } from "@/app/actions/create-job";
import { V2Listbox } from "@/components/thumbnails/v2-listbox";
import { SubmitButton } from "../_components/submit-button";
import {
  labelStyle,
  inputStyle,
  textareaStyle,
  sectionStyle,
} from "../_components/form-field-styles";
import {
  saveJobCreationSession,
  loadJobCreationSession,
} from "@/lib/session-storage";

/**
 * BUSINESS_PLAN_HUB job-creation form.
 *
 * Submits through the shared `createJob` server action, which enqueues an
 * ingest job — it does not insert the `content_jobs` row itself, so everything
 * this form collects has to survive as queue payload (top-level fields) or as
 * `metadata.business_hub`.
 *
 * Two conventions this file deliberately follows:
 *  - Inline styles, like every other V2 page under `(authenticated)`.
 *  - `V2Listbox`, never a native `<select>`: on Windows Chrome the native
 *    option popup is drawn by the OS and is unstyleable.
 */

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

interface BusinessHubFormProps {
  channels: Channel[];
  templates: Template[];
}

// ---------------------------------------------------------------------------
// Option tables
// ---------------------------------------------------------------------------

/**
 * The five video families of design section 2, in the ranked order the design
 * gives them (family 1 absorbs the most of the keyword matrix).
 *
 * Typed as a total `Record<BusinessHubFamily, …>`: adding a family to
 * `BusinessHubFamilySchema` in @repo/contracts then fails to compile here
 * rather than silently leaving the new family unofferable in the UI.
 */
const FAMILY_LABELS: Record<
  BusinessHubFamily,
  { label: string; hint: string }
> = {
  "how-to-write-for": {
    label: "How to write for…",
    hint: "[industry] × [purpose] — the long-tail volume driver",
  },
  "what-they-check": {
    label: "What they check",
    hint: "What lenders and USCIS adjudicators actually look for",
  },
  mechanism: {
    label: "Mechanism",
    hint: "Why 1.25 DSCR, who pays whom — heaviest chart load",
  },
  teardown: {
    label: "Teardown",
    hint: "Patterns across real rejected plans — brand building",
  },
  "flagship-walkthrough": {
    label: "Flagship walkthrough",
    hint: "A plan gets written end to end, then checked",
  },
};

const FAMILY_ORDER: BusinessHubFamily[] = [
  "how-to-write-for",
  "what-they-check",
  "mechanism",
  "teardown",
  "flagship-walkthrough",
];

const FAMILY_OPTIONS = FAMILY_ORDER.map((value) => ({
  value,
  label: FAMILY_LABELS[value].label,
  hint: FAMILY_LABELS[value].hint,
}));

/**
 * Funding purposes from design section 2. There is deliberately no "other" or
 * "general" entry: purpose steers which primary-source domain the script has to
 * cite, so an unrecognised purpose must stay empty rather than be bucketed.
 */
const PURPOSE_OPTIONS = [
  { value: "sba-7a", label: "SBA 7(a) loan" },
  { value: "sba-504", label: "SBA 504 loan" },
  { value: "eb-5", label: "EB-5 investor visa" },
  { value: "e-2", label: "E-2 treaty investor visa" },
  { value: "investor", label: "Private investor / equity raise" },
] as const;

/**
 * Subformat variants (design section 3.4). Swaps what renders in the presenter
 * slot without touching the scene plan, so one script produces all three and
 * retention is compared on identical content.
 */
type PresenterMode = "suit" | "none" | "ai-png";

const PRESENTER_MODES: Array<{
  value: PresenterMode;
  label: string;
  hint: string;
}> = [
  {
    value: "suit",
    label: "Suit",
    hint: "Photographic torso + logo head. The reference look.",
  },
  {
    value: "none",
    label: "None",
    hint: "Motion graphics only — no figure in any scene.",
  },
  {
    value: "ai-png",
    label: "AI PNG",
    hint: "Generated presenter plate instead of the photographic torso.",
  },
];

/**
 * Image backend + model — the comparison control (owner's ask, 2026-08-16).
 *
 * The second dropdown DEPENDS on the first: `ai33` exposes the full AI33
 * catalogue, every other backend is restricted to Nano Banana Pro / Nano Banana
 * 2 because those backends post a fixed model upstream and cannot honour a
 * per-job one. The lists come from `GET /api/v1/image-models`, which fetches
 * AI33's live catalogue and falls back to the checked-in one — so a model AI33
 * added this week shows up here without a deploy.
 */
interface ImageModelPayload {
  id: string;
  label: string;
  supportsAspect: boolean;
  resolution: string | null;
}

interface ImageBackendPayload {
  id: BusinessHubImageBackend;
  label: string;
  hint: string;
  honoursModel: boolean;
  defaultModel: string;
  models: ImageModelPayload[];
}

interface ImageModelsResponse {
  backends: ImageBackendPayload[];
  source: "live" | "fallback";
  sourceReason: string | null;
}

/** Every frame of this format is 16:9; two AI33 models genuinely cannot do it. */
const HUB_ASPECT = "16:9";

/**
 * What the control shows before (or instead of) the API answering: the
 * checked-in catalogue, built through the same helpers the route uses. It is
 * explicitly labelled as such in the UI — the operator is comparing models, so
 * "is this today's list" is a question he must be able to answer.
 */
const FALLBACK_BACKENDS: ImageBackendPayload[] = BUSINESS_HUB_IMAGE_BACKENDS.map(
  (backend) => ({
    id: backend,
    label: BUSINESS_HUB_IMAGE_BACKEND_LABELS[backend].label,
    hint: BUSINESS_HUB_IMAGE_BACKEND_LABELS[backend].hint,
    honoursModel: backendHonoursImageModel(backend),
    defaultModel: defaultModelForBackend(backend),
    models: fallbackModelsForBackend(backend).map((m) => ({
      id: m.id,
      label: m.label,
      supportsAspect: modelSupportsAspect(m, HUB_ASPECT),
      resolution: resolutionForModel(m) ?? null,
    })),
  }),
);

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "de", label: "German" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
];

/** Design section 2: default target length is 15 minutes, adjusted per family. */
const DEFAULT_TARGET_MINUTES = 15;
/** Below this the outline-then-expand chapter split has nothing to split. */
const MIN_TARGET_MINUTES = 3;
/** Above this a single job outruns the render budget; split it into a series. */
const MAX_TARGET_MINUTES = 60;
/** `content_jobs.title` is varchar(100) and the topic becomes the title. */
const MAX_TOPIC_CHARS = 100;

const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: "rgba(205,195,215,0.5)",
  margin: "6px 2px 0",
};

export function BusinessHubForm({ channels, templates }: BusinessHubFormProps) {
  const router = useRouter();

  const [topic, setTopic] = useState("");
  // No default family: which family a video belongs to changes the script
  // shape and the source gate, so it is an explicit operator decision.
  const [family, setFamily] = useState<BusinessHubFamily | "">("");
  const [industry, setIndustry] = useState("");
  const [purpose, setPurpose] = useState("");
  const [targetMinutes, setTargetMinutes] = useState(
    String(DEFAULT_TARGET_MINUTES),
  );
  const [presenterMode, setPresenterMode] = useState<PresenterMode>("suit");
  const [context, setContext] = useState("");

  // Image backend + model. `ai33` is the default because it is the only image
  // generator with live credentials right now AND the only one that honours a
  // per-job model — which is the whole point of this control.
  const [imageBackend, setImageBackend] =
    useState<BusinessHubImageBackend>("ai33");
  const [imageModel, setImageModel] = useState(
    DEFAULT_BUSINESS_HUB_IMAGE_MODEL,
  );
  const [backendCatalogue, setBackendCatalogue] =
    useState<ImageBackendPayload[]>(FALLBACK_BACKENDS);
  const [catalogueSource, setCatalogueSource] = useState<
    "live" | "fallback" | "loading"
  >("loading");
  const [catalogueReason, setCatalogueReason] = useState<string | null>(null);

  const [channelId, setChannelId] = useState(channels[0]?.id ?? "");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [language, setLanguage] = useState("en");
  const [skipImageQc, setSkipImageQc] = useState(false);
  const [skipFinalQc, setSkipFinalQc] = useState(false);

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const saved = loadJobCreationSession();
    if (!saved) return;
    if (saved.channel_id && channels.some((c) => c.id === saved.channel_id)) {
      setChannelId(saved.channel_id);
    }
    if (
      saved.template_id &&
      templates.some((t) => t.id === saved.template_id)
    ) {
      setTemplateId(saved.template_id);
    }
    if (saved.language) setLanguage(saved.language);
    if (saved.skip_image_qc !== undefined) setSkipImageQc(saved.skip_image_qc);
    if (saved.skip_final_qc !== undefined) setSkipFinalQc(saved.skip_final_qc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pull the live (backend, models) pairs once. A failure leaves the
  // checked-in catalogue in place and SAYS SO — it never blanks the control.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/v1/image-models?aspect=${encodeURIComponent(HUB_ASPECT)}`,
          { credentials: "same-origin" },
        );
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = (await res.json()) as ImageModelsResponse;
        if (cancelled || !Array.isArray(data.backends)) return;
        setBackendCatalogue(data.backends);
        setCatalogueSource(data.source);
        setCatalogueReason(data.sourceReason);
      } catch (err) {
        if (cancelled) return;
        setCatalogueSource("fallback");
        setCatalogueReason(
          `the model list could not be fetched (${
            err instanceof Error ? err.message : String(err)
          })`,
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    saveJobCreationSession({
      selectedFormat: "BUSINESS_PLAN_HUB",
      channel_id: channelId,
      template_id: templateId,
      language,
      skip_image_qc: skipImageQc,
      skip_final_qc: skipFinalQc,
    });
  }, [channelId, templateId, language, skipImageQc, skipFinalQc]);

  // `how-to-write-for` IS [industry] × [purpose]; without both, the script has
  // no subject. The other four families are topic-driven and take them as
  // optional narrowing.
  const needsIndustryAndPurpose = family === "how-to-write-for";

  // The second level of the image control, derived from the first.
  const activeBackend: ImageBackendPayload =
    backendCatalogue.find((b) => b.id === imageBackend) ??
    FALLBACK_BACKENDS.find((b) => b.id === imageBackend) ??
    FALLBACK_BACKENDS[0];
  const selectedModel = activeBackend.models.find((m) => m.id === imageModel);

  /**
   * Switching backend re-scopes the model list. The current model is KEPT when
   * the new backend also offers it (switching ai33 → vup on Nano Banana 2 must
   * not silently move you to another model), otherwise it snaps to that
   * backend's default.
   */
  function handleImageBackendChange(next: BusinessHubImageBackend) {
    setImageBackend(next);
    const entry =
      backendCatalogue.find((b) => b.id === next) ??
      FALLBACK_BACKENDS.find((b) => b.id === next);
    if (!entry) return;
    const stillOffered = entry.models.some(
      (m) => m.id === imageModel && m.supportsAspect,
    );
    if (!stillOffered) setImageModel(entry.defaultModel);
  }

  const trimmedTopic = topic.trim();
  const parsedMinutes = Number(targetMinutes);
  const minutesValid =
    Number.isFinite(parsedMinutes) &&
    Number.isInteger(parsedMinutes) &&
    parsedMinutes >= MIN_TARGET_MINUTES &&
    parsedMinutes <= MAX_TARGET_MINUTES;

  const canSubmit =
    trimmedTopic.length > 0 &&
    trimmedTopic.length <= MAX_TOPIC_CHARS &&
    family !== "" &&
    minutesValid &&
    !!templateId &&
    !!channelId &&
    selectedModel !== undefined &&
    selectedModel.supportsAspect &&
    (!needsIndustryAndPurpose ||
      (industry.trim().length > 0 && purpose.length > 0));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Every branch below reports the specific missing thing rather than
    // filling one in — a job created with a guessed family or a guessed
    // funding purpose produces a video that cites the wrong regulator.
    if (!trimmedTopic) {
      setError("Enter the topic — the search query this video answers.");
      return;
    }
    if (trimmedTopic.length > MAX_TOPIC_CHARS) {
      setError(
        `Topic is ${trimmedTopic.length} characters; the job title column holds ${MAX_TOPIC_CHARS}. Shorten it — it is not truncated for you.`,
      );
      return;
    }
    if (family === "") {
      setError("Pick a video family — it decides the script shape.");
      return;
    }
    if (needsIndustryAndPurpose && !industry.trim()) {
      setError(
        'The "How to write for…" family is [industry] × [purpose]. Enter the industry.',
      );
      return;
    }
    if (needsIndustryAndPurpose && !purpose) {
      setError(
        'The "How to write for…" family is [industry] × [purpose]. Pick the funding purpose.',
      );
      return;
    }
    if (!minutesValid) {
      setError(
        `Target length must be a whole number of minutes between ${MIN_TARGET_MINUTES} and ${MAX_TARGET_MINUTES}.`,
      );
      return;
    }
    if (!channelId) {
      setError("Pick a channel.");
      return;
    }
    if (!templateId) {
      setError(
        "No BUSINESS_PLAN_HUB template selected. Seed one with `pnpm --filter @repo/db seed:business-hub`.",
      );
      return;
    }
    // Never fall back to "whatever the backend runs": the model is the variable
    // under comparison, so a job whose model did not resolve is a job whose
    // result means nothing.
    if (selectedModel === undefined) {
      setError(
        `"${imageModel}" is not offered by the ${activeBackend.label} backend. Pick a model.`,
      );
      return;
    }
    if (!selectedModel.supportsAspect) {
      setError(
        `${selectedModel.label} does not render ${HUB_ASPECT}, which is the only ratio this format uses. Pick another model.`,
      );
      return;
    }

    setLoading(true);
    setError(null);

    const result = await createJob({
      channel_id: channelId,
      format: "BUSINESS_PLAN_HUB",
      template_id: templateId,
      initial_topic: trimmedTopic,
      language,
      target_duration_seconds: parsedMinutes * 60,
      skip_image_qc: skipImageQc,
      skip_final_qc: skipFinalQc,
      metadata: {
        business_hub: {
          topic: trimmedTopic,
          family,
          targetMinutes: parsedMinutes,
          presenterMode,
          // Image backend + model. snake_case, matching the keys the pipeline
          // already reads out of this slice (`broll_motion`, `voice_id`).
          // `image_backend` is OMITTED for "auto" — writing it would pin the
          // gateway to a backend the operator explicitly did not choose.
          ...(imageBackend === "auto" ? {} : { image_backend: imageBackend }),
          image_model: selectedModel.id,
          // The resolution the model actually offers. `null` means the model
          // declares none, and the parameter must then be omitted upstream
          // rather than sent as a plausible-looking guess.
          ...(selectedModel.resolution
            ? { image_resolution: selectedModel.resolution }
            : {}),
          // Omitted rather than emptied when unset, so a downstream reader can
          // tell "not applicable to this family" from "operator left it blank".
          ...(industry.trim() ? { industry: industry.trim() } : {}),
          ...(purpose ? { purpose } : {}),
          ...(context.trim() ? { context: context.trim() } : {}),
        },
      },
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
      {templates.length === 0 && (
        <div
          style={{
            padding: "12px 14px",
            background: "rgba(255,180,0,0.08)",
            border: "1px solid rgba(255,180,0,0.25)",
            borderRadius: 8,
            fontSize: 12,
            color: "#ffcf70",
            lineHeight: 1.6,
          }}
        >
          No active BUSINESS_PLAN_HUB template exists in this database, so a job
          cannot be created. Seed one with{" "}
          <code>pnpm --filter @repo/db seed:business-hub</code>.
        </div>
      )}

      {/* Topic — the long-tail query the video answers, in full. */}
      <div>
        <label style={labelStyle}>
          Topic — the search query this answers *
        </label>
        <input
          type="text"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="e.g. How to write a business plan for a bakery for an SBA 7(a) loan"
          style={inputStyle}
          maxLength={MAX_TOPIC_CHARS}
          required
        />
        <p style={hintStyle}>
          {trimmedTopic.length}/{MAX_TOPIC_CHARS} characters. The video has to
          answer this completely — the CTA is that checking the work by hand is
          the expensive part.
        </p>
      </div>

      {/* Video family — decides the script shape and the source gate. */}
      <div>
        <label style={labelStyle}>Video family *</label>
        <V2Listbox
          value={family}
          onChange={(v) => setFamily(v as BusinessHubFamily)}
          options={FAMILY_OPTIONS}
          placeholder="Pick a family…"
          searchable={false}
        />
      </div>

      {/* Industry × purpose — required for family 1, narrowing elsewhere. */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <label style={labelStyle}>
            Industry {needsIndustryAndPurpose ? "*" : "(optional)"}
          </label>
          <input
            type="text"
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            placeholder="e.g. bakery, trucking, daycare, car wash"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>
            Funding purpose {needsIndustryAndPurpose ? "*" : "(optional)"}
          </label>
          <V2Listbox
            value={purpose}
            onChange={setPurpose}
            options={PURPOSE_OPTIONS.map((p) => ({
              value: p.value,
              label: p.label,
            }))}
            placeholder="Pick a purpose…"
            searchable={false}
          />
        </div>
      </div>

      {/* Presenter mode — the A/B switch (design 3.4). */}
      <div>
        <label style={labelStyle}>Presenter mode</label>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 8,
          }}
        >
          {PRESENTER_MODES.map((mode) => {
            const active = presenterMode === mode.value;
            return (
              <button
                key={mode.value}
                type="button"
                onClick={() => setPresenterMode(mode.value)}
                aria-pressed={active}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: 4,
                  padding: "10px 12px",
                  textAlign: "left",
                  borderRadius: 8,
                  cursor: "pointer",
                  background: active
                    ? "rgba(var(--v2-accent-rgb), 0.12)"
                    : "rgba(255,255,255,0.03)",
                  border: `1px solid ${
                    active
                      ? "rgba(var(--v2-accent-rgb), 0.45)"
                      : "rgba(var(--v2-accent-rgb), 0.16)"
                  }`,
                  transition: "background 120ms, border-color 120ms",
                }}
              >
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: active ? "var(--v2-accent)" : "#e5e2e1",
                  }}
                >
                  {mode.label}
                </span>
                <span
                  style={{
                    fontSize: 10.5,
                    color: "rgba(205,195,215,0.6)",
                    lineHeight: 1.4,
                  }}
                >
                  {mode.hint}
                </span>
              </button>
            );
          })}
        </div>
        <p style={hintStyle}>
          Same scene plan either way — one script produces all three variants,
          so retention is compared on identical content.
        </p>
      </div>

      {/* Image backend + model — the model-comparison control. */}
      <div>
        <label style={labelStyle}>Image generation</label>
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}
        >
          <V2Listbox
            value={imageBackend}
            onChange={(v) =>
              handleImageBackendChange(v as BusinessHubImageBackend)
            }
            options={(backendCatalogue.length > 0
              ? backendCatalogue
              : FALLBACK_BACKENDS
            ).map((b) => ({
              value: b.id,
              label: b.label,
              hint: b.hint,
            }))}
            searchable={false}
          />
          <V2Listbox
            value={imageModel}
            onChange={setImageModel}
            options={activeBackend.models.map((m) => ({
              value: m.id,
              label: m.label,
              hint: m.supportsAspect
                ? m.resolution
                  ? `${m.id} · ${m.resolution}`
                  : m.id
                : `${m.id} · does not render ${HUB_ASPECT}`,
              // Offered but unselectable, not hidden: a missing option looks
              // like a bug, a greyed one with a reason is an answer.
              disabled: !m.supportsAspect,
            }))}
            placeholder="Pick a model…"
          />
        </div>
        <p style={hintStyle}>
          {activeBackend.honoursModel ? (
            <>
              AI33 is the one backend that takes a per-job model, so this is
              where models are compared. Pinning a backend also turns OFF the
              gateway&rsquo;s failover for this job — pick Auto if you would
              rather it survive AI33 being down. Catalogue:{" "}
              {catalogueSource === "live"
                ? "live from AI33."
                : catalogueSource === "loading"
                  ? "loading…"
                  : `checked-in fallback — ${catalogueReason ?? "AI33 was unreachable"}.`}
            </>
          ) : imageBackend === "auto" ? (
            <>
              Auto keeps the gateway&rsquo;s health-gated failover. The model
              below is applied only if AI33 ends up serving; the self-hosted
              backends serve their own fixed Nano Banana build.
            </>
          ) : (
            <>
              {activeBackend.label} posts a fixed model upstream, so this entry
              records which build it serves — it is not passed through. Only
              AI33 honours a per-job model.
            </>
          )}
        </p>
      </div>

      {/* Channel + target length. */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <label style={labelStyle}>Channel *</label>
          <V2Listbox
            value={channelId}
            onChange={setChannelId}
            options={channels.map((c) => ({
              value: c.id,
              label: c.name,
              hint: c.language,
            }))}
            placeholder="Pick a channel…"
          />
        </div>
        <div>
          <label style={labelStyle}>Target length (minutes) *</label>
          <input
            type="number"
            value={targetMinutes}
            onChange={(e) => setTargetMinutes(e.target.value)}
            min={MIN_TARGET_MINUTES}
            max={MAX_TARGET_MINUTES}
            step={1}
            style={inputStyle}
            required
          />
          <p style={hintStyle}>
            {MIN_TARGET_MINUTES}–{MAX_TARGET_MINUTES}. Default{" "}
            {DEFAULT_TARGET_MINUTES} — the script is written as an outline then
            expanded chapter by chapter.
          </p>
        </div>
      </div>

      {/* Advanced — everything optional. */}
      <div>
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 2px",
            background: "none",
            border: "none",
            color: "rgba(205,195,215,0.7)",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
            {showAdvanced ? "expand_less" : "expand_more"}
          </span>
          Advanced (optional): notes, template, language, QC
        </button>
      </div>

      {showAdvanced && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 16,
            paddingLeft: 12,
            borderLeft: "2px solid rgba(var(--v2-accent-rgb), 0.15)",
          }}
        >
          <div>
            <label style={labelStyle}>
              Notes / keyword data / source material (optional)
            </label>
            <textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="Passed to every script prompt — the angle, the keyword cluster, specific SOP sections or filings to cite…"
              rows={4}
              style={textareaStyle}
            />
            <p style={hintStyle}>
              Every stat, formula, quote, comparison and checklist must cite an
              in-repo spec or an allowlisted primary domain (uscis.gov, sba.gov,
              govinfo.gov, ecfr.gov, federalregister.gov, irs.gov) or the build
              fails. Naming the documents here is the cheapest way to keep that
              gate green.
            </p>
          </div>

          {templates.length > 1 && (
            <div>
              <label style={labelStyle}>Template</label>
              <V2Listbox
                value={templateId}
                onChange={setTemplateId}
                options={templates.map((t) => ({
                  value: t.id,
                  label: t.name,
                  ...(t.description ? { hint: t.description } : {}),
                }))}
                placeholder="Pick a template…"
              />
            </div>
          )}

          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}
          >
            <div>
              <label style={labelStyle}>Language</label>
              <V2Listbox
                value={language}
                onChange={setLanguage}
                options={LANGUAGES}
                searchable={false}
              />
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
        </div>
      )}

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

      <SubmitButton loading={loading} disabled={!canSubmit} />
    </form>
  );
}
