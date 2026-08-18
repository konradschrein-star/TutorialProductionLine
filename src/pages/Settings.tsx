import React, { useState } from 'react';
import { Key, Check, Save, Tv, Activity, RefreshCw, Server, Shield, Download, Upload } from 'lucide-react';
import { StorageService, DEFAULT_CHANNELS } from '../services/storageService';

export const Settings: React.FC = () => {
  const [groqKey, setGroqKey] = useState<string>(() => StorageService.getApiKey('groq'));
  const [deepseekKey, setDeepseekKey] = useState<string>(() => StorageService.getApiKey('deepseek'));
  const [elevenKey, setElevenKey] = useState<string>(() => StorageService.getApiKey('elevenlabs'));
  const [fishKey, setFishKey] = useState<string>(() => StorageService.getApiKey('fishaudio'));
  const [openAiKey, setOpenAiKey] = useState<string>(() => StorageService.getApiKey('openai'));
  const [serverUrl, setServerUrl] = useState<string>('http://localhost:3001');
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);

  // Live Test States
  const [testingService, setTestingService] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string }>>({});

  const handleSave = () => {
    StorageService.setApiKey('groq', groqKey);
    StorageService.setApiKey('deepseek', deepseekKey);
    StorageService.setApiKey('elevenlabs', elevenKey);
    StorageService.setApiKey('fishaudio', fishKey);
    StorageService.setApiKey('openai', openAiKey);

    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2000);
  };

  const handleTestGroq = async () => {
    setTestingService('groq');
    if (!groqKey.trim()) {
      setTestResults(prev => ({ ...prev, groq: { ok: false, message: 'No API Key Entered' } }));
      setTestingService(null);
      return;
    }

    try {
      const start = Date.now();
      const res = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { 'Authorization': `Bearer ${groqKey}` }
      });
      const latency = Date.now() - start;
      if (res.ok) {
        setTestResults(prev => ({ ...prev, groq: { ok: true, message: `Connected (${latency}ms)` } }));
      } else {
        setTestResults(prev => ({ ...prev, groq: { ok: false, message: `Auth Failed (${res.status})` } }));
      }
    } catch (e: any) {
      setTestResults(prev => ({ ...prev, groq: { ok: false, message: e.message } }));
    } finally {
      setTestingService(null);
    }
  };

  const handleTestDeepSeek = async () => {
    setTestingService('deepseek');
    if (!deepseekKey.trim()) {
      setTestResults(prev => ({ ...prev, deepseek: { ok: false, message: 'No API Key Entered' } }));
      setTestingService(null);
      return;
    }

    try {
      const start = Date.now();
      const res = await fetch('https://api.deepseek.com/models', {
        headers: { 'Authorization': `Bearer ${deepseekKey}` }
      });
      const latency = Date.now() - start;
      if (res.ok) {
        setTestResults(prev => ({ ...prev, deepseek: { ok: true, message: `Connected (${latency}ms)` } }));
      } else {
        setTestResults(prev => ({ ...prev, deepseek: { ok: false, message: `Auth Failed (${res.status})` } }));
      }
    } catch (e: any) {
      setTestResults(prev => ({ ...prev, deepseek: { ok: false, message: e.message } }));
    } finally {
      setTestingService(null);
    }
  };

  const handleTestServer = async () => {
    setTestingService('server');
    try {
      const start = Date.now();
      const res = await fetch(`${serverUrl}/api/system/health`);
      const latency = Date.now() - start;
      if (res.ok) {
        const data = await res.json();
        setTestResults(prev => ({ ...prev, server: { ok: true, message: `Live (${latency}ms) - Storage: ${data.storageRoot}` } }));
      } else {
        setTestResults(prev => ({ ...prev, server: { ok: false, message: `Server HTTP ${res.status}` } }));
      }
    } catch (e: any) {
      setTestResults(prev => ({ ...prev, server: { ok: false, message: 'Server Offline or Unreachable' } }));
    } finally {
      setTestingService(null);
    }
  };

  const handleExportConfig = () => {
    const config = {
      groqKey: groqKey ? '***' : '',
      deepseekKey: deepseekKey ? '***' : '',
      channels: DEFAULT_CHANNELS,
      serverUrl,
      exportedAt: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tutorial_line_config_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-4">
      
      {/* Header */}
      <div className="pro-panel p-4 rounded-xl flex items-center justify-between">
        <div>
          <h1 className="text-sm font-bold font-display text-foreground">Settings &amp; Model Credentials</h1>
          <p className="text-[11px] text-muted mt-0.5">
            Configure neural voice models, Groq &amp; DeepSeek Flash LLM keys, and Konrad's owned channel bindings.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExportConfig}
            className="btn-outline px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            Backup
          </button>

          <button
            onClick={handleSave}
            className="btn-solid px-4 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5"
          >
            {savedSuccess ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
            {savedSuccess ? 'Saved' : 'Save Changes'}
          </button>
        </div>
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
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold text-foreground">
                Groq API Key (Primary: LLaMA 3.3 70B Scriptwriter &amp; Translator)
              </label>
              <div className="flex items-center gap-2">
                {testResults.groq && (
                  <span className={`text-[10px] font-mono font-bold ${testResults.groq.ok ? 'text-emerald-500' : 'text-red-500'}`}>
                    {testResults.groq.message}
                  </span>
                )}
                <button
                  onClick={handleTestGroq}
                  disabled={testingService === 'groq'}
                  className="text-[10px] font-mono text-muted hover:text-foreground underline flex items-center gap-1"
                >
                  {testingService === 'groq' ? <RefreshCw className="w-2.5 h-2.5 animate-spin" /> : null}
                  Test Ping
                </button>
              </div>
            </div>
            <input
              type="password"
              value={groqKey}
              onChange={(e) => setGroqKey(e.target.value)}
              placeholder="gsk_..."
              className="pro-input w-full rounded-lg px-3 py-2 text-xs font-mono"
            />
          </div>

          {/* DeepSeek Flash Key */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <span>DeepSeek Flash API Key (Fallback: deepseek-chat / V3 High-Throughput)</span>
                <span className="text-[10px] font-mono font-bold px-1.5 py-0.2 rounded bg-surface-300 text-foreground">
                  Flash Engine
                </span>
              </label>
              <div className="flex items-center gap-2">
                {testResults.deepseek && (
                  <span className={`text-[10px] font-mono font-bold ${testResults.deepseek.ok ? 'text-emerald-500' : 'text-red-500'}`}>
                    {testResults.deepseek.message}
                  </span>
                )}
                <button
                  onClick={handleTestDeepSeek}
                  disabled={testingService === 'deepseek'}
                  className="text-[10px] font-mono text-muted hover:text-foreground underline flex items-center gap-1"
                >
                  {testingService === 'deepseek' ? <RefreshCw className="w-2.5 h-2.5 animate-spin" /> : null}
                  Test Ping
                </button>
              </div>
            </div>
            <input
              type="password"
              value={deepseekKey}
              onChange={(e) => setDeepseekKey(e.target.value)}
              placeholder="sk-..."
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

      {/* Hetzner Server Connectivity */}
      <div className="pro-panel p-4 rounded-xl space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className="w-3.5 h-3.5 text-muted" />
            <h3 className="text-xs font-bold font-mono text-foreground uppercase tracking-wider">
              Hetzner Backend Pipeline Server
            </h3>
          </div>

          <div className="flex items-center gap-2">
            {testResults.server && (
              <span className={`text-[10px] font-mono font-bold ${testResults.server.ok ? 'text-emerald-500' : 'text-red-500'}`}>
                {testResults.server.message}
              </span>
            )}
            <button
              onClick={handleTestServer}
              disabled={testingService === 'server'}
              className="text-[10px] font-mono text-muted hover:text-foreground underline flex items-center gap-1"
            >
              {testingService === 'server' ? <RefreshCw className="w-2.5 h-2.5 animate-spin" /> : null}
              Check Health
            </button>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-foreground mb-1">
            Backend API Endpoint URL
          </label>
          <input
            type="text"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder="http://localhost:3001 or http://<HETZNER_IP>:3001"
            className="pro-input w-full rounded-lg px-3 py-2 text-xs font-mono"
          />
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
