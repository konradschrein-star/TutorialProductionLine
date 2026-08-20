/**
 * Ingest Stage Validator
 *
 * Validates ingest payloads before job creation.
 * Catches common issues like:
 * - Missing archetype_id when required
 * - Missing format-specific metadata
 * - Invalid template references
 * - Missing required assets for certain formats
 */

import type {
  Validator,
  ValidationContext,
  ValidationResult,
} from "../types.js";
import { success, failure, validationError } from "../types.js";
import {
  normalizeComparison,
  describeComparisonShape,
} from "../../comparison-metadata.js";

/**
 * Ingest payload structure (subset of actual IngestPayload)
 */
interface IngestPayload {
  template_id: string;
  format: string;
  channel_id: string;
  archetype_id?: string | null;
  style_library_id?: string | null;
  initial_topic?: string;
  script_text?: string;
  pre_uploaded_assets?: Array<{
    key: string;
    type: string;
    size_bytes: number;
  }>;
  metadata?: Record<string, unknown>;
  bundestag_clip_paths?: string[];
  language?: string;
  aspect_ratio?: string;
}

/**
 * Formats that require archetype_id
 */
const ARCHETYPE_REQUIRED_FORMATS = [
  "EXPLAINER",
  "DOCUMENTARY",
  "CASUALLY_EXPLAINED",
];

/**
 * Formats that require specific metadata fields, checked as literal dotted
 * paths on the payload.
 *
 * TECH_COMPARISON deliberately does NOT appear here. It used to require
 * `metadata.comparison.product_a_name` / `product_b_name` literally, which made
 * this validator reject every job created from the hub-web create form — that
 * form submits the canonical `metadata.comparison.products[{slot,name}]` array
 * instead, and this validator runs BEFORE the array→flat fallback in
 * `processors/ingest.ts`. TECH_COMPARISON is checked in section 4 below via the
 * shared normalizer, which accepts both shapes.
 */
const METADATA_REQUIREMENTS: Record<string, string[]> = {
  BUNDESTAG: ["bundestag_clip_paths"],
};

export class IngestValidator implements Validator<
  IngestPayload,
  IngestPayload
> {
  readonly id = "ingest-payload-validator";
  readonly name = "Ingest Payload Validator";
  readonly description =
    "Validates ingest payloads for required fields and format-specific requirements";
  readonly applicableStages = ["IDEA_GENERATION", "ingest"];

  async validate(
    input: IngestPayload,
    context: ValidationContext,
  ): Promise<ValidationResult<IngestPayload>> {
    const errors = [];

    // 1. Check archetype_id for formats that require it
    if (ARCHETYPE_REQUIRED_FORMATS.includes(input.format)) {
      if (!input.archetype_id) {
        errors.push(
          validationError(
            "MISSING_ARCHETYPE_ID",
            `Format "${input.format}" requires archetype_id but none was provided`,
            {
              severity: "ERROR",
              path: "payload.archetype_id",
              context: {
                format: input.format,
                template_id: input.template_id,
              },
              suggestion:
                "Provide archetype_id in the payload or ensure the template has a default archetype_id",
            },
          ),
        );
      }
    }

    // 2. Check format-specific metadata requirements
    const requiredMetadataFields = METADATA_REQUIREMENTS[input.format];
    if (requiredMetadataFields) {
      for (const fieldPath of requiredMetadataFields) {
        const parts = fieldPath.split(".");
        let current: any = input;

        // Navigate nested path
        for (const part of parts) {
          current = current?.[part];
          if (current === undefined || current === null) {
            break;
          }
        }

        // Check if field exists and is not empty
        const isValid =
          current !== undefined &&
          current !== null &&
          current !== "" &&
          (!Array.isArray(current) || current.length > 0);

        if (!isValid) {
          errors.push(
            validationError(
              "MISSING_REQUIRED_METADATA",
              `Format "${input.format}" requires "${fieldPath}" but it was not provided or is empty`,
              {
                severity: "ERROR",
                path: `payload.${fieldPath}`,
                context: {
                  format: input.format,
                  requiredField: fieldPath,
                },
                suggestion: `Provide ${fieldPath} in the ingest payload`,
              },
            ),
          );
        }
      }
    }

    // 3. BUNDESTAG format specific checks
    if (input.format === "BUNDESTAG") {
      if (
        !input.bundestag_clip_paths ||
        input.bundestag_clip_paths.length === 0
      ) {
        errors.push(
          validationError(
            "MISSING_BUNDESTAG_CLIPS",
            "BUNDESTAG format requires bundestag_clip_paths array with at least one clip path",
            {
              severity: "ERROR",
              path: "payload.bundestag_clip_paths",
              context: {
                format: input.format,
              },
              suggestion:
                "Provide absolute filesystem paths to video clips in bundestag_clip_paths array",
            },
          ),
        );
      }
    }

    // 4. TECH_COMPARISON format specific checks
    //
    // Accepts BOTH supported metadata shapes via the shared normalizer:
    //   { product_a_name, product_b_name }          (CLI / smoke tests /
    //                                                the /formats ingest panel)
    //   { products: [{ slot: "A", name }, …] }      (hub-web create form +
    //                                                the renderer)
    // Requiring only the flat shape here is what made every UI-created
    // comparison job die at ingest with MISSING_REQUIRED_METADATA.
    if (input.format === "TECH_COMPARISON" && !input.script_text) {
      const comparison = (
        input.metadata as Record<string, unknown> | undefined
      )?.["comparison"];

      if (!comparison) {
        errors.push(
          validationError(
            "MISSING_COMPARISON_METADATA",
            "TECH_COMPARISON format requires metadata.comparison object",
            {
              severity: "ERROR",
              path: "payload.metadata.comparison",
              context: {
                format: input.format,
              },
              suggestion:
                'Provide comparison metadata as either {product_a_name, product_b_name} or {products:[{slot:"A",name},{slot:"B",name}]}',
            },
          ),
        );
      } else {
        const normalized = normalizeComparison(comparison);

        if (!normalized.hasBothProducts) {
          errors.push(
            validationError(
              "MISSING_PRODUCT_NAMES",
              "TECH_COMPARISON requires a product in slot A and slot B",
              {
                severity: "ERROR",
                path: "payload.metadata.comparison",
                context: {
                  format: input.format,
                  has_product_a: !!normalized.productAName,
                  has_product_b: !!normalized.productBName,
                  received_shape: describeComparisonShape(comparison),
                },
                suggestion:
                  'Provide non-empty names as either {product_a_name, product_b_name} or {products:[{slot:"A",name},{slot:"B",name}]} in metadata.comparison',
              },
            ),
          );
        }
      }
    }

    // 5. Basic field validation
    if (!input.channel_id?.trim()) {
      errors.push(
        validationError(
          "MISSING_CHANNEL_ID",
          "channel_id is required and cannot be empty",
          {
            severity: "ERROR",
            path: "payload.channel_id",
            suggestion: "Provide a valid channel_id",
          },
        ),
      );
    }

    if (!input.template_id?.trim()) {
      errors.push(
        validationError(
          "MISSING_TEMPLATE_ID",
          "template_id is required and cannot be empty",
          {
            severity: "ERROR",
            path: "payload.template_id",
            suggestion: "Provide a valid template_id",
          },
        ),
      );
    }

    if (!input.format?.trim()) {
      errors.push(
        validationError(
          "MISSING_FORMAT",
          "format is required and cannot be empty",
          {
            severity: "ERROR",
            path: "payload.format",
            suggestion: "Provide a valid content format",
          },
        ),
      );
    }

    // If we have errors, return failure
    if (errors.length > 0) {
      return failure(errors);
    }

    // All checks passed
    return success(input);
  }
}
