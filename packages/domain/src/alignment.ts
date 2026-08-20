/**
 * Word alignment — canonical helpers and the two-tier policy.
 *
 * TIER 1 (every format): all timing derives from Whisper word timestamps
 * (`assembly_manifest.word_timestamps` or a fresh `runWhisper` call). No
 * estimated or synthetic timings — matching failures throw with diagnostics
 * (see computeWordAlignedPacing in pacing.ts).
 *
 * TIER 2 (premium formats): cuts land frame-perfectly on word boundaries —
 * a cut never starts or resumes mid-word; a resume snaps to the START of
 * the next spoken word. Current tier-2 implementations (algorithms differ
 * by use case, both consume tier-1 word stamps):
 *   - reactor interrupts: snapClipToWords in
 *     apps/worker-orchestrator/src/processors/reactor/script.ts
 *   - clip-forge cut points: snapToWordBoundary in
 *     apps/worker-orchestrator/src/processors/clip-selection.ts
 *
 * `normalizeWord` is THE canonical text normalizer for word matching.
 * History: two hand-rolled copies drifted apart on apostrophe handling
 * (pacing.ts kept them, chapter-builder stripped them), which made the
 * same transcript normalize differently in different subsystems. Keep
 * apostrophes: "it's" and "its" are different words, and Whisper emits
 * the apostrophe.
 */

/**
 * Normalize a word for fuzzy matching: lowercase, strip everything except
 * letters, digits, and apostrophes.
 */
export function normalizeWord(w: string): string {
  return w.toLowerCase().replace(/[^a-z0-9']/g, "");
}
