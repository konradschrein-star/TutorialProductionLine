import { StorageService } from './storageService';
import { ThumbnailBrief } from '../types';

export type ScriptStyle = 'standard' | 'short_60s' | 'deep_dive' | 'troubleshoot';

interface LLMRequestOptions {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  timeoutMs?: number;
}

export class AIService {
  /**
   * Dispatches LLM calls with Google AI Studio (Gemini 2.0 Flash), Groq LLaMA 3.3,
   * and DeepSeek Flash (deepseek-chat) failover.
   * Employs AbortController timeout guards and defensive error catching.
   */
  private static async callLLM({
    messages,
    temperature = 0.7,
    maxTokens = 1200,
    jsonMode = false,
    timeoutMs = 15000
  }: LLMRequestOptions): Promise<string | null> {
    const geminiKey = StorageService.getApiKey('gemini');
    const groqKey = StorageService.getApiKey('groq');
    const deepseekKey = StorageService.getApiKey('deepseek');

    const systemMsg = messages.find(m => m.role === 'system')?.content || '';
    const nonSystemMsgs = messages.filter(m => m.role !== 'system');

    // 1. Try Google AI Studio (Gemini 2.0 Flash)
    if (geminiKey) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const contents = nonSystemMsgs.map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }]
        }));

        const body: Record<string, any> = {
          contents,
          generationConfig: {
            temperature,
            maxOutputTokens: maxTokens,
            ...(jsonMode ? { responseMimeType: 'application/json' } : {})
          }
        };

        if (systemMsg) {
          body.systemInstruction = {
            parts: [{ text: systemMsg }]
          };
        }

        const isVertexExpress = geminiKey.startsWith('AQ.');
        const endpointUrl = isVertexExpress
          ? `https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(geminiKey)}`
          : `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(geminiKey)}`;

        const response = await fetch(endpointUrl, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const data = await response.json();
          const content = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (content) return content;
        } else {
          console.warn(`Google Gemini API returned HTTP ${response.status}, triggering failover.`);
        }
      } catch (err) {
        clearTimeout(timeoutId);
        console.warn('Google Gemini API call failed or timed out:', err);
      }
    }

    // 2. Try Groq (LLaMA 3.3 70B)
    if (groqKey) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          signal: controller.signal,
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

        clearTimeout(timeoutId);

        if (response.ok) {
          const data = await response.json();
          const content = data.choices?.[0]?.message?.content?.trim();
          if (content) return content;
        } else {
          console.warn(`Groq API returned HTTP ${response.status}, triggering DeepSeek Flash fallback.`);
        }
      } catch (err) {
        clearTimeout(timeoutId);
        console.warn('Groq API call failed or timed out:', err);
      }
    }

    // 3. Fallback to DeepSeek Flash (deepseek-chat: DeepSeek-V3 non-reasoning high-throughput model)
    if (deepseekKey) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch('https://api.deepseek.com/chat/completions', {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Authorization': `Bearer ${deepseekKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'deepseek-chat',
            messages,
            temperature,
            max_tokens: maxTokens,
            ...(jsonMode ? { response_format: { type: 'json_object' } } : {})
          }),
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const data = await response.json();
          const content = data.choices?.[0]?.message?.content?.trim();
          if (content) return content;
        } else {
          console.warn(`DeepSeek Flash API returned HTTP ${response.status}`);
        }
      } catch (err) {
        clearTimeout(timeoutId);
        console.warn('DeepSeek Flash API call failed or timed out:', err);
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
    const safeTopic = (topic || 'Software Tutorial').trim();

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
Write a spoken narration script for a video titled "${safeTopic}".

STRICT FORMATTING & PACING RULES:
1. Spoken Audio Pacing: Use second person conversational tone ("Click on the top right menu...", "Next, select...").
2. Include natural spoken pauses using ellipsis "..." where the viewer needs 1-2 seconds to follow the on-screen action.
3. ZERO fluff, ZERO filler phrases like "Let's dive in" or "Without further ado".
4. ${styleInstructions}
5. Output Format: Return PLAIN SPOKEN TEXT ONLY. No markdown headers, no stage directions in brackets, no bullet points.

${extraInstructions ? `EXTRA CUSTOM INSTRUCTIONS: ${extraInstructions}` : ''}`;

    try {
      const llmResult = await this.callLLM({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Generate the spoken script for "${safeTopic}" now.` }
        ],
        temperature: 0.7,
        maxTokens: 1200
      });

      if (llmResult && llmResult.trim().length > 20) {
        return llmResult.trim();
      }
    } catch (e) {
      console.warn('Script generation exception:', e);
    }

    // Deterministic Offline Fallback
    await new Promise(r => setTimeout(r, 400));
    if (style === 'short_60s') {
      return `Here is how to ${safeTopic} in under 60 seconds. Make sure to drop a like! First, open settings... click integrations, and hit connect. Next, pick your default preset... and click save. That is literally all it takes. Subscribe for more quick tricks!`;
    }
    return `In this video, I will show you how to ${safeTopic}. If you find this helpful, make sure to like the video and subscribe for more quick guides.

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
    const safeScript = (script || '').trim();
    if (!safeScript) return '';

    const actionPrompts = {
      add_pauses: 'Insert natural spoken pause markers ("...") after every key click or instructional action so the pacing is natural for voiceover audio.',
      punch_hook: 'Rewrite ONLY the opening two sentences to make the hook dramatically punchier, high-stakes, and immediate.',
      shorten_fluff: 'Remove any remaining filler phrases, duplicate explanations, or wordy descriptions. Make the script razor-sharp and concise.'
    };

    try {
      const llmResult = await this.callLLM({
        messages: [
          {
            role: 'system',
            content: 'You are an elite tutorial editor. Output PLAIN SPOKEN SCRIPT ONLY. Do not add quotes or markdown.'
          },
          {
            role: 'user',
            content: `Original Script:\n${safeScript}\n\nTask: ${actionPrompts[action]}`
          }
        ],
        temperature: 0.5,
        maxTokens: 1200
      });

      if (llmResult && llmResult.trim().length > 10) {
        return llmResult.trim();
      }
    } catch (e) {
      console.warn('Script refinement exception:', e);
    }

    await new Promise(r => setTimeout(r, 300));
    if (action === 'add_pauses') {
      return safeScript.replace(/(\. )/g, '... ');
    }
    return safeScript;
  }

  /**
   * Translates a spoken tutorial script into a target language using Google Gemini / Gemma.
   * Preserves natural voiceover pacing, pause markers ('...'), and software names.
   */
  static async translateScript(script: string, targetLanguage: string): Promise<string> {
    const safeScript = (script || '').trim();
    if (!safeScript) return '';

    const systemPrompt = `You are an expert multilingual video translator.
Translate the tutorial narration script into ${targetLanguage}.
CRITICAL RULES:
1. Preserve natural spoken pauses ("...") and second-person conversational pacing.
2. DO NOT translate software brand names, UI menu paths, keyboard shortcuts, or formulas (e.g. Excel, Notion, VLOOKUP, Settings, Ctrl+C).
3. Output PLAIN SPOKEN SCRIPT ONLY. No markdown, no quotes, no extra commentary.`;

    try {
      const result = await this.callLLM({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: safeScript }
        ],
        temperature: 0.3,
        maxTokens: 1200
      });

      if (result && result.trim().length > 10) {
        return result.trim();
      }
    } catch (e) {
      console.warn(`Translation to ${targetLanguage} failed:`, e);
    }

    return safeScript;
  }

  /**
   * Generates YouTube metadata (SEO Title, Description, Tags)
   */
  static generateMetadata(topic: string, script: string, channelName: string) {
    const cleanTopic = (topic || 'Software Tutorial').replace(/^how to /i, '').trim();
    const title = `How to ${cleanTopic.charAt(0).toUpperCase() + cleanTopic.slice(1)} (Step-by-Step ${new Date().getFullYear()})`;
    
    const safeScript = script || '';
    const description = `Learn how to ${cleanTopic.toLowerCase()} in this quick step-by-step tutorial for ${new Date().getFullYear()}.

📌 What you will learn in this video:
- Complete walkthrough on how to ${cleanTopic.toLowerCase()}
- Common mistakes to avoid
- Best practices and expert tips

${safeScript.slice(0, 240)}...

🔔 Subscribe to ${channelName || 'this channel'} for new daily software tutorials, tips, and automated workflow guides!
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
    const safeTopic = (topic || 'Tutorial').trim();

    const prompt = `Given video topic: "${safeTopic}", produce a JSON thumbnail brief.
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

    try {
      const llmResult = await this.callLLM({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.4,
        jsonMode: true
      });

      if (llmResult) {
        // Robust JSON extraction using regex in case LLM outputs markdown block
        const jsonMatch = llmResult.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed && parsed.thumbnail_text_line1) {
            return parsed;
          }
        }
      }
    } catch (e) {
      console.warn('Failed to parse thumbnail brief JSON:', e);
    }

    // Deterministic Offline Fallback
    await new Promise(r => setTimeout(r, 300));
    const cleanSoftware = safeTopic.split(' ')[0] || 'App';
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

  /**
   * Generates a high-CTR YouTube thumbnail image plate using Google Vertex AI Express Mode
   * (Nano Banana 2 / gemini-2.5-flash-image / gemini-3-pro-image) or Google AI Studio.
   * Returns a base64 data URI: data:image/png;base64,...
   */
  static async generateThumbnailImage(
    prompt: string,
    options?: {
      aspectRatio?: '16:9' | '1:1' | '9:16';
      model?: 'gemini-2.5-flash-image' | 'gemini-3-pro-image';
      imageSize?: '1K' | '2K';
      referenceImageBase64?: string;
      referenceMimeType?: string;
      timeoutMs?: number;
    }
  ): Promise<string> {
    const geminiKey = StorageService.getApiKey('gemini');
    if (!geminiKey) {
      throw new Error('Google AI Studio / Vertex Express API key is not configured in Settings.');
    }

    const isVertexExpress = geminiKey.startsWith('AQ.');
    const model = options?.model || 'gemini-2.5-flash-image';
    const aspectRatio = options?.aspectRatio || '16:9';
    const imageSize = options?.imageSize || (model === 'gemini-3-pro-image' ? '2K' : '1K');
    const timeoutMs = options?.timeoutMs || 45000;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      if (isVertexExpress) {
        // Vertex AI Express Mode endpoint (supports Nano Banana 2 models with imageConfig + Multimodal Reference)
        const url = `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:generateContent?key=${encodeURIComponent(geminiKey)}`;
        
        const parts: any[] = [];
        if (options?.referenceImageBase64) {
          const cleanB64 = options.referenceImageBase64.replace(/^data:[^;]+;base64,/, '');
          parts.push({
            inlineData: {
              mimeType: options.referenceMimeType || 'image/png',
              data: cleanB64
            }
          });
        }
        parts.push({ text: prompt });

        const body = {
          contents: [
            {
              role: 'user',
              parts
            }
          ],
          generationConfig: {
            responseModalities: ['IMAGE'],
            imageConfig: {
              aspectRatio,
              imageSize
            }
          }
        };

        const res = await fetch(url, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        });

        clearTimeout(timeoutId);

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new Error(`Google Image API HTTP ${res.status}: ${errText.slice(0, 200)}`);
        }

        const json = await res.json();
        const imgPart = json.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData?.mimeType?.startsWith('image/'));

        if (!imgPart?.inlineData?.data) {
          const reason = json.candidates?.[0]?.finishReason || json.promptFeedback?.blockReason;
          throw new Error(`Google Image API returned no image data (Finish Reason: ${reason || 'UNKNOWN'})`);
        }

        const mime = imgPart.inlineData.mimeType || 'image/png';
        return `data:${mime};base64,${imgPart.inlineData.data}`;
      } else {
        // AI Studio fallback / Imagen 3 endpoint
        const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${encodeURIComponent(geminiKey)}`;
        const body = {
          instances: [{ prompt }],
          parameters: {
            sampleCount: 1,
            aspectRatio: aspectRatio === '16:9' ? '16:9' : aspectRatio === '9:16' ? '9:16' : '1:1',
            outputOptions: { mimeType: 'image/png' }
          }
        };

        const res = await fetch(url, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        });

        clearTimeout(timeoutId);

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new Error(`Google AI Studio Imagen API HTTP ${res.status}: ${errText.slice(0, 200)}`);
        }

        const json = await res.json();
        const b64 = json.predictions?.[0]?.bytesBase64Encoded;
        if (!b64) {
          throw new Error('Google AI Studio returned no image prediction.');
        }

        return `data:image/png;base64,${b64}`;
      }
    } catch (err: any) {
      clearTimeout(timeoutId);
      throw new Error(`Thumbnail Image Generation failed: ${err.message}`);
    }
  }
}
