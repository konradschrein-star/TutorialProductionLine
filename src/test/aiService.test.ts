import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AIService } from '../services/aiService';
import { StorageService } from '../services/storageService';

describe('AIService Unit Tests', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
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

  it('should fall back to DeepSeek Flash (deepseek-chat) when Groq fails', async () => {
    StorageService.setApiKey('groq', 'gsk_mock_invalid');
    StorageService.setApiKey('deepseek', 'sk_deepseek_flash_mock');

    let calledDeepSeekWithFlash = false;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init: any) => {
      const urlStr = url.toString();
      if (urlStr.includes('api.groq.com')) {
        return new Response(JSON.stringify({ error: { message: 'Rate limited' } }), { status: 429 });
      }
      if (urlStr.includes('api.deepseek.com')) {
        const body = JSON.parse(init.body);
        if (body.model === 'deepseek-chat') {
          calledDeepSeekWithFlash = true;
          return new Response(JSON.stringify({
            choices: [{ message: { content: 'DeepSeek Flash generated narration script with precision...' } }]
          }), { status: 200 });
        }
      }
      return new Response('Not found', { status: 404 });
    });

    const result = await AIService.generateScript('Automate Invoices in Excel');
    expect(calledDeepSeekWithFlash).toBe(true);
    expect(result).toBe('DeepSeek Flash generated narration script with precision...');
  });
});
