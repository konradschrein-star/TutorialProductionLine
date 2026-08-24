# Adaptive sub-3-minute tutorial modes — design

**Date:** 2026-08-24
**Status:** approved (owner: "Add 2 more modes, we'll see which one is best, current 3 min thing seems to work")

## Problem

The VA reported tutorial script lengths are "a bit off." Root cause: every sub-3-minute
tutorial is produced with the fixed `THREE_MIN` mode, which is **hard-pinned to 3 minutes**
in the worker (`targetMinutesForMode` returns a constant 3) and **ignores the reference
video's real runtime**, even though that runtime (`ref_video_seconds`) is already fetched
and carried all the way to the worker.

Two compounding facts:

1. The Create form's default **AUTO** mode claims to "match the reference length," but for
   any video under 4.5 min it resolves to `THREE_MIN` (via `planForMinutes`) and therefore
   floors at 3 minutes. So a 2-minute source video still gets a 3-minute script.
2. `buildLengthLine`'s SHORT branch floors its printed band at `Math.max(3, …)` /
   `Math.max(4, …)` minutes. Even if a sub-3 target were passed, it would still instruct the
   model "between about 3 and 4 minutes." The whole short path cannot currently go under 3.

The VA also wants the extra time (when we go a little longer than the source) spent on
**examples and explanations**, not filler — the current scripts feel padded.

## Decision

Add **two new selectable modes**, raced in production against the untouched `THREE_MIN`:

| | **SHORT_MATCH** ("Short — Match") | **SHORT_PLUS** ("Short — Plus") |
|---|---|---|
| Target length | source runtime | source runtime × **1.15** |
| Clamp band | 1.5 → 3.0 min | 1.75 → 3.25 min |
| Extra time goes to | nothing — mirror the source's scope, tighter | 1–2 concrete worked examples + short "why it works" explanations |

Both derive `targetMinutes` from `ref_video_seconds`. When no reference runtime is present,
fall back to the VA's typed `target_minutes`, then to 2 min.

`THREE_MIN`, `SIX_MIN`, `SIX_MIN_STITCH`, `LONG_FORM`, and the AUTO resolution are all left
exactly as they are. AUTO still resolves short videos to `THREE_MIN` (the control) — the two
new modes are only reached by explicit VA selection, which is what makes the A/B clean:
`tutorial_jobs.mode` distinguishes the three cohorts in the produced-video data.

## Why new enum values here (vs. the documented "no new modes" rule)

`packages/domain/src/tutorial-length.ts` argues against adding `tutorial_mode` values because
a value with no seeded preset breaks the Create form's preset picker and makes the worker throw
"No prompt found," and because length alone is better expressed by `target_minutes`. This change
satisfies both concerns head-on:

- It seeds a default preset for each new category, so the picker is never empty.
- It adds real `targetMinutesForMode` arms, so the worker always resolves a length.
- The two modes differ by more than a number — they encode two different *strategies*
  (mirror vs. expand-with-examples) the owner wants to compare as first-class, filterable
  cohorts. That is a script-shape distinction, which is what modes are for.

## Implementation seam

The new length regime is kept fully isolated from the working `THREE_MIN`/`SIX_MIN` path:

- **New length-line builder** `buildShortAdaptiveLengthLine(targetMinutes, { spendExtraOnExamples })`
  in `script-prompt.ts` — honors sub-3 targets, tight anti-padding band, and (for PLUS) says
  the extra runtime must come from examples/explanations, never filler. `buildLengthLine` is
  NOT modified.
- **Both prompt builders** (`buildAnswerFirstScriptPrompt`, `buildTranscriptRewritePrompt`)
  gain an optional `lengthLineOverride?: string[]`; when present they use it instead of calling
  `buildLengthLine`. Everything else (the SHORT-tier rule stack — opening, walkthrough, teaching
  substance, pacing, ask) is reused unchanged.
- **`targetMinutesForMode`** gets `SHORT_MATCH` / `SHORT_PLUS` arms computing the clamped,
  multiplied target from `refVideoSeconds`, returning `tier: "SHORT"`, `allowLonger: false`.
- **`generate.ts`** builds the override when the mode is short-adaptive and threads it in.
- Production sub-3 jobs run through the **transcript-rewrite** path (keyword → referenceUrl →
  `TRANSCRIPT_REWRITE`), so `buildTranscriptRewritePrompt` is the primary consumer.

## Touch points

- `packages/db/src/schema/tutorial-enums.ts` — add both values to `tutorial_mode` and
  `tutorial_prompt_category`.
- New Drizzle migration — `ALTER TYPE … ADD VALUE` for both enums (following repo convention).
- `packages/db/src/seeds/tutorial-prompts.ts` — seed a default preset per new category.
- `packages/domain/src/tutorial-length.ts` — add both to the `TutorialMode` union and
  `labelForMode` (exhaustive `never` switch). `planForMinutes` / AUTO left unchanged.
- `apps/worker-orchestrator/.../script-prompt.ts` — new length-line builder, `targetMinutesForMode`
  arms, `lengthLineOverride`, `isShortAdaptiveMode` helper.
- `apps/worker-orchestrator/.../transcript-rewrite-prompt.ts` — accept `lengthLineOverride`.
- `apps/worker-orchestrator/.../generate.ts` — build + thread the override.
- Create form + any mode Zod enums / API route validation — accept and offer the new modes.
- Tests: `script-prompt.test.ts`, `tutorial-length.test.ts`, migration/seed as applicable.

## Non-goals

- Not changing `THREE_MIN` behavior or the AUTO resolution.
- Not addressing the "uploads take forever" complaint — tracked separately.
