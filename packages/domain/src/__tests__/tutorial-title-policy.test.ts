import { describe, it, expect } from 'vitest';
import { buildGeneratedTutorialTitle, recommendTutorialTitleSuffix, TUTORIAL_TITLE_SUFFIXES_2026 } from '../tutorial-title-policy.js';
describe('opt-in compact generated tutorial titles', () => {
  it.each(TUTORIAL_TITLE_SUFFIXES_2026)('uses exact suffix %s', suffix => {
    expect(buildGeneratedTutorialTitle('How to share files in Notion', suffix)).toBe(`How to share files in Notion - ${suffix}`);
  });
  it('replaces the unwanted Only Step by Step suffix, never repeats it', () => {
    const original='How to share files (Only Step by Step 2026)';
    expect(buildGeneratedTutorialTitle(original,'Step-by-Step 2026')).toBe('How to share files - Step-by-Step 2026');
    expect(original).toBe('How to share files (Only Step by Step 2026)');
  });
  it('rejects unsupported suffixes and oversized subjects instead of truncating', () => {
    expect(()=>buildGeneratedTutorialTitle('A subject','Only Step by Step 2026' as any)).toThrow();
    expect(()=>buildGeneratedTutorialTitle('a'.repeat(100),'2026 Guide')).toThrow();
    expect(()=>buildGeneratedTutorialTitle('','2026 Guide')).toThrow();
  });
  it('uses the literal Step-by-Step 2026 for procedural setup topics', () => {
    expect(recommendTutorialTitleSuffix('How to set up Gmail')).toBe('Step-by-Step 2026');
  });
  it('keeps automatic variation deterministic', () => {
    expect(recommendTutorialTitleSuffix('How to use Notion', '42')).toBe(recommendTutorialTitleSuffix('How to use Notion', '42'));
  });
});
