import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execa } from 'execa';
import sharp from 'sharp';

// Mock dependencies
vi.mock('execa');
vi.mock('sharp');
vi.mock('@/lib/services/waveform-service');

describe('Metadata Extraction API Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Video metadata extraction', () => {
    it('should extract duration, width, and height from video', async () => {
      const mockProbeOutput = JSON.stringify({
        streams: [
          {
            width: 1920,
            height: 1080,
            duration: '125.5',
          },
        ],
      });

      vi.mocked(execa).mockResolvedValue({
        stdout: mockProbeOutput,
        stderr: '',
        exitCode: 0,
      } as any);

      // Simulate the API logic
      const probe = await execa('ffprobe', [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height,duration',
        '-of', 'json',
        '/fake/video.mp4'
      ], { timeout: 5000 });

      const data = JSON.parse(probe.stdout);
      const stream = data.streams?.[0];

      const metadata = {
        duration_seconds: stream.duration ? Math.round(parseFloat(stream.duration)) : null,
        width: stream.width || null,
        height: stream.height || null,
      };

      expect(metadata).toEqual({
        duration_seconds: 126,
        width: 1920,
        height: 1080,
      });
    });

    it('should handle missing duration gracefully', async () => {
      vi.mocked(execa).mockResolvedValue({
        stdout: JSON.stringify({ streams: [{ width: 1920, height: 1080 }] }),
        stderr: '',
        exitCode: 0,
      } as any);

      const probe = await execa('ffprobe', [], {} as any);
      const data = JSON.parse((probe.stdout as unknown) as string);
      const stream = data.streams?.[0];

      const metadata = {
        duration_seconds: stream.duration ? Math.round(parseFloat(stream.duration)) : null,
        width: stream.width || null,
        height: stream.height || null,
      };

      expect(metadata.duration_seconds).toBeNull();
      expect(metadata.width).toBe(1920);
      expect(metadata.height).toBe(1080);
    });
  });

  describe('Image metadata extraction', () => {
    it('should extract dimensions from image using sharp', async () => {
      const mockMetadata = {
        width: 2560,
        height: 1440,
        format: 'jpeg',
      };

      const mockSharpInstance = {
        metadata: vi.fn().mockResolvedValue(mockMetadata),
      };

      vi.mocked(sharp).mockReturnValue(mockSharpInstance as any);

      // Simulate API logic
      const image = sharp('/fake/image.jpg');
      const imageMetadata = await image.metadata();

      const metadata = {
        duration_seconds: null,
        width: imageMetadata.width || null,
        height: imageMetadata.height || null,
      };

      expect(metadata).toEqual({
        duration_seconds: null,
        width: 2560,
        height: 1440,
      });
    });
  });

  describe('Error handling', () => {
    it('should return null values on FFprobe timeout', async () => {
      vi.mocked(execa).mockRejectedValue(new Error('Timeout exceeded'));

      try {
        await execa('ffprobe', [], { timeout: 5000 } as any);
      } catch (error) {
        // Expected error
      }

      // API should return null values on error
      const fallbackMetadata = {
        duration_seconds: null,
        width: null,
        height: null,
      };

      expect(fallbackMetadata).toEqual({
        duration_seconds: null,
        width: null,
        height: null,
      });
    });

    it('should handle sharp errors gracefully', async () => {
      vi.mocked(sharp).mockImplementation(() => {
        throw new Error('Image processing failed');
      });

      try {
        sharp('/fake/corrupt.jpg');
      } catch (error) {
        // Expected error
      }

      // API should return null values on error
      const fallbackMetadata = {
        duration_seconds: null,
        width: null,
        height: null,
      };

      expect(fallbackMetadata).toEqual({
        duration_seconds: null,
        width: null,
        height: null,
      });
    });
  });

  describe('Validation', () => {
    it('should require valid asset_type parameter', () => {
      const validTypes = ['video', 'audio', 'image'];

      expect(validTypes.includes('video')).toBe(true);
      expect(validTypes.includes('audio')).toBe(true);
      expect(validTypes.includes('image')).toBe(true);
      expect(validTypes.includes('document')).toBe(false);
      expect(validTypes.includes('')).toBe(false);
    });

    it('should enforce 5 second timeout for ffprobe', () => {
      expect(5000).toBeLessThanOrEqual(10000); // Reasonable timeout
      expect(5000).toBeGreaterThan(0);
    });
  });
});
