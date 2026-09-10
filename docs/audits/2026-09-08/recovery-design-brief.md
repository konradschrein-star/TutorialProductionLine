# Tutorial production recovery: corrected product brief

Date: 2026-09-08. Status: design brief, corrected to the later execution mandate; not an implemented release. Current evidence and open work live in `docs/recovery-execution.md`.

## Outcome

A VA independently selects a software batch, records several tutorials, approves localized thumbnail packs, checks completed production, and schedules approved tutorials without needing the owner to coordinate handoffs. Preserve separate Keyword Tool and generic Uploader services. TutorialProductionLine owns tutorial workflow and scheduling. Keep the existing Content Forge operation running until migration is proven. AO OS integration is deferred.

## Evidence and limits

Read-only authenticated inspection of both live interfaces used the supplied Admin account. No production records were approved, deleted, generated, claimed or uploaded. Actual VA permissions and deployed commit IDs are not yet verified.

- New dashboard explicitly counts Content jobs rather than tutorial jobs. Its empty-state messages therefore do not establish tutorial production health.
- New tutorial workspace still exposes Ranking and Video Stitcher alongside core steps.
- Review says unreviewed videos are fine; rejects are described as deletion. This conflicts with a mandatory final scheduling gate and recoverable rework.
- New thumbnail view has a working gallery and existing procedural editor, not a missing engine. Six top-level thumbnail sections and many editor options compete with production work.
- Live example: Canva custom-charts tutorial has an English thumbnail, while DE/FR/IT/SV variants are missing. Approve-all is disabled, citing missing localized video, metadata and copy. This blocks the requested thumbnail-first sequence for this record. It does not by itself prove the localization worker's trigger logic.
- That example's copy is two long lines: CUSTOM CHARTS IN CANVA / EDIT DATA & COLORS. The required short semantic headline is a different content field from the video title.
- The old hub's embedded keyword board successfully loaded software batches and claim counts. Earlier source-level integration concerns are not proof of deployed authentication failure. Competitor scraping/cookie failure remains unreproduced.
- Earlier repository audit covered all five GitHub main branches, not verified live deployment revisions. An isolated Keyword Tool rebuild probe reproduced loss of IDs/claim ownership/notes and disappearance of a completed row. That defect needs fixing before trusting reclassification of operational records.
- Earlier 44 passing focused tests were against local TutorialProductionLine revision 431f60d, not all current main code or end-to-end deployment.

## Non-negotiable workflow

1. VA chooses a software batch, inspects reference-backed keywords and discards unsuitable ones with reasons. Claims are atomic and survive research refreshes.
2. VA provides steps; reference material helps the script. Generate script and voice, record, submit recording. Repeat across the batch before changing work mode.
3. Recording processing and Drive delivery happen in background with durable progress and actionable failure states.
4. VA opens the batch thumbnail queue. Each source tutorial is a row showing all target-language thumbnails and one approve-pack action. A thumbnail click opens an editor. Shared layout changes propagate; explicit locale overrides do not.
5. Thumbnail-pack approval triggers localization once. Target-locale thumbnail records must exist independently of completed localized video jobs.
6. End-of-day review presents English video and metadata, thumbnail pack, and locale completion checklist. VA can self-approve. Rework retains files and comments; it is not deletion.
7. Final approval reserves the next available slot on each ready variant's predetermined channel. Completed approved locales proceed independently; failed or unfinished locales stay outstanding. Studio planning is distinct from confirmed external scheduling.
8. Studio requests advance upload and scheduled publication from the generic Uploader as soon as approved assets are ready, including the future publication time. Do not wait until publication is due to start uploading. Uploader downloads explicit Drive assets, verifies the intended profile AND channel and reports verified results. Drive masters remain. Emergency pause stops new dispatches, not already admitted or externally scheduled work.
9. Studio reconciles results into calendar and published table with video ID, YouTube/Studio links, thumbnail, metadata and attribution.

## UI architecture

Use a restrained neutral palette, readable contrast, one accent, sentence-case labels, consistent spacing and one main action per work surface. Avoid nested competing navigation. This is a proposed direction based on the user's preference for Codex's calm interface, not a finished visual design.

| Workspace | VA experience | Admin experience |
| --- | --- | --- |
| My work | Batch list, resume next action, concise actionable blockers | Same view with producer filter and all-work scope |
| Software & keywords | Choose software, preview evidence, claim, discard with reason | Research health, source configuration, quality sampling |
| Record | Batch queue, active script/audio/recording, autosave and next keyword | Same workflow with all producers' records |
| Thumbnails | Rows of source tutorial + locale cells + approve pack; editor in side panel | Same queue plus English-first gallery with expandable locales |
| Final review | English playback + metadata + locale checklist; approve/rework and next | Same controls across producers, no mandatory extra approval hop |
| Content plan | Own scheduled results and blockers; editing scope to agree | Channel/day calendar, capacity settings and failed deliveries |
| Published | Own searchable records with links and expandable metadata | All producers/channels, filters and audit history |

Admin-only configuration: credentials, channels/profile mapping, brand assets/templates, engines, quotas, system diagnostics and destructive recovery. Enforce scope on the server, not only in navigation. VA sees concrete instructions such as 'German render failed: retry' rather than infrastructure dashboards or misleading overall green status.

## Thumbnail engine

Extend the existing procedural engine. Store a versioned template, product brand/logo, short semantic headline, per-locale translated headline, channel/locale character, shared geometry and explicit locale overrides. Default to 1–4 words per localized headline where natural; use manual rewording for meaning and fit, never silently clip.

Use actual logo/image layers plus deterministic text rendering. Measure rendered text, constrain safe bounds and require loaded fonts/images before export; do not rely on character counts or arbitrary waits. Preview and export must use equivalent layout rules. Persist approved exports and a render-input revision/hash, not merely browser state.

Keep AI optional for backgrounds/character assets or a later side-by-side quality trial. Actual logo and headline layers remain separately editable. Start with a few curated templates rather than exposing all archetypes to every VA. Translation should initially reuse an available supported LLM unless measurement shows a reason for another service.

Shared edits invalidate affected approvals; locale overrides remain explicit. Reapproving an unchanged pack must not launch localization twice. Editing a pack after localization should rerender thumbnails, not unnecessarily regenerate every video.

## Service boundaries and reliability

- Keyword Tool owns discovery, source evidence, classification and stable keyword lifecycle. Studio integrates selection/claim/completion through a documented authenticated contract.
- Studio owns batch/producer, source tutorial, per-locale assets, thumbnail and final approvals, schedules and delivery projections.
- Uploader owns generic delivery attempts. Request includes stable idempotency key, exact channel identity, explicit Drive video/thumbnail/metadata references and asset revision/checksums. It does not query tutorial business tables.
- Persist delivery acceptance before replying. Authenticate callbacks, deduplicate them, tolerate out-of-order events and reconcile unknown outcomes before retrying an upload. Never equate private/unlisted upload success with public publication.
- Approval binds to a specific revision. Asset changes after approval invalidate that approval. Slot reservation and job dispatch must be concurrency-safe.
- Scheduling capacity defaults to 30 publications per channel per day, separately for each language channel, with configurable timezone and distribution window. This planning target is not proof of measured full-network delivery capacity.

## Cut list

Freeze ranking/comparison/review content formats, video stitcher, long-form automation, additional formats, AI-only thumbnail replacement, autonomous no-human production and AO OS consolidation. Hide these from core navigation without deleting useful legacy data. Move engine/template administration out of the VA path. Do not rebuild working script/audio/recording, generic uploader internals or procedural rendering solely for consistency.

## First 48 hours: target, not blanket completion promise

### First: establish a safe and truthful production path

Verify deployed revisions and service ownership; back up relevant state before migrations. Capture a representative existing batch and record its actual failures. Implement thumbnail records independent of locale render completion, explicit approval states, non-destructive rework, and accurate tutorial counters. Preserve claims through Keyword Tool rebuilds with regression tests. Reproduce cookie failure using redacted logs and an approved test source before choosing a fix.

Acceptance: one batch can reach thumbnail approval without requiring localized videos first; repeated approval creates no duplicate localization jobs. No unapproved revision enters scheduling.

### Second: deliver the VA batch workspace

Agree the screen layout, then implement the shared shell, batch queues, thumbnail row grid and sequential final review. Retain functioning recording internals. Add autosave, next-item navigation, consistent status vocabulary and actionable errors. Verify Admin/VA scope with a real VA test account. Test text overflow and missing-font/logo cases across all active locales.

Acceptance: a VA can process a small representative batch without hunting through unrelated tabs or needing Admin credentials.

### Third: prove scheduling and delivery

Wire Studio-owned slot allocation to the generic uploader contract; test with a fake receiver first. Exercise timeout, duplicate callback, worker restart, wrong-channel rejection and ambiguous upload reconciliation. With explicit approval for a live canary, test a controlled non-public upload before enabling broader scheduling. Keep old operation untouched until inventory, ownership, assets and schedules reconcile.

Acceptance: scheduled approved revision reaches the intended channel exactly once in the tested recovery cases, with matching assets and verified returned links. Unknown outcomes are visible and do not cause blind duplicate uploads. Non-public canary success is not proof of production publication or full-network capacity.

## Delegation SOP recordings

- Choose a software batch; recognize duplicates, outdated UI, inaccessible paid features and unsuitable reference videos; discard with a reason.
- Write reproducible steps; verify script/audio; recover a failed generation without duplicating work.
- Record consistent framing/cursor/audio; submit recording; distinguish local upload from completed processing/Drive delivery.
- Review all locale thumbnails; edit shared layout versus one-locale override; shorten translated headlines; approve a pack.
- Check localization readiness; retry a failed locale; escalate missing/wrong-language assets.
- Final review English video, title/description/tags, thumbnails and locale readiness; approve or request rework.
- Read calendar status and published links; report missed slots, wrong-channel concerns or uncertain uploads without resubmitting blindly.
- Admin: channel/locale branding, capacity and profile mapping; credential expiry; deployment rollback; escalation ownership.

Record these against the accepted screens after the pilot succeeds, not against today's unstable navigation.

## Decisions needed from owner

1. If one locale fails, may the completed locales schedule independently, or must the whole tutorial group wait? Recommendation: independent locale delivery, with the failed locale clearly outstanding.
2. Should approval automatically reserve the next available channel slot, or place the tutorial into a queue for manual calendar placement? Recommendation: automatic next slot with Admin override.
3. Confirm 30–40 videos means per individual channel per day, including each locale channel separately. Validate actual capacity before enabling that target.

Next design deliverable: batch workspace and thumbnail/review screens, followed by a small pilot implementation. A full ground-up rewrite is not justified by the current evidence.
