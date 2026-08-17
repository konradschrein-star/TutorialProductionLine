import { describe, it, expect, beforeEach } from 'vitest';
import { AIService } from '../services/aiService';

describe('AIService Unit Tests', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should generate offline fallback script when no API key is set', async () => {
    const script = await AIService.generateScript('Automate Invoices in Excel');
    expect(script).toBeDefined();
    expect(script).toContain('In this video, I will show you how to Automate Invoices in Excel');
    expect(script).toContain('...');
  });

  it('should generate 60s short format script', async () => {
    const script = await AIService.generateScript('Automate Invoices in Excel', '', 'short_60s');
    expect(script).toBeDefined();
    expect(script).toContain('under 60 seconds');
  });

  it('should generate valid YouTube metadata', () => {
    const meta = AIService.generateMetadata('How to Automate Invoices in Excel', 'Sample script', 'Entrepreneurs Skool');
    expect(meta.title).toContain('How to Automate Invoices in Excel');
    expect(meta.description).toContain('Entrepreneurs Skool');
    expect(meta.tags).toContain('excel');
  });

  it('should generate a 10-language thumbnail brief', async () => {
    const brief = await AIService.generateThumbnailBrief('Excel Invoice Automation');
    expect(brief.thumbnail_text_line1).toBeDefined();
    expect(brief.thumbnail_text_line2).toBeDefined();
    expect(brief.translations?.German?.top).toBe('SCHNELL LERNEN');
    expect(brief.translations?.Spanish?.top).toBe('APRENDE FÁCIL');
  });

  it('should refine existing script with pause markers', async () => {
    const original = 'Click on settings. Then click save.';
    const refined = await AIService.refineScript(original, 'add_pauses');
    expect(refined).toContain('...');
  });
});
