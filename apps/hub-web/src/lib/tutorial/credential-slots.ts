/** Runtime names, not the larger platform catalog's optional/deferred key slots. */
export const TUTORIAL_PROVIDER_KEY_OVERRIDES:Record<string,string>={
 openai:'OPENAI_API_KEY',elevenlabs_official:'ELEVENLABS_API_KEY',google_tts:'GOOGLE_TTS_API_KEY',inworld:'INWORLD_API_KEY',gemini_direct:'GEMINI_FALLBACK_API_KEY',
};
export const TUTORIAL_ADDITIONAL_KEYS=[
 ['AI33_API_KEY_2','AI33 backup key','tts'],
 ['MINIMAX_API_KEY','MiniMax voices','tts'],
 ['QWEN_API_KEY','Qwen writing','script'],
 ['CLAUDE_POOL_API_KEY','Claude pool','script'],
 ['GEMINI_POOL_API_KEY','Gemini pool','script'],
 ['GEMMA_API_KEY','Gemma writing','script'],
 ['OPENROUTER_API_KEYS','OpenRouter keys','script'],
 ['NVIDIA_NIM_API_KEYS','NVIDIA NIM keys','script'],
 ['GROQ_API_KEYS','Groq keys','script'],
 ['GEMINI_API_KEY','Gemini images / translation','images'],
 ['VEOFORGE_API_KEY','VeoForge thumbnails','images'],
] as const;
