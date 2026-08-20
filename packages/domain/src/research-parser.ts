/**
 * Research File Parser
 *
 * Extracts text content from uploaded research files (PDF, Markdown, plain text).
 *
 * ARCHITECTURAL JUSTIFICATION:
 * This module lives in the domain layer despite using pdf-parse, which might
 * appear to violate the "no IO" rule. However:
 *
 * 1. pdf-parse operates on in-memory Buffer objects passed as function parameters
 * 2. It performs pure data transformation (binary PDF → text string)
 * 3. It does NOT perform filesystem IO, network IO, or database access
 * 4. The buffer is provided by the caller (imperative shell), not read from disk
 *
 * This is analogous to JSON.parse() or other data transformation libraries.
 * The domain layer transforms data; the infrastructure layer provides it.
 *
 * If the architecture review determines this belongs elsewhere, the suggested
 * location would be a new package (e.g., @repo/file-processing), but the
 * current task specification explicitly places it here.
 *
 * NOTE: pdf-parse is imported dynamically to avoid loading browser-only dependencies
 * (like DOMMatrix from pdfjs-dist) in server contexts that don't use PDF parsing.
 */

import { PipelineErrorCode, MediaValidationError } from './errors/index.js';

export interface ResearchFile {
  filename: string;
  buffer: Buffer;
  format: 'pdf' | 'md' | 'txt';
}

export interface ParsedResearchFile {
  filename: string;
  content: string;
  word_count: number;
  format: 'pdf' | 'md' | 'txt';
}

export interface ParsedResearch {
  files: ParsedResearchFile[];
  total_word_count: number;
  combined_content: string;
}

/**
 * Parse research files and extract text content.
 *
 * @param files - Array of research files with buffers and format types
 * @returns Parsed research with text content and word counts
 * @throws {MediaValidationError} If buffer is missing, empty, or PDF parsing fails
 */
export async function parseResearchFiles(files: ResearchFile[]): Promise<ParsedResearch> {
  const parsedFiles: ParsedResearchFile[] = [];

  for (const file of files) {
    // Validate input buffer exists
    if (!file.buffer) {
      throw new MediaValidationError(
        PipelineErrorCode.ZERO_SIZE_ASSET,
        `Missing buffer for file: ${file.filename}`
      );
    }

    if (file.buffer.length === 0) {
      throw new MediaValidationError(
        PipelineErrorCode.ZERO_SIZE_ASSET,
        `Empty buffer for file: ${file.filename}`,
        { assetKey: file.filename, actual: '0 bytes' }
      );
    }

    let content = '';

    try {
      if (file.format === 'pdf') {
        // Parse PDF using pdf-parse library (lazy-loaded to avoid DOMMatrix errors in server contexts)
        // This can fail for malformed PDFs, encrypted PDFs, or unsupported PDF versions
        const { PDFParse } = await import('pdf-parse');
        const parser = new PDFParse({ data: file.buffer });
        const result = await parser.getText();
        content = result.text;
      } else if (file.format === 'md' || file.format === 'txt') {
        // Decode text buffer as UTF-8
        // This can fail if the buffer contains invalid UTF-8 sequences
        content = file.buffer.toString('utf-8');
      } else {
        // This should never happen if TypeScript types are respected,
        // but handle it defensively
        throw new MediaValidationError(
          PipelineErrorCode.INVALID_FILE_TYPE,
          `Unsupported format: ${file.format} for file: ${file.filename}`,
          { assetKey: file.filename, actual: file.format }
        );
      }
    } catch (error) {
      // Re-throw our own errors unchanged
      if (error instanceof MediaValidationError) {
        throw error;
      }

      // Wrap PDF parsing errors
      if (file.format === 'pdf') {
        throw new MediaValidationError(
          PipelineErrorCode.CORRUPT_FILE,
          `Failed to parse PDF file: ${file.filename}. ${error instanceof Error ? error.message : String(error)}`,
          { assetKey: file.filename }
        );
      }

      // Wrap text decoding errors
      throw new MediaValidationError(
        PipelineErrorCode.INVALID_FILE_TYPE,
        `Failed to decode text file: ${file.filename}. ${error instanceof Error ? error.message : String(error)}`,
        { assetKey: file.filename }
      );
    }

    // Calculate word count
    // Handle empty content edge case: empty string should be 0 words, not 1
    const trimmedContent = content.trim();
    const wordCount = trimmedContent.length === 0 ? 0 : trimmedContent.split(/\s+/).length;

    parsedFiles.push({
      filename: file.filename,
      content,
      word_count: wordCount,
      format: file.format,
    });
  }

  const totalWordCount = parsedFiles.reduce((sum, f) => sum + f.word_count, 0);
  const combinedContent = parsedFiles.map((f) => f.content).join('\n\n---\n\n');

  return {
    files: parsedFiles,
    total_word_count: totalWordCount,
    combined_content: combinedContent,
  };
}
