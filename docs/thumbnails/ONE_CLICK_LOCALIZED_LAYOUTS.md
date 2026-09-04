# One-click localized layout thumbnails

## What existed before

The original non-generative thumbnail workflow is preserved in this repository:

- `528bb972` introduced the browser layer compositor: background, presenter,
  logo, symbols, and editable text layers.
- `e6957b8b` added a one-click multilingual ZIP.
- `64cfa81c` ported the compositor into the production Hub.

The old batch button was only a prototype. It swapped fixed phrases into one
live React canvas, waited 250 ms, and downloaded a ZIP. It did not use the
translated tutorial jobs, did not change presenter by language, silently used
English placeholder copy, and did not attach thumbnails to upload jobs.

The separate Nano Banana/reference-image path is not part of this workflow.

## Current contract

The manual compositor is now a job-bound production tool:

1. A producer clicks **Translate standard** in Tutorial Studio. Automatic fanout
   is locked to the five codes in `DEFAULT_STANDARD_LANGUAGES`; a stale browser
   preference or direct automatic request cannot expand that set. Other catalog
   languages remain explicit one-at-a-time actions.
2. The translation worker creates a durable child job per language and produces
   localized title, description, tags, narration, and two thumbnail lines.
3. The producer opens **Thumbnail pack** on the source tutorial.
4. The existing visual layout is reused across all five variants. Each render
   receives its own localized copy and the configured language presenter. Text
   is measured and reduced to fit its box.
5. **Attach all 5 to jobs** renders every image before sending the first one.
   Each image is normalized server-side to a 1280x720 JPEG, persisted as a
   `thumbnail` row, and selected for that exact translated tutorial job.
6. The existing Drive scanner ships the selected thumbnail beside that job's
   video and metadata. The uploader's thumbnail gate remains the final barrier.

There is no English-copy fallback. A missing translation job, unfinished video,
missing final video, title, description, tags, either thumbnail line, presenter
asset, failed image decode, or failed render blocks the pack and is surfaced in
the UI.

## Production rollout

Apply `packages/db/src/migrations/0076_tutorial_thumbnail_copy.sql` before
deploying the worker and Hub. Existing tutorial rows keep `NULL` thumbnail copy
and therefore remain blocked until their metadata is regenerated; they are not
silently backfilled with a slogan.

The production branch currently defines the five automatic target languages as
German, French, Spanish, Japanese, and Korean (`de, fr, es, ja, ko`). The older
facade used a different set (`de, es, fr, pt, it`). Do not merge those lists.
Change the single production definition deliberately when the five channel
assignments are confirmed.

## Next integration seam

The uploader and TutorialProductionLine remain separate products. The selected
thumbnail, final video, and localized metadata are joined by tutorial job ID;
the Drive/job-exchange adapter is the boundary. The next slice should replace
the archive polling path with the versioned uploader job/receipt connector, not
import uploader internals into this application.
