/**
 * Multi-Language AI Script & Metadata Localization Engine
 * Handles batch high-retention translation into 10 target languages with natural spoken pauses.
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
  apiKey
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

  if (!apiKey) {
    // Offline simulation
    await new Promise(r => setTimeout(r, 600));
    return {
      language: langObj.name,
      languageCode: langObj.code,
      localized_title: `[${langObj.name}] ${originalTopic}`,
      localized_script: `In diesem Tutorial zeige ich dir, wie du ${originalTopic} machst... Wenn dir das hilft, abonniere den Kanal... Erstens, öffne die Einstellungen... Zweitens, wähle deine Konfiguration... und klicke auf Speichern...`,
      localized_description: `Lerne wie du ${originalTopic} in diesem kurzen Schritt-für-Schritt-Tutorial machst.\n\n📌 Was du lernst:\n- Komplette Anleitung\n- Tipps & Tricks\n\n🔔 Kanal abonnieren für tägliche Tutorials!`,
      localized_tags: [`${originalTopic} ${langObj.name}`, 'tutorial', 'anleitung', 'schritt für schritt'],
      thumbnail_text_top: 'SCHNELL LERNEN',
      thumbnail_text_bottom: 'SCHRITT FÜR SCHRITT'
    };
  }

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

  if (!res.ok) {
    throw new Error(`Groq translation failed with status ${res.status}`);
  }

  const data = await res.json();
  const parsed = JSON.parse(data.choices[0].message.content);

  return {
    language: langObj.name,
    languageCode: langObj.code,
    ...parsed
  };
}
