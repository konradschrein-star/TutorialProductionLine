# Production acceptance: user review, 9 September 2026

The user's written review and attached notes supersede the previous local UI
acceptance. Green unit tests and fixture screenshots did not prove the VA
workflow usable. Do not describe the system as finished until the following
journeys have observable evidence.

## Preserve

- My work dashboard, editable scripts, separate Keyword Tool repository.
- Source accounts, existing voices/provider credentials, English originals.
- Shared Content Forge capabilities, including selectable AI thumbnail mode.
- Omar's assets and production untouched until the first team is proven.

## Required journeys

1. Keyword SSO opens; a claimed keyword retains owner/channel through script,
   recording and production. Completion sync is durable and idempotent.
2. Keyword quality has an inspectable eligibility/ranking basis, not random output.
3. A VA's sole assigned channel or keyword-bound channel is preselected. Optional
   disconnected integrations do not produce unexplained scary errors.
4. Thumbnail editor fits a normal viewport with a dedicated properties inspector;
   text stroke/shadow is not clipped, no broken-image glyph is exported.
5. Add, select, move, rotate, duplicate and delete a layer; add rounded shapes.
6. Upload named logo/symbol/background/character, reload, reuse. Hiding an asset
   from My collection does not delete global bytes or another user's collection.
7. Save a draft independently of approval. Prepare localized copy, save/approve
   a pack and reopen its actual images. Failures identify actionable causes.
8. Layouts support left/right hosts, readable white/yellow outlined copy, meaningful
   app logos and symbols. Background cycling uses an explicit allowed pool.
9. Admin AI/procedural mode is honored; tutorial AI endpoints remain owner-scoped.
10. Languages use compact flagged rows with independent actions and real statuses.
11. Final review keyboard navigation works without surprising opt-in traps; typing
    and modal safeguards remain. Media and actions fit together.
12. QA indicators expose measured loudness/black frames only; never invent passes.
13. Library stages have semantic colors and labels; authorized channel/producer
    links, create-missing-thumbnail links, dash for unknown duration, upload check.
14. Producers can see their delivery status and Drive folders; manual upload is
    supported without granting unrestricted publication or global queue access.
15. English media is verified on the requested Google Drive account. Eviction
    requires exact video, thumbnail and metadata verification plus no active lease;
    approval alone never authorizes deletion. Restored/Drive viewing is tested.
16. VPS2 deployment uses preserved accounts/settings, a tested image, media access,
    routing and authentication. No team cutover before the complete journey works.

Execution policy previously denied local Keyword Tool frontend startup on17878.
Do not bypass that restriction. Diagnose and report the exact remaining boundary.
Production uploads, destructive archive cleanup and paid provider loops must not
be triggered merely by importing or testing production records.
