import React, { useState } from 'react';
import { Key, Check, Save, Tv } from 'lucide-react';
import { StorageService, DEFAULT_CHANNELS } from '../services/storageService';

export const Settings: React.FC = () => {
  const [groqKey, setGroqKey] = useState<string>(() => StorageService.getApiKey('groq'));
  const [elevenKey, setElevenKey] = useState<string>(() => StorageService.getApiKey('elevenlabs'));
  const [fishKey, setFishKey] = useState<string>(() => StorageService.getApiKey('fishaudio'));
  const [openAiKey, setOpenAiKey] = useState<string>(() => StorageService.getApiKey('openai'));
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);

  const handleSave = () => {
    StorageService.setApiKey('groq', groqKey);
    StorageService.setApiKey('elevenlabs', elevenKey);
    StorageService.setApiKey('fishaudio', fishKey);
    StorageService.setApiKey('openai', openAiKey);

    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2000);
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-4">
      
      {/* Header */}
      <div className="pro-panel p-4 rounded-xl flex items-center justify-between">
        <div>
          <h1 className="text-sm font-bold font-display text-foreground">Settings &amp; Model Credentials</h1>
          <p className="text-[11px] text-muted mt-0.5">
            Configure neural voice models, Groq LLaMA keys, and Konrad's owned channel bindings.
          </p>
        </div>

        <button
          onClick={handleSave}
          className="btn-solid px-4 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5"
        >
          {savedSuccess ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
          {savedSuccess ? 'Saved' : 'Save Changes'}
        </button>
      </div>

      {/* API Keys Vault */}
      <div className="pro-panel p-4 rounded-xl space-y-3.5">
        <div className="flex items-center gap-2">
          <Key className="w-3.5 h-3.5 text-muted" />
          <h3 className="text-xs font-bold font-mono text-foreground uppercase tracking-wider">
            API Keys Vault
          </h3>
        </div>

        <div className="space-y-3">
          
          {/* Groq Key */}
          <div>
            <label className="block text-xs font-semibold text-foreground mb-1">
              Groq API Key (LLaMA 3.3 70B Scriptwriter)
            </label>
            <input
              type="password"
              value={groqKey}
              onChange={(e) => setGroqKey(e.target.value)}
              placeholder="gsk_..."
              className="pro-input w-full rounded-lg px-3 py-2 text-xs font-mono"
            />
          </div>

          {/* ElevenLabs Key */}
          <div>
            <label className="block text-xs font-semibold text-foreground mb-1">
              ElevenLabs API Key (Neural Voice Studio)
            </label>
            <input
              type="password"
              value={elevenKey}
              onChange={(e) => setElevenKey(e.target.value)}
              placeholder="xi-..."
              className="pro-input w-full rounded-lg px-3 py-2 text-xs font-mono"
            />
          </div>

          {/* Fish Audio Key */}
          <div>
            <label className="block text-xs font-semibold text-foreground mb-1">
              Fish Audio API Key (Fish Audio Fast Neural Voices)
            </label>
            <input
              type="password"
              value={fishKey}
              onChange={(e) => setFishKey(e.target.value)}
              placeholder="fish_..."
              className="pro-input w-full rounded-lg px-3 py-2 text-xs font-mono"
            />
          </div>

          {/* OpenAI Key */}
          <div>
            <label className="block text-xs font-semibold text-foreground mb-1">
              OpenAI API Key (Fallback TTS &amp; Vision)
            </label>
            <input
              type="password"
              value={openAiKey}
              onChange={(e) => setOpenAiKey(e.target.value)}
              placeholder="sk-proj-..."
              className="pro-input w-full rounded-lg px-3 py-2 text-xs font-mono"
            />
          </div>

        </div>
      </div>

      {/* Owned Channels */}
      <div className="pro-panel p-4 rounded-xl space-y-3">
        <div className="flex items-center gap-2">
          <Tv className="w-3.5 h-3.5 text-muted" />
          <h3 className="text-xs font-bold font-mono text-foreground uppercase tracking-wider">
            Konrad's Owned Channel Bindings
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
          {DEFAULT_CHANNELS.map(ch => (
            <div key={ch.id} className="p-3.5 rounded-lg bg-surface-200 border border-border space-y-1.5">
              <div className="text-xs font-bold text-foreground">{ch.name}</div>
              <p className="text-[11px] text-muted">{ch.description}</p>
              <div className="text-[10px] text-foreground font-mono font-semibold">
                Niche: {ch.niche}
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
};
