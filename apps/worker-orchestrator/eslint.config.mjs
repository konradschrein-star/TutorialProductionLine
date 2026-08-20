import tsParser from "@typescript-eslint/parser";

/**
 * Import-boundary enforcement ONLY — no style rules.
 *
 * Provider clients (fastgen, forge, AI33, ElevenLabs, Minimax, Fish, Edge)
 * may be imported exclusively by their gateway. Format processors must go
 * through media-gateway / tts-gateway so priority, concurrency shaping,
 * failover, and spend reporting can't be bypassed. See docs/MEDIA_GATEWAYS.md.
 */

const MEDIA_CLIENTS = [
  {
    group: ["**/fastgen-client.js", "**/fastgen-client"],
    message:
      "Import from utils/media-gateway/index.js instead — provider clients are gateway-only (docs/MEDIA_GATEWAYS.md).",
  },
  {
    group: ["**/media-gateway/forge-client.js", "**/media-gateway/forge-client"],
    message:
      "Import from utils/media-gateway/index.js instead — forge-client is internal to the gateway.",
  },
  {
    group: ["**/media-gateway/vup-client.js", "**/media-gateway/vup-client"],
    message:
      "Import from utils/media-gateway/index.js instead — vup-client is internal to the gateway.",
  },
];

const TTS_CLIENTS = [
  {
    group: [
      "**/ai33-client.js",
      "**/ai33-client",
      "**/elevenlabs-client.js",
      "**/elevenlabs-client",
      "**/minimax-client.js",
      "**/minimax-client",
      "**/fish-client.js",
      "**/fish-client",
      "**/edge-tts-provider.js",
      "**/edge-tts-provider",
    ],
    message:
      "Use requestTTS()/withTTSSlot() from utils/tts-gateway.js — TTS provider clients are gateway-only (docs/MEDIA_GATEWAYS.md).",
  },
];

/**
 * Footage clients. The fence covered media and TTS but NOT footage, which is
 * why `utils/footage-gateway.ts` can declare a RANKING source policy
 * (`["yt-dlp", "pexels"]`, concurrency 60) that is dead configuration: the
 * ranking collector imports `searchYouTube` / `downloadYtClip` /
 * `searchDDGImages` directly and the gateway never sees the traffic. Nothing
 * failed, so nobody noticed the policy was fiction.
 *
 * Scoped to the VIDEO-ACQUISITION functions by name, NOT to whole modules. The
 * first draft of this fence banned the modules outright and immediately flagged
 * five files — but three of them were false positives doing something the
 * footage gateway does not and should not do: `source-transcript.ts` pulls
 * SUBTITLES via `fetchYouTubeSubtitles`, and `comparison-image-fetcher.ts` /
 * `image-ingest.ts` fetch STILL IMAGES. A fence that cries wolf gets switched
 * off, so it names the four functions that actually acquire footage clips.
 */
const FOOTAGE_CLIENTS = [
  {
    group: ["**/yt-dlp-client.js", "**/yt-dlp-client"],
    importNames: ["searchYouTube", "downloadYtClip", "searchAndDownloadClip"],
    message:
      "Use requestFootage() from utils/footage-gateway.js — footage clip acquisition is gateway-only, so the per-format source order and concurrency policy actually applies. (Subtitle helpers like fetchYouTubeSubtitles are NOT footage and are unrestricted.)",
  },
  {
    group: ["**/pexels-client.js", "**/pexels-client"],
    importNames: ["searchPexelsVideos"],
    message:
      "Use requestFootage() from utils/footage-gateway.js — Pexels VIDEO search is gateway-only. Photo search (searchPexelsPhotos) is image acquisition and is unrestricted.",
  },
];

export default [
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [...MEDIA_CLIENTS, ...TTS_CLIENTS, ...FOOTAGE_CLIENTS] },
      ],
    },
  },
  {
    // KNOWN VIOLATION, recorded rather than hidden.
    //
    // `ranking-footage-collection.ts` bypasses the footage gateway. It is NOT
    // a simple refactor: `requestFootage()` returns ONE result from a source
    // cascade, whereas the ranking collector must return a LIST of candidates
    // per item for the VA to choose between in the B-Roll Studio, each with a
    // filmstrip sprite. Routing it through the gateway as it stands today
    // would silently reduce the VA to a single take.
    //
    // Fixing it properly means teaching the gateway to return N candidates.
    // Until then this exception keeps the fence useful for every OTHER file —
    // a new processor cannot quietly acquire the same habit — while stating
    // plainly that this one file is outstanding. Do not delete this entry to
    // "fix the lint error"; delete it when the gateway grows multi-candidate
    // support and this import list is genuinely gone.
    files: [
      "src/processors/ranking/ranking-footage-collection.ts",
      // Same situation, found BY this fence: the TECH_COMPARISON lane's
      // footage-fetcher runs its own yt-dlp -> Pexels-video cascade, which is
      // the gateway's job. Recorded, not hidden.
      "src/utils/footage-fetcher.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [...MEDIA_CLIENTS, ...TTS_CLIENTS] },
      ],
    },
  },
  {
    // The footage gateway and its sources — the legitimate importers.
    files: ["src/utils/footage-gateway.ts", "src/utils/footage-sources/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [...MEDIA_CLIENTS, ...TTS_CLIENTS] },
      ],
    },
  },
  {
    // The gateways themselves — the only legitimate provider-client importers.
    files: [
      "src/utils/media-gateway/**",
      "src/utils/tts-gateway.ts",
      "src/utils/tts-provider.ts",
      "src/utils/tutorial/tts-registry.ts",
      // TODO(llm-router): llm-client uses fastgen's prompt endpoint for text;
      // moves into the LLM router in the next consolidation step.
      "src/utils/llm-client.ts",
    ],
    rules: { "no-restricted-imports": "off" },
  },
  {
    // Tests may mock provider clients by path.
    files: ["src/**/__tests__/**", "src/**/*.test.ts"],
    rules: { "no-restricted-imports": "off" },
  },
];
