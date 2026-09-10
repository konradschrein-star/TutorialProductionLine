# Live-capable uploader with the existing queue held

Local implementation only; no settings changes or uploads performed by this slice.

Deployment must retain `requireManualRelease: true` while setting the reviewed uploader section to `enabled: true`, `executionMode: "live"`, `defaultVisibility: "unlisted"`. Preserve all other existing uploader settings. This is a reviewed configuration change, not an automatic migration: do not globally enable live uploads in a schema migration. Existing explicit visibility settings are not overwritten by the schema default.

Generic scheduled-delivery admission now checks this hold using the same transaction's share-locked settings row, before dispatch persistence. Already-claimed replay and receipt reconciliation remain available. Discovery endpoints remain inspection-only. Disabling the global manual-release hold can admit eligible queued requests: do not use that switch as a per-video release button. Existing external workers must also honor their own manual-release control; Studio cannot retract external uploads already started.

Ordinary upload default is unlisted. A future scheduled YouTube publication remains private until publish time; the scheduled contract is unchanged and Settings explains the distinction.

Settings credential slots now map real tutorial runtime names, including optional writing/voice/image providers previously hidden by null catalog key slots. All editing continues through Admin-only `/api/credentials` and encrypted_secrets. Presence is not credential validity; no secret values were exposed. Root is separately wiring encrypted-key resolution for environment-only worker providers.

Omar read-only presence audit (2026-09-09): DEEPSEEK_API_KEY and FISH_API_KEY exist in encrypted storage and both live process environments; GEMMA_API_KEY exists in worker/web environment only; GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, GOOGLE_DRIVE_REFRESH_TOKEN exist in worker/web environment only. Optional OpenAI, ElevenLabs, Google TTS, Inworld, Gemini fallback, AI33 primary/backup, MiniMax, Qwen, Claude pool, Gemini pool, OpenRouter, NVIDIA NIM, Groq, Gemini image and VeoForge keys were absent from both those environments and encrypted storage. UPLOADER_CALLBACK_SECRET also absent: do not claim generic authenticated uploader integration is connected until an approved shared token is configured on both sides. No credential values were read into output.

Focused verification: 14 tests across admission-safety, discovery-safety and scheduled-routes. Contracts TypeScript build passed. No Next build or service restart performed.
