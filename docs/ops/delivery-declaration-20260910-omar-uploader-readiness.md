# Delivery declaration — Omar uploader readiness and current release gate

Date: 2026-09-10

## Delivered and verified

- Omar's separate headed-browser uploader remains installed on Omar's VPS and
  is not shared with the main VPS2 operation.
- Five Studio channel mappings exactly match the uploader keys:
  `tutorial_usa`, `tutorial_german`, `tutorial_french`, `tutorial_italian`, and
  `tutorial_swedish`.
- All five corresponding persistent Chromium profiles are present.
- Studio's uploader publisher and the uploader worker use identical Drive inbox
  and receipt-folder identifiers. The uploader's authorized-user credential is
  present, owned by `uploader:uploader`, and mode `0600`.
- The one-minute uploader timer is enabled and the explicit arm file is present.
- Studio uploader policy is enabled, `executionMode=live`, defaults to
  `unlisted`, and retains `requireManualRelease=true`.
- Studio's emergency dispatch pause is off.
- The existing Studio → Drive exchange process, production worker, Drive
  uploader, web application, and read-only uploader dashboard remain online.

## Current release gate — no upload started

No new YouTube upload was started during this correction because the required
publication gate is empty:

- 1,922 completed tutorial rows.
- 1,786 rows currently have a final video path.
- 1,914 rows currently have nonempty title/description/tags metadata.
- 926 selected completed thumbnails, all with `review_verdict=not_reviewed`.
- 0 current publication approvals.
- 0 jobs satisfy the durable uploader admission gate.

This is expected after the requested thumbnail reset. Treating Drive presence as
approval would bypass the final-review contract and could publish the thumbnail
defects the reset was intended to remove. A VA/Admin must approve the current
video, exact selected thumbnail, localized metadata, and routing revision before
the uploader request is allowed into Drive.

## External blocker discovered

All five configured uploader proxies failed a credential-redacted egress probe
on 2026-09-10. Direct internet access from the VPS passed, so this is isolated to
the proxy endpoints/configuration. The browser worker is fail-closed and reports
the proxy preflight failure before a provider mutation. Existing login profiles
and uploader history were preserved.

The timer continues to perform read-only reconciliation of one historical
`applied_reported` upload. It does not blindly re-upload it. Existing dispatch
history remains: 8 succeeded, 7 uncertain, and 1 applied-reported. Those rows
must be reconciled against YouTube truth before any retry.

## Exact path to today's first upload

1. Restore or replace the five configured proxy endpoints, then run the same
   redacted egress and saved-page session checks.
2. Review one current English video's selected thumbnail and metadata in Final
   review. Approval freezes file hashes and reserves its channel slot.
3. Use the explicit uploader release action. Studio creates one idempotent
   `requested` dispatch with `visibility=unlisted`.
4. Confirm the Studio publisher writes the immutable Drive bundle and `job.json`
   readiness marker.
5. Confirm the armed uploader consumes it once, writes ordered receipts, and the
   Studio projection reaches `succeeded` with the exact YouTube video ID/URL.
6. Only then release a bounded batch. Do not retry the seven uncertain historical
   dispatches as part of that batch.
