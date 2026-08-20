/**
 * @repo/validation-browser
 *
 * Browser-based validation using Playwright.
 * Provides automated quality checks for videos and research via Gemini and Perplexity.
 */

// Browser Pool
export { BrowserPool } from "./browser-pool.js";

// Gemini Video Validator
export { GeminiVideoValidator } from "./gemini-video-validator.js";
export type {
  VideoQualityAssessment,
  VideoQualityIssue,
} from "./gemini-video-validator.js";

export const VALIDATION_BROWSER_VERSION = "0.1.0";
