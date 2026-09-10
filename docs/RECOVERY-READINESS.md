# Tutorial production readiness

Updated 9 September 2026. This is not a production-completion claim.

## Review scope and deferred setup

The owner will configure uploader destinations and VeoForge later. Their absence
is not a blocker for reviewing the procedural/manual workflow. Each installation
may have one, twenty, or another number of channels; there is no five-channel
minimum. Channel access remains assigned per user within one workspace.

Candidate13 setup checks now distinguish saved credentials from tested connections and
exclude the optional uploader from the core setup count. Disabled uploaders are
not contacted by the setup card. Eight focused tests and TypeScript checks pass.
Candidate13 is deployed privately and browser-verified. The credential inventory
still does not recognize file-based Drive credentials; the separate archive panel
does. Do not re-enter or rotate preserved credentials to resolve that display issue.
VeoForge's editable shared connection resolver is still pending;
do not imply that saving a token alone updates the environment-driven worker.

| Area | Verified | Still required |
| --- | --- | --- |
| English-first AI thumbnails | Five-candidate UI, one-click approval, exact-image locale lineage, replacement invalidation, duplicate admission and uncertain-retry guards tested without paid providers | Reconnect VeoForge sessions; prove live image capability and reference-preserving locale output |
| Procedural thumbnails | Actual browser export inspected: larger white/yellow outlined text; layer removal, saved approval and draft reload work | Final channel assets; representative long localized headlines and VA acceptance |
| Keyword Tool | Separate API handoff, ownership/channel mapping, idempotent completion and stricter versioned quality gates tested; 178 backend tests and clean frontend build passed | Representative editorial-quality acceptance; frontend browser integration still unverified because local startup was denied by execution policy |
| Distribution | Local scheduling/manual-delivery contract pilots; CDP source audit confirms private/unlisted Drive exchange compatibility | Confirm channel network: saved uploader IDs do not match imported English channels. Controlled live private pilot; scheduled-publication protocol and downstream emergency-stop integration remain unimplemented in the audited CDP connector |
| English preservation | Five originals totaling 58,224,531 bytes verified on requested Drive and linked in staging after backup; one original video and its separately preserved 146,123-byte thumbnail restored through deployed withTutorialMedia with exact SHA and unchanged review rows; formerly broken image now renders in browser | Unresolved historical originals remain a separate recovery task; no bulk restoration or eviction authorized by this result |
| VPS2 | Candidate12 web running privately on loopback3118; schema0100–0103 applied after backup; preserved Admin login, original thumbnails, Drive-backed video, exact review links and repaired character manager verified in browser; 40 configured reference/host assets verified at preserved paths; about69.6GiBfree | Hostname/proxy routing and authenticated VA end-to-end pilot |

## Safety boundaries still in force

- No production worker, automatic publication or media eviction has been enabled.
- Only the isolated staging web/database/queue are running. Browser access uses
  a private SSH forward on local13118; this is not the public team address.
- Content Forge and Omar's current production remain unchanged.
- VeoForge reports three expired sessions and zero capacity; images remain disabled.
- A queued item, mocked provider test or external uploader status report is not proof of publication.
- Do not bypass the denied Keyword Tool frontend launch through another runtime.
- Do not migrate the team until the complete VA journey passes on the chosen host:
  `tutorials.schreinercontentsystems.com`.

Detailed evidence: [recovery checkpoint](audits/2026-09-09-recovery-checkpoint.md).
Acceptance journeys: [acceptance checklist](acceptance-2026-09-09.md).
Delegation recordings: [VA/Admin SOP checklist](ops/tutorial-va-sop-recording-checklist.md).
