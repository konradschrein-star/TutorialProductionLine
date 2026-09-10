# Recovery checkpoint — 9 September 2026

This is a progress record, not production acceptance. The user rejected the
previous UI acceptance; `docs/acceptance-2026-09-09.md` defines the required journeys.

## Infrastructure preparation

- VPS2 read-only check: about 81 GB free; existing business containers unchanged.
- Isolated staging database contains 9 imported users, 2,016 tutorial jobs and
  3 channels. It remains a point-in-time snapshot, not a live cutover.
- Provider settings were relayed directly in memory over SSH to an inactive,
  root-private candidate. Existing voice defaults were preserved. Source-local
  Claude/Gemini pool endpoints were mapped to their protected HTTPS equivalents.
  Unmapped Ollama URL was omitted; Ollama continuity is not verified.
- Drive credentials were relayed privately and verified from VPS2 against the
  requested Google account. No media was deleted or uploaded by that identity check.
- Candidate environment files have not replaced the active staging environment.
  No production worker or uploader was started.
- Public ports 80/443 belong to a shared business Caddy container, with its admin
  API disabled. Its configuration has only been inspected. A permanent hostname
  and reviewed routing change are still needed; do not disrupt existing services.

## Local navigation reproduction

In the local VA browser, clicking Record restored a remembered tutorial. Clicking
Prepare scripts then left the browser on Record with that same job ID. The Record
component's restoration effect reacted to the missing jobId while the user was
navigating away and replaced the requested route. The fix limits restoration to
an explicit `tab=studio` visit. Four record-session tests pass; browser verification
of the rebuilt fix is still pending.

The recording screen also claimed “Delivering to Drive…” from an unconfirmed
boolean alone. It now says “Drive delivery not confirmed” and points the user to
Delivery for actual connection/approval/upload state. This is not a fabricated
progress indicator.

## Schema and checks

- Local synthetic database now has migration 0100 (persistent thumbnail drafts
  and per-user asset preferences). No production schema was changed in this step.
- Replaying the entire migration helper against the synthetic database stopped at
  0079 because fixture uploader statuses violate its older check constraint.
  No fixture rows were deleted or rewritten to make the migration pass. The helper
  now accepts an exact `--from` migration suffix and uses a transaction per file;
  applying only audited pending 0100 succeeded.
- Hub regression run: 547 passed, 64 skipped. Worker run: 487 passed, 2 skipped.
  These counts precede final thumbnail AI and QA revision-projection changes and
  must not be used as evidence for untested later edits.
- Keyword frontend startup was refused by the execution policy. It has not been
  retried through an alternative launcher or port. Independent source/tests and
  backend work continue; browser SSO acceptance remains pending.

English originals remain the recovery priority. Unknown-language original records
must not be dismissed as disposable translations. Local eviction stays disabled
until exact video, thumbnail and metadata verification plus active-consumer checks
are proven.

## Browser evidence after the first 9 September rebuild

Using the local VA session, not a mocked browser:

- Record → Prepare scripts now remains on `tab=create`; the sole test channel
  is preselected. Drive status no longer claims a transfer is running.
- New synthetic pack `22222222-3333-4444-8555-666666666601` has a playable local
  test video and four prewritten translated thumbnail copies. No translation
  provider was invoked; this does not test translation quality.
- Applied Guide Host Right layout, saved a draft and fully reloaded. The layout
  reappeared with its white/yellow outlined copy intact after selecting Procedural.
  Reload incorrectly preferred AI mode over the saved procedural draft; follow-up
  fix is being prepared and is not yet browser-verified.
- Selected a bundled logo. Duplicating created a distinct layer; removing that
  duplicate left the original logo and other layers present.
- Approve pack rendered and approved all five locales. Returning to the matrix,
  disabling Pending only and searching for the pack showed five real images,
  localized copy and 5/5 approval. No public publication was performed.
- At 1366×900 the properties were still below the canvas and forced scrolling.
  A three-column inspector layout is being prepared; visual acceptance is pending.
- Windows displayed emoji flags as letters. SVG replacement is implemented but
  requires the next rebuild to verify visually.

The local server currently runs the first 9 September build. Later source changes,
including the separate Keyword Tool backend URL, require another rebuild.

## Second verification pass

- User chose `tutorials.schreinercontentsystems.com` as the permanent VPS2 address.
  DNS inspection currently resolves it to source VPS1 `65.108.6.149`, not VPS2
  `167.233.145.218`. No DNS or shared reverse-proxy change has been made. Recheck
  current ownership/routing before changing this record; private staging can
  continue independently. VPS2 still has 81 GiB free at this check.

- Full regression suites: Hub 577 passed / 64 skipped; worker 489 passed / 2
  skipped. These precede the generic-media Windows-path fix discovered below.
- Final review J/K navigation worked without enabling shortcuts. The synthetic
  English video played to the end (4 seconds, media error null). Approve & next
  removed it from the review queue and reserved its channel slot; Delivery showed
  that reservation and the manual-upload action. No public upload was submitted.
- Approved manual-delivery metadata returned English video, thumbnail, title,
  description, tags and approval revision. This was not a five-language bundle.
- An actual library upload returned 201 and survived a library reload, but fetching
  its image returned 403: the generic media route used a slash-prefix containment
  test against Windows backslash paths. Upload/library acceptance is NOT passed
  until this is fixed and the exact HTTP journey is rerun.
- Compact Delivery controls, SVG locale flags and the three-column thumbnail
  inspector are source-complete; rebuilt-browser verification remains pending.

## Third verification pass and English preservation

- Rebuilt local runtime: session35318 / PID64196. Delivery first record now starts
  around y350 rather than y780 at 1366×900. Browser verified full five-image matrix
  with SVG flags, procedural draft mode restored automatically, and side-by-side
  canvas/inspector. Dark mobile390×844 kept the matrix in its own scroll region.
- The left editor library still clipped tab labels and cropped preset previews;
  follow-up source fixes and larger/wrapped headline export require another build.
- Asset HTTP journey passed: upload201; image200; per-VA hide200; other VA still
  sees shared asset; restore200; exact bytes preserved. This is API coverage, not
  a native file-chooser test.
- Actual KT HTTP bridge passed SSO/claim/create/binding, concurrent clicks and
  lost-response replay to exactly one original+intent, owner/channel rejection,
  recipe preservation and ordered completion callback without duplicate credit.
  Completion was synthetic; embedded frontend remains untested/unstarted.
- Unsaved navigation browser check was inconclusive: click timed out then landed
  on dashboard. Do not claim cancel-flow protection as browser-verified.
- Linux image `tutorial-recovery:20260909-candidate5` built successfully; config
  SHA90177cc3a34ad8aafee2392dbbc5d35bab46fa3ed4e876eb6e892aa38a63a334.
  It predates later text-sizing and English-first AI changes. Do not deploy as final.
- User requested VeoForge five-English-candidate selection, click-to-approve and
  exact-reference localization. Implementation is underway. Live source+HTTPS
  `/ready` report false, capacity0, expired sessions3; provider was NOT enabled.
- Exact five-English preflight succeeded against the unique existing `_Tutorials`
  root owned by the expected Drive account. Source-only manifest SHA
  f022aedee8cd423e26a8ce05adce4b98164c27fa504a8e9f85ceb26a0fe188da lives under
  `/var/tmp/tutorial-migration-preserve-q09ypb`, with private receipts.jsonl.
- Explicit preservation completed: **5 verified, 58,224,531 bytes, 0 uncertain**.
  Each remote object was read back and SHA-verified; local hashes/source revision
  rechecked. No source media deletion, production DB write or public upload.
  First invocation from wrong cwd stopped before work; rerun from source cwd
  succeeded. CLI now anchors cwd for relative OAuth paths. Receipt import into
  staging remains pending. A subsequent exact-object restore onto VPS2 passed:
  13,841,434 bytes, SHA-256
  ea3548ae13bde41c583677a651d554451eabb3a507bebdf87691117d750eaa34,
  retained privately at
  `/opt/tutorial-recovery-staging/restore-pilot-j10RXQ/english-original.mp4`.
  This restore made no Drive writes, DB changes or original-file deletions.

## English-first AI browser pilot and security rebuild

- Local schema0101/0102 applied only to the synthetic database. Current web
  runtime session57145/PID18072 runs the first English-first AI build.
- Browser tab6 (isolated from the other work tabs) tested source
  `63023651-5056-45f0-9d61-e10ede6836b1`: five clearly labeled synthetic candidates,
  full-size viewing without approval, absent QA labeled Unverified, then one click
  approved English and displayed DE/FR/IT/SV pending fanout intents. No worker ran.
- Separate actual HTTP fixture passed owner403, atomic selection+approval,
  duplicate-click idempotency, four SHA/size-bound intents, and confirmed thumbnail
  approval did NOT mark the video publication-approved.
- Full suites at this point: Hub606 passed/64 skipped; worker509 passed/2 skipped.
  These precede the independent audit fixes below and are not their proof.
- Independent review caught stale child approvals after English replacement,
  automatic historical enrollment, missing dequeue policy revalidation and skipped
  recovery of replacement batches when an old image remained selected. Owning
  agents are fixing these; this build must not be activated in production.
- Next upgraded15.5.23→15.5.24 and direct Sharp0.34.5→0.35.4. Reason: image
  optimization AVIF vulnerability documented at
  https://github.com/advisories/GHSA-2xp9-vwfh-vxw4 . Hub build and worker typecheck
  passed after adapting the named Sharp OverlayOptions type. Actual asset upload,
  hide/restore and manual-delivery metadata HTTP pilots passed again afterward.
- VeoForge live OpenAPI accepts mode/image, prompt, aspect, idempotency_key and
  reference_images(category,image_b64); existing adapter matches this contract.
  Added stable batch/variant identities across provider submits (2 mocked transport
  tests), plus bounded advisory visual checks (5 synthetic tests). No live image
  generation or vision-provider proof yet.
- New private VPS2 runtime candidate runtime.ai-20260909.env.candidate SHA
  afcbb7caaa00acc84254dab784ef6dd0a5e54eca531dae8dea1303a0d68fc57b preserves
  provider/Drive settings, uses verified HTTPS VeoForge route, and keeps VeoForge
  images disabled pending capability/session recovery. Active runtime unchanged.
- Keyword frontend16.3.4/backend Linux images built without launching services;
  production npm audit reported zero findings, nine dev-tree findings remain.
  KT migrations fail closed by default because legacy002 deletes rows; SQLite
  migration/parser fixes and source assets still require a preservation rehearsal.

## Admission and replacement verification follow-up

- Local-only migration0103 applied. Actual PostgreSQL test confirmed JSONB-order
  independent payload validation, one mocked provider invocation across duplicate
  deliveries, and source/settings locks available from another connection during
  generation. Synthetic job `38f24e4c-f7a6-4002-a3d6-ea5b9e3e6ac0` retained.
- Independent read-only review found all four previously reported admission and
  stale-approval issues addressed. Periodic recovery only resumes saved intents;
  it cannot enroll historical active or completed jobs. Admitted variants are not
  requeued after Redis loss. VeoForge pinning fails closed on provider downgrade.
- Hub suite: 612 passed, 64 skipped. Worker suite: 517 passed, 3 skipped before
  the final admitted-variant recovery regression; final rerun tracked separately.
- Rebuilt local Hub successfully; runtime session65515/PID47532, no worker.
  Actual HTTP fixture `7864a3e1-5fdc-4060-8eef-fd16288dc6f3` passed duplicate
  selection, ownership denial, exact-image fanout and replacement invalidation of
  locale selection/publication receipt while retaining prior file paths.
- Isolated browser tab6 verified distinct Current edits/Saved images counts,
  replacement-draft retention message, full-size image fitting1280x720viewport,
  and four pending mapped locales. Images remain clearly labeled synthetic;
  this does not prove live provider generation, translation or quality.
- Final worker suite rerun: 518 passed, 3 skipped.
- Actual browser procedural export on fixture63023651 succeeded after removing
  the empty logo layer. Selected acceptable image
  `e90e6ce8-4d31-42ba-a412-7013e46e2b92` was visually inspected at its saved JPG:
  large white/yellow outlined text, no clipped letters. Remaining unsaved state
  refers to other-language drafts affected by the shared-layout change, not loss
  of the English export. A clearer language-specific label is being added.
- Linux candidate6 build started after worker freeze, but must NOT be deployed:
  a subsequent audit found English failed-image retry lacked provider outcome
  certainty. Hub retry/reconciliation safety is being tightened; candidate7 will
  be required. Earlier candidate6 build was canceled before completion because
  source changed.

## Final English retry guard

- Hub615 passed/64skipped; worker518 passed/3skipped. Local Hub build passed,
  runtime session79650/PID2760 now includes English uncertainty rejection and
  language-specific unsaved labels. Browser saved remaining synthetic drafts
  before reload; no production media or accounts were changed.
- Actual HTTP fixture `36421c27-e0cc-44b9-b710-a9cae77bb2c0` also proves ambiguous
  English failure returns409ADMIN_RECONCILIATION_REQUIRED and creates zero new
  batch intents. Atomic approval/replacement invariants passed again.
- Candidate6 completed but is obsolete. Candidate7 Linux build underway.
- VPS2 read-only check:81GiBfree; only isolated staging PostgreSQL and Redis run.
- Receipt preflight: all five preserved revisions match immutable staging archive
  and current jobs; two artifact parents exist, three are missing. No DB import
  performed. See `docs/ops/import-preserved-english-receipts.md`.

## Candidate7 staging preparation

- Clean Linux build passed. Candidate7 manifest-list ID
  `sha256:1d547b1869a90eb61ddf010372e8be4c0e77e50a4fa0ef3eae6fb6a4b25c7732`;
  config SHA `edf5e5e37d74442d150a9fe87641c92b437956513325b3147e7000fcbd22c0e9`.
- Network-none/read-only/capabilities-dropped runtime test ran as UID1000 and
  produced a valid1280x720 PNG in memory. No app, worker or provider started.
- Image archive769,123,840bytes, SHA256
  `8dbfbe3ec2f431b43e4209bcedb168928c5481f5f0c7cc83a8a64095296a77c5`.
  Transfer in progress to private VPS2
  `/opt/tutorial-recovery-staging/image-candidate7-EVC2PY/candidate7.tar`.
- Read-only schema preflight confirmed0100–0103 absent and prerequisites present.
  Root reviewed all four SQL files and authorized backup plus one-transaction
  suffix application to the isolated staging DB only. Outcome pending.
- Outcome:0100–0103 applied in one guarded staging transaction; four new tables
  empty,0103columns verified,0099append-only guard still enabled. Backup:
  `/var/tmp/tutorial-migration-schema-0100-0103-7PpD5U/staging-before-0100-0103.dump`,
  28,031,433bytes, SHA256
  `968d8ebf3fe338da298975f31e764012612faa28054ffafe9d7a699c2cecbbfb`.
  Backup listing verified. No tutorial statuses, media, pointers or services changed.

## VPS2 private web boot and browser login

- Image archive transfer SHA matched exactly; candidate7 loaded on VPS2.
- Guarded `deploy/recovery/start-staging-web.mjs` started only web with
  `runtime.ai-20260909.env.candidate`; original runtime.env contents unchanged.
  Composefile permissions tightened0644→0600. Private override files retained.
- Initial all-internal networking left configured port unmapped. Web-only
  `web_access` bridge fixed publication to127.0.0.1:3118; database/Redis remain
  solely on internal network. No public port, worker, Drive, image generation,
  publication or retention activation. Health200 and empty queues verified.
  Generic health's worker check means no stale jobs, not that workers are running.
- SSH forward session27134: local127.0.0.1:13118→VPS2loopback3118. Hidden browser
  tab7 signed in successfully with the user's existing Admin credentials; dashboard
  and imported thumbnail matrix loaded. This is not a completed VA journey.
- Matrix reveals unavailable imported thumbnail bytes despite saved record status;
  exact one-job storage diagnosis in progress. No imported approval was changed.
- `scripts/migration/inspect-staging-web.ts` emits sanitized running/port/health
  diagnostics only. Other production containers and source sites remain untouched.

## Verified staging Drive retrieval

- Explicitly enabled Drive for staging web after exact metadata/source verification.
  Stored driveEnabled is absent; no DB override or encrypted Drive rows. Added
  missing read-only credential mount from existing private files. Effective config
  now reports enabled. Workers/publication/retention/Veo images remain disabled.
- Corrected older remote compose media mount/env(`/media`) by additionally mounting
  isolated host media at original `/opt/content-forge/media` and setting that root;
  no stored paths rewritten. Current override:
  `/opt/tutorial-recovery-staging/candidate7.web-media-drive.override.json`.
- Materializer deliberately refuses missing parents. Created only the exact pilot
  job's empty thumbnail parent as UID1000, then restored127,176bytes with SHA256
  `7de7e37d8f9ee6e91b573fa925c932e68b63ae8b31ef66d86609901cc2e8ab3b`.
  Browser matrix now displays the original CSS Triangle Shapes thumbnail. Verdict
  remains not_reviewed. No DB writes or source deletions. Other parent directories
  need a separately audited migration skeleton; dry-run implementation underway.
- Direct browser navigation to the binary image endpoint was client-blocked; no
  browser bypass used. Verification occurred in the normal matrix after reload.
- Candidate8 builds the subsequent preview-failure label fix; candidate7 remains
  the privately running staging image until8is verified. KT source now passes178
  backendtests, finalfrontendbuild16.3.4; noKTserviceormigrationactivation.

## Directory migration and actual browser playback

- Directory-only migration inspected 3,094 safe artifact paths and created 3,093
  empty directories as UID1000. Follow-up: 3,096 existing, zero planned, zero
  blocked. No media files or database records changed. Protected audit:
  `/var/tmp/tutorial-migration-media-dirs-1xmYEh/audit.json`.
  Before hash `3791e37f75ca4aa68a20600efb01928d24313e6ee75af9b1c8ab7036873ced88`;
  after hash `172e18c67c7c748bab0cc90b5ef104623bca156a348f4024330705b62814874d`.
- Actual imported library now visibly displays multiple restored English images,
  including CSS Triangle Shapes and Python Ranges. Original branding retained.
- Browser final-review test of CSS job
  `d49fd231-e269-41ab-9021-ec1f0ca12c5d`: selected All VAs, played the actual
  Drive-backed video, observed readyState4, duration216.398seconds, advancing
  currentTime, no media error, then paused at14.285913seconds. No approval,
  rework, schedule or upload action performed. Attempt to mute before loading did
  not take effect; playback was promptly paused after detection.
- Found explicit review deep-link bug: default mine/time filters can hide the
  requested authorized tutorial. Fix with exact-job ownership tests underway.
- Candidate8 clean Linux build and nonroot/network-none/read-only Sharp smoke
  passed. Manifest-list SHA
  `adbc8235ac35cc926ce34a28036fb45f708824a5339a848cfa289488d5ebf7b3`;
  config `44a256cdec6fe46672eaac2006e455d290da4ff2fa2aaae99037e2ff6b64493f`.
  Not deployed: batching subsequent review and delivery-label fixes avoids another
  unnecessary image transfer. Candidate7 remains private staging runtime.
- CDP source contract audit establishes private/unlisted Drive exchange
  compatibility, not reserved scheduled publication or end-to-end emergency stop.
  See `2026-09-09-cdp-uploader-integration.md`. No uploader modifications or live
  upload pilot performed.

## Candidate9 source acceptance

- Review deep links now fetch only the requested authorized English original,
  independent of lookback/review filters; missing/foreign/invalid links never
  substitute another job. Locale queries use the server-authorized scope and
  discard stale job state. Sixteen focused tests and Hub typecheck passed.
- Delivery labels and disjoint counts distinguish unverified reports, verified
  private/unlisted transfer, external scheduling and verified publication. Seven
  helper tests passed; no scheduled connector capability was invented.
- AI prompt paths no longer force black text regardless of background. Small-
  preview readability and unclipped outlines are explicit. Localized vision QA
  receives target-language context and checks translation of the English reference
  rather than an empty literal headline. Unknown original wording cannot pass.
  All125thumbnail tests pass, including18prompt/quality tests. Live vision calls
  remain untested and no automatic paid retry loop was enabled.
- Latest full suites before final scope follow-up: Hub635passed/64skipped,
  worker521passed/3skipped. Final review/delivery focused rerun23passed.
- Candidate9 clean Linux build started; candidate8 was not transferred/deployed.
- Source VeoForge README was inspected read-only. It documents interactive login
  for expired sessions; no session extraction, automated login/security bypass,
  session import, provider restart or generation was attempted.
- VPS2 disk recheck:80GiB available,74% used. Production sites remain unchanged.
- Preservation PhaseA rollback rehearsal passed:3proposed parents,5immutable
  receipts,58,224,531bytes; follow-up confirms zero committed writes. PhaseB atomic
  current-pointer planner has19preservation regressions; actual fresh-proof
  rollback executor still under construction. No current pointer changed.

## Candidate9 privately deployed

- Clean Linux Hub+worker build completed. Image manifest-list SHA
  `d31bee412253be790c3c91f60cd891b6514d8196f31891ab5aefe4dcc70235a1`,
  config SHA `5dd2f87defc2d7fec2ea57e3bf60ab73efa9427bd86eac9ebf5544a5c049bc6b`.
  Isolated nonroot Sharp1280x720 smoke passed without network or writable root.
- Archive769,170,944bytes, SHA256
  `d1d5325d78348d59400b5903f395f5049a8e46d2e7ab1505fbebdd02c13d4a1a`;
  local protected-temp directory
  `C:/Users/konra/AppData/Local/Temp/tutorial-candidate9-transfer-37ad54203ae34dd2b2f15eacde3ea0cc`,
  remote `/opt/tutorial-recovery-staging/image-candidate9-mePNNG`.
  Remote checksum and installed image identity match.
- Reviewed helper's explicit candidate7→candidate9 upgrade replaced only web.
  Override `/opt/tutorial-recovery-staging/candidate9.web-media-drive.override.json`.
  Health200, private127.0.0.1:3118, correct isolated media and read-only Drive
  credentials mounts, internal database/Redis network, empty queues. No workers,
  live image generation, publication or retention enabled. Disk76.3GiB available.
- Browser reload of the actual CSS review deep link now shows exactly that one
  tutorial without changing the default My tutorials filter; API-authorized Admin
  scope still loads language readiness. No approval or rework action taken.
- Final full Hub suite639passed/64skipped. Worker full521passed/3skipped, followed
  by125thumbnail tests after prompt follow-up. No live-provider test claimed.

## Configured reference-asset preservation

- Narrow audit:12active style references,14primary-host normalized images and
  14host originals; all40exist on Content Forge source, total16,120,319bytes.
  None had a verified Drive mapping. VPS2 had one identical normalized image.
- Pinned protected manifest SHA
  `10e483a4e7a416119bdbc4c08a30c5f6ad8f015b25fdea780821db4eb9e64cf5` at
  `C:/Users/konra/AppData/Local/Temp/tutorial-configured-assets-IKn104/preservation-manifest.json`.
- Bounded PC relay copied39missing images(16,014,111bytes), skipped1identical;
  all40runtime paths independently passed exact SHA/size and UID1000 readability.
  No source modifications, database writes, new SSH keys or tutorial-video copy.
  Relative paths preserved into `/opt/tutorial-recovery-staging/media`.
  Relay retained at
  `C:/Users/konra/AppData/Local/Temp/tutorial-reference-relay-aLtwq1`.
- Seven exact reference directories were independently rechecked by canonical
  path/device/inode and changed from root to UID1000/GID1000 using no-follow
  directory handles. Mode0755 stayed unchanged; all seven passed runtime write
  and traversal checks. No image content changed. Protected audit:
  `C:/Users/konra/AppData/Local/Temp/tutorial-reference-relay-aLtwq1/directory-ownership-receipts.json`.
- Three tutorial channels bind two active voice rows with no local reference-file
  dependency in their saved settings. Voice provider IDs retained; live credential
  validity/audio synthesis not tested by this file audit.
- Fresh PhaseB Drive readback verifies all5rescued originals,58,224,531bytes.
  Created exactly3approved missing empty tutorial directories; default rollback
  then tested3parents+5immutable receipts+5current pointers with zero committed
  changes. Authoritative freshness now uses staging DB clock because the PC is
  approximately24seconds behind server time; strict15minute/no-future fence kept.

## Follow-up: five originals linked and application restore verified

- Explicit fixed-five staging commit completed after fresh full protected backup:
  3storage parents,5immutable versions,5current pointers. Independent read-only
  verification found all5recorded,zero remaining inserts,unchanged tutorial rows.
  No approvals,schedules,source files or workers changed.
- Backup `/var/tmp/tutorial-preservation-promotion-pb6vnv/staging-before-promotion.dump`,
  28,043,042bytes,SHA `765f3284f0757148fba01dc3a1dde0d657105e6f85987045febbb3544e7c25db`;
  listing verified, private before/after commit audits retained.
- Exact original48790ac0-6ad1-4ce6-8ac4-7f7c26c428a6 subsequently restored through
  deployed withTutorialMedia and its real current pointer:13,841,434bytes,
  SHA `ea3548ae13bde41c583677a651d554451eabb3a507bebdf87691117d750eaa34`.
  Normal lease,no-clobber and SHA guards retained; job/artifact rows unchanged.
- Its selected English thumbnail70175471-10ac-4d26-81d5-da503701b942 remains on
  source(146,123bytes) but has no verified Drive mapping in either system.
  Staging thumbnail missing; exact-image preservation plan in progress.
- Candidate10 built successfully but was not deployed: restored character routes
  exposed pre-existing manager integrity problems. Transactional rebinding,
  per-channel primary semantics, collision-safe uploads and contained image reads
  are source-fixed; actual local PostgreSQL conflict rollback passed using TEMP
  tables only. Candidate11 will include these plus AI progress/quality visibility.
  Candidate9 remains the private deployed web; production unchanged.

## Candidate11 private deployment and browser acceptance

- Candidate11 image checksum verified across PC/VPS2 before load; manifest-list
  SHA `964a6b4390893eabd1c0ef6bae17a049d8556104bad071f3459352de71ae7e4a`.
  Transfer769,788,928bytes,SHA
  `5b148bd2a7d4c21c98843741b9650605f087010d7328bbecee67de53a3349ae1`.
  Remote `/opt/tutorial-recovery-staging/image-candidate11-pfE1bS`.
- Guarded candidate9→11 web-only replacement passed. Private3118,Drive retrieval
  enabled,all activation flags unchanged/off,no workers. Health200,emptyqueues,
  approximately73.5GiBfree. 'Workers ok' indicates no stale jobs,not running workers.
- Browser confirms exact BeardedGuy page and all5preserved pose images render.
  Channel-binding integrity also passed real local PostgreSQL TEMP-table rollback.
- Temporarily switched isolated staging policy manual→ai to inspect existing
  CSS tutorial candidate. Provider-disabled message remains visible; generation
  disabled; saved quality explicitly unverified; full-size preview Tab stays inside,
  Escape closes and returns focus to its initiating button. No generation/approval.
  Restored manual policy and independently verified DB value='manual'.
- Full current web suite658passed/64skipped; worker521passed/3skipped.
  Candidate12 build contains only follow-up character helper-copy and accessibility
  corrections discovered in browser; no additional feature expansion.

## Candidate12 final private UI build

- Image manifest-list SHA
  `687c1c274e84d7ece1550f6469e1a243b25883f77a709d33fe198d8ba4cb3fb2`;
  runtime config SHA `d8d7e05667a62e23a6a5d32fc928cbb727dba55c71946bc0cee461ff6e1480a5`.
  Linuxbuild/typecheck and network-none/read-only/non-root Sharp smoke passed.
- Transfer769,775,104bytes,SHA
  `9b3bdd56e2f692de4f5246193f3cb97ff29697d75073eae1f46c5a71ae947c4f`
  independently matched on VPS2. Remoteimage/helper directory
  `/opt/tutorial-recovery-staging/image-candidate12-2ay857`.
- Guarded11→12 web-only replacement completed. Health200,queuesempty,
  approximately69.6GiBfree. Same privateport3118/media/Drive mounts and disabled
  generation/publication/retention flags. No workers started.
- Browser confirms per-channel explanation, contextual accessible action labels,
  linked form labels and all5preserved character images. Review flags also render
  beside visible language names. Seventeen focused follow-up tests pass.
- Exact missing English thumbnail now independently verified on requested Drive;
  see `docs/ops/preserve-one-rescued-thumbnail.md`. Its staging pointer transaction
  is still being rehearsed separately; no source image changed/deleted.

## Singleton thumbnail linkage completed

- Fixed-one transaction committed1parent+1immutable version+1current pointer after
  successful rollback and fresh protected full backup. Exact post-state verified;
  tutorial/thumbnail selection/verdict unchanged. No source writes or workers.
- Backup `/var/tmp/tutorial-preservation-promotion-AMshbE/staging-before-promotion.dump`,
  28,044,902bytes,SHA `b3db003f9759a5c9732482cb1013f12a3c77ce73c28404b4721cfcd06263891c`.
- Normal deployed withTutorialMedia restored only the selected English image:
  146,123bytes,SHA `94113309775e2b0e8eb9077711be893c0c27a6aa7bb48f068ca3b32f122b719f`.
  Fifteen singleton tests pass; lost-ACK handling remains reconciliation-only.
- Final candidate12 browser check on tutorial48790ac0-6ad1-4ce6-8ac4-7f7c26c428a6
  confirms the formerly broken image displays both as video poster and English
  language-card thumbnail. No playback/approval action was taken in this check.

## Candidate13 review refresh

- Removed five-channel setup requirement; unit coverage includes one and twenty.
- Disabled uploader excluded from core setup count and automatic connection probes;
  uploader credential is optional for manual delivery. Credential presence no longer
  says connected or implies handoff readiness.
- Web666passed/64skipped; worker521passed/3skipped; TypeScript and Linux builds pass.
  Non-root/read-only/network-none Sharp smoke passed.
- Transfer769,809,408bytes SHA
  `83eef970e49d27dfe276cefc6f83ba95a99ac6d3fdfa2ecc07a052f454b622ca`
  independently matched before load. Remote directory
  `/opt/tutorial-recovery-staging/image-candidate13-pSGgjp`.
- Guarded12→13 web-only update passed. Health200; empty queues; about64.8GiBfree.
  No worker/publication/retention activation, credential changes or DNS changes.
- Restored private SSH forward13118; browser verified new setup copy with three
  existing channels and optional uploader. Manual upload checklist inspected.
- Known display debt: general credential inventory excludes file-based Drive
  credentials even though the archive panel recognizes them. No credential repair
  should be attempted based on that inventory alone.
