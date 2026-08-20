import { z } from "zod";

export const ReactorDownloadPayloadSchema = z.object({
  job_id: z.string().uuid(),
});

export const ReactorTranscribePayloadSchema = z.object({
  job_id: z.string().uuid(),
});

export const ReactorScriptPayloadSchema = z.object({
  job_id: z.string().uuid(),
});

export const ReactorTTSPayloadSchema = z.object({
  job_id: z.string().uuid(),
});

export const ReactorAssemblePayloadSchema = z.object({
  job_id: z.string().uuid(),
});

export type ReactorDownloadPayload = z.infer<
  typeof ReactorDownloadPayloadSchema
>;
export type ReactorTranscribePayload = z.infer<
  typeof ReactorTranscribePayloadSchema
>;
export type ReactorScriptPayload = z.infer<typeof ReactorScriptPayloadSchema>;
export type ReactorTTSPayload = z.infer<typeof ReactorTTSPayloadSchema>;
export type ReactorAssemblePayload = z.infer<
  typeof ReactorAssemblePayloadSchema
>;
