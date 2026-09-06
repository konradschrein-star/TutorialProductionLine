/**
 * Multi-Language AI Script & Metadata Localization Engine
 * Handles batch high-retention translation into 10 target languages with natural spoken pauses.
 * Uses Groq LLaMA 3.3 70B with DeepSeek Flash (deepseek-chat) fallback.
 */

export const SUPPORTED_LANGUAGES = [
  { code: 'de', name: 'German', nativeName: 'Deutsch', defaultVoice: 'de-DE-ConradNeural' },
  { code: 'es', name: 'Spanish', nativeName: 'Español', defaultVoice: 'es-ES-AlvaroNeural' },
  { code: 'fr', name: 'French', nativeName: 'Français', defaultVoice: 'fr-FR-HenriNeural' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português', defaultVoice: 'pt-BR-AntonioNeural' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano', defaultVoice: 'it-IT-DiegoNeural' },
  { code: 'nl', name: 'Dutch', nativeName: 'Nederlands', defaultVoice: 'nl-NL-MaartenNeural' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', defaultVoice: 'ja-JP-KeitaNeural' },
  { code: 'ko', name: 'Korean', nativeName: '한국어', defaultVoice: 'ko-KR-InJoonNeural' },
  { code: 'sv', name: 'Swedish', nativeName: 'Svenska', defaultVoice: 'sv-SE-MattiasNeural' }
];

export async function translateScriptAndMetadata({
  originalTopic,
  originalScript,
  targetLang,
  apiKey,
  deepseekApiKey = process.env.DEEPSEEK_API_KEY || ''
}) {
  const langObj = SUPPORTED_LANGUAGES.find(l => l.code === targetLang.code || l.name.toLowerCase() === targetLang.name?.toLowerCase()) || targetLang;

  const prompt = `You are an elite tutorial localization expert.
Translate the following English software tutorial spoken script and YouTube metadata into natural, native ${langObj.name} (${langObj.nativeName}).

CRITICAL INSTRUCTIONS:
1. Spoken Pacing: Keep the conversational, second-person direct tone.
2. Natural Pauses: Preserve the "..." pause markers so the voiceover timing aligns with on-screen tutorial actions.
3. Zero Fluff: Do not add unnecessary introductory phrases.
4. Output JSON Format ONLY with the following exact schema:
{
  "localized_title": "...",
  "localized_script": "...",
  "localized_description": "...",
  "localized_tags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "thumbnail_text_top": "...",
  "thumbnail_text_bottom": "..."
}

English Topic: "${originalTopic}"
English Script:
${originalScript}`;

  // 1. Try Groq (LLaMA 3.3 70B)
  if (apiKey) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
          temperature: 0.4
        })
      });

      if (res.ok) {
        const data = await res.json();
        const parsed = JSON.parse(data.choices[0].message.content);
        return {
          language: langObj.name,
          languageCode: langObj.code,
          ...parsed
        };
      }
      console.warn(`Groq translation failed with status ${res.status}, checking DeepSeek fallback...`);
    } catch (e) {
      console.warn('Groq translation error, trying DeepSeek fallback:', e.message);
    }
  }

  // 2. Try DeepSeek Flash Fallback (deepseek-chat)
  if (deepseekApiKey) {
    try {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${deepseekApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
          temperature: 0.4
        })
      });

      if (res.ok) {
        const data = await res.json();
        const parsed = JSON.parse(data.choices[0].message.content);
        return {
          language: langObj.name,
          languageCode: langObj.code,
          ...parsed
        };
      }
      console.warn(`DeepSeek translation failed with status ${res.status}`);
    } catch (e) {
      console.warn('DeepSeek translation error:', e.message);
    }
  }

  // No translation provider available/succeeded. Do NOT fabricate a fake
  // translation (the previous version returned canned GERMAN for EVERY target
  // language). Return the ORIGINAL English content, explicitly flagged as
  // untranslated so the caller/UI can surface it honestly instead of shipping
  // wrong-language output.
  console.warn(
    `[localization] No Groq/DeepSeek key succeeded for ${langObj.name}; returning untranslated original.`
  );
  return {
    language: langObj.name,
    languageCode: langObj.code,
    translationFailed: true,
    warning: `Translation into ${langObj.name} was not performed (no working translation provider). Original English content returned — configure a Groq or DeepSeek key to enable real localization.`,
    localized_title: originalTopic,
    localized_script: originalScript,
    localized_description: `Learn how to ${originalTopic} in this step-by-step tutorial.`,
    localized_tags: [originalTopic, 'tutorial', 'how to', 'step by step'],
    thumbnail_text_top: 'HOW TO',
    thumbnail_text_bottom: 'STEP BY STEP'
  };
}
