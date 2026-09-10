# Channel groups and delivery settings

Local implementation; no production account deletion, regrouping, upload, generation, or migration performed.

## Configuration ownership

`channels` remains the destination identity. `voice_id` remains the existing FK to tts_voices; all configured languages are loaded, not a hardcoded four-language list. `metadata.tutorialChannelProfile` adds an explicit primary parent, future-translation enablement (false by default), translation method, thumbnail mode, selected host/image IDs, public channel URL, non-secret account label, and independently scoped prompt overrides. Existing metadata, users, assets, channel IDs and job assignments are preserved.

Admin-only `/api/production/channel-groups` provides the inventory and guarded updates. Saves require the exact updatedAt revision; grouping edits serialize and reject cycles, duplicate language destinations, invalid voice language, inactive hosts, and foreign host images. New channels require their actual YouTube UC identifier and begin disabled. Unassigned historical translated channels are shown separately; never guess their parent from a shared language or name.

`ChannelGroups` is mounted by the root agent in Settings. Translation and thumbnail consumers are coordinated with their owning agents; a stored field is not proof the runtime consumed it. Blank prompts inherit existing global configuration. New settings do not retroactively mutate approved assets, change schedules, or trigger a historical backfill.

## Deployment data review

No new database columns are required. Back up each installation independently. Admin must explicitly map each existing translated destination to its correct primary, select its existing voice, and enable only intended languages. Existing channels without a profile do not authorize new automatic translations. Keep Omar assets/accounts distinct from VPS2. An uploader mapping is not a YouTube login; account sessions must be connected in the existing custom uploader, not by pretending an API key grants channel access.

Delivery settings now identify the custom uploader. The channel weekly plan is authoritative for publication time, timezone and capacity. Legacy fallback fields are advanced controls, not another calendar. Future scheduled publication remains private until its exact publish time; ordinary unlisted upload remains distinct. Enabling live mode does not release the manual hold. Changing transport labels requires checking the separate uploader accepts `custom_uploader`; do not enable a connector merely by editing its label.

## Credential and retention clarity

Fish Audio edits use the existing encrypted FISH_API_KEY slot. Its Test action checks Fish account authentication without generating speech. Other provider cards no longer run the Fish/DeepSeek test and falsely imply they tested a different provider. Saved credentials remain Admin-only and never displayed in plaintext. Full provider-specific live tests beyond existing Fish/DeepSeek/Drive require explicit adapters, not invented green status.

Incoming file size is explicitly GiB. Fallback age retention does not authorize cleanup by itself. Exact Drive preservation and publication proof, leases and source checks remain prerequisites. No retention worker or deletion runs from saving Settings. Existing Drive folder identity must be explicitly reviewed per installation; no silent move from _Tutorials into a guessed Omar folder is performed.
