import { StorageService } from './storageService';
import { ThumbnailBrief } from '../types';

export class AIService {
  /**
   * Generates a spoken narration tutorial script following the high-retention structure:
   * 1. Hook & Topic Statement + CTA to like/subscribe
   * 2. Direct, actionable, fluff-free step-by-step instructions with natural pause markers '...'
   * 3. Quick outro with closing CTA
   */
  static async generateScript(topic: string, extraInstructions: string = ''): Promise<string> {
    const apiKey = StorageService.getApiKey('groq');

    const systemPrompt = `You are a world-class tutorial scriptwriter for a high-retention YouTube channel.
Write a spoken narration script for a video titled "${topic}".

STRICT FORMATTING & PACING RULES:
1. Topic Statement & Early CTA: Start immediately by stating what the video is about, followed by a quick call to action, then jump straight into step 1.
   Example opening: "In this video, I will show you how to ${topic}. If you find this helpful, consider subscribing and liking the video. First, ..."
2. Body & Step Pacing: Provide clear, concise step-by-step instructions.
   - Use second person conversational tone ("Click on the top right menu...", "Next, select...").
   - Include natural spoken pauses using ellipsis "..." where the viewer needs 1-2 seconds to follow the on-screen action.
   - ZERO fluff, ZERO filler phrases like "Let's dive in" or "Without further ado".
3. Outro: A fast 5-second wrap-up reminding the viewer to like, comment with any questions, and subscribe.
4. Output Format: Return PLAIN SPOKEN TEXT ONLY. No markdown headers, no stage directions in brackets, no bullet points.

${extraInstructions ? `EXTRA CUSTOM INSTRUCTIONS: ${extraInstructions}` : ''}`;

    if (!apiKey) {
      // High-quality mock simulation for instant preview when no API key is provided
      await new Promise(r => setTimeout(r, 1200));
      return `In this video, I will show you how to ${topic}. If you find this helpful, make sure to like the video and subscribe for more quick guides.

First, open up your dashboard and navigate to the top settings menu in the upper right corner... 
Once you're in settings, scroll down to the integrations tab and click on connect...

Next, select your desired preset configuration from the dropdown list. You will see three options appear on screen... Choose the primary setup and confirm your selection.

Finally, click the blue save button at the bottom of the page to apply all changes immediately... Your setup is now completely configured and ready to use.

If this helped you out, drop a like and subscribe to the channel. Let me know in the comments what tutorial you want to see next!`;
    }

    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Generate the spoken script for "${topic}" now.` }
          ],
          temperature: 0.7,
          max_tokens: 1200,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err?.error?.message || `Groq API returned ${response.status}`);
      }

      const data = await response.json();
      return data.choices?.[0]?.message?.content?.trim() || '';
    } catch (e: any) {
      console.error('AI generation error:', e);
      throw new Error(`AI generation failed: ${e.message}`);
    }
  }

  /**
   * Generates YouTube metadata (SEO Title, Description, Tags)
   */
  static generateMetadata(topic: string, script: string, channelName: string) {
    const cleanTopic = topic.replace(/^how to /i, '').trim();
    const title = `How to ${cleanTopic.charAt(0).toUpperCase() + cleanTopic.slice(1)} (Step-by-Step ${new Date().getFullYear()})`;
    
    const description = `Learn how to ${cleanTopic.toLowerCase()} in this quick step-by-step tutorial for ${new Date().getFullYear()}.

📌 What you will learn in this video:
- Complete walkthrough on how to ${cleanTopic.toLowerCase()}
- Common mistakes to avoid
- Best practices and expert tips

${script.slice(0, 240)}...

🔔 Subscribe to ${channelName} for new daily software tutorials, tips, and automated workflow guides!
👍 Like this video if it helped you solve your problem!`;

    const baseWords = cleanTopic.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(' ').filter(Boolean);
    const tags = [
      `how to ${cleanTopic.toLowerCase()}`,
      `${cleanTopic.toLowerCase()} tutorial`,
      `${cleanTopic.toLowerCase()} guide`,
      `${cleanTopic.toLowerCase()} ${new Date().getFullYear()}`,
      `learn ${cleanTopic.toLowerCase()}`,
      ...baseWords.map(w => `${w} tutorial`),
      'tutorial',
      'step by step guide'
    ];

    return {
      title,
      description,
      tags: Array.from(new Set(tags)).slice(0, 10).join(', ')
    };
  }

  /**
   * Generates a structured thumbnail brief and 10-language translations
   */
  static async generateThumbnailBrief(topic: string): Promise<ThumbnailBrief> {
    const apiKey = StorageService.getApiKey('groq');

    if (!apiKey) {
      await new Promise(r => setTimeout(r, 800));
      const cleanSoftware = topic.split(' ')[0] || 'App';
      return {
        software_name: cleanSoftware,
        thumbnail_text_line1: 'LEARN FAST',
        thumbnail_text_line2: 'STEP BY STEP',
        purpose_keyword: 'tutorial',
        logo_search_term: cleanSoftware.toLowerCase(),
        translations: {
          English: { top: 'LEARN FAST', bottom: 'STEP BY STEP' },
          German: { top: 'SCHNELL LERNEN', bottom: 'SCHRITT FÜR SCHRITT' },
          Spanish: { top: 'APRENDE FÁCIL', bottom: 'PASO A PASO' },
          Portuguese: { top: 'APRENDA RÁPIDO', bottom: 'PASSO A PASSO' },
          Italian: { top: 'IMPARA SUBITO', bottom: 'PASSO DOPO PASSO' },
          French: { top: 'GUIDE RAPIDE', bottom: 'ÉTAPE PAR ÉTAPE' },
          Dutch: { top: 'SNEL LEREN', bottom: 'STAP VOOR STAP' },
          Japanese: { top: '簡単マスター', bottom: 'ステップ解説' },
          Korean: { top: '빠른 가이드', bottom: '완벽 정리' },
          Swedish: { top: 'LÄR DIG SNABBT', bottom: 'STEG FÖR STEG' }
        }
      };
    }

    const prompt = `Given video topic: "${topic}", produce a JSON thumbnail brief.
Extract:
1. software_name (the main software or 'generic')
2. thumbnail_text_line1 (1-2 words ALL CAPS hook)
3. thumbnail_text_line2 (1-2 words ALL CAPS payoff)
4. purpose_keyword (tutorial/tips/review)
5. logo_search_term
6. translations for English, German, Spanish, Portuguese, Italian, French, Dutch, Japanese, Korean, Swedish.

Output ONLY a JSON object formatted as:
{
  "software_name": "...",
  "thumbnail_text_line1": "...",
  "thumbnail_text_line2": "...",
  "purpose_keyword": "...",
  "logo_search_term": "...",
  "translations": {
    "English": { "top": "...", "bottom": "..." },
    "German": { "top": "...", "bottom": "..." },
    "Spanish": { "top": "...", "bottom": "..." },
    "Portuguese": { "top": "...", "bottom": "..." },
    "Italian": { "top": "...", "bottom": "..." },
    "French": { "top": "...", "bottom": "..." },
    "Dutch": { "top": "...", "bottom": "..." },
    "Japanese": { "top": "...", "bottom": "..." },
    "Korean": { "top": "...", "bottom": "..." },
    "Swedish": { "top": "...", "bottom": "..." }
  }
}`;

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' }
      })
    });

    const data = await res.json();
    return JSON.parse(data.choices[0].message.content);
  }
}
