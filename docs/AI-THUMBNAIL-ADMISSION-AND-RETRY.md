# AI thumbnail admission and recovery

Apply migrations 0101–0103 before starting this worker version. No worker was started during these tests.

- Background recovery only resumes already-persisted English batch intents. It never enrolls historical active or completed jobs. Actual splice/stitch transitions can record a first batch; if required English headline copy is absent, prepare it and explicitly request generation in Studio.
- Each batch variant has a durable admission marker committed before provider HTTP. Repeated Redis deliveries cannot spend again, including a crash before the image record is written. Such an admitted-but-missing result requires reconciliation; deleting Redis state does not grant another attempt.
- Admission checks current Admin AI mode, original/channel binding, frozen batch payload, cancellation/rework, and family delivery. PostgreSQL JSONB key order is not meaningful. Row/settings locks are released before provider HTTP.
- English approval commits source thumbnail identity, SHA-256, size and independent mapped locale destinations. Localization reads exact bytes under a media lease into an immutable reference. Completion must still match the selected English source and destination. Generated locale candidates remain unselected and unreviewed until a human chooses them.
- A failed image invocation is not necessarily proof that no provider work occurred. Only failures before the image invocation are definitely retryable. Invocation failures, timeouts and lost acknowledgements remain `uncertain`. Migration 0103 conservatively converts old generic failed locale records to uncertain once.
- Explicit retry: `POST /api/production/jobs/{EnglishRootId}/thumbnail/ai/locales/{locale}/retry` with `{requestId: UUID}`. Keep the same request ID after a lost response. An authorized owner/Admin can retry a definite `failed` intent after exact source-file and destination/delivery checks. The previous attempt audit and candidate bytes are preserved; a new generation request identity is recorded before worker dispatch.
- `uncertain` returns `409 ADMIN_RECONCILIATION_REQUIRED`; this endpoint cannot override uncertainty, even for Admin. Current implementation intentionally has no generic “force retry” switch. Provider-specific proof/reconciliation remains a separate required operation.
- Changed English identity returns `superseded`, not a retry. Missing files/archives fail closed.

Offline tests mock generation. The separately guarded real-PostgreSQL admission test also mocks all generation, retains its new synthetic fixture, and proves durable admission plus lock release and JSONB equality. It is not evidence of live provider quality or completed publication.
