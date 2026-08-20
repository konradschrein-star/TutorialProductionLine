import type { ThumbnailArchetype, Thumbnail } from "@repo/db";

export type { ThumbnailArchetype, Thumbnail };

export interface ChannelOption {
  id: string;
  name: string;
}

export const ASPECT_OPTIONS = [
  { value: "16:9", label: "16:9 — YouTube (default)" },
  { value: "9:16", label: "9:16 — Shorts / Reels" },
  { value: "1:1", label: "1:1 — Square" },
] as const;

export const RESOLUTION_OPTIONS = [
  { value: "1k", label: "1K (default)" },
  { value: "2k", label: "2K" },
  { value: "4k", label: "4K" },
] as const;

export const PROMPT_MODE_OPTIONS = [
  {
    value: "programmatic",
    label: "Programmatic",
    hint: "Deterministic — renders the compiled brief",
  },
  {
    value: "authored",
    label: "Authored (LLM)",
    hint: "LLM writes the prompt FROM the brief",
  },
] as const;

/** Backend pins. Explicit — a downgrade off these is reported, never silent. */
export const BACKEND_OPTIONS = [
  {
    value: "",
    label: "Auto (gateway chain)",
    hint: "VUP → forge → fastgen → AI33",
  },
  { value: "vup", label: "VUP", hint: "Nano Banana i2i, primary" },
  { value: "forge", label: "forge-api", hint: "VEO Studio wrapper" },
  { value: "ai33", label: "AI33", hint: "Last resort" },
  { value: "fastgen", label: "FastGen", hint: "Licence expired 2026-07-21" },
] as const;

export function archetypeImageUrl(id: string, index = 0): string {
  return `/api/thumbnails/archetypes/${id}/image?i=${index}`;
}

export function thumbnailImageUrl(id: string): string {
  return `/api/thumbnails/image/${id}`;
}

/** "16:9" → 56.25 (percent), for CSS aspect boxes. */
export function aspectPadding(aspect: string): string {
  const [w, h] = aspect.split(":").map(Number);
  if (!w || !h) return "56.25%";
  return `${(h / w) * 100}%`;
}
