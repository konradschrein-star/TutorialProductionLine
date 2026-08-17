import { describe, it, expect } from 'vitest';
import { TTSService, AVAILABLE_VOICES } from '../services/ttsService';

describe('TTSService Unit Tests', () => {
  it('should list studio neural voice profiles', () => {
    expect(AVAILABLE_VOICES.length).toBeGreaterThan(3);
    const paul = AVAILABLE_VOICES.find(v => v.id.includes('paul'));
    expect(paul).toBeDefined();
    expect(paul?.gender).toBe('male');
  });

  it('should synthesize a local WAV blob when offline', async () => {
    let progressReached = 0;
    const { blob, durationSeconds } = await TTSService.synthesizeVoice(
      'Welcome to this quick tutorial on how to configure settings in five minutes.',
      'fish-paul-neutral',
      1.0,
      (pct) => { progressReached = pct; }
    );

    expect(blob).toBeDefined();
    expect(blob.type).toBe('audio/wav');
    expect(blob.size).toBeGreaterThan(1000);
    expect(durationSeconds).toBeGreaterThan(0);
    expect(progressReached).toBe(100);
  });
});
