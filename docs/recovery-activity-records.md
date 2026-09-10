# Production records and honest activity reporting

Local component: `ActivityRecords` in Tutorial Studio's `_components/activity-records.tsx`.
Read-only API: `/api/production/activity-records`.

The component is intended below My work on the dashboard for producers. Admin
queries include all producers; every other role remains scoped to its user ID on
the server, including aggregate queries. Client-supplied owner values cannot
expand access. Uploader-only accounts use the separate assigned delivery area.

The source archive is paginated by exact database creation timestamp plus UUID,
50 sources per page, with expandable language versions. Search covers source
title, keyword reference, producer and channel. The stage filter applies to the
source, not its locales. Voice/provider, recording duration, review status,
thumbnail, video and history are visible in expanded records. History loads only
on request and currently shows the latest 100 events per record.

Throughput counts come from actual `stage_changed` events in a selected 1–90 day
window. They count transitions, include language versions, and can count repeat
completions after rework. The rework count is the current number of records marked
`rework_requested`, not a fabricated historical total. These summaries cover the
full authorized scope independently of the archive search.

Current stage age comes only from a recorded `created` or `stage_changed` event.
Legacy rows without events say their stage start is unrecorded. Neither stage age
nor gaps between events are characterized as human working time or inactivity.
Automation stages explicitly say elapsed automation stage time; this includes
queueing/waiting and does not claim measured provider execution time.

Verification: seven scoped tests pass, including permission denial, cursor/input
validation, VA SQL ownership conditions on every query, Admin scope, literal
wildcard search and honest elapsed-time labels. Hub typecheck passed. Integrated
browser and live-DB walkthrough remain required; no production changes performed.
