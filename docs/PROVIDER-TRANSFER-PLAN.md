# Provider and voice continuity — reviewed names-only migration plan

Update: a narrow EN/DE parity patch now exists in
`configured-voice-default.ts`, called by tutorial generate and translate.
It preserves valid explicit/native choices and matching channel bindings before
resolving DEFAULT_VOICE_EN/DE as exact active, same-language/provider voice rows.
Missing German configuration fails instead of choosing English. No arbitrary
provider switch, AI33 legacy alias mapping, or other-locale fallback was added.
24 offline tests and worker TypeScript build pass. These are later source changes:
candidate3 must not be assumed to contain them; a reviewed candidate4 build is
required. No runtime provider values were copied or voice synthesis invoked.

Audited read-only on 2026-09-08. Source: SSH alias `cf-vps-deploy`,
`/opt/content-forge/.env`. Target: alias `vps2`,
`/opt/tutorial-recovery-staging/runtime.env`. Server-side extraction printed
assignment **names only**, never values. No provider calls, credential transfer,
endpoint changes, network changes or modifications to secure-selective-bundle.ts.
Presence of a name does not establish a nonempty/valid credential.

Target runtime currently contains only CF_API_TOKEN, JWT_SECRET, NODE_ENV,
SECRETS_ENCRYPTION_KEY, STORAGE_DRIVE_ENABLED, TUTORIAL_AUTOMATIC_DELIVERY_RECOVERY_ENABLED,
TUTORIAL_PUBLICATION_RECOVERY_ENABLED, TUTORIAL_RETENTION_ENABLED. Therefore provider
continuity is not yet configured. Compose additionally supplies isolated DB/Redis,
media roots and disables Drive/recovery. No worker is defined.

## Exact names and decisions

| Names | Source names present | Runtime meaning / transfer decision |
|---|---|---|
| FISH_API_KEY, ELEVENLABS_API_KEY, AI33_API_KEY, AI33_API_KEY_2, DEEPSEEK_API_KEY, GEMINI_API_KEY | All | Existing credential allowlist covers these. Keep identities unchanged during the user-authorized migration, using the protected transfer mechanism. |
| ANTHROPIC_API_KEY | Yes | Existing allowlist; configured but intentionally not routed by policy. Preserve does not authorize enabling it. |
| OPENAI_API_KEY, INWORLD_API_KEY, INWORLD_BASIC_AUTH, MINIMAX_API_KEY | No | Existing allowlist, but no source .env assignment observed. Do not fabricate or require them; separately check selected encrypted-secrets presence by name only. |
| CLAUDE_POOL_URL, CLAUDE_POOL_API_KEY | Both | Actual tutorial LLM runtime reads; omitted from current allowlist. Credential transfer and endpoint mapping are separate decisions. Tutorial calls /v1/run with consumer=tutorial. |
| GEMINI_POOL_URL, GEMINI_POOL_API_KEY | Both | Actual canonical Gemini pool reads; omitted from current allowlist. Multiple callers have differing defaults; explicitly map the deployed endpoint. |
| GEMINI_DIRECT_API_KEY, GEMINI_DIRECT_MODEL, GEMINI_PRIMARY | All | Actual pool/direct routing and model policy. Preserve together, including free-tier model restrictions; do not silently change pool preference. |
| FISH_TTS_MODEL | Yes | Shared Fish client supports it. Tutorial Fish implementation deliberately forces s2.1-pro-free, so transferring this cannot override tutorial policy. |
| FISH_API_BASE, FISH_FREE_TIMEOUT_MS, FISH_FAILOVER_DAILY_BUDGET_USD | No | Supported Fish runtime knobs; absent source assignment means preserve existing defaults unless an explicit later decision changes them. |
| TUTORIAL_FISH_VOICE, TUTORIAL_MINIMAX_VOICE, TUTORIAL_MINIMAX_FALLBACK_VOICE, TUTORIAL_INWORLD_VOICE, TUTORIAL_KOKORO_VOICE | No | Supported provider-specific tutorial voice fallbacks. Do not invent migration values. Preserve DB/channel/job choices first. |
| DEFAULT_VOICE_EN, DEFAULT_VOICE_DE | Both | Config schema supports voice-row UUIDs, not raw provider voice strings. Implemented by the new narrow EN/DE helper and both tutorial callers; pending inclusion in candidate4. |
| FISH_DEFAULT_VOICE_ID, TTS_FORCE_ENGINE, TTS_PRIORITY_TUTORIAL_STUDIO | No | Supported shared TTS gateway behavior, separate from tutorial provider selection. No new defaults during migration. |
| TTS_MAX_CONCURRENT | Yes | Actual shared TTS concurrency knob; not a credential. Preserve as reviewed operational config, subject to target capacity. |
| GEMINI_FALLBACK_API_KEY, GEMINI_FALLBACK_MODEL, GEMMA_API_KEY, GEMMA_MODEL, OPENROUTER_API_KEYS, OPENROUTER_MODEL, NVIDIA_NIM_API_KEYS, NVIDIA_NIM_MODEL, GROQ_API_KEYS, GROQ_MODEL | No | Supported tutorial fallback names, but absent source .env assignments. Do not map unrelated similarly named keys automatically. |
| OLLAMA_URL, OLLAMA_MODEL, LLM_PROVIDER | All | Supported broader LLM routing. Endpoint requires network decision; imported tutorial provider/model settings remain authoritative. |
| AI33_API_KEY_BACKUP | Yes | No active target read found; catalog prose mentions it but runtime uses AI33_API_KEY_2. Both source names exist. Never overwrite _2 with BACKUP without secure on-server comparison and an explicit alias policy. |
| AI33_VOICE_EN, AI33_VOICE_DE, CLAUDE_POOL_MODEL | All | No active target runtime read found. Preserve as unapplied source configuration metadata; do not pretend copying restores behavior. Actual Claude model/account policy is pool-side, not this unused env name. |

Adjacent source services also have EDGE_TTS_API_URL/KEY, GOOGLE_VERTEX_API_URL/KEY,
GEMINI_MULTIMODAL_POOL_URL/GEMINI_MM_POOL_API_KEY, NIM_API_KEY and many VEO/VUP/media
endpoint names. These are NOT an instruction to copy every content-format secret.
Only migrate those required by the selected tutorial/thumbnail routes after their
exact consumers and endpoint scopes are reviewed. In particular NIM_API_KEY is not
the tutorial registry's NVIDIA_NIM_API_KEYS name.

## Source/target behavior evidence

- Target tutorial TTS resolves keys through getSecret: encrypted_secrets first,
  then same-name environment. A stale encrypted row can override a correct env
  value; undecryptable rows do not safely fall back. Never import ciphertext under
  a newly generated unrelated SECRETS_ENCRYPTION_KEY. Use separately reviewed
  server-to-server decrypt/re-encrypt under the target key, or leave rows absent
  and use the explicitly selected environment fallback.
- Preserve tts_voices IDs, provider identifiers and provider voice IDs,
  channels.voice_id, tutorial_settings defaults, per-job voice and voice settings.
  Copying API keys alone does not preserve accent, language, speed or speaker.
- Source contains utils/tutorial/voice-language.ts, not copied wholesale into this candidate.
  Its comments describe DEFAULT_VOICE_EN/DE as row-ID resolution. This is a
  parity-review finding, not proof that every source tutorial execution uses it.
  Actual source DEFAULT_VOICE_EN/DE call sites were found in the content lane; the new tested tutorial fallback now extends those row-ID semantics without replacing
  valid explicit job voices or channel bindings.
- Target tutorial Fish primary model is hardcoded s2.1-pro-free; generic Fish
  calls consult FISH_TTS_MODEL. Preserve this distinction and failover budget.

## Network mapping is a deployment prerequisite

### Existing HTTPS pool routes verified — preferred, no new SSH account

A subsequent read-only audit of 72 proxy configuration documents and 33 container
label sets found existing TLS443 locations on hub.schreinercontentsystems.com:

| Explicit target variable | Verified HTTPS base (no trailing slash) | Source routing |
|---|---|---|
| CLAUDE_POOL_URL | https://hub.schreinercontentsystems.com/claude | /claude/ proxies to 127.0.0.1:8092/ |
| GEMINI_POOL_URL | https://hub.schreinercontentsystems.com/gemini | /gemini/ proxies to 127.0.0.1:8090/ |

Both proxy_pass targets have a trailing slash and preserve suffix routing by
replacing the location prefix. Thus /claude/v1/run reaches upstream /v1/run and
/gemini/v1/chat reaches /v1/chat. Candidate tutorial llm-registry, shared llm-client,
canonical Gemini client and Hub Gemini client append these suffixes to their base
strings; they do not discard the configured prefix with an absolute URL join.
Use the bases above without a trailing slash to avoid double slashes.

Source middleware/code inspection confirms Claude accepts x-api-key or Bearer
Authorization and compares CLAUDE_POOL_API_KEY. Gemini's FastAPI x_api_key Header
parameter accepts x-api-key and compares its pool-local GEMINI_API_KEY. A
server-memory comparison proved the source Content Forge CLAUDE_POOL_API_KEY and
GEMINI_POOL_API_KEY respectively match the running pool credentials; only presence
and equality booleans were emitted. This does not rename the Studio GEMINI_POOL_API_KEY
to GEMINI_API_KEY; those two programs intentionally use different variable names.
No provider key values or response payloads were printed.

TLS-verified read-only GETs of /claude/health and /gemini/health returned200 through
the existing public routes. Source code identifies these as liveness/in-memory
status snapshots, with no generation. This verifies transport and prefix routing,
not successful generation or account readiness. In particular **do not use
/claude/v1/selftest as a harmless health probe**: its source explicitly launches
claude -p. No generation/selftest was requested.

Prefer these existing HTTPS routes and same keys over creating a new forwarding
account. The unactivated pool-tunnel draft is now an optional fallback only.
Target application containers still need reviewed outbound TLS access to this
existing host; the staging internal network currently prevents that. No firewall,
network, endpoint or runtime configuration was changed by this audit.

The staging Docker network is internal:true. It intentionally prevents ordinary
external egress; importing keys will not make public provider APIs work.
127.0.0.1 inside a container is that container, not VPS2 and not the source VPS.
Source-host loopback pool URLs therefore must never be copied as working routes.
Selected endpoint routing classes were subsequently inspected only in server memory; the sanitized results are below.

Choose and verify one explicit production topology per selected pool:

1. Retain source pool and reach it through an authenticated private network/tunnel
   or protected reverse proxy, with explicit source access controls.
2. Migrate that pool and its account/session dependencies as its own scoped
   service, then use its Docker service DNS name on an approved shared network.
3. If a pool genuinely runs on VPS2's host, use an explicitly configured host
   gateway or private host address. host.docker.internal is not automatically
   available on Linux and does not identify the old source VPS.

Do not remove internal:true from staging merely to make a test pass. Future
production egress needs explicit network/firewall policy. Keep DB/Redis internal;
allow only reviewed application/provider paths. No pool generation/paid probe occurred in this audit. Controlled end-to-end tests remain part of the user-authorized migration; a health/TCP check alone is not proof of voice parity.

## Secure execution plan — not executed

The user already authorized preserving/transferring existing credentials and normal
in-scope deployment. This is an implementation/security checklist, not a new
approval request. Exact endpoint mapping and test containment must be resolved
before activation.

1. Use the separate `scripts/migration/provider-runtime-transfer.ts` helper,
   which reuses the existing protected-path/fingerprint primitives without editing
   the agent-owned selective bundle implementation. Its explicit exported allowlists
   separate credentials, supported settings and endpoints. Legacy aliases are rejected.
2. Inventory selected secret *names/presence* in encrypted_secrets without printing
   ciphertext, plaintext or provider responses. Reconcile env/DB precedence.
3. Read selected values only on protected Linux hosts; explicit source and target
   paths, owner-only temporary directory0700 and files0600, exclusive creation,
   no symlinks/hardlinks, no shell tracing, no env command/dump, no values in argv,
   Git, OneDrive, tool output, browser or logs. Existing private-bundle primitives
   already enforce much of this; do not create a second weaker exporter.
4. Transfer over authenticated SSH directly to the protected target. Verify file
   checksum and selected-name count only. Merge into a fresh protected candidate
   config without overwriting target DB, Redis, session/encryption identities,
   kill switches, or any unrelated service configuration.
5. During migration rehearsal, keep all workers/dispatch/retention disabled. Compare resolved voice rows and
   model/routing decisions using synthetic text and no provider invocation.
6. Build a new image containing any parity patch, then run a bounded, controlled production test under the existing user mandate. Do not claim a previously built candidate includes
   later code. Preserve a rollback plan and private source snapshots.

### Code-only provider helper verification

The helper is not a CLI and never implicitly reads process.env or activates files.
A source-side wrapper supplies its already-loaded environment and an explicit list
of names in memory. Export files are exclusively created under the existing
Linux-only protected migration directory rules (0700 parent, 0600 file); receipts
contain only SHA256, byte count and selected count. Reads verify SHA, ownership,
single-link regular files and descriptor stability. Merging consumes a private,
hash-verified copy of the target runtime and exclusively creates a new candidate.
Target DB/Redis/session/encryption identities remain unchanged. Drive, retention,
cache eviction and recovery guards are forced false.

Source loopback URLs require an explicit per-variable target mapping; even mapped
loopback addresses are rejected, including localhost trailing-dot forms and IPv4-
mapped IPv6. This is syntactic protection, not DNS/network attestation: root must
still review the protected connection and its access policy. Unsupported aliases,
unknown names, controls/multiline values, endpoint userinfo/query/fragment and
ambiguous env syntax fail closed. The rendered Compose env_file uses single quotes
to preserve literal dollar signs. Literal apostrophes or backslashes are rejected
instead of changing secret bytes; those uncommon values require a separately
reviewed raw env_file format, never silent escaping or shell sourcing.

Synthetic verification passed 38 pure checks and 10 Linux private-file checks in
an existing candidate3 container with network disabled and scripts mounted
read-only. The tests cover guard/identity preservation, mapped endpoints, SHA
tampering, exclusive output, symlinks, hardlinks and unsafe parent/file permissions.
No credentials were exported, transferred or activated. Mounting this source for
tests does not mean candidate3 contains the new helper or later voice patches.

## Sanitized source endpoint classification

A read-only server-side parser emitted only variable name, routing class, protocol
and port. No endpoint host, path, userinfo, query, token, or value was output.
No DNS lookup or provider/network request was made. Hostname classification would
be syntactic rather than proof of reachability; all present selected values here
were loopback.

| Variable | Routing class | Protocol | Port |
|---|---|---|---|
| CLAUDE_POOL_URL | loopback | http | 8092 |
| GEMINI_POOL_URL | loopback | http | 8090 |
| GEMINI_MULTIMODAL_POOL_URL | loopback | http | 8094 |
| OLLAMA_URL | loopback | http | 11434 |
| EDGE_TTS_API_URL | loopback | http | 5051 |
| FISH_API_BASE | unset | — | — |

These pool addresses cannot work by verbatim transfer to a VPS2 container.
Use the reviewed source-private tunnel/proxy or migrate the selected pool service;
changing only the hostname to a Docker host gateway would point at VPS2, not the
source machine. Edge TTS was inventoried only; this is not approval to enable an
unsupported/banned production provider.
