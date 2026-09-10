import { z } from "zod";

const element = z.object({
  id: z.string().min(1).max(100),
  autoLogo: z.boolean().optional(),
  type: z.enum(["TEXT", "PERSON", "LOGO", "SYMBOL", "BACKGROUND", "UPLOAD", "SHAPE"]),
  url: z.string().max(10000).optional(), css: z.string().max(2000).optional(),
  text: z.string().max(1000).optional(),
  x: z.number().finite(), y: z.number().finite(),
  width: z.number().positive().finite(), height: z.number().positive().finite(),
  zIndex: z.number().finite(), rotation: z.number().finite().optional(),
  fontFamily: z.string().optional(), fontSize: z.number().positive().finite().optional(),
  color: z.string().optional(), strokeColor: z.string().optional(),
  strokeWidth: z.number().nonnegative().finite().optional(), fontWeight: z.string().optional(),
  fontStyle: z.string().optional(), bgColor: z.string().optional(),
  borderRadius: z.string().optional(), padding: z.string().optional(),
  shadow: z.boolean().optional(),
  shadowBlur: z.number().min(0).max(40).optional(), shadowOpacity: z.number().min(0).max(1).optional(),
  shadowOffsetY: z.number().min(-30).max(30).optional(), autoColor: z.boolean().optional(),
  imageScale: z.number().min(.1).max(4).optional(), mirrorX:z.boolean().optional(),mirrorY:z.boolean().optional(),
  backgroundTone:z.enum(['light','dark','auto']).optional(), tightBounds:z.boolean().optional(),
});
export const thumbnailLayoutSchema = z.object({
  aspectRatio: z.enum(["16:9", "9:16"]),
  localeOverride: z.boolean().optional(),
  elements: z.array(element).min(1).max(100).refine((rows) => new Set(rows.map((row) => row.id)).size === rows.length, "Duplicate layer IDs"),
});
export type ThumbnailLayout = z.infer<typeof thumbnailLayoutSchema>;

/** Historical AI prompts and malformed old documents are not editable layouts. */
export function readThumbnailLayout(raw: string | null | undefined): ThumbnailLayout | null {
  if (!raw || raw.length > 50_000) return null;
  try {
    const parsed = thumbnailLayoutSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}
