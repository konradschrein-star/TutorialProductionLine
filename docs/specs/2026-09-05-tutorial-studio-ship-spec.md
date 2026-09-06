# Tutorial Studio Ship Specification

Captured verbatim in substance from the product-owner walkthrough on 2026-09-05. This document is the acceptance specification for the final Tutorial Studio pass before customer handoff.

## Product-owner request

I’m right now in the Tutorial Studio. Let’s go through it.

- The Dashboard tab looks good.
- The Create tab also looks good.
- The Studio tab also looks good.
- The Upload tab also looks decent. The uploads are all okay and make more sense than last time. Have a sub-agent audit it again.
- The Review tab looks good. Add keyboard shortcuts:
  - `W` for approve (the top/primary item)
  - `E` for not approve
  - `R` for delete
  - `Q` for approving
  - The upper actions should allow rapid approval triage.
- Generate multi-language thumbnails before generating the localized videos in the selected languages. For a tutorial, automatically generate five thumbnails for the selected languages. Make all language-thumbnail previews larger and clearly visible because AI-created text can contain mistakes.
- In the Localized tab, the localized version is generated with text-to-speech and everything else required.
- The Keywords tab still looks okay.
- The Settings tab looks good.
- Rework the Thumbnail Studio grid. The first column should always be the English thumbnail; following columns should contain the other language versions of the same thumbnail. The columns may be horizontally scrollable. This should make all localized thumbnails easy to compare.
- In the Composer, choosing one logical tutorial/video must clearly represent its multiple translations. Changes to the base thumbnail should propagate automatically to all localized thumbnails, while manually moved objects remain editable per thumbnail/language.
- Rotation and off-canvas positioning work now. Ensure objects visibly clip/disappear when moved outside the thumbnail canvas, and that the exported result includes only the canvas area.
- Backgrounds must be selectable by clicking them in the Backgrounds asset tab.
- Add Settings controls for which backgrounds and personas participate in random rotation.
- Disable these backgrounds from rotation by default: Neutral Gray, Royal Purple, French Green, Warm Sunset, Soft Blue, Dark Slate.
- Keep these four backgrounds enabled in rotation by default: Modern Minimal Tech, Neon Glow Studio, Dark Corporate Slate, Abstract Gradient Blue.
- Improve persona green-screen removal: remove green fringing at the edges and smooth/defringe the cutout boundary.
- Users must be able to add logos, personas, symbols, and backgrounds directly. Uploaded assets must persist across sessions so the VA builds a reusable library over time.
- Asset libraries must load dynamically/paginate or virtualize instead of loading every asset at once as the library grows.
- A selected tutorial must expose all selected language thumbnail versions before localized videos have been rendered. The thumbnail stage comes before localization/quality review for manually composed thumbnails. For AI-generated thumbnails (Nano Banana 2 / configured AI generator), the manual human-in-the-loop stage may be skipped.
- Regenerate/backfill all existing tutorial thumbnails so no eligible existing tutorial is missing its manual thumbnail set.
- In the main Tutorial Studio tabs, put Thumbnail Studio before Review. Put Uploads after Localized. Put Keywords immediately before Create.
- Fix the sidebar’s Delivery & Uploads navigation and any intermittent sidebar navigation failures.
- Thumbnail Studio must also be a tab inside Tutorial Studio.
- Fix the Thumbnail Studio Videos tab: after selecting a video and returning, the complete eligible video list must still appear rather than only the selected video.
- Fix the Thumbnail Studio Library filters/dropdowns for Channels and Status so they render above thumbnails and the library works end to end.
- On Channels, allow opening both the public YouTube channel and YouTube Studio. Provide clear hover/action buttons; YouTube Studio opens in a separate tab and works for a locally signed-in operator.
- Per channel show:
  - scheduled video count
  - uploaded video count
  - verified uploaded video count, reconciled against YouTube
  - a red discrepancy alert when internal and YouTube counts differ
- Accounts currently appear miscounted. Add useful per-account metrics:
  - total time online
  - done videos
  - active videos
  - videos being worked on right now
  - live online/offline status
  - Keep role and status. Do not add total thumbnails generated.
- Create viewer logins so a prospective customer can view the entire product safely and judge whether it fits his operation. Viewer access must be read-only.
- Google Drive deliveries must always be neatly structured and correctly labeled for reliable uploader API consumption.
- Model uploader lifecycle/status callbacks explicitly:
  - `waiting_to_be_uploaded`
  - `uploading`
  - scheduled confirmation includes the scheduled publication time
  - once uploaded/scheduled, retain the scheduled state and time
  - when YouTube makes the video public, automatically transition to `uploaded`/public state
  - persist visibility/mode: `scheduled`, `public`, `private`, or `unlisted`

After these improvements, the Tutorial Studio should be ready to ship and the customer’s viewer login credentials should be ready for handoff.

## `/go` command

Use this after `/go`:

> Finish and ship the Tutorial Studio according to `docs/specs/2026-09-05-tutorial-studio-ship-spec.md`. Work autonomously through the entire acceptance specification: audit the existing implementation, preserve working behavior, implement every incomplete item, add migrations/backfills where needed, verify with targeted tests plus a production build and browser walkthrough, prepare a read-only viewer login for customer handoff, and document deployment/configuration plus any credentials that must be supplied securely. Continue until the acceptance criteria are genuinely complete; do not stop at planning or partial scaffolding. Never commit real secrets or fabricate successful external Google Drive/YouTube verification when credentials or live services are unavailable—implement and test the integration boundaries, then report only the exact remaining external step.
