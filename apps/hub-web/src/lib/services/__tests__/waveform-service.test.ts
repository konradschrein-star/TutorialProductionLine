import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateWaveform, extractAudioDuration } from '../waveform-service';
import { execa } from 'execa';

// Mock execa
vi.mock('execa');

describe('waveform-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('generateWaveform', () => {
    it('should generate waveform with 200 samples', async () => {
      // Mock FFmpeg output (200 bytes of sample data)
      const mockBuffer = Buffer.alloc(200);
      for (let i = 0; i < 200; i++) {
        mockBuffer[i] = Math.floor(Math.random() * 255);
      }

      vi.mocked(execa).mockResolvedValue({
        stdout: mockBuffer,
        stderr: '',
        exitCode: 0,
      } as any);

      const result = await generateWaveform('/fake/path/audio.mp3');

      expect(result).toHaveLength(200);
      expect(result.every(val => val >= 0 && val <= 1)).toBe(true);
      expect(execa).toHaveBeenCalledWith(
        'ffmpeg',
        expect.arrayContaining(['-i', '/fake/path/audio.mp3']),
        expect.objectContaining({ timeout: 500, encoding: 'buffer' })
      );
    });

    it('should normalize amplitudes to 0-1 range', async () => {
      const mockBuffer = Buffer.from([0, 127, 255]);

      vi.mocked(execa).mockResolvedValue({
        stdout: mockBuffer,
        stderr: '',
        exitCode: 0,
      } as any);

      const result = await generateWaveform('/fake/path/audio.mp3');

      expect(result[0]).toBe(0);
      expect(result[1]).toBeCloseTo(0.498, 2);
      expect(result[2]).toBe(1);
    });

    it('should throw error on FFmpeg failure', async () => {
      vi.mocked(execa).mockRejectedValue(new Error('FFmpeg not found'));

      await expect(generateWaveform('/fake/path/audio.mp3')).rejects.toThrow('FFmpeg not found');
    });

    it('should enforce 500ms timeout', async () => {
      const mockBuffer = Buffer.alloc(200);
      vi.mocked(execa).mockResolvedValue({
        stdout: mockBuffer,
        stderr: '',
        exitCode: 0,
      } as any);

      await generateWaveform('/fake/path/audio.mp3');

      expect(execa).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({ timeout: 500 })
      );
    });
  });

  describe('extractAudioDuration', () => {
    it('should extract duration from ffprobe output', async () => {
      vi.mocked(execa).mockResolvedValue({
        stdout: '123.456\n',
        stderr: '',
        exitCode: 0,
      } as any);

      const result = await extractAudioDuration('/fake/path/audio.mp3');

      expect(result).toBe(123.456);
      expect(execa).toHaveBeenCalledWith(
        'ffprobe',
        expect.arrayContaining([
          '-v', 'error',
          '-show_entries', 'format=duration',
          '/fake/path/audio.mp3'
        ]),
        expect.objectContaining({ timeout: 1000 })
      );
    });

    it('should throw error if duration invalid', async () => {
      vi.mocked(execa).mockResolvedValue({
        stdout: 'N/A\n',
        stderr: '',
        exitCode: 0,
      } as any);

      await expect(extractAudioDuration('/fake/path/audio.mp3')).rejects.toThrow('Invalid duration');
    });

    it('should throw error on ffprobe failure', async () => {
      vi.mocked(execa).mockRejectedValue(new Error('FFprobe failed'));

      await expect(extractAudioDuration('/fake/path/audio.mp3')).rejects.toThrow('FFprobe failed');
    });

    it('should handle malformed JSON output', async () => {
      vi.mocked(execa).mockResolvedValue({
        stdout: 'invalid json',
        stderr: '',
        exitCode: 0,
      } as any);

      await expect(extractAudioDuration('/fake/path/audio.mp3')).rejects.toThrow();
    });
  });
});
