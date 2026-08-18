import { StorageService } from './storageService';
import { ThumbnailBrief } from '../types';

export type ScriptStyle = 'standard' | 'short_60s' | 'deep_dive' | 'troubleshoot';

interface LLMRequestOptions {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

export class AIService {
  /**
   * Dispatches LLM calls with primary Groq LLaMA 3.3 and DeepSeek Flash (deepseek-chat) fallback.
   * Uses deepseek-chat (DeepSeek V3 Flash model) for fast sub-second inference.
   * Returns null if neither provider succeeds, allowing offline deterministic fallback.
   */
  private static async callLLM({
    messages,
    temperature = 0.7,
    maxTokens = 1200,
    jsonMode = false
  }: LLMRequestOptions): Promise<string | null> {
    const groqKey = StorageService.getApiKey('groq');
    const deepseekKey = StorageService.getApiKey('deepseek');

    // 1. Try Groq (LLaMA 3.3 70B)
    if (groqKey) {
      try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${groqKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages,
            temperature,
            max_tokens: maxTokens,
            ...(jsonMode ? { response_format: { type: 'json_object' } } : {})
          }),
        });

        if (response.ok) {
          const data = await response.json();
          const content = data.choices?.[0]?.message?.content?.trim();
          if (content) return content;
        } else {
          console.warn(`Groq API returned HTTP ${response.status}, triggering DeepSeek Flash fallback.`);
        }
      } catch (err) {
        console.warn('Groq API call failed:', err);
      }
    }

    // 2. Fallback to DeepSeek Flash (deepseek-chat: DeepSeek-V3 non-reasoning high-throughput model)
    if (deepseekKey) {
      try {
        const response = await fetch('https://api.deepseek.com/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${deepseekKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'deepseek-chat', // DeepSeek Flash (Fast inference model, NOT deepseek-reasoner)
            messages,
            temperature,
            max_tokens: maxTokens,
            ...(jsonMode ? { response_format: { type: 'json_object' } } : {})
          }),
        });

        if (response.ok) {
          const data = await response.json();
          const content = data.choices?.[0]?.message?.content?.trim();
          if (content) return content;
        } else {
          console.warn(`DeepSeek Flash API returned HTTP ${response.status}`);
        }
      } catch (err) {
        console.warn('DeepSeek Flash API call failed:', err);
      }
    }

    return null;
  }

  /**
   * Generates a spoken narration tutorial script with selectable format archetypes
   */
  static async generateScript(
    topic: string, 
    extraInstructions: string = '',
    style: ScriptStyle = 'standard'
  ): Promise<string> {
    let styleInstructions = '';
    if (style === 'short_60s') {
      styleInstructions = `FORMAT: Rapid 60-Second Short/Reel. Under 130 words total. Ultra-fast hook, 3 rapid bullet-point actions, 5-second outro.`;
    } else if (style === 'deep_dive') {
      styleInstructions = `FORMAT: Comprehensive Masterclass Walkthrough (~400 words). Include prerequisite checks, pro-tips, common pitfalls to avoid, and shortcut key combinations.`;
    } else if (style === 'troubleshoot') {
      styleInstructions = `FORMAT: Problem & Error Fix Guide. State the common error message or bug symptom, diagnose the 2 most frequent root causes, then deliver the foolproof step-by-step fix.`;
    } else {
      styleInstructions = `FORMAT: Standard High-Retention Tutorial (~200 words). Early hook + subscribe/like CTA in sentence 2, clear step-by-step instructions with '...' pause markers, and 5-second closing CTA.`;
    }

    const systemPrompt = `You are a world-class tutorial scriptwriter for a high-retention YouTube channel.
Write a spoken narration script for a video titled "${topic}".

STRICT FORMATTING & PACING RULES:
1. Spoken Audio Pacing: Use second person conversational tone ("Click on the top right menu...", "Next, select...").
2. Include natural spoken pauses using ellipsis "..." where the viewer needs 1-2 seconds to follow the on-screen action.
3. ZERO fluff, ZERO filler phrases like "Let's dive in" or "Without further ado".
4. ${styleInstructions}
5. Output Format: Return PLAIN SPOKEN TEXT ONLY. No markdown headers, no stage directions in brackets, no bullet points.

${extraInstructions ? `EXTRA CUSTOM INSTRUCTIONS: ${extraInstructions}` : ''}`;

    const llmResult = await this.callLLM({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Generate the spoken script for "${topic}" now.` }
      ],
      temperature: 0.7,
      maxTokens: 1200
    });

    if (llmResult) {
      return llmResult;
    }

    // Deterministic Offline Fallback
    await new Promise(r => setTimeout(r, 600));
    if (style === 'short_60s') {
      return `Here is how to ${topic} in under 60 seconds. Make sure to drop a like! First, open settings... click integrations, and hit connect. Next, pick your default preset... and click save. That is literally all it takes. Subscribe for more quick tricks!`;
    }
    return `In this video, I will show you how to ${topic}. If you find this helpful, make sure to like the video and subscribe for more quick guides.

First, open up your dashboard and navigate to the top settings menu in the upper right corner... 
Once you're in settings, scroll down to the integrations tab and click on connect...

Next, select your desired preset configuration from the dropdown list. You will see three options appear on screen... Choose the primary setup and confirm your selection.

Finally, click the save button at the bottom of the page to apply all changes immediately... Your setup is now completely configured and ready to use.

If this helped you out, drop a like and subscribe to the channel. Let me know in the comments what tutorial you want to see next!`;
  }

  /**
   * Refines or transforms an existing script (Add pauses, Punch Up Hook, Shorten Fluff)
   */
  static async refineScript(script: string, action: 'add_pauses' | 'punch_hook' | 'shorten_fluff'): Promise<string> {
    const actionPrompts = {
      add_pauses: 'Insert natural spoken pause markers ("...") after every key click or instructional action so the pacing is natural for voiceover audio.',
      punch_hook: 'Rewrite ONLY the opening two sentences to make the hook dramatically punchier, high-stakes, and immediate.',
      shorten_fluff: 'Remove any remaining filler phrases, duplicate explanations, or wordy descriptions. Make the script razor-sharp and concise.'
    };

    const llmResult = await this.callLLM({
      messages: [
        {
          role: 'system',
          content: 'You are an elite tutorial editor. Output PLAIN SPOKEN SCRIPT ONLY. Do not add quotes or markdown.'
        },
        {
          role: 'user',
          content: `Original Script:\n${script}\n\nTask: ${actionPrompts[action]}`
        }
      ],
      temperature: 0.5,
      maxTokens: 1200
    });

    if (llmResult) {
      return llmResult;
    }

    // Deterministic Offline Fallback
    await new Promise(r => setTimeout(r, 400));
    if (action === 'add_pauses') {
      return script.replace(/(\. )/g, '... ');
    }
    return script;
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

    const llmResult = await this.callLLM({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      jsonMode: true
    });

    if (llmResult) {
      try {
        return JSON.parse(llmResult);
      } catch (e) {
        console.warn('Failed to parse thumbnail brief JSON:', e);
      }
    }

    // Deterministic Offline Fallback
    await new Promise(r => setTimeout(r, 400));
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
}
