/**
 * Gemini Video Quality Validator
 *
 * Uses Gemini via Playwright to assess video quality before YouTube upload.
 * Checks for:
 * - Visual coherence
 * - Audio sync issues
 * - Pacing problems
 * - Rendering artifacts
 * - Watchability
 */

import type { Page } from "playwright";
import type { BrowserPool } from "./browser-pool.js";
import { createContextLogger } from "@repo/logger";

const logger = createContextLogger("gemini-video-validator");

/**
 * Video quality assessment result
 */
export interface VideoQualityAssessment {
  /** Overall pass/fail verdict */
  isWatchable: boolean;
  /** Quality score (0-100) */
  qualityScore: number;
  /** List of issues found */
  issues: VideoQualityIssue[];
  /** Gemini's raw response text */
  rawResponse: string;
  /** Timestamp of assessment */
  timestamp: Date;
}

/**
 * Video quality issue
 */
export interface VideoQualityIssue {
  /** Issue category */
  category: "visual" | "audio" | "pacing" | "artifact" | "other";
  /** Severity level */
  severity: "critical" | "major" | "minor";
  /** Description of the issue */
  description: string;
  /** Suggested fix (if available) */
  suggestion?: string;
}

/**
 * Gemini Video Validator
 *
 * Validates video quality using Gemini's multimodal analysis.
 */
export class GeminiVideoValidator {
  constructor(private browserPool: BrowserPool) {
    logger.info("Gemini video validator initialized");
  }

  /**
   * Assess video quality
   *
   * @param videoPath - Absolute path to the rendered video file
   * @param context - Additional context about the video (format, duration, etc.)
   * @returns Quality assessment
   */
  async assessVideoQuality(
    videoPath: string,
    context?: {
      format?: string;
      expectedDuration?: number;
      aspectRatio?: string;
    },
  ): Promise<VideoQualityAssessment> {
    logger.info(
      { videoPath, context },
      "Starting Gemini video quality assessment",
    );

    try {
      const assessment = await this.browserPool.execute(async (page) => {
        // Navigate to Gemini
        await page.goto("https://gemini.google.com/app");
        await page.waitForLoadState("networkidle");

        // Wait for chat interface
        await page.waitForSelector('textarea[placeholder*="Gemini"]', {
          timeout: 10000,
        });

        // Upload video file
        await this.uploadVideo(page, videoPath);

        // Wait for upload to complete
        await page.waitForTimeout(3000);

        // Submit assessment prompt
        const prompt = this.buildAssessmentPrompt(context);
        await this.submitPrompt(page, prompt);

        // Wait for Gemini response
        const response = await this.waitForResponse(page);

        // Parse response
        return this.parseAssessment(response);
      });

      logger.info(
        {
          videoPath,
          isWatchable: assessment.isWatchable,
          qualityScore: assessment.qualityScore,
          issueCount: assessment.issues.length,
        },
        "Video quality assessment complete",
      );

      return assessment;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(
        { videoPath, error: errorMessage },
        "Failed to assess video quality",
      );

      // Return failed assessment
      return {
        isWatchable: false,
        qualityScore: 0,
        issues: [
          {
            category: "other",
            severity: "critical",
            description: `Gemini assessment failed: ${errorMessage}`,
            suggestion:
              "Check video file exists, Gemini authentication is valid, and network is accessible",
          },
        ],
        rawResponse: `ERROR: ${errorMessage}`,
        timestamp: new Date(),
      };
    }
  }

  /**
   * Upload video file via file input
   */
  private async uploadVideo(page: Page, videoPath: string): Promise<void> {
    logger.info({ videoPath }, "Uploading video to Gemini");

    // Click file upload button
    const uploadButton = await page.waitForSelector(
      'button[aria-label*="Datei hochladen"], button[aria-label*="Upload file"]',
      { timeout: 5000 },
    );
    await uploadButton.click();

    // Upload file via file input
    const fileInput = await page.waitForSelector('input[type="file"]', {
      timeout: 5000,
    });
    await fileInput.setInputFiles(videoPath);

    logger.info({ videoPath }, "Video uploaded");
  }

  /**
   * Submit assessment prompt to Gemini
   */
  private async submitPrompt(page: Page, prompt: string): Promise<void> {
    logger.info("Submitting assessment prompt");

    const textarea = await page.waitForSelector(
      'textarea[placeholder*="Gemini"]',
      { timeout: 5000 },
    );
    await textarea.fill(prompt);
    await textarea.press("Enter");

    logger.info("Prompt submitted");
  }

  /**
   * Wait for Gemini response
   */
  private async waitForResponse(page: Page): Promise<string> {
    logger.info("Waiting for Gemini response");

    // Wait for response container to appear
    await page.waitForSelector('[role="presentation"]', { timeout: 60000 });

    // Wait for response to complete (no more "thinking" indicator)
    await page.waitForTimeout(5000);

    // Extract response text
    const responseElements = await page.$$('[role="presentation"]');
    if (responseElements.length === 0) {
      throw new Error("No response elements found");
    }

    // Get last response (most recent)
    const lastResponse = responseElements[responseElements.length - 1];
    const responseText = await lastResponse.textContent();

    if (!responseText || responseText.trim() === "") {
      throw new Error("Empty response from Gemini");
    }

    logger.info(
      { responseLength: responseText.length },
      "Gemini response received",
    );

    return responseText;
  }

  /**
   * Build assessment prompt for Gemini
   */
  private buildAssessmentPrompt(context?: {
    format?: string;
    expectedDuration?: number;
    aspectRatio?: string;
  }): string {
    let prompt = `Assess this video for quality before YouTube upload. Analyze:

1. **Visual Coherence**: Are scenes visually consistent? Any jarring transitions or mismatched styles?
2. **Audio Sync**: Does audio align with visuals? Any lip-sync issues or timing problems?
3. **Pacing**: Is the pacing appropriate? Too fast/slow? Dead air or rushed transitions?
4. **Rendering Artifacts**: Any glitches, compression artifacts, flickering, or corrupted frames?
5. **Watchability**: Overall, is this video ready for public consumption?

`;

    if (context?.format) {
      prompt += `Format: ${context.format}\n`;
    }
    if (context?.expectedDuration) {
      prompt += `Expected Duration: ${context.expectedDuration} seconds\n`;
    }
    if (context?.aspectRatio) {
      prompt += `Aspect Ratio: ${context.aspectRatio}\n`;
    }

    prompt += `
Respond in this format:

**VERDICT:** [WATCHABLE / NOT WATCHABLE]
**QUALITY SCORE:** [0-100]

**ISSUES FOUND:**
- [Category: Visual/Audio/Pacing/Artifact/Other] [Severity: Critical/Major/Minor] - Description
- ...

**SUMMARY:** Brief overall assessment.`;

    return prompt;
  }

  /**
   * Parse Gemini's assessment response
   */
  private parseAssessment(response: string): VideoQualityAssessment {
    logger.info("Parsing Gemini assessment");

    // Extract verdict
    const verdictMatch = response.match(
      /\*\*VERDICT:\*\*\s*(WATCHABLE|NOT WATCHABLE)/i,
    );
    const isWatchable = verdictMatch?.[1]?.toUpperCase() === "WATCHABLE";

    // Extract quality score
    const scoreMatch = response.match(/\*\*QUALITY SCORE:\*\*\s*(\d+)/i);
    const qualityScore = scoreMatch ? parseInt(scoreMatch[1], 10) : 0;

    // Extract issues
    const issues = this.extractIssues(response);

    // If no explicit verdict found, infer from score and issues
    let finalIsWatchable = isWatchable;
    if (!verdictMatch) {
      finalIsWatchable =
        qualityScore >= 70 && !issues.some((i) => i.severity === "critical");
    }

    return {
      isWatchable: finalIsWatchable,
      qualityScore,
      issues,
      rawResponse: response,
      timestamp: new Date(),
    };
  }

  /**
   * Extract issues from Gemini response
   */
  private extractIssues(response: string): VideoQualityIssue[] {
    const issues: VideoQualityIssue[] = [];

    // Match issue pattern: [Category: ...] [Severity: ...] - Description
    const issuePattern =
      /\[Category:\s*(Visual|Audio|Pacing|Artifact|Other)\]\s*\[Severity:\s*(Critical|Major|Minor)\]\s*-\s*([^\n]+)/gi;

    let match;
    while ((match = issuePattern.exec(response)) !== null) {
      const category = match[1].toLowerCase() as VideoQualityIssue["category"];
      const severity = match[2].toLowerCase() as VideoQualityIssue["severity"];
      const description = match[3].trim();

      issues.push({
        category,
        severity,
        description,
      });
    }

    // If no structured issues found but score is low, add generic issue
    if (issues.length === 0 && response.toLowerCase().includes("issue")) {
      issues.push({
        category: "other",
        severity: "major",
        description:
          "Quality issues detected but not in expected format. See raw response for details.",
      });
    }

    logger.info(
      { issueCount: issues.length },
      "Extracted issues from response",
    );

    return issues;
  }
}
