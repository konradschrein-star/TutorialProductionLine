# Tutorial Production — Extension Points

Future hooks for the Tutorial Studio (`/tutorial-studio`) and where to add them.
All paths are repo-relative. This is a map, not a spec.

## (0) Script structure — BUILT (2026-08-02)

The prerequisite for (a) and (c) now exists.

- The script prompts (`utils/tutorial/script-prompt.ts` `STRUCTURE_MARKER_RULE`)
  ask the writer for `[[INTRO]]` / `[[SUBTOPIC: name]]` / `[[OUTRO]]` markers.
- `utils/tutorial/script-structure.ts` strips every marker and returns the
  marker-free prose plus `{version, source, sections:[{kind, title, char_start,
char_end, word_start, word_end, word_count}]}`.
- `generate.ts` persists the prose to `script_text` (UNCHANGED — still the exact
  TTS input, no markers) and the structure to `tutorial_jobs.script_structure`
  (migration 0057). LONG_FORM populates the same shape from its chapter outline
  instead of discarding it.
- `structure.source` is `"markers"`, `"outline"` or `"none"` — always check it;
  `"none"` means the writer ignored the format and there is one whole-script
  section, not real structure.
- Consumers still need word→time mapping. `script_text` is the exact TTS input,
  so aligning it against the narration (Whisper word timestamps, as elsewhere in
  the repo) turns `word_start`/`word_end` into timestamps for chapters, banners
  and per-section QA.

## (a) AI-avatar segments (intro / CTA / outro / subtopic-start)

- UI seam: `_components/create.tsx` — the "Intro Options / Coming Soon"
  placeholder (`GlassCard`). Turn the disabled checkbox into real avatar
  toggles here.
- Data/generation seam: DONE — see (0). Section boundaries are available.
- Render seam: avatar clips would be interleaved with the recording in the
  stitch step (`processors/tutorial/stitch.ts` for SIX_MIN_STITCH, or the
  video-stitch pipeline for LONG_FORM — see (b)).
- ⚠️ BLOCKER, read before designing this: `processors/tutorial/splice.ts` (~line 134) time-scales the ENTIRE screen recording by ONE factor,
  `ttsDuration / effectiveRecording`, to match ONE continuous TTS track.
  Inserting an avatar segment mid-video breaks that in both directions: the
  inserted narration inflates `ttsDuration` (so the whole recording is stretched
  to cover speech that has no recording behind it), and every step after the
  insertion point shifts. Making this work needs splice to become
  segment-aware — per-section TTS files, per-section factors computed against
  the matching slice of the recording, and concatenation — not a bigger factor.
  Overlaying an avatar on top of the recording (no timeline insertion) is the
  cheap version and does not have this problem.
- Note: no DB columns exist for avatar yet — this is a documented seam only.

## (b) Zoom / Ken-Burns effects

- Home: the video-stitch render, `apps/worker-render/src/remotion/VideoStitcherComposition.tsx`
  (Remotion). Per-segment pan/zoom params would be added to the stitch job's
  `input_videos[]` (schema: `packages/db/src/schema/video-stitch-jobs.ts`) and
  applied per clip in the composition.

## (c) Banner / lower-third overlays per subtopic

- Same render home as (b) — `VideoStitcherComposition.tsx`. Drive overlay text
  from `script_structure.sections[].title` (see (0)); overlay timing rides on
  each segment's `order_index` / duration in `input_videos[]`, or on word→time
  alignment of `word_start`/`word_end`.
- YouTube chapters are the same data with no render work at all: section titles
  plus their start timestamps.

## (d) Multi-language

- Already wired: `tutorial_jobs.language`
  (`packages/db/src/schema/tutorial-jobs.ts`) carries the target spoken
  language into script + TTS. Thumbnails carry their own `language`
  (`packages/db/src/schema/thumbnails.ts`). Extend by fanning a job out per
  language rather than adding new plumbing.

## Thumbnail review (Gemini)

- Seam: `apps/worker-orchestrator/src/utils/thumbnail/review.ts` (safe stub).
  Backend: `apps/gemini-multimodal-pool` (POST `/`, `{ prompt, image_paths }`).
