import { describe, it, expect, vi } from 'vitest';
import { parseResearchFiles } from '../research-parser.js';
import { MediaValidationError, PipelineErrorCode } from '../errors/index.js';

// Mock pdf-parse module
vi.mock('pdf-parse', () => {
  class MockPDFParse {
    private data: Buffer;

    constructor(options: { data: Buffer }) {
      this.data = options.data;
    }

    async getText() {
      // Simulate PDF parsing
      const content = this.data.toString('utf-8');

      // Simulate malformed PDF detection
      if (content.includes('CORRUPT_PDF')) {
        throw new Error('Invalid PDF structure');
      }

      // Return mock parsed text
      return { text: 'Sample PDF text content' };
    }
  }
  return {
    PDFParse: MockPDFParse
  };
});

describe('parseResearchFiles', () => {
  describe('successful parsing', () => {
    it('should parse PDF content', async () => {
      const mockPdfBuffer = Buffer.from('mock pdf content');

      const result = await parseResearchFiles([
        { filename: 'test.pdf', buffer: mockPdfBuffer, format: 'pdf' },
      ]);

      expect(result.files).toHaveLength(1);
      expect(result.files[0].filename).toBe('test.pdf');
      expect(result.files[0].format).toBe('pdf');
      expect(result.files[0].content).toBe('Sample PDF text content');
      expect(result.files[0].word_count).toBe(4); // "Sample PDF text content" = 4 words
    });

    it('should parse markdown content', async () => {
      const mdBuffer = Buffer.from('# Heading\n\nSome markdown content');

      const result = await parseResearchFiles([
        { filename: 'test.md', buffer: mdBuffer, format: 'md' },
      ]);

      expect(result.files).toHaveLength(1);
      expect(result.files[0].filename).toBe('test.md');
      expect(result.files[0].format).toBe('md');
      expect(result.files[0].content).toBe('# Heading\n\nSome markdown content');
      expect(result.files[0].word_count).toBe(5); // "# Heading Some markdown content" = 5 words (includes #)
    });

    it('should parse plain text content', async () => {
      const txtBuffer = Buffer.from('Plain text document content');

      const result = await parseResearchFiles([
        { filename: 'test.txt', buffer: txtBuffer, format: 'txt' },
      ]);

      expect(result.files).toHaveLength(1);
      expect(result.files[0].filename).toBe('test.txt');
      expect(result.files[0].format).toBe('txt');
      expect(result.files[0].content).toBe('Plain text document content');
      expect(result.files[0].word_count).toBe(4);
    });

    it('should handle multiple files and combine content', async () => {
      const files = [
        { filename: 'doc1.txt', buffer: Buffer.from('First document'), format: 'txt' as const },
        { filename: 'doc2.md', buffer: Buffer.from('Second document'), format: 'md' as const },
      ];

      const result = await parseResearchFiles(files);

      expect(result.files).toHaveLength(2);
      expect(result.total_word_count).toBe(4); // 2 + 2
      expect(result.combined_content).toBe('First document\n\n---\n\nSecond document');
    });

    it('should calculate total word count correctly', async () => {
      const files = [
        { filename: 'short.txt', buffer: Buffer.from('Short'), format: 'txt' as const },
        { filename: 'long.txt', buffer: Buffer.from('This is a longer text file'), format: 'txt' as const },
      ];

      const result = await parseResearchFiles(files);

      expect(result.total_word_count).toBe(7); // 1 + 6
    });
  });

  describe('empty content edge cases', () => {
    it('should handle empty file with 0 words (not 1)', async () => {
      const emptyBuffer = Buffer.from('');

      await expect(async () => {
        await parseResearchFiles([
          { filename: 'empty.txt', buffer: emptyBuffer, format: 'txt' },
        ]);
      }).rejects.toThrow(MediaValidationError);
    });

    it('should handle whitespace-only content with 0 words', async () => {
      const whitespaceBuffer = Buffer.from('   \n\n\t  ');

      const result = await parseResearchFiles([
        { filename: 'whitespace.txt', buffer: whitespaceBuffer, format: 'txt' },
      ]);

      expect(result.files[0].word_count).toBe(0);
      expect(result.total_word_count).toBe(0);
    });

    it('should handle single word correctly', async () => {
      const singleWordBuffer = Buffer.from('Word');

      const result = await parseResearchFiles([
        { filename: 'single.txt', buffer: singleWordBuffer, format: 'txt' },
      ]);

      expect(result.files[0].word_count).toBe(1);
    });
  });

  describe('error handling', () => {
    it('should throw error for missing buffer', async () => {
      const fileWithoutBuffer = {
        filename: 'missing.txt',
        buffer: null as any,
        format: 'txt' as const,
      };

      await expect(async () => {
        await parseResearchFiles([fileWithoutBuffer]);
      }).rejects.toThrow(MediaValidationError);

      try {
        await parseResearchFiles([fileWithoutBuffer]);
      } catch (error) {
        expect(error).toBeInstanceOf(MediaValidationError);
        expect((error as MediaValidationError).code).toBe(PipelineErrorCode.ZERO_SIZE_ASSET);
        expect((error as MediaValidationError).message).toContain('Missing buffer');
      }
    });

    it('should throw error for empty buffer', async () => {
      const emptyBuffer = Buffer.from('');

      await expect(async () => {
        await parseResearchFiles([
          { filename: 'empty.txt', buffer: emptyBuffer, format: 'txt' },
        ]);
      }).rejects.toThrow(MediaValidationError);

      try {
        await parseResearchFiles([
          { filename: 'empty.txt', buffer: emptyBuffer, format: 'txt' },
        ]);
      } catch (error) {
        expect(error).toBeInstanceOf(MediaValidationError);
        expect((error as MediaValidationError).code).toBe(PipelineErrorCode.ZERO_SIZE_ASSET);
        expect((error as MediaValidationError).message).toContain('Empty buffer');
      }
    });

    it('should throw error for corrupt PDF', async () => {
      const corruptPdfBuffer = Buffer.from('CORRUPT_PDF');

      await expect(async () => {
        await parseResearchFiles([
          { filename: 'corrupt.pdf', buffer: corruptPdfBuffer, format: 'pdf' },
        ]);
      }).rejects.toThrow(MediaValidationError);

      try {
        await parseResearchFiles([
          { filename: 'corrupt.pdf', buffer: corruptPdfBuffer, format: 'pdf' },
        ]);
      } catch (error) {
        expect(error).toBeInstanceOf(MediaValidationError);
        expect((error as MediaValidationError).code).toBe(PipelineErrorCode.CORRUPT_FILE);
        expect((error as MediaValidationError).message).toContain('Failed to parse PDF');
      }
    });

    it('should include filename in error messages', async () => {
      const emptyBuffer = Buffer.from('');

      try {
        await parseResearchFiles([
          { filename: 'important-file.txt', buffer: emptyBuffer, format: 'txt' },
        ]);
      } catch (error) {
        expect((error as MediaValidationError).message).toContain('important-file.txt');
      }
    });

    it('should include error metadata', async () => {
      const emptyBuffer = Buffer.from('');

      try {
        await parseResearchFiles([
          { filename: 'test.txt', buffer: emptyBuffer, format: 'txt' },
        ]);
      } catch (error) {
        const validationError = error as MediaValidationError;
        expect(validationError.assetKey).toBe('test.txt');
        expect(validationError.actual).toBe('0 bytes');
      }
    });
  });

  describe('combined content formatting', () => {
    it('should separate files with --- delimiter', async () => {
      const files = [
        { filename: 'a.txt', buffer: Buffer.from('First'), format: 'txt' as const },
        { filename: 'b.txt', buffer: Buffer.from('Second'), format: 'txt' as const },
        { filename: 'c.txt', buffer: Buffer.from('Third'), format: 'txt' as const },
      ];

      const result = await parseResearchFiles(files);

      expect(result.combined_content).toBe('First\n\n---\n\nSecond\n\n---\n\nThird');
    });

    it('should preserve original content including whitespace', async () => {
      const contentWithWhitespace = 'Line 1\n\nLine 2\n\tIndented';
      const buffer = Buffer.from(contentWithWhitespace);

      const result = await parseResearchFiles([
        { filename: 'test.txt', buffer, format: 'txt' },
      ]);

      expect(result.files[0].content).toBe(contentWithWhitespace);
    });
  });
});
