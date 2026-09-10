# Keyword Tool / Studio handoff recovery — 2026-09-09

## Implemented source behavior

- Studio keyword-linked creation now calls the existing Keyword Tool production-intent service as the signed-in user. It does not directly create an unbound Studio job.
- The browser endpoint checks the user's claims and channel permission, validates title/steps/source/reference, then accepts success only after KT confirms binding and the local Studio original matches keyword, owner and destination.
- KT persists its original target, producer, request and idempotency identity before HTTP. Lost acknowledgements reuse that request; concurrent clicks share one admission. Pending/uncertain responses are not presented as created jobs. Callback projection remains authenticated, ordered and strictly bound.
- Keyword-linked jobs use Admin workspace provider/model/voice/default-preset settings, displayed read-only. Manual jobs retain per-job overrides. Unsupported linked fields are rejected, not silently discarded. Explicit channel UUID and YouTube reference URL are now supported by KT's existing produce endpoint.
- The sole authorized Studio channel is preselected. Multiple authorized channels require a choice. A scraped competitor channel is not a Studio destination; unbound keyword-specific destination assignment still needs an explicit data model before it can be inferred.
- Claimed-keyword view distinguishes an existing job from a produced tutorial; queued/recording/failed work remains visible. Its join is restricted to owned originals, not arbitrary translations or another producer's jobs. Production completion is not proof of YouTube publication.
- `KT_ENABLED=false` explicitly disables the integration. Missing embed URL/secret is a neutral unconfigured state. A configured outage remains an error with retry; it does not become an empty work queue.
- Optional `KT_API_URL` selects the internal server-to-server API base independently of the browser-facing `KT_EMBED_URL`. It accepts HTTP(S) only and rejects credentials/query/fragment. This supports a private backend without pretending the browser iframe is reachable.

## Keyword quality changes

Research rebuild previously restored cached screening verdicts using video ID alone. It now requires the current rubric hash/model (or existing deterministic-rule evidence), clears stale verdicts only on untouched NEW candidates, and preserves production history. Initial rubric creation no longer commits an enclosing research transaction.

`V5_SCREEN_HIDE_UNSCREENED` now defaults to true; an explicit false remains an operator override. Board coverage discloses unscreened research backlog and whether it is being withheld. Coverage refresh does not run paid screening. Board fetch failures have a persistent retry state instead of appearing as no research results.

Ranking is still a heuristic based on reference-video performance, relative outliers, age and estimated RPM. These fixes do not establish that its recommendations are commercially good. A manually labelled, representative acceptance set and a separately supervised screening evaluation remain necessary; no paid rescreen was run.

## Verification and remaining acceptance

- 25 focused Hub tests pass across configuration/API URL validation, owner/original scoping, truthful completion, channel inference, strict linked contract, uncertain acknowledgement and confirmed binding verification (21 workflow/bridge plus four mine-route tests).
- Hub TypeScript check passed.
- 70 targeted KT Python tests passed, including cache/config/transaction safety, stable refresh/claims, concurrent intent creation, lost acknowledgements and ordered callbacks.
- KT frontend TypeScript check passed after repairing the pre-existing curve test runner imports and tuple typing; all 14 original curve tests pass. Isolated webpack build succeeded: `frontend/.next-integration-embed`, BUILD_ID `V1CRU94R0so4iEfd3S77r`, 31 generated static pages. An attempted broad legacy Python suite was interrupted; it is not reported as passing.
- Actual browser-to-KT-to-Studio API acceptance passed against rebuilt local Hub 3108 and KT backend 17877: SSO and claim, owner/channel rejection, parallel clicks, discarded browser acknowledgement and retry, exactly one original job and one confirmed intent, workspace recipe preservation, ordered completion callback and no duplicate credit on replay. The browser acknowledgement loss is deliberately induced by discarding real response bodies; no service HTTP response is mocked.
- Synthetic backend restarted successfully on 17877 (session 62064, PID 64528). Actual SSO checks passed: invalid signature and expiry 401, valid exchange 200, same seeded user, `/me` and board 200. Existing five keywords, three intents and two bindings were preserved. The browser bridge test subsequently added its own keyword 910206 and one associated intent/job; generation requests remain zero.
- The isolated frontend on port 17878 is NOT listening: its previous startup was rejected by the execution tool with `blocked by policy` before process creation. No retry, alternate frontend launch or policy bypass was attempted. Embedded-board CUA acceptance remains blocked, even though its earlier isolated build succeeded.
- No live configuration, source server files, production records or provider credentials were changed by this subtask. No generation, upload, paid screening or public publication was performed.

Passing acceptance harness: `scripts/test-recovery-keyword-browser-bridge.ts`, backed by the KT candidate's `scripts/bridge_fixture.py`. Executed with the exact synthetic PG/JWT configuration and `RECOVERY_NO_WORKERS=true`, exit 0. Uses fixture keyword 910206; verifies actual SSO, claim, parallel browser requests with a deliberately discarded browser acknowledgement, one binding/job, workspace recipe and ordered completion callback/replay. Completion is an explicitly synthetic status transition, not video production. The embedded frontend was not verified by this API test.

KT source candidate: `C:/Users/konra/AppData/Local/Temp/keyword-live-recovery-82957784c49447849cbff7d0a1c16669`.
