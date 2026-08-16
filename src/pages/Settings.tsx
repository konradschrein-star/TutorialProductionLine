import React, { useState } from 'react';
import { Key, Shield, Server, Check, Save, Sparkles, Tv } from 'lucide-react';
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
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      
      {/* Header */}
      <div className="glass-panel p-6 rounded-2xl flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black font-display text-white">System Settings &amp; API Vault</h1>
          <p className="text-xs text-slate-400 mt-1">
            Configure neural voice models, LLM providers, and owned channel bindings.
          </p>
        </div>

        <button
          onClick={handleSave}
          className="px-5 py-2 rounded-xl bg-accent-purple hover:opacity-90 text-white font-bold text-xs flex items-center gap-1.5 shadow-glow transition-all"
        >
          {savedSuccess ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
          {savedSuccess ? 'Saved to Vault' : 'Save Settings'}
        </button>
      </div>

      {/* API Keys Vault */}
      <div className="glass-panel p-6 rounded-2xl space-y-5">
        <div className="flex items-center gap-2">
          <Key className="w-4 h-4 text-accent-purple" />
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">
            API Keys Vault (Encrypted Local Storage)
          </h3>
        </div>

        <div className="space-y-4">
          
          {/* Groq Key */}
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1">
              Groq API Key (LLaMA 3.3 70B Scriptwriter)
            </label>
            <input
              type="password"
              value={groqKey}
              onChange={(e) => setGroqKey(e.target.value)}
              placeholder="gsk_..."
              className="w-full bg-surface-200 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white outline-none focus:border-accent-purple font-mono"
            />
          </div>

          {/* ElevenLabs Key */}
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1">
              ElevenLabs API Key (Studio Quality Neural Voice)
            </label>
            <input
              type="password"
              value={elevenKey}
              onChange={(e) => setElevenKey(e.target.value)}
              placeholder="xi-..."
              className="w-full bg-surface-200 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white outline-none focus:border-accent-purple font-mono"
            />
          </div>

          {/* OpenAI Key */}
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1">
              OpenAI API Key (Fallback TTS &amp; Vision)
            </label>
            <input
              type="password"
              value={openAiKey}
              onChange={(e) => setOpenAiKey(e.target.value)}
              placeholder="sk-proj-..."
              className="w-full bg-surface-200 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white outline-none focus:border-accent-purple font-mono"
            />
          </div>

        </div>
      </div>

      {/* Owned Channels Configuration */}
      <div className="glass-panel p-6 rounded-2xl space-y-4">
        <div className="flex items-center gap-2">
          <Tv className="w-4 h-4 text-accent-cyan" />
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">
            Konrad's Owned Channel Bindings
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {DEFAULT_CHANNELS.map(ch => (
            <div key={ch.id} className="p-4 rounded-xl bg-surface-200 border border-white/5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white">{ch.name}</span>
                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: ch.badgeColor }}
                />
              </div>
              <p className="text-[11px] text-slate-400">{ch.description}</p>
              <div className="text-[10px] text-accent-cyan font-semibold">
                Niche: {ch.niche}
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
};
