# Tutorial production specification gap analysis — 10 September 2026

This document separates code that exists from production behavior that has been proven. A green UI or unit suite is not treated as operational completion.

## Proven or implemented

| Requirement | State | Evidence |
| --- | --- | --- |
| Standalone Tutorial Studio, separate Keyword Tool and separate uploader | Implemented | Independent repositories/services; Studio degrades to direct intake when Keyword Tool is unavailable. |
| Admin versus VA workflow separation | Implemented | Permission-gated management navigation, channel/settings controls and Admin-only integration status; owner-scoped VA queues and history. |
| Linear production workspace | Implemented | Intake, scripts, recording, thumbnails, languages, final review, delivery and calendar are distinct workflow surfaces. |
| Manual and CSV bulk keyword intake | Implemented locally | Exact schema, preview, validation, channel resolution, stable retry identities and partial outage receipts. |
| Configurable channel groups and translation destinations | Implemented | Explicit primary/destination profiles; no implicit or random locale routing. |
| Configurable weekly upload plans | Deployed on Omar | Five channels currently use 30 reservations/day, seven days/week, UTC 08:00–20:00. |
| Procedural thumbnail editor and reusable channel templates | Implemented | 1–4 headline blocks, hitboxes, host side/scale/offset, UI card, logos, symbols, arrows, shapes, aura color/opacity/position and per-channel template profiles. |
| AI/procedural mode choice | Implemented in settings | Omar remains AI-disabled; VeoForge readiness is independently gated. |
| Thumbnail mobile-legibility rules | Implemented and canaried | Four-word ceiling, dynamic fitting, connector grouping, product-name removal when represented by a logo, high-contrast text, host/UI collision planning, black-edge logo cropping. |
| Review and immutable publication snapshots | Proven locally | Exact video/thumbnail bytes and metadata are revision-fenced; replacement invalidates approval; retries cannot silently switch assets. |
| Emergency pause and duplicate-safe uploader exchange | Proven locally | Admission pause, claim identity, idempotency, ordered receipts, schedule matching and uncertain outcome handling pass isolated real-DB contracts. |
| Drive durability contract | Implemented | Storage artifacts distinguish local, Drive-pending, verified and failed states; approval does not pretend a missing file is durable. |

## Implemented locally but not enabled in production

| Requirement | Remaining gate |
| --- | --- |
| Keyword quality recovery | Run migration and read-only audit on a live DB copy, verify one cookie-backed scrape and manually review the score distribution. |
| Stable Keyword Tool → Studio creation | Reconcile onto GitHub history, deploy disabled, configure dedicated token, then prove one exact keyword/channel/producer canary. |
| Studio → Keyword Tool lifecycle callbacks | Configure independent webhook secret; verify ordered script/recording/thumbnail/review/scheduled callbacks and restart recovery. |
| Studio Keyword Admin health view | Deploy both halves of the contract; current production numbers already expose lifecycle divergence. |
| Candidate 30 thumbnail/uploader fixes | Seal and deploy after source review; no production approvals or media have been changed. |

## Not complete and deliberately not represented as complete

| Requirement | Exact reason / next action |
| --- | --- |
| Regenerate every production thumbnail | Blocked on human acceptance of a canary family and missing/incorrect application assets. Deleting accepted thumbnails first would remove the rollback path. |
| Select and schedule 50 new videos per channel | Current read-only audit found zero candidates with both a current publication approval and quality-approved thumbnail. Existing media-ready localized rows were already dispatched. |
| Normal unattended uploading proven on every channel | The connector protocol is proven locally, but the seven uncertain production dispatches require reconciliation and each configured channel needs a one-item live canary. |
| VPS2 public Tutorial Studio endpoint | DNS/public routing remains separate from the healthy private candidate. |
| VPS2 VeoForge generation | Provider endpoint, tunnel/proxy and credentials are not configured. No code path should report it ready until a probe succeeds. |
| Full VA migration away from Content Forge | Do this only after one complete intake-to-Drive-to-unlisted-YouTube canary and a rollback rehearsal. |
| Historical missing media recovery | English originals are the only required archive. The Drive inventory still needs an exact English-source reconciliation; translated media may be regenerated. |
| 706-item Keyword Tool accessibility/pagination | The embedded board exposes at most 500 items. Pagination/virtualization belongs in Keyword Tool, not the Studio iframe shell. |

## Root-cause summary

The system was not failing because it needed four ground-up rewrites. It was failing at boundaries: guessed channel/language routing, refreshes that destroyed identity, fabricated or weak keyword evidence, lifecycle callbacks that did not reconcile, approval state not tied tightly enough to bytes, and a UI that hid these states. The recovery keeps the separate-service architecture and replaces those implicit boundaries with explicit, retryable contracts.

