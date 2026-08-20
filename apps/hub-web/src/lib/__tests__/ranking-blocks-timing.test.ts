import { describe, it, expect } from "vitest";
import * as contracts from "@repo/contracts";
import * as blocks from "../ranking-blocks";

/**
 * BUG 3 guard: the B-Roll Studio and the Remotion renderer MUST size their
 * windows from the same code.
 *
 * They used to keep two hand-maintained copies of `computeItemWindow` and the
 * shot constants, both annotated "keep byte-for-byte in sync". Drift there
 * silently desynced the VA's green trim bar from the window the renderer draws
 * B-roll into — the VA trims to a window the render never uses, and nothing
 * fails. Both now re-export ONE definition from @repo/contracts, so drift is
 * impossible; this test fails the moment someone re-inlines a local copy.
 */
describe("ranking-blocks timing is not a copy", () => {
  it("re-exports the shared implementation by identity", () => {
    expect(blocks.computeItemWindow).toBe(contracts.computeItemWindow);
    expect(blocks.blockNarrationStartMs).toBe(contracts.blockNarrationStartMs);
  });

  it("re-exports the shared shot constants by value", () => {
    expect(blocks.INTRO_SHOT_SECONDS).toBe(contracts.INTRO_SHOT_SECONDS);
    expect(blocks.TIER_LIST_SHOT_SECONDS).toBe(
      contracts.TIER_LIST_SHOT_SECONDS,
    );
    expect(blocks.BROLL_SHOT_SECONDS).toBe(contracts.BROLL_SHOT_SECONDS);
    expect(blocks.REVEAL_SHOT_SECONDS).toBe(contracts.REVEAL_SHOT_SECONDS);
    expect(blocks.BLOCK_DURATION_MS).toBe(contracts.BLOCK_DURATION_MS);
    expect(blocks.TIER_BEAT_MS).toBe(contracts.TIER_BEAT_MS);
    expect(blocks.REVEAL_BEAT_MS).toBe(contracts.REVEAL_BEAT_MS);
    expect(blocks.MIN_BROLL_MS).toBe(contracts.MIN_BROLL_MS);
  });

  it("itemBlockWindow uses the anchored window when segments exist", () => {
    const item = {
      id: "i1",
      name: "Thing",
      narrationStartMs: 10_000,
      narrationEndMs: 50_000,
    } as never;
    const win = blocks.itemBlockWindow(item, 0);
    const shared = contracts.computeItemWindow(10_000, 50_000);
    expect(win.anchored).toBe(true);
    expect(win.narrationStartMs).toBe(shared.brollStartMs);
    expect(win.blockDurationMs).toBe(shared.brollDurationMs);
  });

  it("falls back to the fixed window when segments are absent", () => {
    const item = { id: "i1", name: "Thing" } as never;
    const win = blocks.itemBlockWindow(item, 2);
    expect(win.anchored).toBe(false);
    expect(win.narrationStartMs).toBe(contracts.blockNarrationStartMs(2));
    expect(win.blockDurationMs).toBe(contracts.BLOCK_DURATION_MS);
  });
});
