/**
 * Queue Name Constants
 *
 * Centralized string constants for all BullMQ queue lanes.
 * Prevents magic strings scattered across the codebase.
 */

export const QUEUE_NAMES = {
  /**
   * Ingest Queue
   * - Initial job creation and workflow setup
   * - Workload: High concurrency, short timeout
   */
  INGEST: "queue-ingest",

  /**
   * AI Generation Queue
   * - TTS generation (ElevenLabs/Qwen3)
   * - LLM API calls (script generation)
   * - AI image generation (thumbnails)
   * - Translation engine
   * - Workload: Medium concurrency, longer timeout (external API calls)
   */
  AI_GENERATION: "queue-ai-generation",

  /**
   * Asset Collection Queue
   * - Orchestrates 6-step asset collection pipeline
   * - TTS audio generation and expert splicing
   * - Scene decomposition
   * - Concurrent scene image generation
   * - Thumbnail generation
   * - Assembly manifest creation
   * - Workload: High concurrency (lightweight coordination)
   */
  ASSET_COLLECTION: "queue-asset-collection",

  /**
   * QMS Validation Queue
   * - Lightweight pre-flight checks before expensive operations
   * - Asset validation
   * - Payload schema validation
   * - Workload: High concurrency, short timeout
   */
  QMS_VALIDATION: "queue-qms-validation",

  /**
   * Render Heavy Queue
   * - FFmpeg rendering (lightweight path)
   * - Remotion rendering (heavyweight React-based path)
   * - Workload: Concurrency 1-2 per VPS, very long timeout (CPU-bound)
   */
  RENDER_HEAVY: "queue-render-heavy",

  /**
   * Garbage Collection Queue
   * - Hard deletion of R2 assets
   * - Zombie job cleanup
   * - Orphaned asset detection and removal
   * - Workload: Low concurrency, medium timeout
   */
  GARBAGE_COLLECTION: "queue-garbage-collection",

  /**
   * Scene Analysis Queue
   * - LLM-based script decomposition into structured scenes
   * - Populates assembly_manifest with paragraphs, visual types, image prompts, ticker headlines
   * - Workload: Medium concurrency, LLM API timeout (~30s per job)
   */
  SCENE_ANALYSIS: "queue-scene-analysis",

  /**
   * Auto-Label Queue
   * - Automatic description + tag generation for AI-generated assets
   * - Calls local Ollama LLM using generation_recipe.prompt_template as context
   * - Workload: Low concurrency (local LLM, I/O bound), low priority
   */
  AUTO_LABEL: "queue-auto-label",

  /**
   * Dead Letter Queue
   * - Irrecoverable failures for manual inspection
   * - No automatic processing
   * - Requires human intervention
   * - Workload: Manual processing only, no workers
   */
  DEAD_LETTER: "queue-dead-letter",

  /**
   * Bundestag Clip Analysis Queue
   * - Transcription of parliamentary debate clips
   * - LLM-based clip analysis (content, speaker, emotion, quality)
   * - Metadata synchronization with Bundestag data sources
   * - Workload: Medium concurrency, longer timeout (transcription + API calls)
   */
  BUNDESTAG_CLIP_ANALYSIS: "queue-bundestag-clip-analysis",

  /**
   * Bundestag Playbook Generation Queue
   * - Generates structured editing playbook from analyzed clips
   * - Uses local LLM (Ollama) or remote LLM to create edit sequences
   * - Produces cutting, transition, and pacing decisions
   * - Workload: Low concurrency, short timeout (LLM inference)
   */
  BUNDESTAG_PLAYBOOK_GENERATION: "queue-bundestag-playbook-generation",

  /**
   * Bundestag Render Queue
   * - FFmpeg-based video composition using playbook
   * - Generates multiple output variants (16:9, 9:16, 1:1, various durations)
   * - Applies effects, transitions, and overlays per playbook
   * - Workload: Concurrency 1-2 per VPS, very long timeout (CPU-bound)
   */
  BUNDESTAG_RENDER: "queue-bundestag-render",

  /**
   * Video Stitch Queue
   * - Stitches multiple VA tutorial recordings into single videos
   * - Normalizes different resolutions/FPS via FFmpeg
   * - Optional voiceover with automatic time-stretching
   * - Optional music mixing and captions
   * - Remotion-based transitions between clips
   * - Workload: Concurrency 1 (fixed), capacity-limited to 50% server resources
   */
  VIDEO_STITCH: "queue-video-stitch",

  /**
   * Clip Ingest Queue
   * - Downloads source video + runs scene detection
   * - Workload: I/O-bound, concurrency 3
   */
  CLIP_INGEST: "queue-clip-ingest",

  /**
   * Clip Label Queue
   * - GPU-serialized VLM + Whisper large-v3 + face + audio analysis
   * - Concurrency MUST be 1 — GPU is the bottleneck
   * - Workload: GPU-bound, concurrency 1
   */
  CLIP_LABEL: "queue-clip-label",

  /**
   * Clip Label Batch Queue
   * - One job per source_video; labels every clip in sequence so the worker
   *   can inject prev_context (and later next_keyframe) when sending tiny
   *   clips to Gemini. Without context, micro-clips (<1s) get hallucinated
   *   labels because half a second of a pan has no semantic anchor.
   * - Per-library labeling_concurrency soft cap still applies inside the batch.
   * - Workload: same as CLIP_LABEL but coarser job granularity.
   */
  CLIP_LABEL_BATCH: "queue-clip-label-batch",

  /**
   * Clip Embed Queue
   * - BGE-M3 text + visual embeddings for clip retrieval
   * - Workload: CPU-bound, no GPU contention, concurrency 5
   */
  CLIP_EMBED: "queue-clip-embed",

  /**
   * Clip Selection Queue
   * - AI agent: 1 LLM call + N batch vector retrievals
   * - Workload: Network I/O bound, concurrency 2
   */
  CLIP_SELECTION: "queue-clip-selection",

  /**
   * Clip Retag Queue
   * - Re-assigns vocabulary tags from existing ai_description using Claude Haiku
   * - Used when vocabulary is added/changed after initial labeling
   * - Concurrency 5 (LLM API calls, no GPU)
   */
  CLIP_RETAG: "queue-clip-retag",

  /**
   * Clip Extract Queue
   * - FFmpeg extraction of each scene cut into its own MP4 (materialized storage strategy)
   * - One job per source_video; extracts all clips for that video
   * - Concurrency 2 — I/O-bound (disk read + write), FFmpeg stream-copy is fast
   */
  CLIP_EXTRACT: "queue-clip-extract",

  /**
   * Image Ingest Queue
   * - HTTP download / file copy → SHA-256 + pHash + palette + DB insert
   * - One job per source_image. No scene detection (image IS the unit).
   * - Workload: I/O-bound, concurrency 6
   */
  IMAGE_INGEST: "queue-image-ingest",

  /**
   * Image Label Queue
   * - Gemini single-frame VLM call + face recognition
   * - Workload: network I/O + GPU sidecar, concurrency 4 (matches CLIP_LABEL)
   */
  IMAGE_LABEL: "queue-image-label",

  /**
   * Image Embed Queue
   * - BGE-M3 text embedding of description + tags. Semantic dedup branch.
   * - Workload: CPU-bound (sidecar), concurrency 5
   */
  IMAGE_EMBED: "queue-image-embed",

  /** Drama TTS Queue — ElevenLabs TTS, concurrency 2, lock 30min */
  DRAMA_TTS: "queue-drama-tts",
  /** Drama Transcribe Queue — Faster Whisper, concurrency 2, lock 30min */
  DRAMA_TRANSCRIBE: "queue-drama-transcribe",
  /** Drama Prompt Gen Queue — Gemini pool, concurrency 2 */
  DRAMA_PROMPT_GEN: "queue-drama-prompt-gen",
  /** Drama Image Gen Queue — Nano Banana parallel, concurrency 2, lock 2hr */
  DRAMA_IMAGE_GEN: "queue-drama-image-gen",
  /** Drama Video Gen Queue — Veo i2v per clip, concurrency 1, lock 3hr */
  DRAMA_VIDEO_GEN: "queue-drama-video-gen",
  /** Drama Assemble Queue — FFmpeg Ken Burns or video concat, concurrency 1, lock 3hr */
  DRAMA_ASSEMBLE: "queue-drama-assemble",
  /** Drama QC Queue — pyscenedetect + LUFS, concurrency 2 */
  DRAMA_QC: "queue-drama-qc",
  /** Drama Thumbnail Queue — Nano Banana single image, concurrency 4 */
  DRAMA_THUMBNAIL: "queue-drama-thumbnail",
  /** Global Thumbnail Queue — single i2i image via media-gateway, concurrency 4 */
  THUMBNAIL: "queue-thumbnail",
  /** Stock library bootstrap — VEO t2v one clip per job, fire-and-forget */
  STOCK_LIBRARY_GEN: "queue-stock-library-gen",

  /**
   * Tutorial Generate Queue — LLM script generation + TTS synthesis, concurrency 4, lock 30min
   */
  TUTORIAL_GENERATE: "queue-tutorial-generate",

  /**
   * Tutorial Splice Queue — FFmpeg mux TTS onto recording, concurrency 2, lock 30min
   */
  TUTORIAL_SPLICE: "queue-tutorial-splice",

  /**
   * Tutorial Translate Queue — per-language LLM translate + TTS re-synthesis of a
   * COMPLETED source tutorial, then hand off to TUTORIAL_SPLICE for the child.
   * Concurrency 2, lock 30min (LLM + TTS network I/O).
   */
  TUTORIAL_TRANSLATE: "queue-tutorial-translate",

  /**
   * Tutorial Stitch Queue — FFmpeg concat all segment MP4s into final parent MP4.
   * Concurrency 1, lock 20min (CPU-bound concat).
   * Triggered automatically when all child segments of a SIX_MIN_STITCH parent are COMPLETED.
   */
  TUTORIAL_STITCH: "queue-tutorial-stitch",

  /** Reactor Download Queue — yt-dlp YouTube download, concurrency 2, lock 30min */
  REACTOR_DOWNLOAD: "queue-reactor-download",
  /** Reactor Transcribe Queue — FasterWhisper transcription, concurrency 2, lock 60min */
  REACTOR_TRANSCRIBE: "queue-reactor-transcribe",
  /** Reactor Script Queue — Claude reactor script generation, concurrency 2, lock 10min */
  REACTOR_SCRIPT: "queue-reactor-script",
  /** Reactor TTS Queue — ElevenLabs/Minimax TTS per segment, concurrency 2, lock 30min */
  REACTOR_TTS: "queue-reactor-tts",
  /** Reactor Assemble Queue — amplitude analysis + assembly manifest, concurrency 2, lock 10min */
  REACTOR_ASSEMBLE: "queue-reactor-assemble",

  // ── Tech Comparison footage collection ───────────────────────────────────
  /** Tech footage collection — yt-dlp + Pexels per scene, concurrency 2, lock 10min */
  TECH_FOOTAGE_COLLECTION: "queue-tech-footage-collection",

  // ── Clip Forge — 9:16 short-form clipping pipeline ───────────────────────
  /** Clip Forge Ingest — yt-dlp download + ffprobe + Whisper, concurrency 2, lock 6h */
  CF_INGEST: "queue-cf-ingest",
  /** Clip Forge Clip Detection — DeepSeek clip mining, concurrency 3, lock 10min */
  CF_CLIP_DETECTION: "queue-cf-clip-detection",
  /** Clip Forge Raw Render — FFmpeg cut + 9:16 reframe, concurrency 1, lock 30min */
  CF_RAW_RENDER: "queue-cf-raw-render",
  /** Clip Forge Finishing Render — single-variant re-render driven by Studio edits, concurrency 1, lock 30min */
  CF_FINISHING_RENDER: "queue-cf-finishing-render",
} as const;

/**
 * Type-safe queue name type
 */
export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
