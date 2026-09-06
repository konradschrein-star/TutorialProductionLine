"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";
import { V2Button, V2Input, GlassCard } from "../../_components";
import { V2Listbox } from "@/components/thumbnails/v2-listbox";
import type { TutorialPromptPreset, TutorialSettingsRow } from "@repo/db";
import type { ProviderMeta } from "@repo/contracts";
import {
  tutorialLengthPlan,
  labelForMode,
  type TutorialLengthPlan,
} from "@repo/domain";
import { voiceControlsFor } from "./voice-controls";
import { MyKeywords, type MyKeyword } from "./my-keywords";

interface CreateProps {
  presets: TutorialPromptPreset[];
  providers: { llm: ProviderMeta[]; tts: ProviderMeta[] };
  /** Provider id → true when a credential for it resolves (see page.tsx). */
  providerAvailability: {
    llm: Record<string, boolean>;
    tts: Record<string, boolean>;
  };
  settings: TutorialSettingsRow;
  /** manage:tutorial-settings — ADMIN/MANAGER. Gates the engine controls. */
  canManage: boolean;
  channels: Array<{ id: string; name: string; language: string }>;
  onCreated: () => void;
}

interface BatchJob {
  id: string;
  title: string;
  status: string;
  createdAt: string;
}

type TutorialMode =
  | "THREE_MIN"
  | "SIX_MIN"
  | "SIX_MIN_STITCH"
  | "LONG_FORM"
  | "SHORT_MATCH"
  | "SHORT_PLUS";
type SourceMode = "FROM_SCRATCH" | "TRANSCRIPT_REWRITE";

/**
 * The adaptive sub-3-minute modes. Length tracks the reference video's runtime
 * instead of a fixed 3 min; picked by hand to A/B against the classic 3-Min
 * mode, so they are deliberately NOT auto-selected by the length planner.
 */
const SHORT_ADAPTIVE_MODES: TutorialMode[] = ["SHORT_MATCH", "SHORT_PLUS"];

/**
 * What happened to the reference transcript. Deliberately a discriminated union
 * and not a pair of booleans: "fetched", "failed" and "never tried" each need a
 * different thing said to the VA, and a `loading || error` pair lets the UI show
 * a fourth state that means nothing.
 */
type TranscriptState =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "ok";
      words: number;
      source: string;
      videoTitle: string;
    }
  | { status: "error"; message: string };

/** Words in the transcript box, whether fetched or pasted. */
function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** How the API labels the caption track it found, in words a VA reads. */
const TRANSCRIPT_SOURCE_LABEL: Record<string, string> = {
  youtube_manual_captions: "the video's own captions",
  youtube_auto_captions: "YouTube's auto-generated captions",
};

/**
 * "I do not know where this comes from." So it says. A suggestion a VA cannot
 * trace is a suggestion they learn to click past.
 */
const LENGTH_SOURCE_LABEL: Record<string, string> = {
  keyword: "from the keyword",
  transcript: "from the fetched transcript",
  "step-count": "from your steps",
};

const LANGUAGE_OPTIONS = [
  { value: "English", label: "English" },
  { value: "German", label: "German" },
  { value: "Spanish", label: "Spanish" },
  { value: "French", label: "French" },
  { value: "Portuguese", label: "Portuguese" },
];

/**
 * Channel language code → the label the pipeline expects. A VA never types a
 * language on Create anymore; it is derived from the chosen channel so an
 * original job can't be filed in a language its channel doesn't publish (the
 * old free selector let someone pick "Italian channel + German language").
 * Other languages are produced downstream by the Localize lane, not here.
 */
const CODE_TO_LANGUAGE: Record<string, string> = {
  en: "English",
  de: "German",
  es: "Spanish",
  fr: "French",
  pt: "Portuguese",
  it: "Italian",
  nl: "Dutch",
  sv: "Swedish",
};

const STATUS_COLORS: Record<string, string> = {
  QUEUED: "#6366f1",
  GENERATING_SCRIPT: "#f59e0b",
  GENERATING_AUDIO: "#f59e0b",
  READY_TO_RECORD: "#22c55e",
  AWAITING_UPLOAD: "#3b82f6",
  SPLICING: "#f59e0b",
  COMPLETED: "#22c55e",
  FAILED_SCRIPT: "#ef4444",
  FAILED_AUDIO: "#ef4444",
  FAILED_SPLICE: "#ef4444",
  CANCELLED: "#6b7280",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 9999,
        fontSize: 9,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        background: `${STATUS_COLORS[status] ?? "#6b7280"}22`,
        color: STATUS_COLORS[status] ?? "#6b7280",
        border: `1px solid ${STATUS_COLORS[status] ?? "#6b7280"}44`,
      }}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

interface VoiceSliderProps {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number | "";
  onChange: (v: number | "") => void;
  hint?: string;
}

function VoiceSlider({
  label,
  min,
  max,
  step,
  value,
  onChange,
  hint,
}: VoiceSliderProps) {
  const displayValue =
    value === "" ? "—" : (value as number).toFixed(step < 1 ? 2 : 0);
  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 4,
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: "var(--v2-text-2)",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
          }}
        >
          {label}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{ fontSize: 12, color: "var(--v2-text-1)", fontWeight: 600 }}
          >
            {displayValue}
          </span>
          {value !== "" && (
            <button
              onClick={() => onChange("")}
              title="Clear (use provider default)"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--v2-text-2)",
                fontSize: 10,
                padding: 0,
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          )}
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value === "" ? min + (max - min) / 2 : value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: "100%", accentColor: "var(--v2-accent)" }}
      />
      {hint && (
        <div style={{ fontSize: 9, color: "var(--v2-text-2)", marginTop: 3 }}>
          {hint}
        </div>
      )}
    </div>
  );
}

export function ProductionCreate({
  presets,
  providers,
  providerAvailability,
  settings,
  canManage,
  channels,
  onCreated,
}: CreateProps) {
  const [title, setTitle] = useState("");
  const [channelId, setChannelId] = useState("");
  const [steps, setSteps] = useState("");
  // "AUTO" (the default) means: take the length from the reference material,
  // not a fixed 3-minute floor. See effectiveMode below.
  const [mode, setMode] = useState<TutorialMode | "AUTO">("AUTO");

  const [sourceMode, setSourceMode] = useState<SourceMode>("FROM_SCRATCH");
  const [referenceUrl, setReferenceUrl] = useState("");
  const [referenceTranscript, setReferenceTranscript] = useState("");
  const [language, setLanguage] = useState("English");
  const [targetMinutes, setTargetMinutes] = useState<number | "">(20);
  const [refVideoSeconds, setRefVideoSeconds] = useState<number | "">("");
  const [partLengthMinutes, setPartLengthMinutes] = useState<number | "">(8);
  const [extraContext, setExtraContext] = useState("");
  /**
   * Engines the VA may pick from.
   *
   * The sidebar used to list every provider in the registry and suffix the
   * unusable ones "— needs API key", which was seven of the eight voices. A VA
   * looking at that reasonably concludes the tool is broken, and the label was
   * not even true: it came from a `keyMasks` prop passed as a literal empty
   * array, while ElevenLabs and AI33 keys were sitting in the environment. An
   * engine with no credential cannot produce a video, so it is not an option —
   * it is not offered.
   */
  const llmProviders = useMemo(
    () => providers.llm.filter((p) => providerAvailability.llm[p.id]),
    [providers.llm, providerAvailability.llm],
  );
  const ttsProviders = useMemo(
    () => providers.tts.filter((p) => providerAvailability.tts[p.id]),
    [providers.tts, providerAvailability.tts],
  );

  const [scriptProvider, setScriptProvider] = useState(
    llmProviders.find((p) => p.isDefault)?.id ?? llmProviders[0]?.id ?? "",
  );
  const [scriptModel, setScriptModel] = useState(() => {
    const p = llmProviders.find((pr) => pr.id === scriptProvider);
    return (
      p?.models?.find((m) => m.isDefault)?.value ?? p?.models?.[0]?.value ?? ""
    );
  });
  const [ttsProvider, setTtsProvider] = useState(
    ttsProviders.find((p) => p.isDefault)?.id ?? ttsProviders[0]?.id ?? "",
  );
  // Engine controls are collapsed. "The VAs do not need to make these
  // settings" — the defaults below are the ones every job has used, so the
  // sidebar states the recipe and gets out of the way.
  const [showEngines, setShowEngines] = useState(false);
  const [ttsVoice, setTtsVoice] = useState("");
  // Voice settings state
  const [vsModel, setVsModel] = useState("");
  const [vsSpeed, setVsSpeed] = useState<number | "">("");
  const [vsStability, setVsStability] = useState<number | "">("");
  const [vsSimilarity, setVsSimilarity] = useState<number | "">("");
  const [vsPitch, setVsPitch] = useState<number | "">("");
  const [vsVolume, setVsVolume] = useState<number | "">("");
  const [vsLanguage, setVsLanguage] = useState("");
  // Pre-select the default preset (or first one) for the initial mode so a
  // user who just types a title and clicks Generate gets a working job.
  // Submitting with presetId === "none" and no custom prompt is the most
  // common foot-gun — the worker throws "No prompt found".
  const pickDefaultPresetId = (m: TutorialMode): string => {
    const category = m === "SIX_MIN_STITCH" ? "SIX_MIN_STITCH" : m;
    const available = presets.filter((p) => p.category === category);
    return (
      available.find((p) => p.is_default)?.id ?? available[0]?.id ?? "none"
    );
  };
  const [presetId, setPresetId] = useState<string>(() =>
    pickDefaultPresetId("THREE_MIN"),
  );
  const [useCustomPrompt, setUseCustomPrompt] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [batchJobs, setBatchJobs] = useState<BatchJob[]>([]);
  const batchIdRef = useRef<string | null>(null);
  // The claimed keyword this job came from, if the VA picked one. Sent as
  // keyword_ref/kt_url so the keyword board advances by itself from here on.
  const [keyword, setKeyword] = useState<MyKeyword | null>(null);
  const [keywordRefreshToken, setKeywordRefreshToken] = useState(0);
  /**
   * Keyword id waiting to be queued by the Send-to-production button, and the
   * one currently in flight.
   *
   * Two pieces of state rather than one because they answer different
   * questions: `pendingSend` means "the form has just been filled from this
   * keyword, submit as soon as React has applied it", and `sendingKeywordId`
   * means "a request is out for this row" so its button can say so and not be
   * pressed twice.
   */
  const [pendingSend, setPendingSend] = useState<number | null>(null);
  const [sendingKeywordId, setSendingKeywordId] = useState<number | null>(null);
  const [transcript, setTranscript] = useState<TranscriptState>({
    status: "idle",
  });
  /**
   * Guards against a slow fetch for keyword A landing after the VA has already
   * moved to keyword B and overwriting B's transcript with A's. Only the fetch
   * whose token still matches is allowed to write.
   */
  const transcriptTokenRef = useRef(0);
  /** Scroll target for "back to the top of Create" after a job is queued. */
  const topRef = useRef<HTMLDivElement>(null);

  /**
   * The length judgement, in one place, from the best evidence available.
   *
   * The owner: "the three minute tutorial is auto selected even though we just
   * selected a 10 to 20 minute video which if I search this up on youtube has
   * had the original length of 13 minutes. Knowing that number in our keyword
   * tool we should definitely not select for a three minute video."
   *
   * It used to read the steps textarea and nothing else, which is why. The rule
   * now lives in `@repo/domain` (`tutorialLengthPlan`) so the ordering — the
   * keyword's own runtime, then the fetched transcript, then the step count,
   * clamped inside the keyword's bucket — is testable and cannot drift between
   * the picker and whatever reads it next.
   */
  const transcriptWordCount = useMemo(
    () => countWords(referenceTranscript),
    [referenceTranscript],
  );
  const lengthPlan = useMemo(
    () =>
      tutorialLengthPlan({
        lengthClass: keyword?.lengthClass ?? null,
        durationSec: keyword?.durationSec ?? null,
        transcriptWordCount,
        stepsInput: steps,
      }),
    [keyword, transcriptWordCount, steps],
  );

  /**
   * Put a length plan into the form: the mode, its prompt preset, and the
   * numbers the mode actually uses. `targetMinutes` is only written when the
   * plan carries one — THREE_MIN and SIX_MIN hardcode their length in the
   * worker and ignore the field, so writing a number there would show the VA a
   * promise the pipeline does not keep.
   */
  function applyLengthPlan(plan: TutorialLengthPlan) {
    setMode(plan.mode);
    setPresetId(pickDefaultPresetId(plan.mode));
    if (plan.targetMinutes !== null) setTargetMinutes(plan.targetMinutes);
    if (plan.partLengthMinutes !== null)
      setPartLengthMinutes(plan.partLengthMinutes);
  }

  /**
   * The mode actually run, once "AUTO" is resolved.
   *
   * AUTO is the standard choice: it takes the length straight from the reference
   * material via `tutorialLengthPlan` (the reference video's runtime, then the
   * fetched transcript, then the keyword bucket, then the steps). Before this,
   * the form defaulted to THREE_MIN and quietly forced a 13-minute topic down to
   * three. When AUTO has no evidence yet it falls back to the shortest shape and
   * says so in the note under the picker.
   */
  const effectiveMode: TutorialMode =
    mode === "AUTO" ? (lengthPlan?.mode ?? "THREE_MIN") : mode;
  const effectiveTargetMinutes: number | null =
    mode === "AUTO"
      ? (lengthPlan?.targetMinutes ?? null)
      : targetMinutes === ""
        ? null
        : Number(targetMinutes);
  const effectivePartLengthMinutes: number | null =
    mode === "AUTO"
      ? (lengthPlan?.partLengthMinutes ?? null)
      : partLengthMinutes === ""
        ? null
        : Number(partLengthMinutes);

  // Under AUTO the prompt preset must follow the resolved shape, or a topic that
  // resolves to SIX_MIN would be generated with the THREE_MIN prompt.
  useEffect(() => {
    if (mode === "AUTO") setPresetId(pickDefaultPresetId(effectiveMode));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, effectiveMode]);

  /**
   * Pull the reference video's transcript into the box.
   *
   * The owner: "we can fetch the transcript already by as soon as the keyword is
   * selected... and the leave blank stuff will not appear if we are not able to
   * fetch it, then the VA can manually fetch it."
   *
   * On failure this sets an error and leaves the box EMPTY. It never writes a
   * placeholder — a box holding "could not fetch" would be submitted as the
   * transcript and rewritten into a script.
   */
  async function fetchTranscript(url: string, lang: string) {
    const trimmed = url.trim();
    if (!trimmed) return;
    const token = ++transcriptTokenRef.current;
    setTranscript({ status: "loading" });
    try {
      const res = await fetch("/api/production/transcript", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: trimmed, language: lang }),
      });
      const body = (await res.json()) as {
        transcript?: string;
        source?: string;
        videoTitle?: string;
        videoSeconds?: number;
        wordCount?: number;
        error?: string;
      };
      // The VA has moved on to another keyword — this answer is about a video
      // that is no longer in the form.
      if (token !== transcriptTokenRef.current) return;

      if (!res.ok || !body.transcript) {
        setTranscript({
          status: "error",
          message: body.error ?? `HTTP ${res.status}`,
        });
        return;
      }
      setReferenceTranscript(body.transcript);
      // The real runtime, straight from the source. It seeds the STITCH length
      // target and is told to the writer as the coverage to beat.
      if (typeof body.videoSeconds === "number" && body.videoSeconds > 0) {
        setRefVideoSeconds(body.videoSeconds);
      }
      setTranscript({
        status: "ok",
        words: body.wordCount ?? countWords(body.transcript),
        source: body.source ?? "",
        videoTitle: body.videoTitle ?? "",
      });
    } catch (err) {
      if (token !== transcriptTokenRef.current) return;
      setTranscript({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Dropzone for .md / .txt files → paste into steps textarea
  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setSteps((prev) => (prev ? prev + "\n\n" + text : text));
    };
    reader.readAsText(file);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "text/markdown": [".md"], "text/plain": [".txt"] },
    multiple: false,
    noClick: true,
  });

  const optionFor = (p: ProviderMeta) => ({
    value: p.id,
    label: p.label,
    hint: p.unreliable
      ? "can be unreliable"
      : p.mostStable
        ? "most stable"
        : undefined,
  });
  const llmOptions = llmProviders.map(optionFor);
  const ttsOptions = ttsProviders.map(optionFor);

  const scriptProviderMeta = llmProviders.find((p) => p.id === scriptProvider);
  const ttsProviderMeta = ttsProviders.find((p) => p.id === ttsProvider);
  const voiceControls = voiceControlsFor(ttsProvider);

  const modeOptions = [
    { value: "AUTO", label: "Auto — match the reference length (standard)" },
    { value: "THREE_MIN", label: "3-Minute Tutorial" },
    { value: "SHORT_MATCH", label: "Short — Match the reference length" },
    { value: "SHORT_PLUS", label: "Short — Plus (reference + examples)" },
    { value: "SIX_MIN", label: "6-Minute Tutorial" },
    { value: "SIX_MIN_STITCH", label: "Long-Form Stitch (6-Min segments)" },
    { value: "LONG_FORM", label: "Long-form (40+ min, stitched)" },
  ];

  // Channel is REQUIRED as of 2026-08-03. It used to default to "— None —"
  // and be labelled "optional — drives thumbnail styling", so nobody filled it
  // in: 1,921 of 2,006 completed tutorials (96%) have channel_id NULL. The
  // consequences were never local to thumbnails — a NULL channel means the
  // Drive folder is literally named _no-channel, and nobody can tell which of
  // three channels a finished video was made for, which is the entire point of
  // the pipeline. The picker now lists only channels flagged accepts_tutorials
  // (migration 0059) rather than all 7 rows, several of which are placeholders.
  const channelOptions = [
    { value: "", label: "— Select a channel —" },
    ...channels.map((c) => ({ value: c.id, label: c.name })),
  ];

  // The job's language is the channel's language — a VA can't mismatch them.
  const selectedChannel = channels.find((c) => c.id === channelId);
  const channelLanguage = selectedChannel
    ? (CODE_TO_LANGUAGE[selectedChannel.language] ?? "English")
    : "";
  useEffect(() => {
    if (channelLanguage) setLanguage(channelLanguage);
  }, [channelLanguage]);

  const relevantPresets = presets.filter(
    (p) =>
      p.category ===
      (effectiveMode === "SIX_MIN_STITCH" ? "SIX_MIN_STITCH" : effectiveMode),
  );
  const presetOptions = [
    { value: "none", label: "— Select a prompt preset —" },
    ...relevantPresets.map((p) => ({ value: p.id, label: p.name })),
  ];

  async function handleGenerate() {
    if (!title.trim()) {
      toast.error("Please enter a tutorial title.");
      return;
    }

    // Channel is required — see the channelOptions comment. Caught here so the
    // VA gets an immediate, specific message rather than discovering weeks later
    // that the video landed in a Drive folder called _no-channel with no
    // thumbnail and no way to tell which channel it was for.
    if (!channelId) {
      toast.error(
        "Please pick a channel — it decides the Drive folder, the thumbnail style, and where this video gets uploaded.",
      );
      return;
    }

    // Hard guard: the worker throws "No prompt found" if both the preset
    // and custom prompt are empty. Catch it before the API call so the
    // user gets a clear, immediate message instead of a silent failure.
    const hasPreset = presetId !== "none";
    const hasCustomPrompt = useCustomPrompt && customPrompt.trim().length > 0;
    if (!hasPreset && !hasCustomPrompt) {
      if (relevantPresets.length === 0) {
        toast.error(
          `No prompt presets exist for "${mode}" mode yet. Enable "Use custom prompt instead" and paste one, or add a preset in Settings.`,
        );
      } else {
        toast.error(
          "Pick a prompt preset (or enable 'Use custom prompt instead') before generating.",
        );
      }
      return;
    }

    // The pickers only ever contain engines with a resolvable credential, so
    // this is the belt for the braces: it catches a stale selection left over
    // from a key being removed while the tab was open.
    if (!scriptProvider || !providerAvailability.llm[scriptProvider]) {
      toast.error(
        "That script engine has no working API key any more. Pick another one.",
      );
      return;
    }
    if (!ttsProvider || !providerAvailability.tts[ttsProvider]) {
      toast.error(
        "That voice engine has no working API key any more. Pick another one.",
      );
      return;
    }

    // A rewrite needs something to rewrite FROM. The URL alone is enough — the
    // worker fetches the source video's captions itself — but "rewrite a
    // reference video" with neither a video nor a transcript used to be
    // accepted and then quietly produced a from-scratch script.
    if (
      sourceMode === "TRANSCRIPT_REWRITE" &&
      !referenceUrl.trim() &&
      !referenceTranscript.trim()
    ) {
      toast.error(
        "Rewriting a reference video needs the video's URL (the transcript is fetched automatically) — or a pasted transcript.",
      );
      return;
    }

    if (!batchIdRef.current) {
      // generate a local UUID for this browser session batch
      batchIdRef.current = crypto.randomUUID();
    }

    setLoading(true);
    try {
      // Collect voice settings — only include fields the user actually set
      const voiceSettings: Record<string, unknown> = {};
      if (vsModel.trim()) voiceSettings.model = vsModel.trim();
      if (vsSpeed !== "") voiceSettings.speed = vsSpeed;
      if (vsStability !== "") voiceSettings.stability = vsStability;
      if (vsSimilarity !== "") voiceSettings.similarity = vsSimilarity;
      if (vsPitch !== "") voiceSettings.pitch = vsPitch;
      if (vsVolume !== "") voiceSettings.volume = vsVolume;
      if (vsLanguage.trim()) voiceSettings.language = vsLanguage.trim();

      const body: Record<string, unknown> = {
        title: title.trim(),
        channel_id: channelId,
        steps_input: steps.trim(),
        // AUTO is resolved to a concrete shape from the reference material here.
        mode: effectiveMode,
        script_provider: scriptProvider,
        script_model: scriptModel || undefined,
        tts_provider: ttsProvider,
        tts_voice: ttsVoice || settings.default_tts_voice || "en-US-Neural2-A",
        batch_id: batchIdRef.current,
        voice_settings:
          Object.keys(voiceSettings).length > 0 ? voiceSettings : undefined,
        // Source mode + language are always sent; reference fields only when
        // rewriting (and only if non-empty).
        source_mode: sourceMode,
        language: language || "English",
      };
      if (sourceMode === "TRANSCRIPT_REWRITE") {
        if (referenceUrl.trim()) body.reference_url = referenceUrl.trim();
        if (referenceTranscript.trim())
          body.reference_transcript = referenceTranscript.trim();
      }
      // ref_video_seconds is no longer STITCH-only: it is the reference video's
      // runtime, it seeds the STITCH length target, and it tells the rewrite
      // prompt how much coverage it has to beat. Send it whenever it is set.
      if (refVideoSeconds !== "") body.ref_video_seconds = refVideoSeconds;
      if (effectiveMode === "SIX_MIN_STITCH") {
        if (effectiveTargetMinutes !== null)
          body.target_minutes = effectiveTargetMinutes;
      }
      if (effectiveMode === "LONG_FORM") {
        if (effectiveTargetMinutes !== null)
          body.target_minutes = effectiveTargetMinutes;
        if (effectivePartLengthMinutes !== null)
          body.part_length_minutes = effectivePartLengthMinutes;
        if (extraContext.trim()) body.extra_context = extraContext.trim();
      }
      if (keyword) {
        body.keyword_ref = String(keyword.id);
        body.kt_url = keyword.ktUrl;
      }
      if (presetId !== "none") body.prompt_preset_id = presetId;
      if (useCustomPrompt && customPrompt.trim())
        body.custom_prompt = customPrompt.trim();

      const res = await fetch("/api/production/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }

      const { jobId } = (await res.json()) as { jobId: string };
      setBatchJobs((prev) => [
        {
          id: jobId,
          title: title.trim(),
          status: "QUEUED",
          createdAt: new Date().toISOString(),
        },
        ...prev,
      ]);
      toast.success("Job created! Script generation started.");

      /**
       * Clear everything that belonged to the keyword just used, and NOTHING
       * else. The owner: "what the VA's will do is generate multiple tutorials
       * one after another" — so the channel, the engines and the batch list all
       * survive, because they are the same for the whole run.
       *
       * The reference fields must NOT survive: leaving the last video's URL and
       * transcript in place would silently rewrite the previous keyword's source
       * into the next keyword's script. Same for the mode — it was set from a
       * keyword that is no longer selected.
       */
      setTitle("");
      setKeyword(null);
      setSteps("");
      setSourceMode("FROM_SCRATCH");
      setReferenceUrl("");
      setReferenceTranscript("");
      setRefVideoSeconds("");
      transcriptTokenRef.current++;
      setTranscript({ status: "idle" });
      setMode("AUTO");
      setPresetId(pickDefaultPresetId("THREE_MIN"));
      setTargetMinutes(20);
      setPartLengthMinutes(8);
      setExtraContext("");
      // Re-read the claim list so the keyword just used shows as made.
      setKeywordRefreshToken((n) => n + 1);
      onCreated();
      // Back to the top of Create — the claimed-keyword queue is up there and
      // picking the next one is literally the next thing they do.
      topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      toast.error(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setTitle("");
    setChannelId("");
    setSteps("");
    setMode("AUTO");
    setSourceMode("FROM_SCRATCH");
    setReferenceUrl("");
    setReferenceTranscript("");
    setLanguage("English");
    setTargetMinutes(20);
    setRefVideoSeconds("");
    setPartLengthMinutes(8);
    setExtraContext("");
    setScriptProvider(
      llmProviders.find((p) => p.isDefault)?.id ?? llmProviders[0]?.id ?? "",
    );
    setScriptModel(() => {
      const dp = llmProviders.find((p) => p.isDefault) ?? llmProviders[0];
      return (
        dp?.models?.find((m) => m.isDefault)?.value ??
        dp?.models?.[0]?.value ??
        ""
      );
    });
    setTtsProvider(
      ttsProviders.find((p) => p.isDefault)?.id ?? ttsProviders[0]?.id ?? "",
    );
    setTtsVoice("");
    setVsModel("");
    setVsSpeed("");
    setVsStability("");
    setVsSimilarity("");
    setVsPitch("");
    setVsVolume("");
    setVsLanguage("");
    setPresetId(pickDefaultPresetId("THREE_MIN"));
    setUseCustomPrompt(false);
    setCustomPrompt("");
    batchIdRef.current = null;
    setBatchJobs([]);
    setKeyword(null);
    transcriptTokenRef.current++;
    setTranscript({ status: "idle" });
  }

  /**
   * Load a claimed keyword into the form.
   *
   * Named rather than inline because the keywords panel now has a second
   * button — Send to production — which has to do EXACTLY this and then
   * submit. Duplicating it would let the two paths drift, and the thing
   * that would drift is the length plan, which is the part that already
   * caused a wrong-length job once.
   */
  /**
   * Submit the form once a Send-to-production pick has actually been applied.
   *
   * Gated on `title` matching the picked keyword: pickKeyword sets several
   * pieces of state, and firing on the flag alone could post while the title
   * was still the previous one. The transcript fetch is deliberately NOT waited
   * for — it is optional enrichment, and holding the queue on a network call to
   * YouTube is how one press turns into a VA staring at a spinner.
   */
  useEffect(() => {
    if (pendingSend === null) return;
    if (keyword?.id !== pendingSend) return;
    if (!title.trim()) return;
    setPendingSend(null);
    setSendingKeywordId(pendingSend);
    void handleGenerate().finally(() => setSendingKeywordId(null));
    // handleGenerate reads current state directly; re-running on its identity
    // would resubmit on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSend, keyword, title]);

  const pickKeyword = (k: MyKeyword) => {
    setKeyword(k);
    setTitle(k.keyword);

    /**
     * THE LENGTH COMES FROM THE KEYWORD.
     *
     * The Keyword Tool measured the reference video that already ranks
     * for this search — `duration_sec` and `length_class` are its
     * runtime, not a guess. Leaving the mode on its 3-minute default
     * after picking a 13-minute keyword was the bug the owner caught,
     * and it is not cosmetic: the job is queued, a script is written to
     * that length, TTS is paid for and a VA records the screen before
     * anyone can see it was a quarter of the length it should be.
     *
     * Applied FIRST, before the transcript arrives, so the form is
     * never briefly showing "3-Minute Tutorial" for a long keyword.
     */
    const plan = tutorialLengthPlan({
      lengthClass: k.lengthClass,
      durationSec: k.durationSec,
      stepsInput: steps,
    });
    if (plan) applyLengthPlan(plan);

    // A keyword carries the source video it was mined from. Offering it
    // as a rewrite source is the whole reason KT stores video_id.
    setTranscript({ status: "idle" });
    setReferenceTranscript("");
    setRefVideoSeconds(k.durationSec ?? "");
    if (k.referenceUrl) {
      setSourceMode("TRANSCRIPT_REWRITE");
      setReferenceUrl(k.referenceUrl);
      void fetchTranscript(k.referenceUrl, language);
    } else {
      setSourceMode("FROM_SCRATCH");
      setReferenceUrl("");
    }

    toast.success(
      plan
        ? `Loaded "${k.keyword}" — ${labelForMode(plan.mode)}.`
        : `Loaded "${k.keyword}".`,
    );
  };

  return (
    <div
      ref={topRef}
      /* scrollMarginTop keeps the tab bar from covering the top of the form
         when we scroll back here after queuing a job. */
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 320px",
        gap: 20,
        alignItems: "start",
        scrollMarginTop: 16,
      }}
    >
      {/* Left: main form */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <MyKeywords
          selectedId={keyword?.id ?? null}
          refreshToken={keywordRefreshToken}
          sending={sendingKeywordId}
          /**
           * Queue straight from the list.
           *
           * It loads the keyword exactly as "Use this" does — same length plan,
           * same transcript fetch — and then submits once that state has
           * actually landed. It cannot call generate() inline: every setter
           * above is asynchronous, so submitting in the same tick would post
           * the PREVIOUS keyword's title and mode. The flag is consumed by an
           * effect below, which runs after the re-render.
           */
          onSendToProduction={(k) => {
            pickKeyword(k);
            setPendingSend(k.id);
          }}
          onPick={pickKeyword}
          onClear={() => {
            setKeyword(null);
            setSourceMode("FROM_SCRATCH");
            setReferenceUrl("");
            setReferenceTranscript("");
            setRefVideoSeconds("");
            transcriptTokenRef.current++;
            setTranscript({ status: "idle" });
          }}
        />

        {/* Title */}
        <GlassCard style={{ padding: 20 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--v2-text-2)",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              marginBottom: 12,
            }}
          >
            Step 1 — Tutorial Details
          </div>
          <V2Input
            label="Tutorial Title"
            placeholder="e.g. How to reset a router in 3 minutes"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            fullWidth
          />

          {/* Channel — REQUIRED. Decides the Drive folder, the thumbnail style,
              and which of the three channels this video gets uploaded to. */}
          <div style={{ marginTop: 16 }}>
            <V2Listbox
              label="Channel (required)"
              value={channelId}
              onChange={setChannelId}
              options={channelOptions}
            />
            {!channelId && (
              <div
                style={{
                  fontSize: 11,
                  color: "var(--v2-text-2)",
                  marginTop: 4,
                }}
              >
                Decides the Google Drive folder, the thumbnail style, and which
                channel this video is uploaded to.
              </div>
            )}
          </div>

          {/* Source mode — write from scratch vs rewrite a reference video */}
          <div style={{ marginTop: 16 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: "var(--v2-text-2)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: 6,
              }}
            >
              Source
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {(
                [
                  { value: "FROM_SCRATCH", label: "Write from scratch" },
                  {
                    value: "TRANSCRIPT_REWRITE",
                    label: "Rewrite a reference video",
                  },
                ] as Array<{ value: SourceMode; label: string }>
              ).map((opt) => {
                const active = sourceMode === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setSourceMode(opt.value)}
                    style={{
                      flex: 1,
                      padding: "10px 12px",
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                      background: active
                        ? "rgba(var(--v2-accent-rgb), 0.15)"
                        : "var(--v2-surface-2)",
                      color: active ? "var(--v2-accent)" : "var(--v2-text-2)",
                      border: active
                        ? "1px solid var(--v2-accent)"
                        : "1px solid rgba(255,255,255,0.1)",
                      transition: "all 150ms",
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Reference fields — only when rewriting a reference video */}
          {sourceMode === "TRANSCRIPT_REWRITE" && (
            <>
              <div style={{ marginTop: 16 }}>
                <V2Input
                  label="Reference video URL"
                  placeholder="e.g. https://youtube.com/watch?v=…"
                  value={referenceUrl}
                  onChange={(e) => {
                    setReferenceUrl(e.target.value);
                    // A different video means the transcript on screen is no
                    // longer this video's. Drop it rather than let it look
                    // fetched.
                    transcriptTokenRef.current++;
                    setTranscript({ status: "idle" });
                  }}
                  fullWidth
                />
                <div
                  style={{
                    marginTop: 6,
                    fontSize: 11,
                    color: "var(--v2-text-2)",
                    lineHeight: 1.5,
                  }}
                >
                  The transcript is pulled from this video automatically — you
                  do not need to copy it out by hand. If the video has no
                  captions at all, the job stops with an error instead of
                  writing a generic script.
                </div>
              </div>
              <div style={{ marginTop: 16 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginBottom: 6,
                    flexWrap: "wrap",
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: "var(--v2-text-2)",
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                    }}
                  >
                    Reference transcript
                  </div>
                  {/* Manual fetch. Offered whenever we do not currently hold a
                      fetched transcript for this URL — after a failure, and
                      after the VA edits the URL by hand. */}
                  {transcript.status !== "ok" && (
                    <button
                      type="button"
                      disabled={
                        transcript.status === "loading" || !referenceUrl.trim()
                      }
                      onClick={() =>
                        void fetchTranscript(referenceUrl, language)
                      }
                      style={{
                        background: "none",
                        border: "1px solid rgba(var(--v2-accent-rgb), 0.5)",
                        color: "var(--v2-accent)",
                        borderRadius: 6,
                        fontSize: 11,
                        padding: "3px 10px",
                        cursor:
                          transcript.status === "loading" ||
                          !referenceUrl.trim()
                            ? "not-allowed"
                            : "pointer",
                        opacity:
                          transcript.status === "loading" ||
                          !referenceUrl.trim()
                            ? 0.5
                            : 1,
                      }}
                    >
                      {transcript.status === "loading"
                        ? "Fetching…"
                        : "Fetch transcript"}
                    </button>
                  )}
                  {transcript.status === "ok" && (
                    <span style={{ fontSize: 11, color: "#22c55e" }}>
                      Fetched {transcript.words.toLocaleString()} words from{" "}
                      {TRANSCRIPT_SOURCE_LABEL[transcript.source] ??
                        "the source video"}
                      {transcript.videoTitle
                        ? ` — ${transcript.videoTitle}`
                        : ""}
                    </span>
                  )}
                </div>

                {transcript.status === "error" && (
                  <div
                    style={{
                      marginBottom: 6,
                      fontSize: 11,
                      color: "#f87171",
                      lineHeight: 1.5,
                    }}
                  >
                    Could not fetch the transcript — {transcript.message} You
                    can retry with the button above, or paste one in below.
                  </div>
                )}

                <textarea
                  rows={6}
                  value={referenceTranscript}
                  onChange={(e) => {
                    setReferenceTranscript(e.target.value);
                    // Hand-edited text is no longer what we fetched, so stop
                    // claiming it was.
                    if (transcript.status === "ok")
                      setTranscript({ status: "idle" });
                  }}
                  /* The "leave blank" hint is WRONG once the box is full — the
                     owner's point. It only ever appears when the box is empty
                     and nothing has been fetched. */
                  placeholder={
                    transcript.status === "loading"
                      ? "Fetching the transcript from the URL above…"
                      : "Leave blank — the transcript is fetched from the URL above. Paste one only to override it (e.g. the source has no captions)."
                  }
                  style={{
                    width: "100%",
                    background: "var(--v2-surface-2)",
                    border:
                      transcript.status === "ok"
                        ? "1px solid rgba(34,197,94,0.4)"
                        : "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 8,
                    padding: "10px 12px",
                    color: "var(--v2-text-1)",
                    fontSize: 13,
                    resize: "vertical",
                    fontFamily: "inherit",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>
            </>
          )}

          {/* Language — derived from the channel, not chosen. Locked to the
              channel's language so an original job can't be filed in a language
              the channel doesn't publish; other languages come from Localize. */}
          <div style={{ marginTop: 16 }}>
            <V2Listbox
              label="Language"
              value={channelId ? channelLanguage : language}
              onChange={channelId ? () => {} : setLanguage}
              options={
                channelId
                  ? [{ value: channelLanguage, label: channelLanguage }]
                  : LANGUAGE_OPTIONS
              }
            />
            <div
              style={{ fontSize: 11, color: "var(--v2-text-2)", marginTop: 4 }}
            >
              {channelId
                ? "Set by the channel. Translations into other languages are made on the Localize tab."
                : "Pick a channel above — the language follows it."}
            </div>
          </div>

          {/* Steps + dropzone */}
          <div style={{ marginTop: 16 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: "var(--v2-text-2)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: 6,
              }}
            >
              Steps / Outline
            </div>
            <div
              {...getRootProps()}
              style={{
                position: "relative",
                border: isDragActive
                  ? "2px dashed var(--v2-accent)"
                  : "2px dashed rgba(255,255,255,0.1)",
                borderRadius: 8,
                transition: "border-color 150ms",
              }}
            >
              <input {...getInputProps()} />
              <textarea
                rows={8}
                value={steps}
                onChange={(e) => setSteps(e.target.value)}
                placeholder="Enter tutorial steps, one per line — or drag & drop a .md / .txt file here"
                style={{
                  width: "100%",
                  background: "var(--v2-surface-2)",
                  border: "none",
                  borderRadius: 8,
                  padding: "10px 12px",
                  color: "var(--v2-text-1)",
                  fontSize: 13,
                  resize: "vertical",
                  fontFamily: "inherit",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
              {isDragActive && (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: "rgba(var(--v2-accent-rgb), 0.10)",
                    borderRadius: 8,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--v2-accent)",
                    fontSize: 14,
                    fontWeight: 700,
                    pointerEvents: "none",
                  }}
                >
                  Drop .md or .txt file here
                </div>
              )}
            </div>
          </div>

          {/* Mode select */}
          <div style={{ marginTop: 16 }}>
            <V2Listbox
              label="Tutorial Mode"
              value={mode}
              onChange={(v) => {
                const newMode = v as TutorialMode | "AUTO";
                setMode(newMode);
                if (newMode !== "AUTO") {
                  // Re-pick a sensible preset for the new mode's category —
                  // the previously-selected preset.id will be wrong-category
                  // for the new mode, so submitting would send a mismatched
                  // preset id.
                  setPresetId(pickDefaultPresetId(newMode));
                  // Reset target minutes to a mode-appropriate default
                  if (newMode === "LONG_FORM") setTargetMinutes(40);
                  else if (newMode === "SIX_MIN_STITCH") setTargetMinutes(20);
                }
                // AUTO keeps its preset in sync via the effect above.
              }}
              options={modeOptions}
            />
            {/* Where the suggestion comes from — the owner asked, and the honest
                answer is now printed: the keyword's own runtime, the transcript
                we fetched, or the steps typed, in that order. */}
            {mode === "AUTO" ? (
              <div
                style={{
                  marginTop: 8,
                  fontSize: 11,
                  color: "var(--v2-text-2)",
                  lineHeight: 1.5,
                }}
              >
                {lengthPlan
                  ? `Auto → ${labelForMode(effectiveMode)} · ~${Math.round(
                      lengthPlan.estimatedMinutes,
                    )} min. ${LENGTH_SOURCE_LABEL[lengthPlan.source]}: ${lengthPlan.reason}`
                  : "Auto → a 3-minute tutorial for now. Fetch a reference video, pick a keyword, or list steps and the length will follow the reference material."}
              </div>
            ) : SHORT_ADAPTIVE_MODES.includes(mode) ? (
              <div
                style={{
                  marginTop: 8,
                  fontSize: 11,
                  color: "var(--v2-text-2)",
                  lineHeight: 1.5,
                }}
              >
                {refVideoSeconds !== ""
                  ? `Length is measured off the reference video (~${Math.round(
                      Number(refVideoSeconds) / 60,
                    )} min source). ${
                      mode === "SHORT_PLUS"
                        ? "Plus runs a bit longer than the source, spending it on worked examples."
                        : "Match mirrors the source length."
                    }`
                  : "Length will match the reference video — pick a keyword or fetch a reference video so it has a runtime to match. Without one it falls back to about 2 minutes."}
              </div>
            ) : (
              lengthPlan && (
                <div
                  style={{
                    marginTop: 8,
                    fontSize: 11,
                    color:
                      lengthPlan.mode === mode ? "var(--v2-text-2)" : "#f59e0b",
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    flexWrap: "wrap",
                    lineHeight: 1.5,
                  }}
                >
                  <span>
                    {lengthPlan.mode === mode
                      ? `Looks right — ${LENGTH_SOURCE_LABEL[lengthPlan.source]}: ${lengthPlan.reason}`
                      : `Suggested: ${labelForMode(lengthPlan.mode)} — ${LENGTH_SOURCE_LABEL[lengthPlan.source]}: ${lengthPlan.reason}`}
                  </span>
                  {lengthPlan.mode !== mode && (
                    <button
                      type="button"
                      onClick={() => applyLengthPlan(lengthPlan)}
                      style={{
                        background: "none",
                        border: "1px solid #f59e0b",
                        color: "#f59e0b",
                        borderRadius: 4,
                        fontSize: 10,
                        padding: "2px 8px",
                        cursor: "pointer",
                      }}
                    >
                      Use it
                    </button>
                  )}
                </div>
              )
            )}
          </div>

          {/* SIX_MIN_STITCH extra fields */}
          {mode === "SIX_MIN_STITCH" && (
            <div style={{ marginTop: 16, display: "flex", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: "var(--v2-text-2)",
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                    marginBottom: 6,
                  }}
                >
                  Target minutes
                </div>
                <input
                  type="number"
                  min={6}
                  max={120}
                  step={1}
                  value={targetMinutes}
                  onChange={(e) =>
                    setTargetMinutes(
                      e.target.value === "" ? "" : Number(e.target.value),
                    )
                  }
                  placeholder="e.g. 20"
                  style={{
                    width: "100%",
                    background: "var(--v2-surface-2)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 8,
                    padding: "8px 12px",
                    color: "var(--v2-text-1)",
                    fontSize: 13,
                    boxSizing: "border-box",
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: "var(--v2-text-2)",
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                    marginBottom: 6,
                  }}
                >
                  Ref video length (seconds, optional)
                </div>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={refVideoSeconds}
                  onChange={(e) =>
                    setRefVideoSeconds(
                      e.target.value === "" ? "" : Number(e.target.value),
                    )
                  }
                  placeholder="e.g. 1200"
                  style={{
                    width: "100%",
                    background: "var(--v2-surface-2)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 8,
                    padding: "8px 12px",
                    color: "var(--v2-text-1)",
                    fontSize: 13,
                    boxSizing: "border-box",
                  }}
                />
                <div
                  style={{
                    marginTop: 6,
                    fontSize: 11,
                    color: "var(--v2-text-2)",
                    lineHeight: 1.5,
                  }}
                >
                  Runtime of the video you are beating. Leave blank when
                  rewriting a reference video — it is filled in from the source
                  automatically. Used as the length target when Target minutes
                  is empty, and told to the writer as the coverage to beat.
                </div>
              </div>
            </div>
          )}

          {/* LONG_FORM extra fields */}
          {mode === "LONG_FORM" && (
            <>
              <div style={{ marginTop: 16, display: "flex", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: "var(--v2-text-2)",
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                      marginBottom: 6,
                    }}
                  >
                    Target length (minutes)
                  </div>
                  <input
                    type="number"
                    min={10}
                    max={300}
                    step={1}
                    value={targetMinutes}
                    onChange={(e) =>
                      setTargetMinutes(
                        e.target.value === "" ? "" : Number(e.target.value),
                      )
                    }
                    placeholder="e.g. 40"
                    style={{
                      width: "100%",
                      background: "var(--v2-surface-2)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 8,
                      padding: "8px 12px",
                      color: "var(--v2-text-1)",
                      fontSize: 13,
                      boxSizing: "border-box",
                    }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: "var(--v2-text-2)",
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                      marginBottom: 6,
                    }}
                  >
                    Part length (minutes)
                  </div>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    step={1}
                    value={partLengthMinutes}
                    onChange={(e) =>
                      setPartLengthMinutes(
                        e.target.value === "" ? "" : Number(e.target.value),
                      )
                    }
                    placeholder="e.g. 8"
                    style={{
                      width: "100%",
                      background: "var(--v2-surface-2)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 8,
                      padding: "8px 12px",
                      color: "var(--v2-text-1)",
                      fontSize: 13,
                      boxSizing: "border-box",
                    }}
                  />
                </div>
              </div>
              <div style={{ marginTop: 16 }}>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: "var(--v2-text-2)",
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                    marginBottom: 6,
                  }}
                >
                  Additional Context & Instructions (optional)
                </div>
                <textarea
                  value={extraContext}
                  onChange={(e) => setExtraContext(e.target.value)}
                  placeholder="Optional extra context or instructions for the script writer — tone, target audience, must-cover points, things to avoid, etc."
                  rows={4}
                  style={{
                    width: "100%",
                    background: "var(--v2-surface-2)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 8,
                    padding: "8px 12px",
                    color: "var(--v2-text-1)",
                    fontSize: 13,
                    boxSizing: "border-box",
                    resize: "vertical",
                  }}
                />
              </div>
            </>
          )}
        </GlassCard>

        {/* Actions */}
        <div style={{ display: "flex", gap: 12 }}>
          <V2Button
            variant="accent"
            size="lg"
            onClick={handleGenerate}
            disabled={loading}
          >
            {loading ? "Submitting…" : "Generate Script & Audio"}
          </V2Button>
          <V2Button variant="outline" onClick={handleReset} disabled={loading}>
            Reset
          </V2Button>
        </div>

        {/* Batch list */}
        {batchJobs.length > 0 && (
          <GlassCard style={{ padding: 20 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "var(--v2-text-2)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: 12,
              }}
            >
              This Session — {batchJobs.length} job
              {batchJobs.length !== 1 ? "s" : ""}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {batchJobs.map((j) => (
                <div
                  key={j.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "8px 12px",
                    background: "rgba(255,255,255,0.03)",
                    borderRadius: 8,
                    gap: 12,
                  }}
                >
                  <span
                    style={{
                      fontSize: 13,
                      color: "var(--v2-text-1)",
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {j.title}
                  </span>
                  <StatusBadge status={j.status} />
                </div>
              ))}
            </div>
          </GlassCard>
        )}
      </div>

      {/* Right: the recipe.

          This column used to be five always-open cards of engine controls —
          script engine, model, TTS provider, voice id, seven voice sliders,
          prompt preset, custom prompt override, and a permanently disabled
          "Intro video — Coming Soon" checkbox. The owner's read: "the virtual
          assistants do not need to really make these settings and a lot of
          these selections."

          They do not, and they never did: every job in the last week used the
          same script engine, the same model and the same voice engine. So the
          column now STATES the recipe, and the controls that change it live
          behind one disclosure that only ADMIN/MANAGER see. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <GlassCard style={{ padding: 20 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--v2-text-2)",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              marginBottom: 14,
            }}
          >
            How this will be made
          </div>

          <RecipeRow
            label="Script"
            value={scriptProviderMeta?.label ?? scriptProvider ?? "—"}
            detail={
              scriptProviderMeta?.models?.find((m) => m.value === scriptModel)
                ?.label ?? scriptModel
            }
          />
          <RecipeRow
            label="Voice"
            value={ttsProviderMeta?.label ?? ttsProvider ?? "—"}
            detail={
              ttsVoice.trim()
                ? `voice ${ttsVoice.trim()}`
                : channelId
                  ? "the voice bound to this channel"
                  : "the studio default voice"
            }
          />
          <RecipeRow
            label="Prompt"
            value={
              useCustomPrompt
                ? "Custom prompt"
                : (relevantPresets.find((p) => p.id === presetId)?.name ??
                  "— none selected —")
            }
            detail={
              mode === "AUTO"
                ? `Auto → ${labelForMode(effectiveMode)}`
                : (modeOptions.find((m) => m.value === mode)?.label ?? mode)
            }
          />

          {llmProviders.length === 0 && (
            <div style={{ marginTop: 12, fontSize: 11, color: "#f87171" }}>
              No script engine has a working API key. Nothing can be generated
              until an administrator adds one in Settings → Credentials.
            </div>
          )}
          {ttsProviders.length === 0 && (
            <div style={{ marginTop: 12, fontSize: 11, color: "#f87171" }}>
              No voice engine has a working API key. Nothing can be generated
              until an administrator adds one in Settings → Credentials.
            </div>
          )}

          {canManage && (
            <button
              type="button"
              onClick={() => setShowEngines((v) => !v)}
              style={{
                marginTop: 14,
                background: "none",
                border: "1px solid rgba(255,255,255,0.14)",
                borderRadius: 6,
                color: "var(--v2-text-2)",
                fontSize: 11,
                padding: "5px 10px",
                cursor: "pointer",
              }}
            >
              {showEngines ? "Hide engine settings" : "Change engine settings"}
            </button>
          )}
        </GlassCard>

        {canManage && showEngines && (
          <>
            <GlassCard style={{ padding: 20 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--v2-text-2)",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  marginBottom: 16,
                }}
              >
                Script Provider
              </div>
              <V2Listbox
                label="Script Engine"
                value={scriptProvider}
                onChange={(id) => {
                  setScriptProvider(id);
                  const p = llmProviders.find((pr) => pr.id === id);
                  setScriptModel(
                    p?.models?.find((m) => m.isDefault)?.value ??
                      p?.models?.[0]?.value ??
                      "",
                  );
                }}
                options={llmOptions}
              />
              {scriptProviderMeta?.models &&
                scriptProviderMeta.models.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <V2Listbox
                      label="Model"
                      value={scriptModel}
                      onChange={setScriptModel}
                      options={scriptProviderMeta.models.map((m) => ({
                        value: m.value,
                        label: m.label,
                      }))}
                    />
                  </div>
                )}
            </GlassCard>

            <GlassCard style={{ padding: 20 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--v2-text-2)",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  marginBottom: 16,
                }}
              >
                Voice / TTS Provider
              </div>
              <V2Listbox
                label="TTS Provider"
                value={ttsProvider}
                onChange={setTtsProvider}
                options={ttsOptions}
              />
              <div style={{ marginTop: 12 }}>
                <V2Input
                  label="Voice ID (optional)"
                  placeholder="Leave blank — the channel's voice is used"
                  value={ttsVoice}
                  onChange={(e) => setTtsVoice(e.target.value)}
                  fullWidth
                />
                <div
                  style={{
                    marginTop: 6,
                    fontSize: 10,
                    color: "var(--v2-text-2)",
                    lineHeight: 1.5,
                  }}
                >
                  Blank is the right answer almost always: the worker uses the
                  voice bound to the chosen channel, and falls back to the
                  studio default. Only type an id to override that for this one
                  job.
                </div>
              </div>
            </GlassCard>

            <GlassCard style={{ padding: 20 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--v2-text-2)",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  marginBottom: 16,
                }}
              >
                Voice Settings (optional)
              </div>
              <div
                style={{ display: "flex", flexDirection: "column", gap: 12 }}
              >
                {voiceControls.has("model") && (
                  <V2Input
                    label="Model (e.g. eleven_turbo_v2)"
                    placeholder="Leave blank for provider default"
                    value={vsModel}
                    onChange={(e) => setVsModel(e.target.value)}
                    fullWidth
                  />
                )}
                {voiceControls.has("speed") && (
                  <VoiceSlider
                    label="Speed"
                    min={0.5}
                    max={2.5}
                    step={0.05}
                    value={vsSpeed}
                    onChange={setVsSpeed}
                    hint="0.5 = slowest · 1.0 = normal · 2.5 = fastest"
                  />
                )}
                {voiceControls.has("stability") && (
                  <VoiceSlider
                    label="Stability"
                    min={0}
                    max={1}
                    step={0.05}
                    value={vsStability}
                    onChange={setVsStability}
                    hint="0 = more expressive · 1 = very consistent"
                  />
                )}
                {voiceControls.has("similarity") && (
                  <VoiceSlider
                    label="Similarity"
                    min={0}
                    max={1}
                    step={0.05}
                    value={vsSimilarity}
                    onChange={setVsSimilarity}
                    hint="0 = less similar to original · 1 = very similar"
                  />
                )}
                {voiceControls.has("pitch") && (
                  <VoiceSlider
                    label="Pitch (semitones)"
                    min={-12}
                    max={12}
                    step={1}
                    value={vsPitch}
                    onChange={setVsPitch}
                    hint="-12 = lowest · 0 = default · +12 = highest"
                  />
                )}
                {voiceControls.has("volume") && (
                  <VoiceSlider
                    label="Volume"
                    min={0}
                    max={2}
                    step={0.05}
                    value={vsVolume}
                    onChange={setVsVolume}
                    hint="0 = silent · 1 = normal · 2 = loudest"
                  />
                )}
                {voiceControls.has("language") && (
                  <V2Input
                    label="Language / Boost (e.g. en, zh)"
                    placeholder="Leave blank for auto-detect"
                    value={vsLanguage}
                    onChange={(e) => setVsLanguage(e.target.value)}
                    fullWidth
                  />
                )}
                {voiceControls.size === 1 && voiceControls.has("speed") && (
                  <div
                    style={{
                      fontSize: 10,
                      color: "var(--v2-text-2)",
                      lineHeight: 1.5,
                    }}
                  >
                    This provider uses its own defaults — only Speed applies.
                  </div>
                )}
              </div>
            </GlassCard>

            <GlassCard style={{ padding: 20 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--v2-text-2)",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  marginBottom: 16,
                }}
              >
                Prompt Preset
              </div>
              <V2Listbox
                label="Preset"
                value={presetId}
                onChange={setPresetId}
                options={presetOptions}
                disabled={useCustomPrompt}
              />

              <div style={{ marginTop: 12 }}>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    cursor: "pointer",
                    fontSize: 12,
                    color: "var(--v2-text-2)",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={useCustomPrompt}
                    onChange={(e) => setUseCustomPrompt(e.target.checked)}
                  />
                  Use custom prompt instead
                </label>
              </div>

              {useCustomPrompt && (
                <div style={{ marginTop: 12 }}>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: "var(--v2-text-2)",
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                      marginBottom: 6,
                    }}
                  >
                    Custom System Prompt
                  </div>
                  <textarea
                    rows={5}
                    value={customPrompt}
                    onChange={(e) => setCustomPrompt(e.target.value)}
                    placeholder="Enter your custom system prompt for the script generator…"
                    style={{
                      width: "100%",
                      background: "var(--v2-surface-2)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 8,
                      padding: "10px 12px",
                      color: "var(--v2-text-1)",
                      fontSize: 12,
                      resize: "vertical",
                      fontFamily: "inherit",
                      outline: "none",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
              )}
            </GlassCard>
          </>
        )}
      </div>
    </div>
  );
}

/** One line of the recipe card: what will be used, and the detail under it. */
function RecipeRow({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        alignItems: "baseline",
        padding: "7px 0",
        borderTop: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: "var(--v2-text-2)",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          flex: "0 0 54px",
        }}
      >
        {label}
      </span>
      <span style={{ minWidth: 0 }}>
        <span
          style={{
            display: "block",
            fontSize: 12,
            fontWeight: 600,
            color: "var(--v2-text-1)",
          }}
        >
          {value}
        </span>
        {detail && (
          <span style={{ fontSize: 10, color: "var(--v2-text-2)" }}>
            {detail}
          </span>
        )}
      </span>
    </div>
  );
}
