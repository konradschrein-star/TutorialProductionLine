import React, { useState } from 'react';
import { 
  Sparkles, 
  Check, 
  ArrowRight, 
  ArrowLeft, 
  Tv, 
  Key, 
  HardDrive, 
  UserCircle2, 
  X,
  CheckCircle2,
  RefreshCw
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { StorageService } from '../services/storageService';
import { GoogleDriveService } from '../services/googleDriveService';
import { Channel, GoogleDriveConfig, VAUser } from '../types';

interface SetupWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (channel: Channel, user: VAUser) => void;
}

export const SetupWizardModal: React.FC<SetupWizardModalProps> = ({
  isOpen,
  onClose,
  onComplete
}) => {
  const [step, setStep] = useState<number>(1);

  // Form States
  const [vaName, setVaName] = useState<string>('Production VA');
  const [vaEmail, setVaEmail] = useState<string>('va@production.team');
  const [channelName, setChannelName] = useState<string>('Tutorials Master');
  const [channelNiche, setChannelNiche] = useState<string>('Software & App Tutorials');
  const [selectedVoice, setSelectedVoice] = useState<string>('fish-paul-neutral');

  // Keys
  const [groqKey, setGroqKey] = useState<string>(() => StorageService.getApiKey('groq'));
  const [deepseekKey, setDeepseekKey] = useState<string>(() => StorageService.getApiKey('deepseek'));

  // Drive
  const [driveConfig, setDriveConfig] = useState<GoogleDriveConfig>(() => StorageService.getGoogleDriveConfig());
  const [isTestingDrive, setIsTestingDrive] = useState<boolean>(false);
  const [driveTestMessage, setDriveTestMessage] = useState<string>('');

  if (!isOpen) return null;

  const handleTestDrive = async () => {
    setIsTestingDrive(true);
    try {
      const res = await GoogleDriveService.testConnection(driveConfig);
      setDriveTestMessage(res.ok ? '✓ Connected to Google Drive' : res.message);
    } catch (e: any) {
      setDriveTestMessage('Test failed: ' + e.message);
    } finally {
      setIsTestingDrive(false);
    }
  };

  const handleFinish = () => {
    // Save User
    const user: VAUser = {
      id: `user_${Date.now()}`,
      name: vaName,
      email: vaEmail,
      role: 'va',
      assignedChannels: ['custom_primary']
    };
    StorageService.setActiveUser(user);

    // Save Channel
    const channel: Channel = {
      id: 'custom_primary',
      name: channelName,
      niche: channelNiche,
      description: `Primary tutorial channel for ${channelName}`,
      badgeColor: '#00e5ff',
      defaultVoiceId: selectedVoice,
      targetCategory: 'Education & How-To',
      driveFolder: `${channelName.replace(/[^a-zA-Z0-9_-]/g, '_')}/Tutorials`
    };
    StorageService.saveChannel(channel);
    StorageService.setActiveChannel(channel);

    // Save Keys & Drive
    if (groqKey) StorageService.setApiKey('groq', groqKey);
    if (deepseekKey) StorageService.setApiKey('deepseek', deepseekKey);
    StorageService.setGoogleDriveConfig(driveConfig);

    // Mark Onboarding Complete
    StorageService.setOnboardingState({ isCompleted: true, currentStep: 5 });

    try {
      confetti({
        particleCount: 80,
        spread: 60,
        origin: { y: 0.6 }
      });
    } catch {}

    onComplete(channel, user);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-surface-100 border border-border rounded-xl max-w-xl w-full p-6 space-y-5 shadow-elevation animate-fadeIn">
        
        {/* Header & Steps Indicator */}
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-foreground text-background flex items-center justify-center font-bold text-xs">
              {step}
            </div>
            <div>
              <h2 className="text-sm font-bold font-display text-foreground">
                Workstation Onboarding Setup
              </h2>
              <p className="text-[10px] text-muted font-mono">Step {step} of 4</p>
            </div>
          </div>

          <button onClick={onClose} className="p-1 rounded text-muted hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Step 1: User Profile */}
        {step === 1 && (
          <div className="space-y-3 animate-fadeIn">
            <div className="flex items-center gap-2 text-xs font-mono font-bold text-foreground uppercase">
              <UserCircle2 className="w-4 h-4 text-muted" />
              <span>Operator / Virtual Assistant Profile</span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1">Your Name / Alias</label>
              <input
                type="text"
                value={vaName}
                onChange={(e) => setVaName(e.target.value)}
                placeholder="e.g. Alex"
                className="pro-input w-full rounded-lg px-3 py-2 text-xs"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1">Contact Email</label>
              <input
                type="email"
                value={vaEmail}
                onChange={(e) => setVaEmail(e.target.value)}
                placeholder="va@production.team"
                className="pro-input w-full rounded-lg px-3 py-2 text-xs"
              />
            </div>
          </div>
        )}

        {/* Step 2: Channel Profile */}
        {step === 2 && (
          <div className="space-y-3 animate-fadeIn">
            <div className="flex items-center gap-2 text-xs font-mono font-bold text-foreground uppercase">
              <Tv className="w-4 h-4 text-muted" />
              <span>Tutorial Channel Configuration</span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1">Channel Name</label>
              <input
                type="text"
                value={channelName}
                onChange={(e) => setChannelName(e.target.value)}
                placeholder="e.g. App Academy 2026"
                className="pro-input w-full rounded-lg px-3 py-2 text-xs"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1">Niche Focus</label>
              <input
                type="text"
                value={channelNiche}
                onChange={(e) => setChannelNiche(e.target.value)}
                placeholder="e.g. Office Tools, Excel, Notion, B2B SaaS"
                className="pro-input w-full rounded-lg px-3 py-2 text-xs"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1">Default Neural Voice</label>
              <select
                value={selectedVoice}
                onChange={(e) => setSelectedVoice(e.target.value)}
                className="pro-input w-full rounded-lg px-3 py-2 text-xs"
              >
                <option value="fish-paul-neutral">Paul (Fish Audio - Professional Neutral)</option>
                <option value="fish-adam-punchy">Adam (Fish Audio - Energetic Punchy)</option>
                <option value="fish-sarah-calm">Sarah (Fish Audio - Calm Deep Dive)</option>
                <option value="eleven-rachel">Rachel (ElevenLabs - Natural Flow)</option>
              </select>
            </div>
          </div>
        )}

        {/* Step 3: API Vault */}
        {step === 3 && (
          <div className="space-y-3 animate-fadeIn">
            <div className="flex items-center gap-2 text-xs font-mono font-bold text-foreground uppercase">
              <Key className="w-4 h-4 text-muted" />
              <span>AI LLM &amp; Script Generation Keys</span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1">
                Groq API Key (Primary LLaMA 3.3 70B Engine)
              </label>
              <input
                type="password"
                value={groqKey}
                onChange={(e) => setGroqKey(e.target.value)}
                placeholder="gsk_..."
                className="pro-input w-full rounded-lg px-3 py-2 text-xs font-mono"
              />
              <p className="text-[10px] text-muted mt-1 font-mono">
                Leave empty to run in instant local template fallback mode.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1">
                DeepSeek Flash API Key (Fast Failover Engine)
              </label>
              <input
                type="password"
                value={deepseekKey}
                onChange={(e) => setDeepseekKey(e.target.value)}
                placeholder="sk-..."
                className="pro-input w-full rounded-lg px-3 py-2 text-xs font-mono"
              />
            </div>
          </div>
        )}

        {/* Step 4: Google Drive & Launch */}
        {step === 4 && (
          <div className="space-y-3 animate-fadeIn">
            <div className="flex items-center gap-2 text-xs font-mono font-bold text-foreground uppercase">
              <HardDrive className="w-4 h-4 text-emerald-500" />
              <span>Google Drive Automated Delivery</span>
            </div>

            <div className="p-3 rounded-lg bg-surface-200 border border-border space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground">Auto-Upload to Google Drive</span>
                <input
                  type="checkbox"
                  checked={driveConfig.autoUploadOnRender}
                  onChange={(e) => setDriveConfig({ ...driveConfig, autoUploadOnRender: e.target.checked })}
                  className="w-4 h-4 rounded cursor-pointer"
                />
              </div>
              <p className="text-[10px] text-muted">
                Completed videos will automatically be organized into: <br />
                <code className="text-foreground font-bold">{channelName.replace(/\s+/g, '_')}/Tutorials/{'{year}_{month}'}/{'{topic_slug}'}/</code>
              </p>
            </div>

            <div className="flex items-center justify-between pt-1">
              <button
                onClick={handleTestDrive}
                disabled={isTestingDrive}
                className="text-xs font-mono text-muted hover:text-foreground underline flex items-center gap-1"
              >
                {isTestingDrive ? <RefreshCw className="w-3 h-3 animate-spin" /> : null}
                Verify Google Drive Link
              </button>
              {driveTestMessage && (
                <span className="text-xs font-mono text-emerald-500 font-bold">{driveTestMessage}</span>
              )}
            </div>
          </div>
        )}

        {/* Navigation Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-border">
          {step > 1 ? (
            <button
              onClick={() => setStep(s => s - 1)}
              className="btn-outline px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1"
            >
              <ArrowLeft className="w-3 h-3" /> Back
            </button>
          ) : (
            <div />
          )}

          {step < 4 ? (
            <button
              onClick={() => setStep(s => s + 1)}
              className="btn-solid px-4 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5"
            >
              Next Step <ArrowRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              onClick={handleFinish}
              className="btn-solid px-5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-400 text-white"
            >
              <CheckCircle2 className="w-4 h-4" /> Launch Workstation
            </button>
          )}
        </div>

      </div>
    </div>
  );
};
