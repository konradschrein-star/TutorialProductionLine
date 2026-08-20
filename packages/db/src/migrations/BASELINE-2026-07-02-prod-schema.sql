-- BASELINE REFERENCE — NOT A RUNNABLE MIGRATION
-- pg_dump --schema-only of the live production database (content-forge-postgres
-- on 65.108.6.149, db content_forge) taken 2026-07-02 during Phase 0 repo rescue.
-- Ground truth for what prod actually looks like: the drizzle journal is known
-- to be unreliable (27 SQL files vs 13 journal entries, duplicate numbers).
-- Use this to verify schema drift; do not execute via any migration runner.

--
-- PostgreSQL database dump
--

\restrict 2yUTcPE9Fpdr4N1irbqVpFnBhMb4f7YAfOx7MNJ837KPavPNKDYgv7nPbRyF7nf

-- Dumped from database version 16.13
-- Dumped by pg_dump version 16.13

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: drizzle; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA drizzle;


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: vector; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;


--
-- Name: EXTENSION vector; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION vector IS 'vector data type and ivfflat and hnsw access methods';


--
-- Name: bundestag_camera_angle; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.bundestag_camera_angle AS ENUM (
    'wide',
    'closeup',
    'medium',
    'reaction',
    'speaker',
    'audience',
    'overview',
    'unknown'
);


--
-- Name: bundestag_job_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.bundestag_job_status AS ENUM (
    'CREATED',
    'PENDING_UPLOAD',
    'ANALYZING_CLIPS',
    'CLIPS_ANALYZED',
    'GENERATING_PLAYBOOK',
    'PLAYBOOK_GENERATED',
    'RENDERING',
    'RENDERED',
    'AWAITING_QA',
    'QA_APPROVED',
    'QA_REJECTED',
    'COMPLETED',
    'FAILED',
    'CANCELLED',
    'FAILED_CLIP_ANALYSIS',
    'FAILED_PLAYBOOK_GENERATION',
    'FAILED_RENDERING',
    'FAILED_QA'
);


--
-- Name: bundestag_sync_method; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.bundestag_sync_method AS ENUM (
    'audio_correlation',
    'manual',
    'assumed_zero'
);


--
-- Name: bundestag_transcription_quality_grade; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.bundestag_transcription_quality_grade AS ENUM (
    'excellent',
    'good',
    'acceptable',
    'poor',
    'failed'
);


--
-- Name: clip_audio_class; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.clip_audio_class AS ENUM (
    'dialogue',
    'music_only',
    'speech_over_music',
    'action_sfx',
    'ambient',
    'silence'
);


--
-- Name: clip_forge_category; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.clip_forge_category AS ENUM (
    'wisdom',
    'funny',
    'controversial',
    'story',
    'educational',
    'hot_take',
    'hype',
    'insight',
    'reaction',
    'rant',
    'wholesome',
    'other'
);


--
-- Name: clip_forge_distribution_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.clip_forge_distribution_status AS ENUM (
    'pooled',
    'assigned',
    'rendered',
    'qc_pass',
    'qc_flag',
    'qc_fail',
    'queued',
    'uploaded',
    'live',
    'failed',
    'skipped',
    'cancelled'
);


--
-- Name: clip_forge_error_class; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.clip_forge_error_class AS ENUM (
    'transient',
    'resource',
    'data',
    'platform',
    'logic'
);


--
-- Name: clip_forge_payout_model; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.clip_forge_payout_model AS ENUM (
    'per_view',
    'per_clip',
    'flat'
);


--
-- Name: clip_forge_platform; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.clip_forge_platform AS ENUM (
    'tiktok',
    'instagram',
    'youtube_shorts'
);


--
-- Name: clip_forge_qc_result; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.clip_forge_qc_result AS ENUM (
    'pass',
    'flag',
    'fail'
);


--
-- Name: clip_forge_raw_clip_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.clip_forge_raw_clip_status AS ENUM (
    'detected',
    'rendering',
    'ready',
    'rejected',
    'cancelled'
);


--
-- Name: clip_forge_source_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.clip_forge_source_kind AS ENUM (
    'youtube_vod',
    'twitch_vod',
    'podcast_rss',
    'manual_upload',
    'other'
);


--
-- Name: clip_forge_source_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.clip_forge_source_status AS ENUM (
    'ingested',
    'transcribed',
    'extracted',
    'duplicate',
    'failed'
);


--
-- Name: clip_ingest_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.clip_ingest_status AS ENUM (
    'pending',
    'downloading',
    'download_failed',
    'processing',
    'processing_failed',
    'labeling',
    'labeling_failed',
    'embedding',
    'embedding_failed',
    'ready',
    'archived'
);


--
-- Name: clip_labeling_step; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.clip_labeling_step AS ENUM (
    'vlm',
    'whisper',
    'face',
    'audio',
    'done',
    'minicpm'
);


--
-- Name: clip_review_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.clip_review_status AS ENUM (
    'pending',
    'approved',
    'edited',
    'flagged',
    'skipped'
);


--
-- Name: clip_shot_scale; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.clip_shot_scale AS ENUM (
    'extreme_close',
    'close',
    'medium',
    'wide',
    'extreme_wide',
    'over_shoulder',
    'pov',
    'aerial',
    'unknown'
);


--
-- Name: clip_storage_strategy; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.clip_storage_strategy AS ENUM (
    'inline',
    'materialized'
);


--
-- Name: clip_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.clip_type AS ENUM (
    'text_on_screen',
    'footage_movie',
    'footage_clone_wars',
    'footage_animation',
    'footage_comic',
    'ai_generated',
    'unknown',
    'footage_real',
    'footage_news',
    'footage_documentary',
    'footage_stock',
    'footage_animation_2d',
    'footage_animation_3d',
    'footage_vfx_heavy',
    'footage_archival',
    'screen_recording'
);


--
-- Name: content_format; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.content_format AS ENUM (
    'EXPLAINER',
    'DOCUMENTARY',
    'POLITICAL_COMMENTARY',
    'TECH_COMPARISON',
    'DAY_IN_THE_LIFE',
    'HISTORICAL_WHAT_IF',
    'VIDEO_ESSAY',
    'NEWS_BROADCAST',
    'CASUALLY_EXPLAINED',
    'STICKMAN_ANIMATION',
    'SELF_NARRATED_STORY',
    'BUNDESTAG',
    'SPACE_VIDEO',
    'LONG_FORM_DRAMA',
    'POLITICAL_COMMENTARY_REACTOR',
    'RANKING'
);


--
-- Name: image_generation_mode; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.image_generation_mode AS ENUM (
    'auto',
    'manual'
);


--
-- Name: job_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.job_status AS ENUM (
    'IDEA_GENERATION',
    'SCRIPTING',
    'AWAITING_RESEARCH',
    'RESEARCH_UPLOADED',
    'TRANSLATING',
    'ASSET_COLLECTION',
    'QMS_VALIDATING',
    'ROUTING_RENDER',
    'RENDERING_FFMPEG',
    'RENDERING_REMOTION',
    'AWAITING_PRODUCTION_VA',
    'AWAITING_IMAGE_QC',
    'AWAITING_QC',
    'AWAITING_UPLOADER',
    'UPLOADING',
    'PUBLISHED',
    'CANCELLED',
    'DELETED',
    'FAILED_QMS',
    'FAILED_RENDER',
    'FAILED_UPLOAD',
    'FAILED_GENERAL',
    'FAILED_IRRECOVERABLE',
    'PAUSED',
    'MARKED_FOR_DELETION',
    'CLIP_SELECTION',
    'AWAITING_CLIP_REVIEW',
    'FAILED_CLIP_SELECTION',
    'SPACE_TTS_GENERATING',
    'SPACE_TRANSCRIBING',
    'SPACE_PROMPT_GENERATING',
    'SPACE_IMAGE_GENERATING',
    'SPACE_VIDEO_GENERATING',
    'SPACE_ASSEMBLING',
    'FAILED_SPACE_PIPELINE',
    'DRAMA_TTS_GENERATING',
    'DRAMA_TRANSCRIBING',
    'DRAMA_PROMPT_GENERATING',
    'DRAMA_IMAGE_GENERATING',
    'DRAMA_VIDEO_GENERATING',
    'DRAMA_ASSEMBLING',
    'DRAMA_QC',
    'DRAMA_QC_FAILED',
    'FAILED_DRAMA_PIPELINE',
    'REACTOR_DOWNLOADING',
    'REACTOR_TRANSCRIBING',
    'REACTOR_SCRIPTING',
    'REACTOR_TTS_GENERATING',
    'REACTOR_ASSEMBLING',
    'FAILED_REACTOR_PIPELINE',
    'TECH_FOOTAGE_COLLECTING',
    'TECH_FOOTAGE_FAILED'
);


--
-- Name: operator_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.operator_role AS ENUM (
    'ADMIN',
    'MANAGER',
    'PRODUCTION_VA',
    'UPLOADER_VA',
    'VIEWER',
    'DRAMA_OPERATOR',
    'TUTORIAL_VA',
    'INVESTOR'
);


--
-- Name: production_version; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.production_version AS ENUM (
    'V1',
    'V2',
    'V3'
);


--
-- Name: render_engine; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.render_engine AS ENUM (
    'FFMPEG',
    'REMOTION'
);


--
-- Name: secret_capability; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.secret_capability AS ENUM (
    'LLM',
    'TTS'
);


--
-- Name: source_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.source_kind AS ENUM (
    'movie',
    'series',
    'youtube',
    'stock',
    'upload',
    'other'
);


--
-- Name: storage_backend; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.storage_backend AS ENUM (
    'local',
    'nas',
    's3'
);


--
-- Name: tutorial_derivative_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.tutorial_derivative_status AS ENUM (
    'PENDING',
    'TRANSLATING',
    'GENERATING_AUDIO',
    'GENERATING_INTRO',
    'RENDERING',
    'COMPLETED',
    'FAILED'
);


--
-- Name: tutorial_job_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.tutorial_job_status AS ENUM (
    'QUEUED',
    'GENERATING_SCRIPT',
    'GENERATING_AUDIO',
    'READY_TO_RECORD',
    'AWAITING_UPLOAD',
    'SPLICING',
    'COMPLETED',
    'FAILED_SCRIPT',
    'FAILED_AUDIO',
    'FAILED_SPLICE',
    'CANCELLED',
    'AWAITING_RECORDINGS',
    'RECORDED',
    'READY_TO_STITCH',
    'SENT_TO_STITCHER'
);


--
-- Name: tutorial_mode; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.tutorial_mode AS ENUM (
    'THREE_MIN',
    'SIX_MIN',
    'SIX_MIN_STITCH',
    'LONG_FORM'
);


--
-- Name: tutorial_prompt_category; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.tutorial_prompt_category AS ENUM (
    'THREE_MIN',
    'SIX_MIN',
    'SIX_MIN_STITCH',
    'LONG_FORM'
);


--
-- Name: prevent_style_assets_insert(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_style_assets_insert() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'style_assets table is deprecated. Use style_collections instead. See /style-library or /style-collections in the Hub.';
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: __drizzle_migrations; Type: TABLE; Schema: drizzle; Owner: -
--

CREATE TABLE drizzle.__drizzle_migrations (
    id integer NOT NULL,
    hash text NOT NULL,
    created_at bigint
);


--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE; Schema: drizzle; Owner: -
--

CREATE SEQUENCE drizzle.__drizzle_migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: drizzle; Owner: -
--

ALTER SEQUENCE drizzle.__drizzle_migrations_id_seq OWNED BY drizzle.__drizzle_migrations.id;


--
-- Name: archetypes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.archetypes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    style_prefix text,
    style_suffix text,
    image_style character varying(30),
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    metadata jsonb,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: asset_collection_memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_collection_memberships (
    asset_id uuid NOT NULL,
    collection_id uuid NOT NULL,
    added_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: asset_collections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_collections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    color character varying(7) DEFAULT '#6366F1'::character varying,
    icon character varying(50) DEFAULT 'folder'::character varying,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(150) NOT NULL,
    description text NOT NULL,
    asset_type character varying(50) NOT NULL,
    origin character varying(20) DEFAULT 'ai_generated'::character varying NOT NULL,
    channel_id uuid,
    archetype_id uuid,
    format character varying(50),
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    file_path text,
    r2_key text,
    file_name character varying(255) NOT NULL,
    file_format character varying(20) NOT NULL,
    width integer,
    height integer,
    size_bytes bigint,
    background_removed boolean DEFAULT false NOT NULL,
    quality_rating smallint,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    generation_recipe jsonb,
    parent_asset_id uuid,
    character_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    language character varying(10) DEFAULT 'en'::character varying NOT NULL,
    thumbnail_path text,
    waveform_data jsonb,
    duration_seconds integer,
    variant_type character varying(20),
    variant_metadata jsonb
);


--
-- Name: bundestag_clips; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bundestag_clips (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    clip_id character varying(255) NOT NULL,
    source_url text,
    local_path text NOT NULL,
    camera_angle public.bundestag_camera_angle,
    duration_seconds numeric(10,3),
    resolution character varying(20),
    width integer,
    height integer,
    fps numeric(6,3),
    codec character varying(50),
    pixel_format character varying(20),
    bitrate_kbps integer,
    file_size_bytes bigint,
    has_audio boolean DEFAULT true,
    sample_rate integer,
    sync_offset_ms integer DEFAULT 0,
    sync_confidence numeric(4,3),
    sync_method public.bundestag_sync_method,
    is_reference_clip boolean DEFAULT false,
    transcript_text text,
    transcript_words jsonb,
    transcript_language character varying(10),
    transcription_completed_at timestamp with time zone,
    transcription_quality_grade public.bundestag_transcription_quality_grade,
    transcription_confidence numeric(4,3),
    transcription_flags jsonb,
    normalization_required boolean DEFAULT false,
    normalization_completed boolean DEFAULT false,
    normalized_path text,
    detected_speaker_name character varying(255),
    speaker_confidence numeric(5,2),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: bundestag_playbooks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bundestag_playbooks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    is_active boolean DEFAULT true,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    model character varying(100),
    editing_style character varying(50),
    editing_plan jsonb NOT NULL,
    quality_flags jsonb,
    total_segments integer,
    total_duration_seconds numeric(10,3),
    total_cuts integer,
    generation_prompt text,
    generation_reasoning text,
    condensed_transcript jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: caption_presets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.caption_presets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    is_default boolean DEFAULT false,
    config jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: cf_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cf_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    persona_id uuid NOT NULL,
    platform public.clip_forge_platform NOT NULL,
    handle character varying(128) NOT NULL,
    variant_seed integer NOT NULL,
    posts_per_day integer DEFAULT 1 NOT NULL,
    jitter_hours_override integer,
    daily_slots integer DEFAULT 3 NOT NULL,
    niche public.clip_forge_category,
    category_mix jsonb DEFAULT '{}'::jsonb NOT NULL,
    active boolean DEFAULT true NOT NULL,
    proxy_endpoint text,
    browser_profile_id character varying(128),
    caption_preset_id uuid,
    flagged_at timestamp with time zone,
    last_activity_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: cf_caption_pool; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cf_caption_pool (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    persona_id uuid NOT NULL,
    text text NOT NULL,
    category public.clip_forge_category,
    uses integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: cf_caption_presets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cf_caption_presets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(120) NOT NULL,
    text_color character varying(16) DEFAULT '#ffffff'::character varying NOT NULL,
    highlight_color character varying(16) DEFAULT '#57a578'::character varying NOT NULL,
    all_caps boolean DEFAULT true NOT NULL,
    outline boolean DEFAULT true NOT NULL,
    font_size integer DEFAULT 38 NOT NULL,
    position_pct integer DEFAULT 74 NOT NULL,
    animation character varying(32) DEFAULT 'word-pop'::character varying NOT NULL,
    emoji_set character varying(32) DEFAULT 'minimal'::character varying NOT NULL,
    assigned_personas jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: cf_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cf_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    persona_id uuid,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    edited_by character varying(128),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: cf_distributions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cf_distributions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    raw_clip_id uuid NOT NULL,
    variant_id uuid,
    account_id uuid NOT NULL,
    platform public.clip_forge_platform NOT NULL,
    status public.clip_forge_distribution_status DEFAULT 'pooled'::public.clip_forge_distribution_status NOT NULL,
    qc_result public.clip_forge_qc_result,
    qc_report jsonb,
    scheduled_for timestamp with time zone,
    uploaded_at timestamp with time zone,
    post_url text,
    view_count integer DEFAULT 0 NOT NULL,
    view_history jsonb DEFAULT '[]'::jsonb NOT NULL,
    last_error text,
    error_class public.clip_forge_error_class,
    retry_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: cf_finishing_variants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cf_finishing_variants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    raw_clip_id uuid NOT NULL,
    platform public.clip_forge_platform NOT NULL,
    caption_text text,
    subtitle_style jsonb DEFAULT '{}'::jsonb NOT NULL,
    duration_delta_sec real DEFAULT 0 NOT NULL,
    variant_seed integer NOT NULL,
    rendered_mp4_key text,
    rendered_hash character varying(64),
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    layout_preset character varying(32),
    subtitle_style_id character varying(64),
    caption_style_id character varying(64),
    layout_options jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: cf_job_failures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cf_job_failures (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id character varying(128) NOT NULL,
    queue character varying(80) NOT NULL,
    error_class public.clip_forge_error_class DEFAULT 'transient'::public.clip_forge_error_class NOT NULL,
    correlation_id character varying(128),
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    last_error text,
    stacktrace text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: cf_personas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cf_personas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(120) NOT NULL,
    rights_confirmed boolean DEFAULT false NOT NULL,
    payout_model public.clip_forge_payout_model DEFAULT 'per_view'::public.clip_forge_payout_model NOT NULL,
    payout_rate real DEFAULT 0 NOT NULL,
    default_style_tokens jsonb DEFAULT '{}'::jsonb NOT NULL,
    face_detection_hints jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    default_language character varying(8) DEFAULT 'en'::character varying NOT NULL
);


--
-- Name: cf_raw_clips; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cf_raw_clips (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_id uuid NOT NULL,
    persona_id uuid NOT NULL,
    start_sec real NOT NULL,
    end_sec real NOT NULL,
    clip_score real NOT NULL,
    score_reason text DEFAULT ''::text NOT NULL,
    categories jsonb DEFAULT '[]'::jsonb NOT NULL,
    suggested_caption text,
    reframe_recipe jsonb DEFAULT '{}'::jsonb NOT NULL,
    raw_mp4_key text,
    status public.clip_forge_raw_clip_status DEFAULT 'detected'::public.clip_forge_raw_clip_status NOT NULL,
    cancel_requested boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: cf_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cf_sources (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    persona_id uuid NOT NULL,
    external_id character varying(256) NOT NULL,
    source_kind public.clip_forge_source_kind NOT NULL,
    source_url text NOT NULL,
    title text NOT NULL,
    duration_sec real DEFAULT 0 NOT NULL,
    resolution character varying(32),
    codec character varying(64),
    fps real,
    size_bytes bigint,
    transcript_key text,
    word_timings jsonb DEFAULT '[]'::jsonb,
    audio_fingerprint character varying(128),
    duplicate_of uuid,
    status public.clip_forge_source_status DEFAULT 'ingested'::public.clip_forge_source_status NOT NULL,
    raw_video_deleted boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    language character varying(8) DEFAULT 'en'::character varying NOT NULL,
    facecam_layout jsonb,
    portrait_crops jsonb,
    progress jsonb,
    detection jsonb
);


--
-- Name: cf_style_presets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cf_style_presets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(128) NOT NULL,
    persona_id uuid,
    subtitle_style_id character varying(64),
    caption_style_id character varying(64),
    layout_options jsonb DEFAULT '{}'::jsonb NOT NULL,
    caption_y integer,
    subtitle_y integer,
    caption_size integer,
    subtitle_size integer,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: channel_drama_characters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.channel_drama_characters (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    channel_id uuid NOT NULL,
    character_id uuid NOT NULL,
    role_label character varying(100),
    is_default boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: channels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.channels (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    youtube_channel_id character varying(50) NOT NULL,
    name character varying(100) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    description text,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    metadata jsonb,
    language character varying(10) DEFAULT 'en'::character varying NOT NULL,
    clip_library_id uuid
);


--
-- Name: character_registry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.character_registry (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    library_id uuid NOT NULL,
    name character varying(120) NOT NULL,
    aliases text[] DEFAULT '{}'::text[] NOT NULL,
    reference_clip_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    face_sample_count integer DEFAULT 0 NOT NULL,
    confidence_threshold real DEFAULT 0.65 NOT NULL,
    clip_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    face_centroid public.halfvec(512)
);


--
-- Name: character_state_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.character_state_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(50) NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: characters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.characters (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    description text NOT NULL,
    channel_id uuid,
    archetype_id uuid,
    reference_sheet_asset_id uuid,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: clip_label_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clip_label_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    clip_id uuid NOT NULL,
    changed_by character varying(60) NOT NULL,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    before jsonb NOT NULL,
    after jsonb NOT NULL,
    change_reason text
);


--
-- Name: clip_libraries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clip_libraries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(120) NOT NULL,
    slug character varying(80) NOT NULL,
    description text,
    tag_vocabulary jsonb DEFAULT '{}'::jsonb NOT NULL,
    clip_storage_strategy public.clip_storage_strategy DEFAULT 'inline'::public.clip_storage_strategy NOT NULL,
    clip_count integer DEFAULT 0 NOT NULL,
    total_duration_ms integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    vlm_labeling_config jsonb DEFAULT '{"enabled": false, "vps_host": "65.108.6.149", "vps_user": "root", "concurrency": 1, "ssh_key_path": "~/.ssh/content-forge-key", "lm_studio_url": "", "vps_media_root": "/opt/content-forge/media", "lm_studio_model": "", "lm_studio_token": ""}'::jsonb NOT NULL,
    character_block text DEFAULT ''::text NOT NULL,
    script_prompt text DEFAULT ''::text NOT NULL,
    music_mode character varying(16) DEFAULT 'generate'::character varying NOT NULL,
    music_volume_db integer DEFAULT '-28'::integer NOT NULL,
    use_reference_scripts boolean DEFAULT true NOT NULL,
    storage_backend public.storage_backend DEFAULT 'local'::public.storage_backend NOT NULL,
    storage_root text,
    labeling_concurrency smallint DEFAULT 4 NOT NULL,
    use_visual_embedding boolean DEFAULT false NOT NULL
);


--
-- Name: clip_library_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clip_library_configs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    format public.content_format NOT NULL,
    channel_id uuid,
    clip_library_id uuid NOT NULL,
    clip_selection_enabled boolean DEFAULT false NOT NULL,
    hitl_clip_review boolean DEFAULT true NOT NULL,
    clips_per_sentence smallint DEFAULT 1 NOT NULL,
    min_gap_before_repeat smallint DEFAULT 5 NOT NULL,
    character_continuity character varying(20) DEFAULT 'off'::character varying NOT NULL,
    broll_fallback_enabled boolean DEFAULT true NOT NULL,
    broll_fallback_model character varying(100),
    playbook jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: clip_library_reference_scripts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clip_library_reference_scripts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    clip_library_id uuid NOT NULL,
    name character varying(160) NOT NULL,
    content text NOT NULL,
    word_count integer DEFAULT 0 NOT NULL,
    last_used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: clip_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clip_usage (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    clip_id uuid NOT NULL,
    job_id uuid NOT NULL,
    edit_list_id uuid NOT NULL,
    sentence_index smallint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: clips; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clips (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    library_id uuid NOT NULL,
    source_video_id uuid NOT NULL,
    start_ms integer NOT NULL,
    end_ms integer NOT NULL,
    storage_key text,
    cdn_url text,
    thumbnail_url text,
    labeling_step public.clip_labeling_step,
    review_status public.clip_review_status DEFAULT 'pending'::public.clip_review_status NOT NULL,
    reviewed_at timestamp with time zone,
    reviewed_by uuid,
    ai_description text,
    ai_confidence real,
    shot_scale public.clip_shot_scale,
    dominant_mood character varying(60),
    audio_class public.clip_audio_class,
    tags_characters text[] DEFAULT '{}'::text[] NOT NULL,
    tags_mood text[] DEFAULT '{}'::text[] NOT NULL,
    tags_location text[] DEFAULT '{}'::text[] NOT NULL,
    tags_action text[] DEFAULT '{}'::text[] NOT NULL,
    tags_custom text[] DEFAULT '{}'::text[] NOT NULL,
    characters_present text[] DEFAULT '{}'::text[] NOT NULL,
    transcript text,
    transcript_json jsonb,
    width smallint,
    height smallint,
    fps real,
    times_used integer DEFAULT 0 NOT NULL,
    last_used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    embedding_sparse jsonb,
    clip_type public.clip_type DEFAULT 'unknown'::public.clip_type NOT NULL,
    motion_level character varying(20),
    camera_movement character varying(30),
    lighting_style character varying(30),
    color_temperature character varying(30),
    face_count smallint,
    has_text_overlay boolean,
    dialogue_present boolean,
    source_episode character varying(120),
    scene_context text,
    keywords text[] DEFAULT '{}'::text[] NOT NULL,
    quality_score smallint,
    manual_notes text,
    is_usable boolean,
    embedding public.halfvec(384),
    prev_clip_id uuid,
    next_clip_id uuid,
    narrative_type character varying(30),
    clip_index integer DEFAULT 0 NOT NULL,
    external_ref character varying(240),
    duplicate_of_id uuid,
    phash bigint,
    motion_score real,
    palette_dominant_hex text[],
    embedding_visual public.halfvec(512)
);


--
-- Name: connector_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.connector_configs (
    id character varying(64) NOT NULL,
    service character varying(64) NOT NULL,
    display_name text NOT NULL,
    status character varying(16) DEFAULT 'disconnected'::character varying NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    secret_ref character varying(128),
    last_sync_at timestamp with time zone,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT connector_configs_status_check CHECK (((status)::text = ANY ((ARRAY['disconnected'::character varying, 'connected'::character varying, 'error'::character varying, 'syncing'::character varying])::text[])))
);


--
-- Name: content_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    channel_id uuid NOT NULL,
    template_id uuid NOT NULL,
    status public.job_status NOT NULL,
    paused_from_status public.job_status,
    status_updated_at timestamp with time zone NOT NULL,
    state_machine_history jsonb DEFAULT '[]'::jsonb NOT NULL,
    assigned_production_va_id uuid,
    assigned_uploader_va_id uuid,
    production_va_time_spent_seconds integer,
    uploader_va_time_spent_seconds integer,
    format public.content_format NOT NULL,
    title character varying(100) NOT NULL,
    description text NOT NULL,
    script text,
    generated_tags text[],
    render_engine public.render_engine,
    aspect_ratio character varying(10),
    target_duration_seconds integer,
    render_started_at timestamp with time zone,
    render_completed_at timestamp with time zone,
    total_render_time_seconds integer,
    r2_asset_manifest jsonb DEFAULT '[]'::jsonb NOT NULL,
    size_bytes_total_assets bigint,
    final_video_size_bytes bigint,
    final_video_duration_seconds integer,
    youtube_video_id character varying(50),
    published_at timestamp with time zone,
    views integer,
    revenue_cents integer,
    error_message text,
    retry_count integer DEFAULT 0 NOT NULL,
    worker_lease_id uuid,
    worker_lease_expires_at timestamp with time zone,
    idempotency_key uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    duration_frames integer,
    assembly_manifest jsonb,
    error_detail jsonb,
    qc_feedback text,
    qc_reviewed_at timestamp with time zone,
    production_version public.production_version DEFAULT 'V2'::public.production_version NOT NULL,
    skip_image_qc boolean DEFAULT false NOT NULL,
    skip_final_qc boolean DEFAULT false NOT NULL,
    metadata jsonb,
    language character varying(10) DEFAULT 'en'::character varying NOT NULL,
    narration_source_path text,
    generation_log jsonb DEFAULT '[]'::jsonb NOT NULL,
    initial_topic text,
    error_metadata jsonb,
    plugin_architecture_version integer DEFAULT 1 NOT NULL,
    archetype_id uuid,
    progress integer DEFAULT 0,
    image_generation_mode public.image_generation_mode DEFAULT 'auto'::public.image_generation_mode NOT NULL
);


--
-- Name: COLUMN content_jobs.duration_frames; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.content_jobs.duration_frames IS 'Total video duration in frames at 30fps, derived from master audio';


--
-- Name: COLUMN content_jobs.assembly_manifest; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.content_jobs.assembly_manifest IS 'Complete scene manifest: audio timing, scene breakdown, asset keys for render composition';


--
-- Name: content_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    description text NOT NULL,
    format public.content_format NOT NULL,
    pipeline_stages jsonb NOT NULL,
    prompts jsonb NOT NULL,
    render_config jsonb NOT NULL,
    required_assets jsonb NOT NULL,
    metadata jsonb,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archetype_id uuid,
    default_style_library_id uuid,
    supports_character_tracking boolean DEFAULT false NOT NULL
);


--
-- Name: course_chapters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.course_chapters (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_id uuid NOT NULL,
    title character varying(200) NOT NULL,
    description text,
    icon character varying(50),
    order_index integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: course_videos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.course_videos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    chapter_id uuid NOT NULL,
    title character varying(200) NOT NULL,
    description text,
    order_index integer DEFAULT 0 NOT NULL,
    video_key text NOT NULL,
    duration_seconds integer,
    thumbnail_key text,
    is_published boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    transcript text,
    summary text,
    takeaways text
);


--
-- Name: courses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.courses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title character varying(200) NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    thumbnail_key text,
    allowed_roles text[] DEFAULT '{}'::text[] NOT NULL,
    is_published boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: cron_schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cron_schedules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    cron_expr character varying(64) NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    prompt_template text NOT NULL,
    title_template text,
    worker_label character varying(64),
    next_run_at timestamp with time zone NOT NULL,
    last_run_at timestamp with time zone,
    last_run_id uuid,
    last_error text,
    total_fires integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: decisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.decisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ts timestamp with time zone DEFAULT now() NOT NULL,
    kind character varying(32) NOT NULL,
    actor character varying(64) NOT NULL,
    action text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    inbox_item_id uuid,
    related_job_id uuid,
    CONSTRAINT decisions_kind_check CHECK (((kind)::text = ANY ((ARRAY['dispatch'::character varying, 'breaker'::character varying, 'degrade'::character varying, 'escalate'::character varying, 'unstick'::character varying, 'resolve'::character varying, 'freeze'::character varying, 'resume'::character varying, 'guardrail'::character varying, 'manager'::character varying, 'user'::character varying])::text[])))
);


--
-- Name: drama_characters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.drama_characters (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    description text NOT NULL,
    thumbnail_url text,
    is_preset boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: drama_clips; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.drama_clips (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    clip_index integer NOT NULL,
    section_type character varying(10) DEFAULT 'body'::character varying NOT NULL,
    text text NOT NULL,
    start_ms integer NOT NULL,
    end_ms integer NOT NULL,
    image_prompt text,
    image_path text,
    image_status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    video_path text,
    video_status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    veo_job_id text,
    character_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL
);


--
-- Name: encrypted_secrets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.encrypted_secrets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    namespace text DEFAULT 'tutorial-production'::text NOT NULL,
    capability public.secret_capability NOT NULL,
    provider text NOT NULL,
    ciphertext bytea NOT NULL,
    iv bytea NOT NULL,
    auth_tag bytea NOT NULL,
    last4 text NOT NULL,
    created_by uuid,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: environments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.environments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    description text NOT NULL,
    archetype_id uuid,
    channel_id uuid,
    background_asset_id uuid NOT NULL,
    prop_asset_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    spatial_hints jsonb,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: fleet_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fleet_state (
    id integer DEFAULT 1 NOT NULL,
    status character varying(16) DEFAULT 'running'::character varying NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by character varying(64) DEFAULT 'system'::character varying NOT NULL,
    CONSTRAINT fleet_state_id_check CHECK ((id = 1)),
    CONSTRAINT fleet_state_status_check CHECK (((status)::text = ANY ((ARRAY['running'::character varying, 'paused'::character varying])::text[])))
);


--
-- Name: format_style_libraries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.format_style_libraries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(120) NOT NULL,
    description text NOT NULL,
    format character varying(50) NOT NULL,
    text_guidelines text,
    metadata jsonb,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: format_style_library_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.format_style_library_assets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    library_id uuid NOT NULL,
    asset_id uuid NOT NULL,
    ref_type character varying(50) NOT NULL,
    display_order smallint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: google_drive_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.google_drive_connections (
    user_id uuid NOT NULL,
    google_email text NOT NULL,
    refresh_ciphertext bytea NOT NULL,
    refresh_iv bytea NOT NULL,
    refresh_auth_tag bytea NOT NULL,
    folder_id text,
    folder_name text DEFAULT 'Tutorial Videos'::text NOT NULL,
    autoupload_enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: guardrail_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.guardrail_rules (
    id character varying(64) NOT NULL,
    label text NOT NULL,
    description text NOT NULL,
    category character varying(32) NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    builtin boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT guardrail_rules_category_check CHECK (((category)::text = ANY ((ARRAY['financial'::character varying, 'destructive'::character varying, 'communication'::character varying, 'security'::character varying, 'deployment'::character varying, 'custom'::character varying])::text[])))
);


--
-- Name: guardrail_trips; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.guardrail_trips (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    rule_id character varying(64) NOT NULL,
    agent character varying(64) NOT NULL,
    attempted_action text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    resolved boolean DEFAULT false NOT NULL,
    resolution_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: inbox_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inbox_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    type character varying(64) NOT NULL,
    status character varying(32) NOT NULL,
    title text NOT NULL,
    ask text NOT NULL,
    tried jsonb DEFAULT '[]'::jsonb NOT NULL,
    actions jsonb DEFAULT '[]'::jsonb NOT NULL,
    source character varying(64) NOT NULL,
    related_job_id uuid,
    related_worker_id character varying(64),
    escalation_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    resolved_by character varying(64),
    resolution jsonb,
    external_id character varying(80),
    CONSTRAINT inbox_items_status_check CHECK (((status)::text = ANY ((ARRAY['BLEED'::character varying, 'STUCK'::character varying, 'APPROVE'::character varying, 'DECIDE'::character varying, 'NORMAL'::character varying])::text[])))
);


--
-- Name: job_edit_lists; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_edit_lists (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    version smallint DEFAULT 1 NOT NULL,
    status character varying(30) DEFAULT 'ai_pending'::character varying NOT NULL,
    entries jsonb NOT NULL,
    source_script_hash character varying(64),
    total_clips smallint DEFAULT 0 NOT NULL,
    unique_clips smallint DEFAULT 0 NOT NULL,
    total_duration_ms integer DEFAULT 0 NOT NULL,
    ai_fallback_count smallint DEFAULT 0 NOT NULL,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    locked_for_render boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: knowledge_embeddings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.knowledge_embeddings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_path text NOT NULL,
    title text NOT NULL,
    chunk_index integer DEFAULT 0 NOT NULL,
    content text NOT NULL,
    embedding public.halfvec(1024),
    metadata jsonb DEFAULT '{}'::jsonb,
    content_hash text,
    indexed_at timestamp with time zone DEFAULT now()
);


--
-- Name: knowledge_triples; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.knowledge_triples (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subject text NOT NULL,
    predicate text NOT NULL,
    object text NOT NULL,
    subject_key text NOT NULL,
    object_key text NOT NULL,
    note_slug text NOT NULL,
    source_path text NOT NULL,
    chunk_index integer NOT NULL,
    confidence numeric(4,3),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    category text DEFAULT 'other'::text NOT NULL,
    CONSTRAINT knowledge_triples_category_check CHECK ((category = ANY (ARRAY['decision'::text, 'rule'::text, 'error'::text, 'provider'::text, 'job'::text, 'format'::text, 'person'::text, 'other'::text])))
);


--
-- Name: music_library; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.music_library (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(200) NOT NULL,
    file_path text NOT NULL,
    duration_seconds integer NOT NULL,
    genre character varying(100),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    format character varying(50)
);


--
-- Name: music_presets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.music_presets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name character varying(100) NOT NULL,
    file_path text NOT NULL,
    original_filename character varying(255) NOT NULL,
    mood text[],
    bpm integer,
    genre character varying(100),
    duration_seconds real,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: narrators; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.narrators (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    description text NOT NULL,
    channel_id uuid NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: reminders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reminders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    text text NOT NULL,
    due_at timestamp with time zone NOT NULL,
    recur text,
    status text DEFAULT 'pending'::text NOT NULL,
    source text DEFAULT 'chat'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    delivered_at timestamp with time zone,
    CONSTRAINT reminders_recur_check CHECK ((recur = ANY (ARRAY['daily'::text, 'weekly'::text]))),
    CONSTRAINT reminders_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'delivered'::text, 'dismissed'::text])))
);


--
-- Name: remotion_caption_presets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.remotion_caption_presets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    config jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    prompt text NOT NULL,
    worker character varying(64),
    status character varying(16) DEFAULT 'queued'::character varying NOT NULL,
    thread jsonb DEFAULT '[]'::jsonb NOT NULL,
    budget_usd numeric(10,2) DEFAULT 0 NOT NULL,
    spent_usd numeric(10,2) DEFAULT 0 NOT NULL,
    parent_run_id uuid,
    stuck_signal character varying(64),
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    last_heartbeat_at timestamp with time zone,
    CONSTRAINT runs_status_check CHECK (((status)::text = ANY ((ARRAY['queued'::character varying, 'running'::character varying, 'paused'::character varying, 'stuck'::character varying, 'completed'::character varying, 'failed'::character varying, 'cancelled'::character varying])::text[])))
);


--
-- Name: scene_frame_sequences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scene_frame_sequences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    scene_index integer NOT NULL,
    frame_index integer NOT NULL,
    asset_id uuid,
    prompt_delta text,
    seed_asset_id uuid,
    transition_type character varying(20) DEFAULT 'cut'::character varying NOT NULL,
    hold_duration_ms integer DEFAULT 500 NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: source_videos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.source_videos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    library_id uuid NOT NULL,
    ingest_status public.clip_ingest_status DEFAULT 'pending'::public.clip_ingest_status NOT NULL,
    source_url text,
    source_file_path text,
    content_hash character varying(64),
    storage_key text,
    cdn_url text,
    title character varying(500),
    duration_ms integer,
    width smallint,
    height smallint,
    fps real,
    codec character varying(30),
    clip_count integer DEFAULT 0 NOT NULL,
    error_message text,
    ingest_started_at timestamp with time zone,
    ingest_completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    source_kind public.source_kind DEFAULT 'other'::public.source_kind NOT NULL,
    work_slug character varying(120),
    work_title character varying(300),
    work_part smallint,
    season smallint,
    episode smallint,
    youtube_id character varying(20),
    external_provider character varying(40),
    external_id character varying(200),
    ref_base character varying(200),
    audio_storage_key text,
    phash bigint
);


--
-- Name: space_video_clips; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.space_video_clips (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    paragraph_index integer NOT NULL,
    sentence_index integer NOT NULL,
    sub_sentence_index integer DEFAULT 0 NOT NULL,
    text text NOT NULL,
    start_ms integer NOT NULL,
    end_ms integer NOT NULL,
    clip_duration integer NOT NULL,
    image_prompt text,
    video_prompt text,
    image_path text,
    video_path text,
    image_status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    video_status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    veo_job_id character varying(100),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: spend_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.spend_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    provider text NOT NULL,
    kind text NOT NULL,
    amount_eur numeric(10,4) NOT NULL,
    job_id uuid,
    units integer,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT spend_log_amount_eur_check CHECK ((amount_eur >= (0)::numeric))
);


--
-- Name: stock_clip_uses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_clip_uses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    stock_clip_id uuid NOT NULL,
    "position" numeric(6,0) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: stock_clips; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_clips (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    video_path text NOT NULL,
    duration_sec numeric(6,3) NOT NULL,
    prompt text NOT NULL,
    vibe_tag character varying(64),
    veo_job_id text,
    status character varying(16) DEFAULT 'queued'::character varying NOT NULL,
    origin character varying(24) DEFAULT 'bootstrap'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone,
    clip_library_id uuid,
    embedding public.halfvec(384)
);


--
-- Name: style_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.style_assets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(120) NOT NULL,
    description text NOT NULL,
    asset_type character varying(50) NOT NULL,
    format public.content_format NOT NULL,
    channel_id uuid,
    file_path text NOT NULL,
    file_name character varying(255) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE style_assets; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.style_assets IS 'DEPRECATED: Replaced by style_collections system. No new records should be inserted. Scheduled for removal after 2026-06-01.';


--
-- Name: subtitle_fonts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subtitle_fonts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    file_name character varying(255) NOT NULL,
    file_path character varying(500) NOT NULL,
    format character varying(10) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: subtitle_preset_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subtitle_preset_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    preset_id uuid NOT NULL,
    format character varying(50),
    channel_id uuid
);


--
-- Name: subtitle_presets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subtitle_presets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    engine character varying(10) NOT NULL,
    config jsonb NOT NULL,
    is_built_in boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: system_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_type character varying(100) NOT NULL,
    job_id uuid,
    payload jsonb NOT NULL,
    "timestamp" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: system_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_settings (
    id character varying(20) DEFAULT 'singleton'::character varying NOT NULL,
    general jsonb,
    pipeline jsonb,
    ai_services jsonb,
    storage jsonb,
    rendering jsonb,
    channels jsonb,
    notifications jsonb,
    security jsonb,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    CONSTRAINT singleton_check CHECK (((id)::text = 'singleton'::text))
);


--
-- Name: TABLE system_settings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.system_settings IS 'Singleton row storing global system configuration. NULL columns = use env/hardcoded defaults.';


--
-- Name: tts_voices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tts_voices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(120) NOT NULL,
    provider character varying(50) NOT NULL,
    voice_id character varying(255) NOT NULL,
    language character varying(10) NOT NULL,
    gender character varying(20),
    style character varying(50),
    description text,
    is_default boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    settings text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tutorial_background_presets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tutorial_background_presets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    kind text DEFAULT 'remotion'::text NOT NULL,
    source_path text,
    params jsonb,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tutorial_derivatives; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tutorial_derivatives (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_job_id uuid NOT NULL,
    language character varying(8) NOT NULL,
    status public.tutorial_derivative_status DEFAULT 'PENDING'::public.tutorial_derivative_status NOT NULL,
    translated_script text,
    audio_path text,
    audio_duration_s numeric(10,3),
    intro_video_path text,
    background_preset_id uuid,
    final_path text,
    error_stage text,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tutorial_intro_hosts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tutorial_intro_hosts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    reference_image_path text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tutorial_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tutorial_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_by uuid NOT NULL,
    batch_id uuid,
    title text NOT NULL,
    mode public.tutorial_mode NOT NULL,
    status public.tutorial_job_status DEFAULT 'QUEUED'::public.tutorial_job_status NOT NULL,
    progress integer DEFAULT 0 NOT NULL,
    steps_input text DEFAULT ''::text NOT NULL,
    prompt_preset_id uuid,
    custom_prompt text,
    script_provider text NOT NULL,
    script_model text,
    tts_provider text NOT NULL,
    tts_voice text NOT NULL,
    script_text text,
    audio_path text,
    audio_duration_s numeric(10,3),
    playback_speed numeric(4,2),
    recording_path text,
    recording_duration_s numeric(10,3),
    final_path text,
    target_minutes integer,
    ref_video_seconds integer,
    delivered_to_drive boolean DEFAULT false NOT NULL,
    error_stage text,
    error_message text,
    error_detail text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    script_done_at timestamp with time zone,
    audio_done_at timestamp with time zone,
    recorded_at timestamp with time zone,
    completed_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    parent_job_id uuid,
    segment_index integer,
    voice_settings jsonb,
    part_length_minutes integer DEFAULT 8,
    long_audio_path text,
    stitch_job_id uuid,
    extra_context text,
    intro_enabled boolean DEFAULT false NOT NULL,
    intro_mode text,
    intro_config jsonb,
    intro_hook_text text,
    intro_audio_path text,
    intro_video_path text,
    intro_status text,
    intro_error text
);


--
-- Name: tutorial_prompt_presets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tutorial_prompt_presets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    category public.tutorial_prompt_category NOT NULL,
    name text NOT NULL,
    system_prompt text NOT NULL,
    is_seeded boolean DEFAULT false NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tutorial_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tutorial_settings (
    id integer DEFAULT 1 NOT NULL,
    default_script_provider text DEFAULT 'gemini_pool'::text NOT NULL,
    default_script_model text,
    default_tts_provider text DEFAULT 'ai33_elevenlabs'::text NOT NULL,
    default_tts_voice text DEFAULT ''::text NOT NULL,
    default_playback_speed numeric(4,2) DEFAULT 1.00 NOT NULL,
    record_hotkey text DEFAULT 'Space'::text NOT NULL,
    retention_hours integer DEFAULT 48 NOT NULL,
    drive_autoupload_enabled boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    default_voice_settings jsonb,
    silence_cap_enabled boolean DEFAULT true NOT NULL,
    silence_cap_max_ms integer DEFAULT 250 NOT NULL,
    silence_cap_threshold_db integer DEFAULT '-40'::integer NOT NULL,
    derivative_config jsonb
);


--
-- Name: user_job_presets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_job_presets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    template_id uuid NOT NULL,
    preset_name character varying(100) NOT NULL,
    settings jsonb NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email character varying(255) NOT NULL,
    name character varying(100) NOT NULL,
    role public.operator_role NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    password_hash character varying(255) DEFAULT ''::character varying NOT NULL
);


--
-- Name: COLUMN users.password_hash; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.password_hash IS 'Bcrypt password hash for authentication (10 rounds)';


--
-- Name: video_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.video_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    video_id uuid NOT NULL,
    timestamp_seconds integer,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: video_stitch_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.video_stitch_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_by_user_id uuid,
    status character varying(50) DEFAULT 'PENDING'::character varying NOT NULL,
    input_videos jsonb NOT NULL,
    output_filename character varying(255) NOT NULL,
    target_width integer DEFAULT 1920 NOT NULL,
    target_height integer DEFAULT 1080 NOT NULL,
    target_fps integer DEFAULT 30 NOT NULL,
    transition_type character varying(50) DEFAULT 'hard_cut'::character varying,
    transition_duration_seconds integer DEFAULT 0,
    voiceover_enabled boolean DEFAULT false,
    voiceover_file_path text,
    voiceover_original_duration_seconds integer,
    voiceover_target_duration_seconds integer,
    voiceover_speed_factor integer,
    music_enabled boolean DEFAULT false,
    music_file_path text,
    music_volume integer,
    captions_enabled boolean DEFAULT false,
    caption_preset_id uuid,
    caption_config jsonb,
    progress integer DEFAULT 0,
    render_started_at timestamp with time zone,
    render_completed_at timestamp with time zone,
    total_render_time_seconds integer,
    output_video_path text,
    output_duration_seconds integer,
    output_size_bytes bigint,
    whisper_output jsonb,
    error_message text,
    error_detail jsonb,
    retry_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    music_tracks jsonb,
    remotion_enabled boolean DEFAULT false,
    remotion_preset_id uuid,
    alignment_mode character varying(20) DEFAULT 'global'::character varying NOT NULL,
    speed_adjust_mode character varying(50) DEFAULT 'audio_to_video'::character varying NOT NULL
);


--
-- Name: video_timelines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.video_timelines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    timeline_data jsonb NOT NULL,
    saved_by character varying(100),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: video_watch_progress; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.video_watch_progress (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    video_id uuid NOT NULL,
    last_position_seconds integer DEFAULT 0 NOT NULL,
    is_completed boolean DEFAULT false NOT NULL,
    completed_at timestamp with time zone,
    last_viewed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: webhooks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhooks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    description text,
    secret text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    prompt_template text NOT NULL,
    title_template text,
    worker_label character varying(64),
    total_calls integer DEFAULT 0 NOT NULL,
    last_called_at timestamp with time zone,
    last_run_id uuid,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: __drizzle_migrations id; Type: DEFAULT; Schema: drizzle; Owner: -
--

ALTER TABLE ONLY drizzle.__drizzle_migrations ALTER COLUMN id SET DEFAULT nextval('drizzle.__drizzle_migrations_id_seq'::regclass);


--
-- Name: __drizzle_migrations __drizzle_migrations_pkey; Type: CONSTRAINT; Schema: drizzle; Owner: -
--

ALTER TABLE ONLY drizzle.__drizzle_migrations
    ADD CONSTRAINT __drizzle_migrations_pkey PRIMARY KEY (id);


--
-- Name: archetypes archetypes_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.archetypes
    ADD CONSTRAINT archetypes_name_key UNIQUE (name);


--
-- Name: archetypes archetypes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.archetypes
    ADD CONSTRAINT archetypes_pkey PRIMARY KEY (id);


--
-- Name: asset_collection_memberships asset_collection_memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_collection_memberships
    ADD CONSTRAINT asset_collection_memberships_pkey PRIMARY KEY (asset_id, collection_id);


--
-- Name: asset_collections asset_collections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_collections
    ADD CONSTRAINT asset_collections_pkey PRIMARY KEY (id);


--
-- Name: assets assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_pkey PRIMARY KEY (id);


--
-- Name: bundestag_clips bundestag_clips_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bundestag_clips
    ADD CONSTRAINT bundestag_clips_pkey PRIMARY KEY (id);


--
-- Name: bundestag_playbooks bundestag_playbooks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bundestag_playbooks
    ADD CONSTRAINT bundestag_playbooks_pkey PRIMARY KEY (id);


--
-- Name: caption_presets caption_presets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.caption_presets
    ADD CONSTRAINT caption_presets_pkey PRIMARY KEY (id);


--
-- Name: cf_accounts cf_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cf_accounts
    ADD CONSTRAINT cf_accounts_pkey PRIMARY KEY (id);


--
-- Name: cf_caption_pool cf_caption_pool_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cf_caption_pool
    ADD CONSTRAINT cf_caption_pool_pkey PRIMARY KEY (id);


--
-- Name: cf_caption_presets cf_caption_presets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cf_caption_presets
    ADD CONSTRAINT cf_caption_presets_pkey PRIMARY KEY (id);


--
-- Name: cf_config cf_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cf_config
    ADD CONSTRAINT cf_config_pkey PRIMARY KEY (id);


--
-- Name: cf_distributions cf_distributions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cf_distributions
    ADD CONSTRAINT cf_distributions_pkey PRIMARY KEY (id);


--
-- Name: cf_finishing_variants cf_finishing_variants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cf_finishing_variants
    ADD CONSTRAINT cf_finishing_variants_pkey PRIMARY KEY (id);


--
-- Name: cf_job_failures cf_job_failures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cf_job_failures
    ADD CONSTRAINT cf_job_failures_pkey PRIMARY KEY (id);


--
-- Name: cf_personas cf_personas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cf_personas
    ADD CONSTRAINT cf_personas_pkey PRIMARY KEY (id);


--
-- Name: cf_raw_clips cf_raw_clips_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cf_raw_clips
    ADD CONSTRAINT cf_raw_clips_pkey PRIMARY KEY (id);


--
-- Name: cf_sources cf_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cf_sources
    ADD CONSTRAINT cf_sources_pkey PRIMARY KEY (id);


--
-- Name: cf_style_presets cf_style_presets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cf_style_presets
    ADD CONSTRAINT cf_style_presets_pkey PRIMARY KEY (id);


--
-- Name: channel_drama_characters channel_drama_characters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channel_drama_characters
    ADD CONSTRAINT channel_drama_characters_pkey PRIMARY KEY (id);


--
-- Name: channels channels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channels
    ADD CONSTRAINT channels_pkey PRIMARY KEY (id);


--
-- Name: channels channels_youtube_channel_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channels
    ADD CONSTRAINT channels_youtube_channel_id_unique UNIQUE (youtube_channel_id);


--
-- Name: character_registry character_registry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.character_registry
    ADD CONSTRAINT character_registry_pkey PRIMARY KEY (id);


--
-- Name: character_state_types character_state_types_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.character_state_types
    ADD CONSTRAINT character_state_types_name_key UNIQUE (name);


--
-- Name: character_state_types character_state_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.character_state_types
    ADD CONSTRAINT character_state_types_pkey PRIMARY KEY (id);


--
-- Name: characters characters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.characters
    ADD CONSTRAINT characters_pkey PRIMARY KEY (id);


--
-- Name: clip_label_history clip_label_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clip_label_history
    ADD CONSTRAINT clip_label_history_pkey PRIMARY KEY (id);


--
-- Name: clip_libraries clip_libraries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clip_libraries
    ADD CONSTRAINT clip_libraries_pkey PRIMARY KEY (id);


--
-- Name: clip_libraries clip_libraries_slug_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clip_libraries
    ADD CONSTRAINT clip_libraries_slug_unique UNIQUE (slug);


--
-- Name: clip_library_configs clip_library_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clip_library_configs
    ADD CONSTRAINT clip_library_configs_pkey PRIMARY KEY (id);


--
-- Name: clip_library_reference_scripts clip_library_reference_scripts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clip_library_reference_scripts
    ADD CONSTRAINT clip_library_reference_scripts_pkey PRIMARY KEY (id);


--
-- Name: clip_usage clip_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clip_usage
    ADD CONSTRAINT clip_usage_pkey PRIMARY KEY (id);


--
-- Name: clips clips_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clips
    ADD CONSTRAINT clips_pkey PRIMARY KEY (id);


--
-- Name: connector_configs connector_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connector_configs
    ADD CONSTRAINT connector_configs_pkey PRIMARY KEY (id);


--
-- Name: content_jobs content_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_jobs
    ADD CONSTRAINT content_jobs_pkey PRIMARY KEY (id);


--
-- Name: content_templates content_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_templates
    ADD CONSTRAINT content_templates_pkey PRIMARY KEY (id);


--
-- Name: course_chapters course_chapters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_chapters
    ADD CONSTRAINT course_chapters_pkey PRIMARY KEY (id);


--
-- Name: course_videos course_videos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_videos
    ADD CONSTRAINT course_videos_pkey PRIMARY KEY (id);


--
-- Name: courses courses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courses
    ADD CONSTRAINT courses_pkey PRIMARY KEY (id);


--
-- Name: cron_schedules cron_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cron_schedules
    ADD CONSTRAINT cron_schedules_pkey PRIMARY KEY (id);


--
-- Name: decisions decisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decisions
    ADD CONSTRAINT decisions_pkey PRIMARY KEY (id);


--
-- Name: drama_characters drama_characters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drama_characters
    ADD CONSTRAINT drama_characters_pkey PRIMARY KEY (id);


--
-- Name: drama_clips drama_clips_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drama_clips
    ADD CONSTRAINT drama_clips_pkey PRIMARY KEY (id);


--
-- Name: encrypted_secrets encrypted_secrets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.encrypted_secrets
    ADD CONSTRAINT encrypted_secrets_pkey PRIMARY KEY (id);


--
-- Name: encrypted_secrets encrypted_secrets_slot_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.encrypted_secrets
    ADD CONSTRAINT encrypted_secrets_slot_uq UNIQUE (namespace, capability, provider);


--
-- Name: environments environments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environments
    ADD CONSTRAINT environments_pkey PRIMARY KEY (id);


--
-- Name: fleet_state fleet_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fleet_state
    ADD CONSTRAINT fleet_state_pkey PRIMARY KEY (id);


--
-- Name: format_style_libraries format_style_libraries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.format_style_libraries
    ADD CONSTRAINT format_style_libraries_pkey PRIMARY KEY (id);


--
-- Name: format_style_library_assets format_style_library_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.format_style_library_assets
    ADD CONSTRAINT format_style_library_assets_pkey PRIMARY KEY (id);


--
-- Name: google_drive_connections google_drive_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.google_drive_connections
    ADD CONSTRAINT google_drive_connections_pkey PRIMARY KEY (user_id);


--
-- Name: guardrail_rules guardrail_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guardrail_rules
    ADD CONSTRAINT guardrail_rules_pkey PRIMARY KEY (id);


--
-- Name: guardrail_trips guardrail_trips_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guardrail_trips
    ADD CONSTRAINT guardrail_trips_pkey PRIMARY KEY (id);


--
-- Name: inbox_items inbox_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_items
    ADD CONSTRAINT inbox_items_pkey PRIMARY KEY (id);


--
-- Name: job_edit_lists job_edit_lists_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_edit_lists
    ADD CONSTRAINT job_edit_lists_pkey PRIMARY KEY (id);


--
-- Name: knowledge_embeddings knowledge_embeddings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_embeddings
    ADD CONSTRAINT knowledge_embeddings_pkey PRIMARY KEY (id);


--
-- Name: knowledge_embeddings knowledge_embeddings_source_path_chunk_index_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_embeddings
    ADD CONSTRAINT knowledge_embeddings_source_path_chunk_index_key UNIQUE (source_path, chunk_index);


--
-- Name: knowledge_triples knowledge_triples_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_triples
    ADD CONSTRAINT knowledge_triples_pkey PRIMARY KEY (id);


--
-- Name: music_library music_library_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.music_library
    ADD CONSTRAINT music_library_pkey PRIMARY KEY (id);


--
-- Name: music_presets music_presets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.music_presets
    ADD CONSTRAINT music_presets_pkey PRIMARY KEY (id);


--
-- Name: narrators narrators_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.narrators
    ADD CONSTRAINT narrators_pkey PRIMARY KEY (id);


--
-- Name: reminders reminders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reminders
    ADD CONSTRAINT reminders_pkey PRIMARY KEY (id);


--
-- Name: remotion_caption_presets remotion_caption_presets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remotion_caption_presets
    ADD CONSTRAINT remotion_caption_presets_pkey PRIMARY KEY (id);


--
-- Name: runs runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runs
    ADD CONSTRAINT runs_pkey PRIMARY KEY (id);


--
-- Name: scene_frame_sequences scene_frame_sequences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scene_frame_sequences
    ADD CONSTRAINT scene_frame_sequences_pkey PRIMARY KEY (id);


--
-- Name: source_videos source_videos_content_hash_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.source_videos
    ADD CONSTRAINT source_videos_content_hash_unique UNIQUE (content_hash);


--
-- Name: source_videos source_videos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.source_videos
    ADD CONSTRAINT source_videos_pkey PRIMARY KEY (id);


--
-- Name: space_video_clips space_video_clips_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.space_video_clips
    ADD CONSTRAINT space_video_clips_pkey PRIMARY KEY (id);


--
-- Name: spend_log spend_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spend_log
    ADD CONSTRAINT spend_log_pkey PRIMARY KEY (id);


--
-- Name: stock_clip_uses stock_clip_uses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_clip_uses
    ADD CONSTRAINT stock_clip_uses_pkey PRIMARY KEY (id);


--
-- Name: stock_clips stock_clips_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_clips
    ADD CONSTRAINT stock_clips_pkey PRIMARY KEY (id);


--
-- Name: style_assets style_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.style_assets
    ADD CONSTRAINT style_assets_pkey PRIMARY KEY (id);


--
-- Name: subtitle_fonts subtitle_fonts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subtitle_fonts
    ADD CONSTRAINT subtitle_fonts_pkey PRIMARY KEY (id);


--
-- Name: subtitle_preset_assignments subtitle_preset_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subtitle_preset_assignments
    ADD CONSTRAINT subtitle_preset_assignments_pkey PRIMARY KEY (id);


--
-- Name: subtitle_presets subtitle_presets_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subtitle_presets
    ADD CONSTRAINT subtitle_presets_name_unique UNIQUE (name);


--
-- Name: subtitle_presets subtitle_presets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subtitle_presets
    ADD CONSTRAINT subtitle_presets_pkey PRIMARY KEY (id);


--
-- Name: system_events system_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_events
    ADD CONSTRAINT system_events_pkey PRIMARY KEY (id);


--
-- Name: system_settings system_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_pkey PRIMARY KEY (id);


--
-- Name: tts_voices tts_voices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tts_voices
    ADD CONSTRAINT tts_voices_pkey PRIMARY KEY (id);


--
-- Name: tutorial_background_presets tutorial_background_presets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutorial_background_presets
    ADD CONSTRAINT tutorial_background_presets_pkey PRIMARY KEY (id);


--
-- Name: tutorial_derivatives tutorial_derivatives_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutorial_derivatives
    ADD CONSTRAINT tutorial_derivatives_pkey PRIMARY KEY (id);


--
-- Name: tutorial_intro_hosts tutorial_intro_hosts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutorial_intro_hosts
    ADD CONSTRAINT tutorial_intro_hosts_pkey PRIMARY KEY (id);


--
-- Name: tutorial_jobs tutorial_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutorial_jobs
    ADD CONSTRAINT tutorial_jobs_pkey PRIMARY KEY (id);


--
-- Name: tutorial_prompt_presets tutorial_prompt_presets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutorial_prompt_presets
    ADD CONSTRAINT tutorial_prompt_presets_pkey PRIMARY KEY (id);


--
-- Name: tutorial_settings tutorial_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutorial_settings
    ADD CONSTRAINT tutorial_settings_pkey PRIMARY KEY (id);


--
-- Name: subtitle_preset_assignments uq_subtitle_preset_assignments_format_channel; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subtitle_preset_assignments
    ADD CONSTRAINT uq_subtitle_preset_assignments_format_channel UNIQUE (format, channel_id);


--
-- Name: user_job_presets user_job_presets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_job_presets
    ADD CONSTRAINT user_job_presets_pkey PRIMARY KEY (id);


--
-- Name: users users_email_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_unique UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: video_notes video_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_notes
    ADD CONSTRAINT video_notes_pkey PRIMARY KEY (id);


--
-- Name: video_stitch_jobs video_stitch_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_stitch_jobs
    ADD CONSTRAINT video_stitch_jobs_pkey PRIMARY KEY (id);


--
-- Name: video_timelines video_timelines_job_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_timelines
    ADD CONSTRAINT video_timelines_job_id_key UNIQUE (job_id);


--
-- Name: video_timelines video_timelines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_timelines
    ADD CONSTRAINT video_timelines_pkey PRIMARY KEY (id);


--
-- Name: video_watch_progress video_watch_progress_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_watch_progress
    ADD CONSTRAINT video_watch_progress_pkey PRIMARY KEY (id);


--
-- Name: webhooks webhooks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhooks
    ADD CONSTRAINT webhooks_pkey PRIMARY KEY (id);


--
-- Name: webhooks webhooks_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhooks
    ADD CONSTRAINT webhooks_slug_key UNIQUE (slug);


--
-- Name: cf_accounts_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cf_accounts_active_idx ON public.cf_accounts USING btree (active);


--
-- Name: cf_accounts_persona_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cf_accounts_persona_idx ON public.cf_accounts USING btree (persona_id);


--
-- Name: cf_accounts_platform_handle_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX cf_accounts_platform_handle_uidx ON public.cf_accounts USING btree (platform, handle);


--
-- Name: cf_caption_pool_persona_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cf_caption_pool_persona_idx ON public.cf_caption_pool USING btree (persona_id);


--
-- Name: cf_caption_presets_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cf_caption_presets_name_idx ON public.cf_caption_presets USING btree (name);


--
-- Name: cf_config_persona_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cf_config_persona_idx ON public.cf_config USING btree (persona_id);


--
-- Name: cf_distributions_account_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cf_distributions_account_idx ON public.cf_distributions USING btree (account_id);


--
-- Name: cf_distributions_clip_account_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX cf_distributions_clip_account_uidx ON public.cf_distributions USING btree (raw_clip_id, account_id);


--
-- Name: cf_distributions_scheduled_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cf_distributions_scheduled_idx ON public.cf_distributions USING btree (scheduled_for);


--
-- Name: cf_distributions_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cf_distributions_status_idx ON public.cf_distributions USING btree (status);


--
-- Name: cf_job_failures_class_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cf_job_failures_class_idx ON public.cf_job_failures USING btree (error_class);


--
-- Name: cf_job_failures_corr_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cf_job_failures_corr_idx ON public.cf_job_failures USING btree (correlation_id);


--
-- Name: cf_job_failures_queue_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cf_job_failures_queue_idx ON public.cf_job_failures USING btree (queue);


--
-- Name: cf_raw_clips_persona_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cf_raw_clips_persona_idx ON public.cf_raw_clips USING btree (persona_id);


--
-- Name: cf_raw_clips_score_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cf_raw_clips_score_idx ON public.cf_raw_clips USING btree (clip_score);


--
-- Name: cf_raw_clips_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cf_raw_clips_source_idx ON public.cf_raw_clips USING btree (source_id);


--
-- Name: cf_raw_clips_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cf_raw_clips_status_idx ON public.cf_raw_clips USING btree (status);


--
-- Name: cf_sources_persona_external_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX cf_sources_persona_external_uidx ON public.cf_sources USING btree (persona_id, external_id);


--
-- Name: cf_sources_persona_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cf_sources_persona_idx ON public.cf_sources USING btree (persona_id);


--
-- Name: cf_sources_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cf_sources_status_idx ON public.cf_sources USING btree (status);


--
-- Name: cf_style_presets_persona_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cf_style_presets_persona_idx ON public.cf_style_presets USING btree (persona_id);


--
-- Name: cf_style_presets_persona_name_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX cf_style_presets_persona_name_uq ON public.cf_style_presets USING btree (COALESCE((persona_id)::text, ''::text), name);


--
-- Name: cf_variants_clip_seed_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX cf_variants_clip_seed_uidx ON public.cf_finishing_variants USING btree (raw_clip_id, variant_seed);


--
-- Name: cf_variants_expires_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cf_variants_expires_idx ON public.cf_finishing_variants USING btree (expires_at);


--
-- Name: cf_variants_hash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cf_variants_hash_idx ON public.cf_finishing_variants USING btree (rendered_hash);


--
-- Name: cf_variants_raw_clip_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cf_variants_raw_clip_idx ON public.cf_finishing_variants USING btree (raw_clip_id);


--
-- Name: channel_drama_chars_channel_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX channel_drama_chars_channel_idx ON public.channel_drama_characters USING btree (channel_id);


--
-- Name: character_registry_library_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX character_registry_library_name_idx ON public.character_registry USING btree (library_id, name);


--
-- Name: clip_label_history_clip_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX clip_label_history_clip_id_idx ON public.clip_label_history USING btree (clip_id);


--
-- Name: clip_libraries_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX clip_libraries_name_idx ON public.clip_libraries USING btree (name);


--
-- Name: clip_library_configs_format_channel_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX clip_library_configs_format_channel_idx ON public.clip_library_configs USING btree (format, channel_id);


--
-- Name: clip_library_configs_library_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX clip_library_configs_library_id_idx ON public.clip_library_configs USING btree (clip_library_id);


--
-- Name: clip_library_reference_scripts_lib_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX clip_library_reference_scripts_lib_idx ON public.clip_library_reference_scripts USING btree (clip_library_id);


--
-- Name: clip_library_reference_scripts_lru_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX clip_library_reference_scripts_lru_idx ON public.clip_library_reference_scripts USING btree (clip_library_id, last_used_at NULLS FIRST);


--
-- Name: clip_usage_clip_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX clip_usage_clip_id_idx ON public.clip_usage USING btree (clip_id);


--
-- Name: clip_usage_job_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX clip_usage_job_id_idx ON public.clip_usage USING btree (job_id);


--
-- Name: clips_characters_present_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX clips_characters_present_gin ON public.clips USING gin (characters_present);


--
-- Name: clips_clip_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX clips_clip_type_idx ON public.clips USING btree (clip_type);


--
-- Name: clips_duplicate_of_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX clips_duplicate_of_idx ON public.clips USING btree (duplicate_of_id) WHERE (duplicate_of_id IS NOT NULL);


--
-- Name: clips_embedding_hnsw_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX clips_embedding_hnsw_idx ON public.clips USING hnsw (embedding public.halfvec_cosine_ops);


--
-- Name: clips_labeling_step_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX clips_labeling_step_idx ON public.clips USING btree (labeling_step);


--
-- Name: clips_library_external_ref_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX clips_library_external_ref_idx ON public.clips USING btree (library_id, external_ref) WHERE (external_ref IS NOT NULL);


--
-- Name: clips_library_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX clips_library_id_idx ON public.clips USING btree (library_id);


--
-- Name: clips_narrative_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX clips_narrative_type_idx ON public.clips USING btree (narrative_type);


--
-- Name: clips_next_clip_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX clips_next_clip_id_idx ON public.clips USING btree (next_clip_id);


--
-- Name: clips_phash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX clips_phash_idx ON public.clips USING btree (phash) WHERE (phash IS NOT NULL);


--
-- Name: clips_prev_clip_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX clips_prev_clip_id_idx ON public.clips USING btree (prev_clip_id);


--
-- Name: clips_review_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX clips_review_status_idx ON public.clips USING btree (review_status);


--
-- Name: clips_source_video_clip_index_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX clips_source_video_clip_index_idx ON public.clips USING btree (source_video_id, clip_index);


--
-- Name: clips_source_video_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX clips_source_video_id_idx ON public.clips USING btree (source_video_id);


--
-- Name: clips_tags_action_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX clips_tags_action_gin ON public.clips USING gin (tags_action);


--
-- Name: clips_tags_characters_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX clips_tags_characters_gin ON public.clips USING gin (tags_characters);


--
-- Name: clips_tags_location_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX clips_tags_location_gin ON public.clips USING gin (tags_location);


--
-- Name: clips_tags_mood_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX clips_tags_mood_gin ON public.clips USING gin (tags_mood);


--
-- Name: content_jobs_channel_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_jobs_channel_id_idx ON public.content_jobs USING btree (channel_id);


--
-- Name: content_jobs_production_va_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_jobs_production_va_id_idx ON public.content_jobs USING btree (assigned_production_va_id);


--
-- Name: content_jobs_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_jobs_status_idx ON public.content_jobs USING btree (status);


--
-- Name: content_jobs_template_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_jobs_template_id_idx ON public.content_jobs USING btree (template_id);


--
-- Name: content_jobs_uploader_va_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_jobs_uploader_va_id_idx ON public.content_jobs USING btree (assigned_uploader_va_id);


--
-- Name: content_jobs_youtube_video_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_jobs_youtube_video_id_idx ON public.content_jobs USING btree (youtube_video_id);


--
-- Name: course_chapters_course_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX course_chapters_course_id_idx ON public.course_chapters USING btree (course_id);


--
-- Name: course_videos_chapter_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX course_videos_chapter_id_idx ON public.course_videos USING btree (chapter_id);


--
-- Name: cron_schedules_next_run_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cron_schedules_next_run_idx ON public.cron_schedules USING btree (next_run_at) WHERE enabled;


--
-- Name: decisions_kind_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX decisions_kind_idx ON public.decisions USING btree (kind, ts DESC);


--
-- Name: decisions_ts_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX decisions_ts_idx ON public.decisions USING btree (ts DESC);


--
-- Name: drama_clips_character_ids_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX drama_clips_character_ids_idx ON public.drama_clips USING gin (character_ids);


--
-- Name: drama_clips_job_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX drama_clips_job_id_idx ON public.drama_clips USING btree (job_id);


--
-- Name: guardrail_trips_rule_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX guardrail_trips_rule_idx ON public.guardrail_trips USING btree (rule_id, created_at DESC);


--
-- Name: guardrail_trips_ts_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX guardrail_trips_ts_idx ON public.guardrail_trips USING btree (created_at DESC);


--
-- Name: idx_archetypes_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_archetypes_is_active ON public.archetypes USING btree (is_active);


--
-- Name: idx_archetypes_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_archetypes_name ON public.archetypes USING btree (name);


--
-- Name: idx_assets_archetype; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assets_archetype ON public.assets USING btree (archetype_id);


--
-- Name: idx_assets_asset_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assets_asset_type ON public.assets USING btree (asset_type);


--
-- Name: idx_assets_channel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assets_channel ON public.assets USING btree (channel_id);


--
-- Name: idx_assets_character_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assets_character_id ON public.assets USING btree (character_id);


--
-- Name: idx_assets_format; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assets_format ON public.assets USING btree (format);


--
-- Name: idx_assets_media_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assets_media_type ON public.assets USING btree (asset_type) WHERE ((asset_type)::text = ANY ((ARRAY['video'::character varying, 'audio'::character varying, 'image'::character varying])::text[]));


--
-- Name: idx_assets_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assets_status ON public.assets USING btree (status);


--
-- Name: idx_assets_tags; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assets_tags ON public.assets USING gin (tags);


--
-- Name: idx_caption_presets_default; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_caption_presets_default ON public.caption_presets USING btree (is_default);


--
-- Name: idx_caption_presets_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_caption_presets_name ON public.caption_presets USING btree (name);


--
-- Name: idx_characters_archetype; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_characters_archetype ON public.characters USING btree (archetype_id);


--
-- Name: idx_characters_channel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_characters_channel ON public.characters USING btree (channel_id);


--
-- Name: idx_characters_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_characters_is_active ON public.characters USING btree (is_active);


--
-- Name: idx_collection_memberships_asset_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_collection_memberships_asset_id ON public.asset_collection_memberships USING btree (asset_id);


--
-- Name: idx_collection_memberships_collection_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_collection_memberships_collection_id ON public.asset_collection_memberships USING btree (collection_id);


--
-- Name: idx_content_jobs_error_detail_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_content_jobs_error_detail_code ON public.content_jobs USING btree (((error_detail ->> 'code'::text))) WHERE (error_detail IS NOT NULL);


--
-- Name: idx_content_jobs_metadata_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_content_jobs_metadata_gin ON public.content_jobs USING gin (metadata);


--
-- Name: idx_environments_archetype; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_environments_archetype ON public.environments USING btree (archetype_id);


--
-- Name: idx_environments_channel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_environments_channel ON public.environments USING btree (channel_id);


--
-- Name: idx_environments_tags; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_environments_tags ON public.environments USING gin (tags);


--
-- Name: idx_format_style_libraries_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_format_style_libraries_active ON public.format_style_libraries USING btree (is_active);


--
-- Name: idx_format_style_libraries_format; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_format_style_libraries_format ON public.format_style_libraries USING btree (format);


--
-- Name: idx_format_style_library_assets_asset; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_format_style_library_assets_asset ON public.format_style_library_assets USING btree (asset_id);


--
-- Name: idx_format_style_library_assets_library; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_format_style_library_assets_library ON public.format_style_library_assets USING btree (library_id);


--
-- Name: idx_format_style_library_assets_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_format_style_library_assets_unique ON public.format_style_library_assets USING btree (library_id, asset_id);


--
-- Name: idx_music_presets_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_music_presets_user_id ON public.music_presets USING btree (user_id);


--
-- Name: idx_narrators_channel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_narrators_channel ON public.narrators USING btree (channel_id);


--
-- Name: idx_narrators_default_per_channel; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_narrators_default_per_channel ON public.narrators USING btree (channel_id, is_default) WHERE (is_default = true);


--
-- Name: idx_remotion_caption_presets_default; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_remotion_caption_presets_default ON public.remotion_caption_presets USING btree (is_default);


--
-- Name: idx_remotion_caption_presets_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_remotion_caption_presets_name ON public.remotion_caption_presets USING btree (name);


--
-- Name: idx_scene_frame_sequences_job; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scene_frame_sequences_job ON public.scene_frame_sequences USING btree (job_id);


--
-- Name: idx_scene_frame_sequences_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scene_frame_sequences_status ON public.scene_frame_sequences USING btree (status);


--
-- Name: idx_style_assets_channel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_style_assets_channel ON public.style_assets USING btree (channel_id);


--
-- Name: idx_style_assets_format; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_style_assets_format ON public.style_assets USING btree (format);


--
-- Name: idx_subtitle_fonts_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subtitle_fonts_name ON public.subtitle_fonts USING btree (name);


--
-- Name: idx_subtitle_preset_assignments_preset; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subtitle_preset_assignments_preset ON public.subtitle_preset_assignments USING btree (preset_id);


--
-- Name: idx_subtitle_presets_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subtitle_presets_active ON public.subtitle_presets USING btree (is_active);


--
-- Name: idx_subtitle_presets_engine; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subtitle_presets_engine ON public.subtitle_presets USING btree (engine);


--
-- Name: idx_video_stitch_jobs_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_video_stitch_jobs_created_at ON public.video_stitch_jobs USING btree (created_at);


--
-- Name: idx_video_stitch_jobs_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_video_stitch_jobs_created_by ON public.video_stitch_jobs USING btree (created_by_user_id);


--
-- Name: idx_video_stitch_jobs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_video_stitch_jobs_status ON public.video_stitch_jobs USING btree (status);


--
-- Name: inbox_items_external_id_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX inbox_items_external_id_uniq ON public.inbox_items USING btree (external_id) WHERE (external_id IS NOT NULL);


--
-- Name: inbox_items_open_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inbox_items_open_idx ON public.inbox_items USING btree (created_at DESC) WHERE (resolved_at IS NULL);


--
-- Name: inbox_items_related_job_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inbox_items_related_job_idx ON public.inbox_items USING btree (related_job_id) WHERE (related_job_id IS NOT NULL);


--
-- Name: inbox_items_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inbox_items_status_idx ON public.inbox_items USING btree (status) WHERE (resolved_at IS NULL);


--
-- Name: job_edit_lists_job_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX job_edit_lists_job_id_idx ON public.job_edit_lists USING btree (job_id);


--
-- Name: job_edit_lists_job_version_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX job_edit_lists_job_version_idx ON public.job_edit_lists USING btree (job_id, version);


--
-- Name: job_edit_lists_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX job_edit_lists_status_idx ON public.job_edit_lists USING btree (status);


--
-- Name: knowledge_embeddings_hnsw; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX knowledge_embeddings_hnsw ON public.knowledge_embeddings USING hnsw (embedding public.halfvec_cosine_ops) WITH (m='16', ef_construction='64');


--
-- Name: knowledge_embeddings_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX knowledge_embeddings_source ON public.knowledge_embeddings USING btree (source_path);


--
-- Name: knowledge_triples_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX knowledge_triples_category_idx ON public.knowledge_triples USING btree (category);


--
-- Name: knowledge_triples_note_slug_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX knowledge_triples_note_slug_idx ON public.knowledge_triples USING btree (note_slug);


--
-- Name: knowledge_triples_object_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX knowledge_triples_object_key_idx ON public.knowledge_triples USING btree (object_key);


--
-- Name: knowledge_triples_subject_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX knowledge_triples_subject_key_idx ON public.knowledge_triples USING btree (subject_key);


--
-- Name: knowledge_triples_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX knowledge_triples_unique_idx ON public.knowledge_triples USING btree (subject_key, predicate, object_key, source_path, chunk_index);


--
-- Name: music_library_format_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX music_library_format_idx ON public.music_library USING btree (format);


--
-- Name: reminders_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reminders_due_idx ON public.reminders USING btree (due_at) WHERE (status = 'pending'::text);


--
-- Name: runs_parent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runs_parent_idx ON public.runs USING btree (parent_run_id) WHERE (parent_run_id IS NOT NULL);


--
-- Name: runs_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runs_status_idx ON public.runs USING btree (status, created_at DESC);


--
-- Name: runs_stuck_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runs_stuck_idx ON public.runs USING btree (last_heartbeat_at) WHERE ((status)::text = ANY ((ARRAY['running'::character varying, 'stuck'::character varying])::text[]));


--
-- Name: runs_worker_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runs_worker_idx ON public.runs USING btree (worker) WHERE (worker IS NOT NULL);


--
-- Name: source_videos_content_hash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX source_videos_content_hash_idx ON public.source_videos USING btree (content_hash);


--
-- Name: source_videos_ingest_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX source_videos_ingest_status_idx ON public.source_videos USING btree (ingest_status);


--
-- Name: source_videos_library_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX source_videos_library_id_idx ON public.source_videos USING btree (library_id);


--
-- Name: source_videos_library_ref_base_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX source_videos_library_ref_base_idx ON public.source_videos USING btree (library_id, ref_base) WHERE (ref_base IS NOT NULL);


--
-- Name: source_videos_source_kind_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX source_videos_source_kind_idx ON public.source_videos USING btree (source_kind);


--
-- Name: source_videos_youtube_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX source_videos_youtube_id_idx ON public.source_videos USING btree (youtube_id) WHERE (youtube_id IS NOT NULL);


--
-- Name: space_video_clips_job_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX space_video_clips_job_id_idx ON public.space_video_clips USING btree (job_id);


--
-- Name: spend_log_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX spend_log_created_at_idx ON public.spend_log USING btree (created_at DESC);


--
-- Name: spend_log_provider_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX spend_log_provider_created_idx ON public.spend_log USING btree (provider, created_at DESC);


--
-- Name: stock_clip_uses_clip_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stock_clip_uses_clip_idx ON public.stock_clip_uses USING btree (stock_clip_id);


--
-- Name: stock_clip_uses_job_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stock_clip_uses_job_idx ON public.stock_clip_uses USING btree (job_id);


--
-- Name: stock_clips_last_used_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stock_clips_last_used_at_idx ON public.stock_clips USING btree (last_used_at);


--
-- Name: stock_clips_library_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stock_clips_library_idx ON public.stock_clips USING btree (clip_library_id);


--
-- Name: stock_clips_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stock_clips_status_idx ON public.stock_clips USING btree (status);


--
-- Name: system_events_event_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX system_events_event_type_idx ON public.system_events USING btree (event_type);


--
-- Name: system_events_job_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX system_events_job_id_idx ON public.system_events USING btree (job_id);


--
-- Name: system_events_timestamp_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX system_events_timestamp_idx ON public.system_events USING btree ("timestamp");


--
-- Name: tutorial_derivatives_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tutorial_derivatives_source_idx ON public.tutorial_derivatives USING btree (source_job_id);


--
-- Name: tutorial_derivatives_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tutorial_derivatives_status_idx ON public.tutorial_derivatives USING btree (status);


--
-- Name: tutorial_jobs_batch_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tutorial_jobs_batch_id_idx ON public.tutorial_jobs USING btree (batch_id);


--
-- Name: tutorial_jobs_created_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tutorial_jobs_created_by_idx ON public.tutorial_jobs USING btree (created_by);


--
-- Name: tutorial_jobs_parent_job_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tutorial_jobs_parent_job_id_idx ON public.tutorial_jobs USING btree (parent_job_id);


--
-- Name: tutorial_jobs_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tutorial_jobs_status_idx ON public.tutorial_jobs USING btree (status);


--
-- Name: tutorial_prompt_presets_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tutorial_prompt_presets_category_idx ON public.tutorial_prompt_presets USING btree (category);


--
-- Name: uidx_scene_frame_sequences_job_scene_frame; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uidx_scene_frame_sequences_job_scene_frame ON public.scene_frame_sequences USING btree (job_id, scene_index, frame_index);


--
-- Name: user_job_presets_user_template_name_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX user_job_presets_user_template_name_uidx ON public.user_job_presets USING btree (user_id, template_id, preset_name);


--
-- Name: video_notes_user_video_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX video_notes_user_video_idx ON public.video_notes USING btree (user_id, video_id);


--
-- Name: video_timelines_job_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX video_timelines_job_id_idx ON public.video_timelines USING btree (job_id);


--
-- Name: video_watch_progress_user_video_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX video_watch_progress_user_video_uidx ON public.video_watch_progress USING btree (user_id, video_id);


--
-- Name: webhooks_enabled_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX webhooks_enabled_idx ON public.webhooks USING btree (enabled) WHERE enabled;


--
-- Name: style_assets block_style_assets_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER block_style_assets_insert BEFORE INSERT ON public.style_assets FOR EACH ROW EXECUTE FUNCTION public.prevent_style_assets_insert();


--
-- Name: asset_collection_memberships asset_collection_memberships_asset_id_assets_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_collection_memberships
    ADD CONSTRAINT asset_collection_memberships_asset_id_assets_id_fk FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON DELETE CASCADE;


--
-- Name: asset_collection_memberships asset_collection_memberships_collection_id_asset_collections_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_collection_memberships
    ADD CONSTRAINT asset_collection_memberships_collection_id_asset_collections_id FOREIGN KEY (collection_id) REFERENCES public.asset_collections(id) ON DELETE CASCADE;


--
-- Name: assets assets_archetype_id_archetypes_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_archetype_id_archetypes_id_fk FOREIGN KEY (archetype_id) REFERENCES public.archetypes(id) ON DELETE SET NULL;


--
-- Name: assets assets_archetype_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_archetype_id_fkey FOREIGN KEY (archetype_id) REFERENCES public.archetypes(id) ON DELETE SET NULL;


--
-- Name: assets assets_channel_id_channels_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_channel_id_channels_id_fk FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE SET NULL;


--
-- Name: assets assets_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE SET NULL;


--
-- Name: assets assets_character_id_characters_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_character_id_characters_id_fk FOREIGN KEY (character_id) REFERENCES public.characters(id) ON DELETE CASCADE;


--
-- Name: assets assets_parent_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_parent_asset_id_fkey FOREIGN KEY (parent_asset_id) REFERENCES public.assets(id) ON DELETE SET NULL;


--
-- Name: bundestag_clips bundestag_clips_job_id_content_jobs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bundestag_clips
    ADD CONSTRAINT bundestag_clips_job_id_content_jobs_id_fk FOREIGN KEY (job_id) REFERENCES public.content_jobs(id) ON DELETE CASCADE;


--
-- Name: bundestag_playbooks bundestag_playbooks_job_id_content_jobs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bundestag_playbooks
    ADD CONSTRAINT bundestag_playbooks_job_id_content_jobs_id_fk FOREIGN KEY (job_id) REFERENCES public.content_jobs(id) ON DELETE CASCADE;


--
-- Name: cf_accounts cf_accounts_persona_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cf_accounts
    ADD CONSTRAINT cf_accounts_persona_id_fkey FOREIGN KEY (persona_id) REFERENCES public.cf_personas(id) ON DELETE CASCADE;


--
-- Name: cf_caption_pool cf_caption_pool_persona_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cf_caption_pool
    ADD CONSTRAINT cf_caption_pool_persona_id_fkey FOREIGN KEY (persona_id) REFERENCES public.cf_personas(id) ON DELETE CASCADE;


--
-- Name: cf_config cf_config_persona_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cf_config
    ADD CONSTRAINT cf_config_persona_id_fkey FOREIGN KEY (persona_id) REFERENCES public.cf_personas(id) ON DELETE CASCADE;


--
-- Name: cf_distributions cf_distributions_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cf_distributions
    ADD CONSTRAINT cf_distributions_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.cf_accounts(id) ON DELETE CASCADE;


--
-- Name: cf_distributions cf_distributions_raw_clip_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cf_distributions
    ADD CONSTRAINT cf_distributions_raw_clip_id_fkey FOREIGN KEY (raw_clip_id) REFERENCES public.cf_raw_clips(id) ON DELETE CASCADE;


--
-- Name: cf_distributions cf_distributions_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cf_distributions
    ADD CONSTRAINT cf_distributions_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.cf_finishing_variants(id) ON DELETE SET NULL;


--
-- Name: cf_finishing_variants cf_finishing_variants_raw_clip_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cf_finishing_variants
    ADD CONSTRAINT cf_finishing_variants_raw_clip_id_fkey FOREIGN KEY (raw_clip_id) REFERENCES public.cf_raw_clips(id) ON DELETE CASCADE;


--
-- Name: cf_raw_clips cf_raw_clips_persona_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cf_raw_clips
    ADD CONSTRAINT cf_raw_clips_persona_id_fkey FOREIGN KEY (persona_id) REFERENCES public.cf_personas(id) ON DELETE CASCADE;


--
-- Name: cf_raw_clips cf_raw_clips_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cf_raw_clips
    ADD CONSTRAINT cf_raw_clips_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.cf_sources(id) ON DELETE CASCADE;


--
-- Name: cf_sources cf_sources_persona_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cf_sources
    ADD CONSTRAINT cf_sources_persona_id_fkey FOREIGN KEY (persona_id) REFERENCES public.cf_personas(id) ON DELETE CASCADE;


--
-- Name: cf_style_presets cf_style_presets_persona_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cf_style_presets
    ADD CONSTRAINT cf_style_presets_persona_id_fkey FOREIGN KEY (persona_id) REFERENCES public.cf_personas(id) ON DELETE CASCADE;


--
-- Name: channel_drama_characters channel_drama_characters_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channel_drama_characters
    ADD CONSTRAINT channel_drama_characters_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE CASCADE;


--
-- Name: channel_drama_characters channel_drama_characters_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channel_drama_characters
    ADD CONSTRAINT channel_drama_characters_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.drama_characters(id) ON DELETE CASCADE;


--
-- Name: channels channels_clip_library_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channels
    ADD CONSTRAINT channels_clip_library_id_fkey FOREIGN KEY (clip_library_id) REFERENCES public.clip_libraries(id) ON DELETE SET NULL;


--
-- Name: character_registry character_registry_library_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.character_registry
    ADD CONSTRAINT character_registry_library_id_fkey FOREIGN KEY (library_id) REFERENCES public.clip_libraries(id) ON DELETE CASCADE;


--
-- Name: characters characters_archetype_id_archetypes_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.characters
    ADD CONSTRAINT characters_archetype_id_archetypes_id_fk FOREIGN KEY (archetype_id) REFERENCES public.archetypes(id) ON DELETE SET NULL;


--
-- Name: characters characters_archetype_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.characters
    ADD CONSTRAINT characters_archetype_id_fkey FOREIGN KEY (archetype_id) REFERENCES public.archetypes(id) ON DELETE SET NULL;


--
-- Name: characters characters_channel_id_channels_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.characters
    ADD CONSTRAINT characters_channel_id_channels_id_fk FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE SET NULL;


--
-- Name: characters characters_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.characters
    ADD CONSTRAINT characters_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE SET NULL;


--
-- Name: characters characters_reference_sheet_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.characters
    ADD CONSTRAINT characters_reference_sheet_asset_id_fkey FOREIGN KEY (reference_sheet_asset_id) REFERENCES public.assets(id) ON DELETE SET NULL;


--
-- Name: clip_label_history clip_label_history_clip_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clip_label_history
    ADD CONSTRAINT clip_label_history_clip_id_fkey FOREIGN KEY (clip_id) REFERENCES public.clips(id) ON DELETE CASCADE;


--
-- Name: clip_library_configs clip_library_configs_clip_library_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clip_library_configs
    ADD CONSTRAINT clip_library_configs_clip_library_id_fkey FOREIGN KEY (clip_library_id) REFERENCES public.clip_libraries(id) ON DELETE RESTRICT;


--
-- Name: clip_library_reference_scripts clip_library_reference_scripts_clip_library_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clip_library_reference_scripts
    ADD CONSTRAINT clip_library_reference_scripts_clip_library_id_fkey FOREIGN KEY (clip_library_id) REFERENCES public.clip_libraries(id) ON DELETE CASCADE;


--
-- Name: clip_usage clip_usage_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clip_usage
    ADD CONSTRAINT clip_usage_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.content_jobs(id) ON DELETE CASCADE;


--
-- Name: clips clips_duplicate_of_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clips
    ADD CONSTRAINT clips_duplicate_of_id_fkey FOREIGN KEY (duplicate_of_id) REFERENCES public.clips(id) ON DELETE SET NULL;


--
-- Name: clips clips_library_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clips
    ADD CONSTRAINT clips_library_id_fkey FOREIGN KEY (library_id) REFERENCES public.clip_libraries(id) ON DELETE RESTRICT;


--
-- Name: clips clips_next_clip_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clips
    ADD CONSTRAINT clips_next_clip_id_fkey FOREIGN KEY (next_clip_id) REFERENCES public.clips(id) ON DELETE SET NULL;


--
-- Name: clips clips_prev_clip_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clips
    ADD CONSTRAINT clips_prev_clip_id_fkey FOREIGN KEY (prev_clip_id) REFERENCES public.clips(id) ON DELETE SET NULL;


--
-- Name: clips clips_source_video_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clips
    ADD CONSTRAINT clips_source_video_id_fkey FOREIGN KEY (source_video_id) REFERENCES public.source_videos(id) ON DELETE CASCADE;


--
-- Name: content_jobs content_jobs_archetype_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_jobs
    ADD CONSTRAINT content_jobs_archetype_id_fkey FOREIGN KEY (archetype_id) REFERENCES public.archetypes(id) ON DELETE SET NULL;


--
-- Name: content_jobs content_jobs_assigned_production_va_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_jobs
    ADD CONSTRAINT content_jobs_assigned_production_va_id_users_id_fk FOREIGN KEY (assigned_production_va_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: content_jobs content_jobs_assigned_uploader_va_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_jobs
    ADD CONSTRAINT content_jobs_assigned_uploader_va_id_users_id_fk FOREIGN KEY (assigned_uploader_va_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: content_jobs content_jobs_channel_id_channels_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_jobs
    ADD CONSTRAINT content_jobs_channel_id_channels_id_fk FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE RESTRICT;


--
-- Name: content_jobs content_jobs_template_id_content_templates_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_jobs
    ADD CONSTRAINT content_jobs_template_id_content_templates_id_fk FOREIGN KEY (template_id) REFERENCES public.content_templates(id) ON DELETE RESTRICT;


--
-- Name: content_templates content_templates_archetype_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_templates
    ADD CONSTRAINT content_templates_archetype_id_fkey FOREIGN KEY (archetype_id) REFERENCES public.archetypes(id) ON DELETE SET NULL;


--
-- Name: content_templates content_templates_default_style_library_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_templates
    ADD CONSTRAINT content_templates_default_style_library_id_fkey FOREIGN KEY (default_style_library_id) REFERENCES public.format_style_libraries(id) ON DELETE SET NULL;


--
-- Name: course_chapters course_chapters_course_id_courses_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_chapters
    ADD CONSTRAINT course_chapters_course_id_courses_id_fk FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE;


--
-- Name: course_chapters course_chapters_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_chapters
    ADD CONSTRAINT course_chapters_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE;


--
-- Name: course_videos course_videos_chapter_id_course_chapters_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_videos
    ADD CONSTRAINT course_videos_chapter_id_course_chapters_id_fk FOREIGN KEY (chapter_id) REFERENCES public.course_chapters(id) ON DELETE CASCADE;


--
-- Name: course_videos course_videos_chapter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_videos
    ADD CONSTRAINT course_videos_chapter_id_fkey FOREIGN KEY (chapter_id) REFERENCES public.course_chapters(id) ON DELETE CASCADE;


--
-- Name: cron_schedules cron_schedules_last_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cron_schedules
    ADD CONSTRAINT cron_schedules_last_run_id_fkey FOREIGN KEY (last_run_id) REFERENCES public.runs(id) ON DELETE SET NULL;


--
-- Name: decisions decisions_inbox_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decisions
    ADD CONSTRAINT decisions_inbox_item_id_fkey FOREIGN KEY (inbox_item_id) REFERENCES public.inbox_items(id) ON DELETE SET NULL;


--
-- Name: decisions decisions_related_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decisions
    ADD CONSTRAINT decisions_related_job_id_fkey FOREIGN KEY (related_job_id) REFERENCES public.content_jobs(id) ON DELETE SET NULL;


--
-- Name: drama_clips drama_clips_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drama_clips
    ADD CONSTRAINT drama_clips_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.content_jobs(id) ON DELETE CASCADE;


--
-- Name: encrypted_secrets encrypted_secrets_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.encrypted_secrets
    ADD CONSTRAINT encrypted_secrets_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: encrypted_secrets encrypted_secrets_updated_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.encrypted_secrets
    ADD CONSTRAINT encrypted_secrets_updated_by_users_id_fk FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: environments environments_archetype_id_archetypes_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environments
    ADD CONSTRAINT environments_archetype_id_archetypes_id_fk FOREIGN KEY (archetype_id) REFERENCES public.archetypes(id) ON DELETE SET NULL;


--
-- Name: environments environments_archetype_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environments
    ADD CONSTRAINT environments_archetype_id_fkey FOREIGN KEY (archetype_id) REFERENCES public.archetypes(id) ON DELETE SET NULL;


--
-- Name: environments environments_background_asset_id_assets_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environments
    ADD CONSTRAINT environments_background_asset_id_assets_id_fk FOREIGN KEY (background_asset_id) REFERENCES public.assets(id) ON DELETE RESTRICT;


--
-- Name: environments environments_background_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environments
    ADD CONSTRAINT environments_background_asset_id_fkey FOREIGN KEY (background_asset_id) REFERENCES public.assets(id) ON DELETE RESTRICT;


--
-- Name: environments environments_channel_id_channels_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environments
    ADD CONSTRAINT environments_channel_id_channels_id_fk FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE SET NULL;


--
-- Name: environments environments_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environments
    ADD CONSTRAINT environments_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE SET NULL;


--
-- Name: assets fk_assets_character; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT fk_assets_character FOREIGN KEY (character_id) REFERENCES public.characters(id) ON DELETE CASCADE;


--
-- Name: format_style_library_assets format_style_library_assets_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.format_style_library_assets
    ADD CONSTRAINT format_style_library_assets_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON DELETE CASCADE;


--
-- Name: format_style_library_assets format_style_library_assets_library_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.format_style_library_assets
    ADD CONSTRAINT format_style_library_assets_library_id_fkey FOREIGN KEY (library_id) REFERENCES public.format_style_libraries(id) ON DELETE CASCADE;


--
-- Name: google_drive_connections google_drive_connections_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.google_drive_connections
    ADD CONSTRAINT google_drive_connections_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: guardrail_trips guardrail_trips_rule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guardrail_trips
    ADD CONSTRAINT guardrail_trips_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES public.guardrail_rules(id) ON DELETE CASCADE;


--
-- Name: inbox_items inbox_items_related_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_items
    ADD CONSTRAINT inbox_items_related_job_id_fkey FOREIGN KEY (related_job_id) REFERENCES public.content_jobs(id) ON DELETE SET NULL;


--
-- Name: job_edit_lists job_edit_lists_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_edit_lists
    ADD CONSTRAINT job_edit_lists_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.content_jobs(id) ON DELETE CASCADE;


--
-- Name: music_presets music_presets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.music_presets
    ADD CONSTRAINT music_presets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: narrators narrators_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.narrators
    ADD CONSTRAINT narrators_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE CASCADE;


--
-- Name: runs runs_parent_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runs
    ADD CONSTRAINT runs_parent_run_id_fkey FOREIGN KEY (parent_run_id) REFERENCES public.runs(id) ON DELETE SET NULL;


--
-- Name: scene_frame_sequences scene_frame_sequences_asset_id_assets_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scene_frame_sequences
    ADD CONSTRAINT scene_frame_sequences_asset_id_assets_id_fk FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON DELETE SET NULL;


--
-- Name: scene_frame_sequences scene_frame_sequences_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scene_frame_sequences
    ADD CONSTRAINT scene_frame_sequences_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON DELETE SET NULL;


--
-- Name: scene_frame_sequences scene_frame_sequences_job_id_content_jobs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scene_frame_sequences
    ADD CONSTRAINT scene_frame_sequences_job_id_content_jobs_id_fk FOREIGN KEY (job_id) REFERENCES public.content_jobs(id) ON DELETE CASCADE;


--
-- Name: scene_frame_sequences scene_frame_sequences_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scene_frame_sequences
    ADD CONSTRAINT scene_frame_sequences_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.content_jobs(id) ON DELETE CASCADE;


--
-- Name: scene_frame_sequences scene_frame_sequences_seed_asset_id_assets_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scene_frame_sequences
    ADD CONSTRAINT scene_frame_sequences_seed_asset_id_assets_id_fk FOREIGN KEY (seed_asset_id) REFERENCES public.assets(id) ON DELETE SET NULL;


--
-- Name: scene_frame_sequences scene_frame_sequences_seed_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scene_frame_sequences
    ADD CONSTRAINT scene_frame_sequences_seed_asset_id_fkey FOREIGN KEY (seed_asset_id) REFERENCES public.assets(id) ON DELETE SET NULL;


--
-- Name: source_videos source_videos_library_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.source_videos
    ADD CONSTRAINT source_videos_library_id_fkey FOREIGN KEY (library_id) REFERENCES public.clip_libraries(id) ON DELETE RESTRICT;


--
-- Name: space_video_clips space_video_clips_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.space_video_clips
    ADD CONSTRAINT space_video_clips_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.content_jobs(id) ON DELETE CASCADE;


--
-- Name: stock_clip_uses stock_clip_uses_stock_clip_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_clip_uses
    ADD CONSTRAINT stock_clip_uses_stock_clip_id_fkey FOREIGN KEY (stock_clip_id) REFERENCES public.stock_clips(id) ON DELETE CASCADE;


--
-- Name: stock_clips stock_clips_clip_library_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_clips
    ADD CONSTRAINT stock_clips_clip_library_id_fkey FOREIGN KEY (clip_library_id) REFERENCES public.clip_libraries(id) ON DELETE SET NULL;


--
-- Name: style_assets style_assets_channel_id_channels_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.style_assets
    ADD CONSTRAINT style_assets_channel_id_channels_id_fk FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE SET NULL;


--
-- Name: style_assets style_assets_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.style_assets
    ADD CONSTRAINT style_assets_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE SET NULL;


--
-- Name: subtitle_preset_assignments subtitle_preset_assignments_preset_id_subtitle_presets_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subtitle_preset_assignments
    ADD CONSTRAINT subtitle_preset_assignments_preset_id_subtitle_presets_id_fk FOREIGN KEY (preset_id) REFERENCES public.subtitle_presets(id) ON DELETE CASCADE;


--
-- Name: system_events system_events_job_id_content_jobs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_events
    ADD CONSTRAINT system_events_job_id_content_jobs_id_fk FOREIGN KEY (job_id) REFERENCES public.content_jobs(id) ON DELETE CASCADE;


--
-- Name: system_settings system_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: system_settings system_settings_updated_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_updated_by_users_id_fk FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: tutorial_background_presets tutorial_background_presets_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutorial_background_presets
    ADD CONSTRAINT tutorial_background_presets_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: tutorial_derivatives tutorial_derivatives_source_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutorial_derivatives
    ADD CONSTRAINT tutorial_derivatives_source_job_id_fkey FOREIGN KEY (source_job_id) REFERENCES public.tutorial_jobs(id) ON DELETE CASCADE;


--
-- Name: tutorial_intro_hosts tutorial_intro_hosts_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutorial_intro_hosts
    ADD CONSTRAINT tutorial_intro_hosts_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: tutorial_jobs tutorial_jobs_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutorial_jobs
    ADD CONSTRAINT tutorial_jobs_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: tutorial_jobs tutorial_jobs_parent_job_id_tutorial_jobs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutorial_jobs
    ADD CONSTRAINT tutorial_jobs_parent_job_id_tutorial_jobs_id_fk FOREIGN KEY (parent_job_id) REFERENCES public.tutorial_jobs(id) ON DELETE CASCADE;


--
-- Name: tutorial_prompt_presets tutorial_prompt_presets_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutorial_prompt_presets
    ADD CONSTRAINT tutorial_prompt_presets_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_job_presets user_job_presets_template_id_content_templates_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_job_presets
    ADD CONSTRAINT user_job_presets_template_id_content_templates_id_fk FOREIGN KEY (template_id) REFERENCES public.content_templates(id) ON DELETE CASCADE;


--
-- Name: user_job_presets user_job_presets_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_job_presets
    ADD CONSTRAINT user_job_presets_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: video_notes video_notes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_notes
    ADD CONSTRAINT video_notes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: video_notes video_notes_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_notes
    ADD CONSTRAINT video_notes_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: video_notes video_notes_video_id_course_videos_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_notes
    ADD CONSTRAINT video_notes_video_id_course_videos_id_fk FOREIGN KEY (video_id) REFERENCES public.course_videos(id) ON DELETE CASCADE;


--
-- Name: video_notes video_notes_video_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_notes
    ADD CONSTRAINT video_notes_video_id_fkey FOREIGN KEY (video_id) REFERENCES public.course_videos(id) ON DELETE CASCADE;


--
-- Name: video_stitch_jobs video_stitch_jobs_created_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_stitch_jobs
    ADD CONSTRAINT video_stitch_jobs_created_by_user_id_users_id_fk FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: video_stitch_jobs video_stitch_jobs_remotion_preset_id_remotion_caption_presets_i; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_stitch_jobs
    ADD CONSTRAINT video_stitch_jobs_remotion_preset_id_remotion_caption_presets_i FOREIGN KEY (remotion_preset_id) REFERENCES public.remotion_caption_presets(id) ON DELETE SET NULL;


--
-- Name: video_timelines video_timelines_job_id_content_jobs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_timelines
    ADD CONSTRAINT video_timelines_job_id_content_jobs_id_fk FOREIGN KEY (job_id) REFERENCES public.content_jobs(id) ON DELETE CASCADE;


--
-- Name: video_timelines video_timelines_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_timelines
    ADD CONSTRAINT video_timelines_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.content_jobs(id) ON DELETE CASCADE;


--
-- Name: video_watch_progress video_watch_progress_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_watch_progress
    ADD CONSTRAINT video_watch_progress_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: video_watch_progress video_watch_progress_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_watch_progress
    ADD CONSTRAINT video_watch_progress_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: video_watch_progress video_watch_progress_video_id_course_videos_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_watch_progress
    ADD CONSTRAINT video_watch_progress_video_id_course_videos_id_fk FOREIGN KEY (video_id) REFERENCES public.course_videos(id) ON DELETE CASCADE;


--
-- Name: video_watch_progress video_watch_progress_video_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_watch_progress
    ADD CONSTRAINT video_watch_progress_video_id_fkey FOREIGN KEY (video_id) REFERENCES public.course_videos(id) ON DELETE CASCADE;


--
-- Name: webhooks webhooks_last_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhooks
    ADD CONSTRAINT webhooks_last_run_id_fkey FOREIGN KEY (last_run_id) REFERENCES public.runs(id) ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--

\unrestrict 2yUTcPE9Fpdr4N1irbqVpFnBhMb4f7YAfOx7MNJ837KPavPNKDYgv7nPbRyF7nf

