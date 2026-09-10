/**
 * Database Schema Exports
 *
 * Re-exports all Drizzle table definitions and enums.
 * This is the central import point for schema-related code.
 */

// Enums
export * from "./enums.js";

// Thumbnail system
export * from "./thumbnail-enums.js";
export * from "./thumbnails.js";

// Tables
export * from "./channels.js";
export * from "./users.js";
export * from "./user-job-presets.js";
export * from "./content-templates.js";
export * from "./content-jobs.js";
export * from "./system-events.js";
export * from "./system-settings.js";
export * from "./style-assets.js";
export * from "./format-style-libraries.js";
export * from "./narrators.js";
export * from "./tts-voices.js";
// Asset graph
export * from "./archetypes.js";
export * from "./character-state-types.js";
export * from "./characters.js";
export * from "./assets.js";
export * from "./environments.js";
export * from "./scene-frame-sequences.js";
// Timeline editor
export * from "./video-timelines.js";
// Knowledge LMS
export * from "./knowledge.js";
// Asset collections
export * from "./asset-collections.js";
// Bundestag format
export * from "./bundestag-clips.js";
export * from "./bundestag-playbooks.js";
// Video Stitcher
export * from "./video-stitch-jobs.js";
export * from "./music-presets.js";
export * from "./music-library.js";
export * from "./caption-presets.js";
export * from "./remotion-caption-presets.js";
// Global subtitle preset + font system
export * from "./subtitle-presets.js";
export * from "./subtitle-fonts.js";
// Clip library
export * from "./clip-library-enums.js";
export * from "./clip-library.js";
export * from "./image-library.js";
export * from "./clip-pipeline.js";
// Long Form Drama format
export * from "./drama-clips.js";
export * from "./drama-characters.js";
// Drama stock-chain library
export * from "./stock-clips.js";
export * from "./clip-library-reference-scripts.js";
// Tutorial production engine
export * from "./tutorial-enums.js";
export * from "./tutorial-jobs.js";
export * from "./llm-pool.js";
export * from "./tutorial-prompt-presets.js";
export * from "./encrypted-secrets.js";
export * from "./tutorial-settings.js";
export * from "./tutorial-upload-exchange.js";
// Clip Forge (schema recovered 2026-06-17 from the live DB)
export * from "./clip-forge.js";
// Provider / capability registry (migration 0038)
export * from "./providers.js";
// Provider expiry clocks + capability fallback policies (migration 0043)
export * from "./provider-expiries.js";
export * from "./capability-policies.js";
// Provider call-site index + observed-consumer rollup (migration 0045)
export * from "./provider-call-sites.js";
// Compute-node registry — render/GPU topology (migration 0044)
export * from "./compute-nodes.js";
// AI OS tables (fleet_state, inbox_items, runs, guardrails, etc.) live in
// the separate AI-Operating-System repo now (split 2026-06-21). Drizzle
// mirror previously here was dead code in this repo — no content-forge
// consumer ever imported it.

// Storage links: finished-product artefacts -> VPS + Google Drive (migration 0041)
export * from "./storage-artifacts.js";
export * from "./thumbnail-library-assets.js";
export * from "./tutorial-job-events.js";
export * from "./tutorial-legacy-archive.js";
export * from "./storage-artifact-versions.js";
export * from "./thumbnail-workspace.js";
export * from "./tutorial-thumbnail-fanout.js";
export * from "./tutorial-thumbnail-ai-batches.js";
