import { z } from "zod";

export const ErrorDetailSchema = z.object({
  code: z.string(),
  message: z.string(),
  category: z.enum([
    "media_validation",
    "external_service",
    "asset_management",
    "render",
    "orchestration",
    "unknown",
  ]),
  context: z.record(z.unknown()).optional(),
  retryable: z.boolean(),
  timestamp: z.string().datetime(),
});

export type ErrorDetail = z.infer<typeof ErrorDetailSchema>;

export function buildErrorDetail(params: {
  code: string;
  message: string;
  category: ErrorDetail["category"];
  context?: Record<string, unknown>;
  retryable: boolean;
}): ErrorDetail {
  return {
    ...params,
    timestamp: new Date().toISOString(),
  };
}
