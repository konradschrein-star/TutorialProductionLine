import { z } from "zod";

/**
 * Payload for the stock-library-gen worker. One job = one VEO t2v
 * call. The bootstrap CLI enqueues N of these; the worker picks each
 * up, submits to VEO, downloads the MP4, and marks the stock_clips
 * row as ready.
 */
export const StockLibraryGenPayloadSchema = z.object({
  /** UUID of the pre-reserved row in stock_clips (status='queued'). */
  stockClipId: z.string().uuid(),
});
export type StockLibraryGenPayload = z.infer<
  typeof StockLibraryGenPayloadSchema
>;
