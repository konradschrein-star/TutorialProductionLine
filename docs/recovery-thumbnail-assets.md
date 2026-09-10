# Thumbnail asset and headline recovery

Implemented locally; no artwork generated, no provider calls or deployment performed.

## VA procedure

1. Open a tutorial's thumbnail editor, then Custom. Enter the exact software name
   (for example `Notion`) and upload its logo. Otherwise the filename becomes its name.
2. Search finds shared assets across the server library, not only the first page.
   The newest logo with the longest matching software name is preferred. Matching
   uses whole words in the English tutorial title, not arbitrary substrings.
3. Automatic logo layers in unapproved, non-overridden drafts pick up the current
   library logo on opening or the editor's next ten-second refresh. This resolves
   against the library rather than rewriting rendered images in the database.
4. Approved images, explicit locale overrides, manually selected logos and legacy
   layouts without an automatic-logo marker are preserved. Selecting a logo
   manually replaces the automatic layer and opts that layer out of propagation.
5. An unknown software logo is explained in the editor: upload one, choose one,
   or remove its empty layer when a logo is unnecessary. Existing image decoding
   and font-fit validation still run before export and approval.
6. For an empty headline, Generate / retry headline submits a bounded background
   task using the existing configured provider. A failed retained job is retried;
   an active task is not duplicated. Existing or partially written operator copy
   and selected thumbnails are never cleared. Complete those lines manually.
7. If the queue is unavailable, work remains intact; enter both lines manually or
   retry later. A running configured worker is necessary for automatic generation.

## Verification

- 24 scoped Hub tests passed: logo matching, propagation protection, export/font
  checks, layout inheritance, and seven headline retry route cases.
- Headline cases include ownership rejection, partial-copy and selected-image
  preservation, bounded first enqueue, retained failure retry, duplicate active
  requests and actionable queue outage. Mocked queue: no paid calls.
- Thumbnail image bytes and subject listings require job ownership, Admin or
  explicitly assigned uploader-channel access; manage:thumbnails alone does not
  grant network-wide access. Three image route access tests pass.
- Hub TypeScript check passed after implementation; browser propagation and
  actual provider-quality checks remain required in the integrated pilot.

## Limits

Software association currently uses the source title; it is not a separate
canonical software-ID registry. Background and character assignment remains the
existing per-layout/per-language behavior. No old assets, voices or keys changed.
