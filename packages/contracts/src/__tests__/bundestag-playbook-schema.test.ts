import { describe, it, expect } from "vitest";
import {
  BundestagPlaybookSegmentSchema,
  BundestagPlaybookSchema,
  formatZodValidationError,
  formatBusinessRuleValidationError,
} from "../bundestag-playbook-schema.js";
import type { BundestagPlaybookSegment } from "../bundestag-playbook-schema.js";

describe("BundestagPlaybookSegmentSchema", () => {
  it("should validate a valid segment", () => {
    const validSegment: BundestagPlaybookSegment = {
      sequence_number: 1,
      timestamp_start: 0.0,
      timestamp_end: 5.2,
      primary_clip_id: "clip_speaker_closeup",
      clip_start_offset: 0.0,
      clip_end_offset: 5.2,
      audio_clip_id: "clip_speaker_closeup",
      subtitle_text: "Meine Damen und Herren",
      subtitle_style: "normal",
      cut_reason: "Opening statement",
      transition: "cut",
    };

    const result = BundestagPlaybookSegmentSchema.safeParse(validSegment);
    expect(result.success).toBe(true);
  });

  it("should reject segment with negative timestamp_start", () => {
    const invalidSegment = {
      sequence_number: 1,
      timestamp_start: -1.0,
      timestamp_end: 5.2,
      primary_clip_id: "clip_speaker_closeup",
      clip_start_offset: 0.0,
      clip_end_offset: 5.2,
      audio_clip_id: "clip_speaker_closeup",
      subtitle_text: "Meine Damen und Herren",
      subtitle_style: "normal",
      cut_reason: "Opening statement",
      transition: "cut",
    };

    const result = BundestagPlaybookSegmentSchema.safeParse(invalidSegment);
    expect(result.success).toBe(false);
  });

  it("should reject segment with missing required fields", () => {
    const invalidSegment = {
      sequence_number: 1,
      timestamp_start: 0.0,
      timestamp_end: 5.2,
      // Missing primary_clip_id
      clip_start_offset: 0.0,
      clip_end_offset: 5.2,
      audio_clip_id: "clip_speaker_closeup",
      subtitle_text: "Meine Damen und Herren",
      subtitle_style: "normal",
      cut_reason: "Opening statement",
      transition: "cut",
    };

    const result = BundestagPlaybookSegmentSchema.safeParse(invalidSegment);
    expect(result.success).toBe(false);
  });

  it("should reject segment with invalid transition type", () => {
    const invalidSegment = {
      sequence_number: 1,
      timestamp_start: 0.0,
      timestamp_end: 5.2,
      primary_clip_id: "clip_speaker_closeup",
      clip_start_offset: 0.0,
      clip_end_offset: 5.2,
      audio_clip_id: "clip_speaker_closeup",
      subtitle_text: "Meine Damen und Herren",
      subtitle_style: "normal",
      cut_reason: "Opening statement",
      transition: "dissolve", // Invalid - not in enum
    };

    const result = BundestagPlaybookSegmentSchema.safeParse(invalidSegment);
    expect(result.success).toBe(false);
  });

  it("should reject segment where timestamp_end <= timestamp_start", () => {
    const invalidSegment = {
      sequence_number: 1,
      timestamp_start: 5.0,
      timestamp_end: 5.0, // Equal - should fail
      primary_clip_id: "clip_1",
      clip_start_offset: 0.0,
      clip_end_offset: 5.0,
      audio_clip_id: "clip_1",
      subtitle_text: "Test",
      subtitle_style: "normal" as const,
      cut_reason: "Test",
      transition: "cut" as const,
    };

    const result = BundestagPlaybookSegmentSchema.safeParse(invalidSegment);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) =>
          issue.message.includes("timestamp_end must be greater"),
        ),
      ).toBe(true);
    }
  });

  it("should reject segment where timestamp_end < timestamp_start", () => {
    const invalidSegment = {
      sequence_number: 1,
      timestamp_start: 10.0,
      timestamp_end: 5.0, // Less than start - should fail
      primary_clip_id: "clip_1",
      clip_start_offset: 0.0,
      clip_end_offset: 5.0,
      audio_clip_id: "clip_1",
      subtitle_text: "Test",
      subtitle_style: "normal" as const,
      cut_reason: "Test",
      transition: "cut" as const,
    };

    const result = BundestagPlaybookSegmentSchema.safeParse(invalidSegment);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) =>
          issue.message.includes("timestamp_end must be greater"),
        ),
      ).toBe(true);
    }
  });

  it("should reject segment where clip_end_offset <= clip_start_offset", () => {
    const invalidSegment = {
      sequence_number: 1,
      timestamp_start: 0.0,
      timestamp_end: 5.0,
      primary_clip_id: "clip_1",
      clip_start_offset: 5.0,
      clip_end_offset: 5.0, // Equal - should fail
      audio_clip_id: "clip_1",
      subtitle_text: "Test",
      subtitle_style: "normal" as const,
      cut_reason: "Test",
      transition: "cut" as const,
    };

    const result = BundestagPlaybookSegmentSchema.safeParse(invalidSegment);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) =>
          issue.message.includes("clip_end_offset must be greater"),
        ),
      ).toBe(true);
    }
  });

  it("should reject segment where clip_end_offset < clip_start_offset", () => {
    const invalidSegment = {
      sequence_number: 1,
      timestamp_start: 0.0,
      timestamp_end: 5.0,
      primary_clip_id: "clip_1",
      clip_start_offset: 10.0,
      clip_end_offset: 5.0, // Less than start - should fail
      audio_clip_id: "clip_1",
      subtitle_text: "Test",
      subtitle_style: "normal" as const,
      cut_reason: "Test",
      transition: "cut" as const,
    };

    const result = BundestagPlaybookSegmentSchema.safeParse(invalidSegment);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) =>
          issue.message.includes("clip_end_offset must be greater"),
        ),
      ).toBe(true);
    }
  });
});

describe("BundestagPlaybookSchema", () => {
  it("should validate a valid playbook", () => {
    const validPlaybook = {
      segments: [
        {
          sequence_number: 1,
          timestamp_start: 0.0,
          timestamp_end: 5.2,
          primary_clip_id: "clip_speaker_closeup",
          clip_start_offset: 0.0,
          clip_end_offset: 5.2,
          audio_clip_id: "clip_speaker_closeup",
          subtitle_text: "Meine Damen und Herren",
          subtitle_style: "normal",
          cut_reason: "Opening statement",
          transition: "cut",
        },
      ],
      reasoning: "Dynamic editing with frequent cuts",
    };

    const result = BundestagPlaybookSchema.safeParse(validPlaybook);
    expect(result.success).toBe(true);
  });

  it("should reject playbook with empty segments array", () => {
    const invalidPlaybook = {
      segments: [],
      reasoning: "Dynamic editing",
    };

    const result = BundestagPlaybookSchema.safeParse(invalidPlaybook);
    expect(result.success).toBe(false);
  });

  it("should accept playbook without reasoning field", () => {
    const validPlaybook = {
      segments: [
        {
          sequence_number: 1,
          timestamp_start: 0.0,
          timestamp_end: 5.2,
          primary_clip_id: "clip_speaker_closeup",
          clip_start_offset: 0.0,
          clip_end_offset: 5.2,
          audio_clip_id: "clip_speaker_closeup",
          subtitle_text: "Meine Damen und Herren",
          subtitle_style: "normal",
          cut_reason: "Opening statement",
          transition: "cut",
        },
      ],
    };

    const result = BundestagPlaybookSchema.safeParse(validPlaybook);
    expect(result.success).toBe(true);
  });
});

describe("formatZodValidationError", () => {
  it("should format Zod errors with field paths", () => {
    const invalidPlaybook = {
      segments: [
        {
          sequence_number: "not a number", // Wrong type
          timestamp_start: 0.0,
          timestamp_end: 5.2,
        },
      ],
    };

    const result = BundestagPlaybookSchema.safeParse(invalidPlaybook);
    expect(result.success).toBe(false);

    if (!result.success) {
      const formatted = formatZodValidationError(result.error, "raw output");
      expect(formatted.stage).toBe("zod_schema");
      expect(formatted.errors.length).toBeGreaterThan(0);
      expect(formatted.errors[0].field).toContain("segments");
      expect(formatted.raw_llm_output).toBe("raw output");
    }
  });
});

describe("formatBusinessRuleValidationError", () => {
  it("should format business rule errors", () => {
    const errors = [
      "Segment 1: primary_clip_id 'clip_xyz' does not exist",
      "Timeline gap between segment 2 and 3: 1.50s",
    ];

    const formatted = formatBusinessRuleValidationError(errors);
    expect(formatted.stage).toBe("business_rules");
    expect(formatted.errors.length).toBe(2);
    expect(formatted.errors[0].message).toContain("primary_clip_id");
    expect(formatted.errors[1].message).toContain("Timeline gap");
  });
});
