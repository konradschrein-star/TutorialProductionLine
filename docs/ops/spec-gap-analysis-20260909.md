# Tutorial Production Line — specification gap analysis

Audited on 2026-09-09 against the owner's spoken and written requirements, the
Omar production database, the VPS2 staging tenant, automated tests, and a live
browser acceptance pass. `Delivered` means the feature exists and was verified;
it does not mean an external provider action was inferred from an internal queue.

## Production workflow

| Requirement | Status | Evidence / remaining work |
| --- | --- | --- |
| Linear VA flow from keywords through upload | Delivered | Persistent navigation exposes Software & topics, Prepare scripts, Record, Thumbnails, Languages, Final review, Delivery & Uploads, and Content calendar. |
| VA-focused My work and Admin oversight | Delivered | Owner-scoped VA work/activity and Admin management pages are role-gated. |
| Final review with fast keyboard operation | Delivered | Review queue and hotkey-oriented review controls are implemented and covered by workflow tests. |
| Emergency stop and approval-gated delivery | Delivered | Dispatch admission pause and final-approval fences are implemented. Existing uncertain dispatches are preserved for reconciliation. |
| Manual uploader path when no uploader service is connected | Delivered | Manual delivery/download endpoints and UI are available independently of automatic dispatch. |
| Weekly plan, default 30 videos/day/channel | Delivered | Per-channel weekly publication policy, schedule overrides and content calendar are present. Exact scheduled-public provider readback is still gated below. |

## Keywords

| Requirement | Status | Evidence / remaining work |
| --- | --- | --- |
| Keep Keyword Tool as a separate service but integrate it | Delivered | Tutorial Studio embeds the VA board and an Admin/Manager-only Admin Console through the signed handoff. |
| Bulk CSV alternative | Delivered | Native CSV/manual intake has instructions, template download, required `keyword`, optional `channel`, `steps`, `reference_url`, `mode`, `source_mode`, preview and all-row validation. |
| Automatically hand approved keywords into production | Delivered | Native intake and Keyword Tool outbox use the script-generation pipeline with idempotent ownership. |
| Commercially good keyword recommendations | Not yet proven | Safer cache/screening rules exist, but the separate Keyword Tool candidate still needs deployment, a paid rescreen and a labelled acceptance set. No quality claim is made without that evaluation. |

## Procedural thumbnails

| Requirement | Status | Evidence / remaining work |
| --- | --- | --- |
| Big face, big logo, big text, simple background | Delivered | Six procedural archetypes use large host/logo regions, restrained backgrounds and an arrow targeting the logo. |
| Maximum four words, no dangling `&`, no repeated product name | Delivered | Worker copy normalization enforces the four-word cap, removes represented product names and drops connector-only words. |
| One to four independent headline blocks | Delivered | Editor exposes 1/2/3/4-line modes; each text hitbox auto-fits independently with a safe margin and can be manually resized/repositioned. |
| Dynamic contrast | Delivered | Render-time luminance chooses white on dark regions and yellow on light regions; outline/shadow remain configurable. |
| Adjustable logo, optional backing circle, shadows and layers | Delivered | Logo art scale and container size are separate, circle/fill/shadow are configurable, and layers remain reorderable/removable. |
| Reusable global assets and per-channel selection | Delivered | Logos, symbols, backgrounds and host cut-outs can be bulk uploaded; channel profiles choose host, layouts and automatic background pools. |
| Plain black/white backgrounds and circle layouts | Delivered | Both backgrounds exist as manual-only defaults and two corresponding circle archetypes exist. |
| Freeform shapes | Delivered | Shapes tab adds circles, rounded boxes and rectangles as normal editable layers. |
| Five-language comparison, compact UI and predictable navigation | Delivered | Live browser verification showed EN/FR/IT/DE/SV, persistent workspace navigation, Matrix back action, compact comparison cards, and constrained editor/inspector widths. |
| Compare languages and edit headlines open by default | Delivered | Both disclosure panels were live and expanded on first editor load. |
| Delete/reset/regenerate Omar thumbnails | Delivered with audit exception | 47 Drive thumbnail artifacts and 1,502 unreferenced thumbnail rows were deleted after backup. Sixteen rows referenced by uploader receipts were retained as immutable audit evidence and had their images regenerated. Final regeneration: 913 selected thumbnails, 897 newly created plus 16 audit-linked replacements, zero failures. |
| Make every tutorial unapproved | Delivered | All 1,910 Omar tutorial jobs now have no VA approval. Thumbnail drafts, fan-out and AI batch state were reset. |
| AI five-candidate English selection and localized fan-out | Implemented, environment-gated | Contracts/UI/quality-retry/fan-out exist. Omar intentionally has AI disabled. VPS2/VeoForge activation awaits its own tenant credentials and the mini-PC tunnel. |

## Localization, channels and settings

| Requirement | Status | Evidence / remaining work |
| --- | --- | --- |
| Restore standard languages | Delivered | Omar now has active EN source plus DE, FR, IT and SV translation destinations; NL remains disabled. |
| One or twenty channels | Delivered | Channel groups are data-driven rather than hard-coded; each primary owns zero or more translated destinations. |
| Per-channel language, voice, avatar, thumbnail and uploader settings | Delivered | Live settings expose channel enablement, URL/mapping, voice, translation method, procedural/AI/both mode, layout/background pools, host and prompt overrides. |
| VA-specific settings | Delivered | Each VA has private record-hotkey and default-playback-speed preferences. |
| Central credentials/API configuration | Partially delivered | Admin credential vault and provider tests exist. Omar Drive still resolves from the proven environment fallback; migration of the live secret into the vault is intentionally not claimed. |

## Storage and distribution

| Requirement | Status | Evidence / remaining work |
| --- | --- | --- |
| Videos live in Google Drive, not indefinitely on VPS | Delivered for recorded inventory | 1,752 final-video artifacts are recorded uploaded. No videos were deleted during thumbnail reset. Retention remains fail-closed until archive restore/read verification permits eviction. |
| Regenerated thumbnails upload to Drive | Approval-gated by design | Because every tutorial was explicitly made unapproved, regenerated thumbnail artifacts remain local/pending. The Drive uploader will accept them after VA approval; bypassing this fence would contradict the requested reset. |
| YouTube delivery through separate uploader | Operational but not fully declared | Existing exchange process and receipt history were preserved. Seven historical dispatches remain `uncertain`; they must be reconciled with provider truth before any blind retry. |
| Upload as unlisted | Delivered | Omar's configured visibility is unlisted with manual release. |
| Exact scheduled publication | Not yet proven | Do not declare this from a queue record. It requires connector readback of channel, video ID, visibility and publication time. |

## Deployments

| Environment | Status | Explicit boundary |
| --- | --- | --- |
| Omar — `tutorials.axtrelis.com` | Live | Web, worker and Drive uploader run the current release. AI thumbnails are off. The separate uploader exchange was not restarted or reconfigured. |
| VPS2 — `167.233.145.218` | Private web-only staging | Database, Redis and web are healthy on loopback port 3118. Workers, Drive writes, YouTube, retention and VeoForge are disabled to prevent Omar/Schreiner tenant crossover. |
| `tutorials.schreinercontentsystems.com` | Not public | DNS is not yet pointed to VPS2. Public cutover still needs authoritative DNS access and a controlled shared-Caddy restart window. |

## Remaining prioritized closure work

1. Reconcile the seven uncertain uploader receipts against YouTube and then run
   one unlisted canary with exact provider readback.
2. Deploy and evaluate the separate Keyword Tool candidate with a labelled
   commercial-quality benchmark instead of judging it by generated volume.
3. Configure VPS2's own Drive root, channel mappings and VeoForge/mini-PC tunnel;
   then enable services one at a time behind health and tenant-identity checks.
4. Replace or clean the uploaded HubSpot source logo, whose transparent canvas
   still produces narrow dark edge pixels in one archetype.
5. Move Omar's proven Drive credential into the Admin vault only after a
   read/write canary confirms identical account and folder identity.
