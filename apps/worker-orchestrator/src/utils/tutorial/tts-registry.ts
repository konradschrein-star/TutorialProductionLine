import { createTTSProvider, type TTSProvider } from "../tts-provider.js";
import type { VoiceSettings } from "@repo/contracts";
import { generateFishTTS } from "../fish-client.js";

class GoogleTTSProvider implements TTSProvider {
  name = "google_tts";
  constructor(
    private apiKey: string,
    private settings: VoiceSettings = {},
  ) {}
  async generateChunk(text: string, voiceId: string): Promise<Buffer> {
    const langCode = voiceId.split("-").slice(0, 2).join("-") || "en-US";
    const audioConfig: Record<string, unknown> = { audioEncoding: "MP3" };
    if (this.settings.speed !== undefined)
      audioConfig.speakingRate = this.settings.speed;
    if (this.settings.pitch !== undefined)
      audioConfig.pitch = this.settings.pitch;
    if (this.settings.volume !== undefined) {
      // Map 0–2 range: volume=1 → 0dB, volume<1 → up to -20dB, volume>1 → up to +6dB
      audioConfig.volumeGainDb =
        this.settings.volume <= 1
          ? (this.settings.volume - 1) * 20
          : (this.settings.volume - 1) * 6;
    }
    const res = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${this.apiKey}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          input: { text },
          voice: { languageCode: langCode, name: voiceId },
          audioConfig,
        }),
      },
    );
    if (!res.ok)
      throw new Error(`Google TTS error ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { audioContent: string };
    return Buffer.from(json.audioContent, "base64");
  }
}

class ElevenLabsOfficialProvider implements TTSProvider {
  name = "elevenlabs_official";
  constructor(
    private apiKey: string,
    private settings: VoiceSettings = {},
  ) {}
  async generateChunk(text: string, voiceId: string): Promise<Buffer> {
    const body: Record<string, unknown> = {
      text,
      model_id: this.settings.model ?? "eleven_multilingual_v2",
    };
    const voiceSettings: Record<string, unknown> = {};
    if (this.settings.stability !== undefined)
      voiceSettings.stability = this.settings.stability;
    if (this.settings.similarity !== undefined)
      voiceSettings.similarity_boost = this.settings.similarity;
    if (Object.keys(voiceSettings).length > 0)
      body.voice_settings = voiceSettings;
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "xi-api-key": this.apiKey,
        },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok)
      throw new Error(`ElevenLabs error ${res.status}: ${await res.text()}`);
    return Buffer.from(await res.arrayBuffer());
  }
}

class TutorialElevenLabsAI33Provider implements TTSProvider {
  name = "ai33_elevenlabs_tutorial";
  constructor(
    private apiKey: string,
    private settings: VoiceSettings = {},
  ) {}
  async generateChunk(text: string, voiceId: string): Promise<Buffer> {
    const { generateElevenLabsTTS } = await import("../elevenlabs-client.js");
    // Map VoiceSettings → ElevenLabsTTSSettings
    // stability/similarity 0–1 → similarity param 0–4 (scale by 4)
    const rawSim = this.settings.similarity ?? this.settings.stability;
    return generateElevenLabsTTS(this.apiKey, voiceId, text, {
      speed:
        this.settings.speed !== undefined
          ? Math.min(1.5, Math.max(0.5, this.settings.speed))
          : undefined,
      similarity: rawSim !== undefined ? rawSim * 4 : undefined,
    });
  }
}

const AI33_V3_BASE_URL = "https://api.ai33.pro";

function ai33Sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * AI33 v3 TTS provider. Submits via the modern FormData endpoint
 * (Authorization header, prefixed voice ids), polls /v3/task, and downloads
 * the resulting audio. Works for any v3 voice prefix (kokoro_, minimax_,
 * elevenlabs_, edge_, clone_). Kokoro is local + reliable and anchors the
 * fallback chain while the AI33 ElevenLabs upstream is in outage.
 */
class Ai33V3Provider implements TTSProvider {
  name = "ai33_v3";
  constructor(
    private apiKey: string,
    private settings: VoiceSettings = {},
  ) {}
  async generateChunk(text: string, voiceId: string): Promise<Buffer> {
    const form = new FormData();
    form.append("text", text);
    form.append("voice_id", voiceId);
    if (this.settings.speed !== undefined) {
      const clamped = Math.min(1.5, Math.max(0.5, this.settings.speed));
      form.append("speed", String(clamped));
    }
    form.append("with_transcript", "false");

    const submitRes = await fetch(`${AI33_V3_BASE_URL}/v3/text-to-speech`, {
      method: "POST",
      headers: { Authorization: this.apiKey },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    if (!submitRes.ok)
      throw new Error(
        `AI33 v3 submit error ${submitRes.status}: ${await submitRes.text()}`,
      );
    const submit = (await submitRes.json()) as {
      success?: boolean;
      task_id?: string;
      message?: string;
    };
    if (!submit.task_id)
      throw new Error(`AI33 v3 submit failed: ${JSON.stringify(submit)}`);

    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      const taskRes = await fetch(
        `${AI33_V3_BASE_URL}/v3/task/${submit.task_id}`,
        { headers: { Authorization: this.apiKey } },
      );
      if (!taskRes.ok) throw new Error(`AI33 v3 poll error ${taskRes.status}`);
      const task = (await taskRes.json()) as {
        data?: {
          status?: string;
          error_message?: string;
          metadata?: { audio_url?: string };
        };
      };
      const status = task.data?.status;
      if (status === "done") {
        const audioUrl = task.data?.metadata?.audio_url;
        if (!audioUrl) throw new Error("AI33 v3 task done but no audio_url");
        const audioRes = await fetch(audioUrl);
        if (!audioRes.ok)
          throw new Error(`AI33 v3 audio download error ${audioRes.status}`);
        return Buffer.from(await audioRes.arrayBuffer());
      }
      if (status === "error")
        throw new Error(
          `AI33 v3 task failed: ${task.data?.error_message ?? "unknown error"}`,
        );
      await ai33Sleep(2_000);
    }
    throw new Error("AI33 v3 task timeout after 180s");
  }
}

class InworldTTSProvider implements TTSProvider {
  name = "inworld_tts";
  constructor(
    private apiKey: string,
    private settings: VoiceSettings = {},
  ) {}
  async generateChunk(text: string, voiceId: string): Promise<Buffer> {
    const res = await fetch("https://api.inworld.ai/tts/v1/voice", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Basic ${this.apiKey}`,
      },
      body: JSON.stringify({
        text,
        voiceId,
        modelId: "inworld-tts-2",
        audioConfig: { speakingRate: this.settings.speed ?? 1 },
        deliveryMode: "BALANCED",
        language: "AUTO",
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok)
      throw new Error(`Inworld TTS error ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { audioContent?: string };
    if (!json.audioContent)
      throw new Error("Inworld TTS: no audioContent in response");
    return Buffer.from(json.audioContent, "base64");
  }
}

/**
 * Fish Audio (https://fish.audio) — the default tutorial voice engine.
 * voiceId is a Fish model reference_id (e.g. Alok / F1). Delegates to the
 * shared fish-client so the global TTS gateway uses the same call path.
 */
class FishAudioTTSProvider implements TTSProvider {
  name = "fish_audio";
  constructor(
    private apiKey: string,
    private settings: VoiceSettings = {},
  ) {}
  async generateChunk(text: string, voiceId: string): Promise<Buffer> {
    return generateFishTTS(this.apiKey, voiceId, text, {
      // Default to 1.05 — a touch quicker than natural pace so tutorials feel
      // brisk without sounding rushed (2026-08-23, Konrad: "a teeny tiny bit
      // faster, like 1.05"). The Settings → Default Voice Settings speed slider
      // (or a per-job value) overrides this when set.
      speed: this.settings.speed ?? 1.05,
      // FORCE the free S2.1 Pro tier as primary (Konrad: "s2.1-pro-free is the
      // one we want to primarily use"). Hardcoded — NOT env-driven — so a stray
      // FISH_TTS_MODEL on the server (e.g. the old speech-1.6 in the .env
      // example) can't silently route tutorials to a paid/legacy model and
      // disable the free→paid failover. fish-client fails over to paid s2.1-pro
      // only if the free tier stalls past its window AND the daily budget allows.
      model: "s2.1-pro-free",
    });
  }
}

/**
 * Build the VA/operator-facing error thrown when every provider in the TTS
 * fallback chain fails. Leads with a plain-language, actionable summary and
 * separates real upstream errors from links that were skipped for lack of an
 * API key — so the job's error banner is useful instead of a raw dump.
 */
export function formatTtsChainFailure(
  errors: Array<{ provider: string; error: string }>,
): string {
  const isNoKey = (e: { error: string }) => /no api key/i.test(e.error);
  const failed = errors.filter((e) => !isNoKey(e));
  const skipped = errors.filter(isNoKey);

  const lines: string[] = [];
  if (failed.length > 0) {
    lines.push(
      'Voice generation failed — every available TTS provider errored. This is ' +
        'usually a temporary Fish Audio outage or stall. Click "Retry Audio ' +
        "Generation\" to try again; it should recover on its own.",
    );
    lines.push("", "Provider errors:");
    for (const e of failed) lines.push(`  - ${e.provider}: ${e.error}`);
  } else {
    lines.push(
      "Voice generation failed — no TTS provider was usable. None of the " +
        "fallback providers have an API key configured, so nothing could run. " +
        "Check the Fish Audio (FISH_API_KEY) credential in Settings.",
    );
  }
  if (skipped.length > 0) {
    lines.push(
      "",
      `Skipped (no API key configured): ${skipped
        .map((e) => e.provider)
        .join(", ")}`,
    );
  }
  return lines.join("\n");
}

export function createTutorialTTSProvider(
  providerId: string,
  apiKey: string,
  options?: { voice?: string; settings?: VoiceSettings },
): TTSProvider {
  const settings = options?.settings ?? {};
  switch (providerId) {
    case "ai33_elevenlabs":
      return new TutorialElevenLabsAI33Provider(apiKey, settings);
    case "ai33_minimax":
      // Uses the AI33 Minimax engine (/v1m/task/text-to-speech); NOT the direct Minimax API.
      // Voice ID prefix ("minimax_") is stripped in resolveVoiceForProvider before this is called.
      return createTTSProvider(apiKey, "AI33");
    case "ai33_kokoro":
      // AI33 v3 Kokoro — local, reliable, the tutorial TTS fallback anchor.
      // Was in TTS_FALLBACK_CHAIN with NO factory case, so it threw
      // "Unknown TTS provider" OUTSIDE the retry try and aborted the whole
      // chain (V21/T3). Voice ids are "kokoro_"-prefixed (resolveVoiceForProvider).
      return new Ai33V3Provider(apiKey, settings);
    case "google_tts":
      return new GoogleTTSProvider(apiKey, settings);
    case "elevenlabs_official":
      return new ElevenLabsOfficialProvider(apiKey, settings);
    case "minimax_official":
      return createTTSProvider(apiKey, "Minimax", {
        model: settings.model,
        speed: settings.speed,
        pitch: settings.pitch,
        volume: settings.volume,
        languageBoost: settings.language,
      });
    case "inworld_tts":
      return new InworldTTSProvider(apiKey, settings);
    case "fish_audio":
      return new FishAudioTTSProvider(apiKey, settings);
    case "qwen3_local":
      throw new Error("qwen3_local is coming soon");
    default:
      throw new Error(`Unknown TTS provider: ${providerId}`);
  }
}
