/**
 * Sidecar client re-export for processor co-location.
 *
 * clip-label.ts, clip-embed.ts, clip-ingest.ts all import from
 * "./sidecar-client.js" (relative to processors/). This file re-exports
 * everything from the canonical implementation at utils/sidecar-client.ts.
 */
export * from "../utils/sidecar-client.js";
