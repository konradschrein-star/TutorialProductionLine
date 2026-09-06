import { StorageService } from './storageService';
import { VoiceOption } from '../types';

export const AVAILABLE_VOICES: VoiceOption[] = [
  {
    id: 'fish-paul-neutral',
    name: 'Paul (Calm & Professional)',
    provider: 'fish-audio',
    gender: 'male',
    accent: 'US Natural',
    description: 'Clean, articulate pacing ideal for technical walkthroughs.'
  },
  {
    id: 'fish-adam-punchy',
    name: 'Adam (Energetic & Dynamic)',
    provider: 'fish-audio',
    gender: 'male',
    accent: 'US Modern',
    description: 'High-energy, punchy delivery for fast productivity tips.'
  },
  {
    id: 'fish-sarah-calm',
    name: 'Sarah (Clear & Friendly)',
    provider: 'fish-audio',
    gender: 'female',
    accent: 'US Conversational',
    description: 'Warm, approachable tone perfect for beginner guides.'
  },
  {
    id: 'eleven-rachel-pro',
    name: 'Rachel (Studio Crisp)',
    provider: 'elevenlabs',
    gender: 'female',
    accent: 'US Standard',
    description: 'Deep neural voice with exceptional micro-inflections.'
  },
  {
    id: 'eleven-josh-deep',
    name: 'Josh (Deep & Authoritative)',
    provider: 'elevenlabs',
    gender: 'male',
    accent: 'US Deep',
    description: 'Rich broadcast tone suited for enterprise software.'
  }
];

export interface TTSResult {
  blob: Blob;
  durationSeconds: number;
  /** Which provider actually produced the audio. */
  provider?: 'elevenlabs' | 'fish-audio' | 'openai' | 'placeholder';
  /**
   * True when NO real TTS provider was configured and we returned a silent/tone
   * PLACEHOLDER track — not real narration. Callers should warn the operator.
   */
  isPlaceholder?: boolean;
  /** Human-readable note for the UI (e.g. why the placeholder was used). */
  warning?: string;
}

export class TTSService {
  /** Measure a real audio blob's duration; falls back to a word-count estimate. */
  private static async measureDuration(blob: Blob, wordEstimate: number): Promise<number> {
    try {
      const AC: typeof AudioContext =
        (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AC) return wordEstimate;
      const ctx = new AC();
      const arr = await blob.arrayBuffer();
      const decoded = await ctx.decodeAudioData(arr.slice(0));
      ctx.close?.();
      const d = Math.round(decoded.duration);
      return d > 0 ? d : wordEstimate;
    } catch {
      return wordEstimate;
    }
  }

  /**
   * Synthesizes audio via ElevenLabs / Fish Audio / OpenAI depending on the
   * selected voice and which provider keys are configured. If NONE is
   * configured it returns a clearly-flagged placeholder track (isPlaceholder),
   * never silently passing a tone off as narration.
   */
  static async synthesizeVoice(
    text: string,
    voiceId: string,
    speed: number = 1.0,
    onProgress?: (percent: number) => void
  ): Promise<TTSResult> {
    const elevenKey = StorageService.getApiKey('elevenlabs');
    const fishKey = StorageService.getApiKey('fishaudio');
    const openAiKey = StorageService.getApiKey('openai');
    const wordEstimate = Math.max(5, Math.round(text.split(/\s+/).filter(Boolean).length / 2.5));

    onProgress?.(25);

    // 1. ElevenLabs Provider
    if (voiceId.startsWith('eleven-') && elevenKey) {
      try {
        const elevenVoiceId = voiceId === 'eleven-rachel-pro' ? '21m00Tcm4TlvDq8ikWAM' : 'TxGEqnHWrfWFTfGW9XjX';
        const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${elevenVoiceId}`, {
          method: 'POST',
          headers: {
            'xi-api-key': elevenKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            text,
            model_id: 'eleven_turbo_v2_5',
            voice_settings: { stability: 0.5, similarity_boost: 0.8 }
          })
        });

        if (!res.ok) throw new Error(`ElevenLabs error ${res.status}`);
        onProgress?.(85);
        const blob = await res.blob();
        const durationSeconds = await this.measureDuration(blob, wordEstimate);
        onProgress?.(100);
        return { blob, durationSeconds, provider: 'elevenlabs' };
      } catch (err) {
        console.warn('ElevenLabs failed, trying next provider:', err);
      }
    }

    // 2. Fish Audio Provider (the advertised default for `fish-*` voices)
    if (voiceId.startsWith('fish-') && fishKey) {
      try {
        const res = await fetch('https://api.fish.audio/v1/tts', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${fishKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ text, format: 'mp3', latency: 'normal' })
        });
        if (!res.ok) throw new Error(`Fish Audio error ${res.status}`);
        onProgress?.(85);
        const blob = await res.blob();
        const durationSeconds = await this.measureDuration(blob, wordEstimate);
        onProgress?.(100);
        return { blob, durationSeconds, provider: 'fish-audio' };
      } catch (err) {
        console.warn('Fish Audio failed, trying next provider:', err);
      }
    }

    // 3. OpenAI TTS Provider (general fallback for any voice when keyed)
    if (openAiKey) {
      try {
        const res = await fetch('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openAiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'tts-1',
            input: text,
            voice: voiceId.includes('female') || voiceId.includes('sarah') || voiceId.includes('rachel') ? 'nova' : 'onyx',
            speed
          })
        });

        if (!res.ok) throw new Error(`OpenAI TTS error ${res.status}`);
        onProgress?.(90);
        const blob = await res.blob();
        const durationSeconds = await this.measureDuration(blob, wordEstimate);
        onProgress?.(100);
        return { blob, durationSeconds, provider: 'openai' };
      } catch (err) {
        console.warn('OpenAI TTS failed, falling back to placeholder track:', err);
      }
    }

    // 4. PLACEHOLDER — no real TTS provider configured. This is NOT narration;
    //    it is a silent-cadence timing track so the pipeline can proceed. The
    //    result is flagged so the UI can prompt the operator to add a key.
    onProgress?.(60);
    await new Promise(r => setTimeout(r, 600));
    
    // Estimate word count duration
    const words = text.split(/\s+/).filter(Boolean).length;
    const durationSeconds = Math.max(6, Math.min(300, Math.round((words / 2.6) / speed)));

    // Generate clean WAV container with spoken frequency carrier so audio player plays reliably
    const sampleRate = 22050;
    const numSamples = Math.floor(sampleRate * durationSeconds);
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);

    // WAV header
    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i));
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + numSamples * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, numSamples * 2, true);

    // Quiet cadence tick so the track has audible structure for timing/preview,
    // but low enough to never be mistaken for real narration.
    let offset = 44;
    const pitch = voiceId.includes('female') || voiceId.includes('sarah') ? 220 : 130;
    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const cadence = Math.sin(2 * Math.PI * 3.5 * t) > 0.1 ? 1 : 0.03;
      const sample = (Math.sin(2 * Math.PI * pitch * t) * 0.08 +
                      Math.sin(2 * Math.PI * (pitch * 2) * t) * 0.04) * cadence;
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }

    const wavBlob = new Blob([view], { type: 'audio/wav' });
    onProgress?.(100);
    console.warn(
      '[TTS] No ElevenLabs / Fish Audio / OpenAI key configured — returned a PLACEHOLDER timing track, not narration. Add a provider key in Settings → Credentials for real voiceover.'
    );
    return {
      blob: wavBlob,
      durationSeconds,
      provider: 'placeholder',
      isPlaceholder: true,
      warning: 'No TTS provider configured — this is a silent placeholder track, not real narration. Add an ElevenLabs, Fish Audio, or OpenAI key in Settings to generate voiceover.',
    };
  }
}
