import { z } from "zod";

/**
 * Shape returned by every job-creation function. Hub-web routes and
 * cf-mcp-server both surface this verbatim — keep it stable.
 */
export interface CreatedJob {
  id: string;
  title: string;
  status: string;
  status_updated_at: string | null;
  /** Free-form bag — format-specific creators can stash extras here. */
  extra?: Record<string, unknown>;
}

export interface JobListItem {
  id: string;
  title: string | null;
  status: string;
  format: string;
  channel_id: string | null;
  created_at: string;
  updated_at: string;
  status_updated_at: string | null;
}

export interface JobListFilter {
  status?: string;
  format?: string;
  channelId?: string;
  limit?: number;
  offset?: number;
}

export const JobListFilterSchema = z.object({
  status: z.string().optional(),
  format: z.string().optional(),
  channelId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0),
});

export interface JobArtifactKind {
  kind: "edit" | "thumbnail" | "tts" | "script" | "manifest";
}
