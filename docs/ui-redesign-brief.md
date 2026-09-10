# Tutorial Studio: production workspace redesign

User correction, 8 September 2026: the old UI is not a preservation requirement.
Working API contracts, account boundaries, exact-revision approvals, recording
continuity and customer assets are preservation requirements.

## Design direction

Calm, neutral, Notion-style operational workspace. Existing React/Next, theme
tokens and TanStack table/virtualization dependencies; no replacement framework.
Design variance 3/10, motion 2/10, table density 8/10. Media inspection remains
spacious: density is not permission to shrink thumbnail text or video previews.
One navigation rail, coherent light/dark contrast, low visual decoration.

Installed user-requested skills: nextlevelbuilder/ui-ux-pro-max-skill and
Leonxlnx/taste-skill. UI/UX Pro Max's initial design-system search returned a
marketing hero pattern; the product-specific retry had no match. That pattern
was rejected, not persisted as a design decision. Applicable accessibility,
focus, virtualization and navigation guidance informs implementation. Taste's
current instructions explicitly exclude dashboards/data tables/multi-step UI;
no marketing hero, carousel or decorative motion is being forced into this app.

## Acceptance checks

- All tutorials is a first-class destination, not hidden below dashboard cards.
- Server-filtered originals, expandable locale rows, bounded incremental loading.
- Admin sees team filters; VAs see authorized work only.
- Thumbnail matrix: tutorial rows, language columns, comfortable/large media,
  stable row context, visible row approval, large editor and clear edit scope.
- Final review: selected English original, large player, locale readiness,
  discoverable keyboard controls with typing/repeat/modal guards.
- Languages: independent state and recovery, readable labels, no all-or-nothing
  presentation or false inference that COMPLETED means current media verified.
- Navigation is not repeated as a wall of primary-looking buttons.
- Loading, errors, empty results, focus visibility and both themes are verified.

## Migration clarification

English originals are the preservation priority. Missing translated material can
be regenerated and is not a cutover blocker. This does not authorize deleting
existing translations or inferring English from records with unknown language.
Drive is permanent storage, VPS media is a bounded working cache. Existing OAuth
matches the requested account and has about 4.16 TiB free; new archive writes still
require folder/access and revision verification.

## Local verification, 8 September

- First integrated production build passed; Hub suite: 503 passed, 64 skipped.
- Real browser, local VA account: library search narrowed to two pilot originals;
  expanding an original loaded its four language rows; next page increased the
  loaded originals from 25 to 50.
- Thumbnail comfortable/large controls changed actual preview dimensions;
  German edit opened the German locale and locale-only edit scope.
- Review shortcut opt-in enabled R to open rework and focus the reason field.
  Typing `qrjk` in that field remained text, not actions. Rework was cancelled;
  no publication or provider request was sent.
- Dark-mode language/review/library surfaces were readable. At 390×844,
  language controls and compact workspace navigation wrapped without clipping.
- Compact second-pass production build passed; Hub suite: 506 passed, 64 skipped.
  At 1280×720, the thumbnail canvas begins near y313 and the selected review
  player and decisions are visible on the first screen. Review root/locale
  links and targeted language state lookup were verified in the browser.
- J/K navigation was verified on the compact review. The 390×844 library
  shows readable title/stage rows with expandable details, not a squeezed
  eight-column table. Temporary viewport overrides were reset.
- Final copy correction: queued/cancelled/recording records must not claim
  "Review pending"; only completed originals awaiting a decision show it.

## Remaining operational gates

The local preview intentionally has no live providers, Drive uploader or
publication workers enabled. Its Keyword Tool SSO/embed configuration now targets
the isolated frontend at localhost:17878. That frontend built successfully in a
separate output directory, but the execution policy rejected its startup before
process creation; it is NOT listening. No alternate launch/bypass was attempted.
The synthetic SSO backend at localhost:17877 remains running. Standalone local
Keyword Tool contract pilots exist separately; this embed still needs verification.
Backend-only SSO checks passed: existing VA identity, authenticated board access,
rejection of invalid/expired tokens and anonymous access. The existing five
keywords, three creation intents and two job bindings were preserved.
Preparing a real script from this preview is not an end-to-end production test.
Production credential continuity, Drive-first preservation, final VPS2 image,
hostname/TLS and team cutover still require completion and verification.

The clean Linux image `tutorial-recovery:20260908-candidate4` built successfully
(config SHA256 `da793c4318bf944e6aaa819cbff84d6ca1e9ce89cad4c0b358dcbcc1314e4cb1`).
A read-only, network-disabled smoke test ran as UID1000 and rendered a
1920×1080 PNG with Sharp. A filename scan outside dependencies found no .env,
private-key, credential/token JSON, MP4 or database-dump files. This is a limited
artifact hygiene check, not a complete security audit. The image has not been
deployed to VPS2. Worker tests: 476 passed, one skipped. Storage tests:239 passed.

These are local fixture checks, not a production cutover or a claim that every
backend/migration specification is complete. Live source services remain intact.
