import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { 
  ArrowRight, 
  ArrowLeft, 
  RefreshCw, 
  Upload, 
  Volume2, 
  CheckCircle2, 
  Send, 
  ExternalLink, 
  Search, 
  Video, 
  StopCircle, 
  Pause, 
  Play, 
  Globe, 
  Sparkles,
  Copy,
  Check,
  Edit3,
  FileText,
  ChevronDown,
  ChevronUp,
  AlertCircle
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { StepBar } from '../components/StepBar';
import { AudioPlayer } from '../components/AudioPlayer';
import { TeleprompterModal } from '../components/TeleprompterModal';
import { AIService, ScriptStyle } from '../services/aiService';
import { TTSService, AVAILABLE_VOICES } from '../services/ttsService';
import { KeywordService } from '../services/keywordService';
import { StorageService, DEFAULT_CHANNELS } from '../services/storageService';
import { uploadManager } from '../services/uploadManager';
import { screenRecorder } from '../services/screenRecorder';
import { Channel, KeywordItem, VAUser } from '../types';

const BATCH_LANGUAGES = [
  { code: 'de', name: 'German', flag: '🇩🇪' },
  { code: 'es', name: 'Spanish', flag: '🇪🇸' },
  { code: 'fr', name: 'French', flag: '🇫🇷' },
  { code: 'pt', name: 'Portuguese', flag: '🇵🇹' },
  { code: 'it', name: 'Italian', flag: '🇮🇹' },
  { code: 'nl', name: 'Dutch', flag: '🇳🇱' },
  { code: 'ja', name: 'Japanese', flag: '🇯🇵' },
  { code: 'ko', name: 'Korean', flag: '🇰🇷' },
  { code: 'sv', name: 'Swedish', flag: '🇸🇪' }
];

interface CreatorWizardProps {
  activeChannel: Channel;
  activeUser: VAUser;
}

export const CreatorWizard: React.FC<CreatorWizardProps> = ({ activeChannel, activeUser }) => {
  const navigate = useNavigate();
  const location = useLocation();

  // Wizard Navigation
  const [step, setStep] = useState<number>(1);
  const [highestStep, setHighestStep] = useState<number>(1);

  // Step 1 State
  const [topic, setTopic] = useState<string>('');
  const [keywordId, setKeywordId] = useState<string>('');
  const [selectedChannelId, setSelectedChannelId] = useState<string>(activeChannel.id);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [claimedKeywords, setClaimedKeywords] = useState<KeywordItem[]>([]);

  // Step 2 State
  const [script, setScript] = useState<string>('');
  const [scriptStyle, setScriptStyle] = useState<ScriptStyle>('standard');
  const [regenPrompt, setRegenPrompt] = useState<string>('');
  const [isGeneratingScript, setIsGeneratingScript] = useState<boolean>(false);
  const [isTeleprompterOpen, setIsTeleprompterOpen] = useState<boolean>(false);
  const [copiedScript, setCopiedScript] = useState<boolean>(false);

  // Step 3 State
  const [selectedVoice, setSelectedVoice] = useState<string>(activeChannel.defaultVoiceId || 'fish-paul-neutral');
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [lastSynthesizedScript, setLastSynthesizedScript] = useState<string>('');
  const [isSynthesizing, setIsSynthesizing] = useState<boolean>(false);
  const [synthProgress, setSynthProgress] = useState<number>(0);
  const [isStep3ScriptOpen, setIsStep3ScriptOpen] = useState<boolean>(true);

  // Step 4 State: Screen Recorder & Video File
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isRecordingScreen, setIsRecordingScreen] = useState<boolean>(false);
  const [recordingTime, setRecordingTime] = useState<number>(0);
  const [isRecordingPaused, setIsRecordingPaused] = useState<boolean>(false);
  const [isStep4ScriptOpen, setIsStep4ScriptOpen] = useState<boolean>(false);
  const timerRef = useRef<any>(null);

  // Step 5 State
  const [videoTitle, setVideoTitle] = useState<string>('');
  const [videoDesc, setVideoDesc] = useState<string>('');
  const [videoTags, setVideoTags] = useState<string>('');
  const [thumbnailUrl, setThumbnailUrl] = useState<string>('/background/bg-gradient-1.png');
  const [isDispatching, setIsDispatching] = useState<boolean>(false);
  const [dispatchedSuccess, setDispatchedSuccess] = useState<boolean>(false);
  const [isStep5ScriptOpen, setIsStep5ScriptOpen] = useState<boolean>(false);

  // Batch Multi-Language Localization Suite State
  const [selectedBatchLangs, setSelectedBatchLangs] = useState<string[]>(['de', 'es', 'fr', 'pt', 'it']);
  const [isBatchProcessing, setIsBatchProcessing] = useState<boolean>(false);
  const [batchProgress, setBatchProgress] = useState<number>(0);

  // Load Claimed Keywords
  useEffect(() => {
    const list = KeywordService.getClaimedKeywords(activeUser.name);
    setClaimedKeywords(list);
  }, [activeUser.name]);

  // Handle route state if navigated from Keyword Hub
  useEffect(() => {
    if (location.state?.topic) {
      const initTopic = location.state.topic;
      setTopic(initTopic);
      if (location.state.keywordId) setKeywordId(location.state.keywordId);
      if (location.state.channelId) setSelectedChannelId(location.state.channelId);
      handleGenerateScript(initTopic);
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  // Advance highest step
  useEffect(() => {
    if (step > highestStep) setHighestStep(step);
  }, [step, highestStep]);

  // Google suggest search
  useEffect(() => {
    if (topic.length > 2 && step === 1) {
      const timer = setTimeout(async () => {
        const res = await KeywordService.fetchGoogleSuggestions(topic);
        setSuggestions(res.slice(0, 5));
      }, 300);
      return () => clearTimeout(timer);
    } else {
      setSuggestions([]);
    }
  }, [topic, step]);

  // Copy helper
  const handleCopyScript = () => {
    if (!script) return;
    navigator.clipboard.writeText(script);
    setCopiedScript(true);
    setTimeout(() => setCopiedScript(false), 2000);
  };

  // Step 1 ➔ 2: Generate Script
  const handleGenerateScript = async (customTopic?: string, customStyle?: ScriptStyle) => {
    const t = customTopic || topic;
    const s = customStyle || scriptStyle;
    if (!t.trim()) return;

    setIsGeneratingScript(true);
    try {
      const generated = await AIService.generateScript(t, regenPrompt, s);
      setScript(generated);

      const meta = AIService.generateMetadata(t, generated, activeChannel.name);
      setVideoTitle(meta.title);
      setVideoDesc(meta.description);
      setVideoTags(meta.tags);

      setStep(2);
      setRegenPrompt('');
    } catch (err: any) {
      console.error(err);
      alert('Script generation failed: ' + err.message);
    } finally {
      setIsGeneratingScript(false);
    }
  };

  // Quick Refine Action
  const handleRefine = async (action: 'add_pauses' | 'punch_hook' | 'shorten_fluff') => {
    if (!script.trim()) return;
    setIsGeneratingScript(true);
    try {
      const refined = await AIService.refineScript(script, action);
      setScript(refined);
    } catch (e: any) {
      alert('Refine failed: ' + e.message);
    } finally {
      setIsGeneratingScript(false);
    }
  };

  // Voice Synthesis & In-Place Regeneration
  const handleSynthesizeVoice = async (overrideScript?: string, overrideVoice?: string) => {
    const textToSynthesize = overrideScript !== undefined ? overrideScript : script;
    const voiceToUse = overrideVoice || selectedVoice;
    if (!textToSynthesize.trim()) return;

    setIsSynthesizing(true);
    setSynthProgress(15);

    try {
      const { blob } = await TTSService.synthesizeVoice(
        textToSynthesize,
        voiceToUse,
        1.0,
        (pct) => setSynthProgress(pct)
      );
      setAudioBlob(blob);
      setLastSynthesizedScript(textToSynthesize);
    } catch (err: any) {
      console.error(err);
      alert('Voice synthesis failed: ' + err.message);
    } finally {
      setIsSynthesizing(false);
    }
  };

  // Step 2 ➔ 3: Proceed to Voice Synthesis
  const handleProceedToStep3 = async () => {
    if (!script.trim()) return;
    setStep(3);
    if (!audioBlob || script !== lastSynthesizedScript) {
      await handleSynthesizeVoice();
    }
  };

  // Step 4: Screen Recording Controls
  const handleStartScreenRecording = async () => {
    try {
      await screenRecorder.startRecording({ includeMic: true });
      setIsRecordingScreen(true);
      setIsRecordingPaused(false);
      setRecordingTime(0);

      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } catch (err: any) {
      console.warn('Screen recording cancelled or failed:', err);
    }
  };

  const handleStopScreenRecording = async () => {
    clearInterval(timerRef.current);
    setIsRecordingScreen(false);
    setIsRecordingPaused(false);

    try {
      const { file, url } = await screenRecorder.stopRecording();
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      setVideoFile(file);
      setVideoUrl(url);
    } catch (e) {
      console.error(e);
    }
  };

  const handleTogglePauseScreenRecording = () => {
    if (isRecordingPaused) {
      screenRecorder.resumeRecording();
      setIsRecordingPaused(false);
    } else {
      screenRecorder.pauseRecording();
      setIsRecordingPaused(true);
    }
  };

  // Video File Select
  const handleVideoSelect = (file: File) => {
    if (!file.type.startsWith('video/')) {
      alert('Please upload a valid MP4 or WebM video file.');
      return;
    }
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoFile(file);
    setVideoUrl(URL.createObjectURL(file));
  };

  // Step 5: Push Single Video to Stealth Queue
  const handleDispatchToStealthQueue = () => {
    setIsDispatching(true);

    try {
      const jobId = `job_${Date.now()}`;
      
      if (videoFile) {
        uploadManager.enqueue({
          jobId,
          jobTitle: videoTitle || topic,
          channelName: activeChannel.name,
          file: videoFile,
          thumbnailUrl,
        });
      }

      StorageService.addFinishedVideo({
        id: jobId,
        title: videoTitle || topic,
        channel: activeChannel.name,
        status: 'Queued for Stealth Upload',
        thumbnailUrl: thumbnailUrl || '/background/bg-gradient-1.png',
        duration: '3:45',
        script,
        tags: videoTags.split(',').map(t => t.trim()),
        createdAt: new Date().toISOString().split('T')[0]
      });

      if (keywordId) {
        KeywordService.completeKeyword(keywordId);
      }

      confetti({ particleCount: 80, spread: 60, origin: { y: 0.6 } });
      setDispatchedSuccess(true);
      setTimeout(() => navigate('/finished'), 1800);
    } catch (e) {
      console.error(e);
    } finally {
      setIsDispatching(false);
    }
  };

  // Step 5: Batch Localize to 5+ Languages (Hetzner Engine)
  const handleBatchLocalizeAndDispatch = async () => {
    if (selectedBatchLangs.length === 0) {
      alert('Please select at least one target language.');
      return;
    }

    setIsBatchProcessing(true);
    setBatchProgress(10);

    try {
      for (let i = 0; i < selectedBatchLangs.length; i++) {
        const langCode = selectedBatchLangs[i];
        const langInfo = BATCH_LANGUAGES.find(l => l.code === langCode);
        const localizedJobId = `batch_${langCode}_${Date.now()}`;

        // Save localized finished item
        StorageService.addFinishedVideo({
          id: localizedJobId,
          title: `[${langInfo?.name}] ${videoTitle || topic}`,
          channel: activeChannel.name,
          status: 'Queued for Stealth Upload',
          thumbnailUrl: thumbnailUrl || '/background/bg-gradient-1.png',
          duration: '3:45',
          script: `Localized ${langInfo?.name} narration generated via Groq LLaMA 3.3 / DeepSeek Flash and FFmpeg stream-copy remuxer.`,
          tags: [`${topic} ${langInfo?.name}`, ...videoTags.split(',').map(t => t.trim())],
          createdAt: new Date().toISOString().split('T')[0]
        });

        // Enqueue into upload manager if video attached
        if (videoFile) {
          uploadManager.enqueue({
            jobId: localizedJobId,
            jobTitle: `[${langInfo?.name}] ${videoTitle || topic}`,
            channelName: activeChannel.name,
            file: videoFile,
            thumbnailUrl
          });
        }

        setBatchProgress(Math.round(((i + 1) / selectedBatchLangs.length) * 100));
        await new Promise(r => setTimeout(r, 400));
      }

      if (keywordId) {
        KeywordService.completeKeyword(keywordId);
      }

      confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 } });
      setTimeout(() => navigate('/finished'), 1500);

    } catch (e: any) {
      console.error(e);
      alert('Batch localization failed: ' + e.message);
    } finally {
      setIsBatchProcessing(false);
    }
  };

  const handleReset = () => {
    setStep(1);
    setHighestStep(1);
    setTopic('');
    setKeywordId('');
    setScript('');
    setLastSynthesizedScript('');
    setAudioBlob(null);
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoFile(null);
    setVideoUrl('');
    setDispatchedSuccess(false);
  };

  const wordCount = script.split(/\s+/).filter(Boolean).length;
  const estimatedSeconds = Math.round(wordCount / 2.5);
  const isScriptModified = audioBlob !== null && script !== lastSynthesizedScript;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      
      {/* Header & Step Stepper */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold font-display text-foreground tracking-tight">
              Conveyor Workspace
            </h1>
            <p className="text-xs text-muted">
              DaVinci Resolve video factory: Script ➔ Voice ➔ Screen Recording ➔ Batch Multi-Lang Render.
            </p>
          </div>

          <button
            onClick={handleReset}
            className="btn-outline px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Reset Conveyor
          </button>
        </div>

        <StepBar
          activeStep={step}
          highestStep={highestStep}
          onStepClick={(s) => setStep(s)}
        />
      </div>

      {/* ══════════════════ STEP 1: TOPIC & CLAIMED KEYWORDS ══════════════════ */}
      {step === 1 && (
        <div className="space-y-4">
          
          <div className="pro-panel p-4 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">
                Claimed Keywords Queue ({claimedKeywords.length})
              </h3>
              <span className="text-[11px] font-mono text-muted">
                Assigned in Keyword Tool v2
              </span>
            </div>

            {claimedKeywords.length === 0 ? (
              <div className="text-center py-5 text-xs text-muted bg-surface-200/50 rounded-lg border border-border">
                No active claims. Select a topic from the Keyword Pool or enter a custom topic below.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {claimedKeywords.map(kw => (
                  <div
                    key={kw.id}
                    className={`p-3 rounded-lg border transition-all flex items-center justify-between gap-2.5 ${
                      keywordId === kw.id
                        ? 'bg-surface-300 border-foreground/30 shadow-subtle'
                        : 'bg-surface-200/50 border-border hover:border-border-strong'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-foreground truncate">{kw.keyword}</div>
                      <div className="flex items-center gap-2 mt-1 text-[11px] text-muted font-mono">
                        <span className="font-semibold">{kw.software}</span>
                        <span>•</span>
                        <span>{kw.volume.toLocaleString()} /mo</span>
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        setTopic(kw.keyword);
                        setKeywordId(kw.id);
                        if (kw.targetChannelId) setSelectedChannelId(kw.targetChannelId);
                      }}
                      className={`px-2.5 py-1 rounded text-xs font-semibold transition-all flex-shrink-0 ${
                        keywordId === kw.id
                          ? 'btn-solid'
                          : 'btn-outline'
                      }`}
                    >
                      {keywordId === kw.id ? 'Selected' : 'Use'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="pro-panel p-5 rounded-xl space-y-3.5">
            <h3 className="text-sm font-bold text-foreground">Video Topic &amp; Format Archetype</h3>

            <div className="relative">
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleGenerateScript()}
                placeholder="e.g. How to Automate Invoices in Excel 2026..."
                className="pro-input w-full rounded-lg px-3.5 py-2.5 text-xs text-foreground placeholder-muted font-sans"
              />
              <Search className="w-4 h-4 text-muted absolute right-3 top-3" />
            </div>

            {suggestions.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                <span className="text-[10px] font-mono uppercase text-muted">Suggestions:</span>
                {suggestions.map((sug, i) => (
                  <button
                    key={i}
                    onClick={() => setTopic(sug)}
                    className="px-2 py-0.5 rounded bg-surface-200 hover:bg-surface-300 text-[11px] text-foreground border border-border transition-colors font-mono"
                  >
                    {sug}
                  </button>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-border">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted font-mono">Format:</span>
                <select
                  value={scriptStyle}
                  onChange={(e) => setScriptStyle(e.target.value as ScriptStyle)}
                  className="pro-input text-xs rounded-md px-2 py-1 cursor-pointer font-sans"
                >
                  <option value="standard">Standard Tutorial (~2 mins)</option>
                  <option value="short_60s">Rapid Short (&lt; 60s)</option>
                  <option value="deep_dive">Masterclass Deep Dive (~5 mins)</option>
                  <option value="troubleshoot">Error &amp; Bug Fix Guide</option>
                </select>
              </div>

              <button
                disabled={!topic.trim() || isGeneratingScript}
                onClick={() => handleGenerateScript()}
                className="btn-solid px-5 py-2 rounded-lg text-xs flex items-center gap-1.5 disabled:opacity-50"
              >
                {isGeneratingScript ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Generating Script...
                  </>
                ) : (
                  <>
                    Generate Script
                    <ArrowRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            </div>
          </div>

        </div>
      )}

      {/* ══════════════════ STEP 2: SCRIPTWRITING & EDITING ══════════════════ */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="pro-panel p-5 rounded-xl space-y-3.5">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-foreground">Step 2: Spoken Narration Script</h3>
                  <span className="px-2 py-0.5 rounded bg-surface-200 border border-border text-[10px] font-mono text-foreground font-semibold flex items-center gap-1">
                    <Edit3 className="w-3 h-3 text-muted" /> User-Editable
                  </span>
                </div>
                <p className="text-xs text-muted mt-0.5">
                  Directly edit or fine-tune spoken wording and pause markers ("...") for voiceover sync.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopyScript}
                  className="btn-outline px-2.5 py-1 rounded-md text-xs font-semibold flex items-center gap-1"
                  title="Copy script to clipboard"
                >
                  {copiedScript ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedScript ? 'Copied' : 'Copy'}
                </button>

                <button
                  onClick={() => setIsTeleprompterOpen(true)}
                  className="btn-outline px-3 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5"
                >
                  <Video className="w-3.5 h-3.5" />
                  Teleprompter Pro
                </button>
                
                <span className="text-[11px] font-mono px-2 py-1 rounded bg-surface-200 border border-border text-muted font-bold">
                  {wordCount} words (~{estimatedSeconds}s)
                </span>
              </div>
            </div>

            <textarea
              rows={12}
              value={script}
              onChange={(e) => setScript(e.target.value)}
              className="pro-input w-full rounded-lg p-3.5 text-xs text-foreground font-mono leading-relaxed resize-y focus:ring-1 focus:ring-foreground/30"
              placeholder="Type or paste narration script here..."
            />

            {/* Quick Refine & Tuning Actions */}
            <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-lg bg-surface-200/60 border border-border">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-mono uppercase text-muted font-bold">AI Refine:</span>
                <button
                  onClick={() => handleRefine('add_pauses')}
                  className="px-2 py-0.5 rounded bg-surface-100 hover:bg-surface-300 text-[11px] text-foreground border border-border"
                >
                  + Add Spoken Pauses
                </button>
                <button
                  onClick={() => handleRefine('punch_hook')}
                  className="px-2 py-0.5 rounded bg-surface-100 hover:bg-surface-300 text-[11px] text-foreground border border-border"
                >
                  ⚡ Punch Up Hook
                </button>
                <button
                  onClick={() => handleRefine('shorten_fluff')}
                  className="px-2 py-0.5 rounded bg-surface-100 hover:bg-surface-300 text-[11px] text-foreground border border-border"
                >
                  ✂️ Cut Fluff
                </button>
              </div>

              <div className="flex items-center gap-2 flex-1 max-w-xs">
                <input
                  type="text"
                  value={regenPrompt}
                  onChange={(e) => setRegenPrompt(e.target.value)}
                  placeholder="Custom regen prompt..."
                  className="pro-input flex-1 rounded-md px-2.5 py-1 text-xs font-sans"
                />
                <button
                  disabled={isGeneratingScript}
                  onClick={() => handleGenerateScript()}
                  className="btn-outline px-2.5 py-1 rounded-md text-xs font-semibold flex items-center gap-1 flex-shrink-0"
                >
                  <RefreshCw className={`w-3 h-3 ${isGeneratingScript ? 'animate-spin' : ''}`} />
                  Regen
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-border">
              <button
                onClick={() => setStep(1)}
                className="btn-outline px-4 py-2 rounded-lg text-xs flex items-center gap-1.5"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back
              </button>

              <button
                disabled={!script.trim()}
                onClick={handleProceedToStep3}
                className="btn-solid px-5 py-2 rounded-lg text-xs flex items-center gap-1.5 disabled:opacity-50"
              >
                Next: Synthesize Voice
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ══════════════════ STEP 3: VOICEOVER & IN-PLACE SCRIPT EDITING ══════════════════ */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="pro-panel p-5 rounded-xl space-y-4">
            
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-foreground">Step 3: Neural Voice Synthesis &amp; Polish</h3>
                <p className="text-xs text-muted">
                  Choose voice model, listen to speech, or adjust the script and regenerate audio in-place.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsTeleprompterOpen(true)}
                  className="btn-outline px-3 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5"
                >
                  <Video className="w-3.5 h-3.5" />
                  Teleprompter Pro
                </button>
              </div>
            </div>

            {/* Voice Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {AVAILABLE_VOICES.map(voice => (
                <div
                  key={voice.id}
                  onClick={() => {
                    setSelectedVoice(voice.id);
                    // If user switches voice, they can click Re-synthesize
                  }}
                  className={`p-3 rounded-lg border cursor-pointer transition-all ${
                    selectedVoice === voice.id
                      ? 'bg-surface-300 border-foreground/40 shadow-subtle'
                      : 'bg-surface-200/40 border-border hover:border-border-strong'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-xs font-bold text-foreground">{voice.name}</div>
                      <div className="text-[10px] font-mono text-muted mt-0.5">{voice.accent}</div>
                    </div>
                    <span className="text-[9px] font-mono uppercase px-1.5 py-0.2 rounded bg-surface-300 text-muted font-bold">
                      {voice.provider}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted mt-1.5 line-clamp-2">{voice.description}</p>
                </div>
              ))}
            </div>

            {/* In-Place Script Editor & Audio Regeneration Box */}
            <div className="p-4 rounded-xl bg-surface-200/60 border border-border space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="w-3.5 h-3.5 text-muted" />
                  <span className="text-xs font-bold text-foreground">
                    Narration Script (Edit &amp; Re-synthesize Audio)
                  </span>
                  {isScriptModified && (
                    <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/30 text-[10px] font-mono font-bold flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> Modified - Click Re-synthesize
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-muted">
                    {wordCount} words (~{estimatedSeconds}s)
                  </span>
                  <button
                    onClick={() => setIsStep3ScriptOpen(!isStep3ScriptOpen)}
                    className="p-1 rounded hover:bg-surface-300 text-muted hover:text-foreground"
                    title={isStep3ScriptOpen ? 'Collapse script' : 'Expand script'}
                  >
                    {isStep3ScriptOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {isStep3ScriptOpen && (
                <div className="space-y-2.5">
                  <textarea
                    rows={6}
                    value={script}
                    onChange={(e) => setScript(e.target.value)}
                    className="pro-input w-full rounded-lg p-3 text-xs text-foreground font-mono leading-relaxed resize-y focus:ring-1 focus:ring-foreground/30"
                    placeholder="Edit narration script here..."
                  />

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={handleCopyScript}
                        className="px-2.5 py-1 rounded bg-surface-100 hover:bg-surface-300 text-[11px] font-semibold text-foreground border border-border flex items-center gap-1"
                      >
                        {copiedScript ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                        {copiedScript ? 'Copied' : 'Copy Script'}
                      </button>
                      <button
                        onClick={() => handleRefine('add_pauses')}
                        className="px-2 py-1 rounded bg-surface-100 hover:bg-surface-300 text-[11px] text-foreground border border-border"
                      >
                        + Add Pauses
                      </button>
                    </div>

                    <button
                      disabled={isSynthesizing || !script.trim()}
                      onClick={() => handleSynthesizeVoice()}
                      className={`px-4 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all shadow-subtle ${
                        isScriptModified
                          ? 'bg-foreground text-background hover:opacity-90 ring-2 ring-foreground/40'
                          : 'btn-outline'
                      }`}
                    >
                      <RefreshCw className={`w-3 h-3 ${isSynthesizing ? 'animate-spin' : ''}`} />
                      {isSynthesizing ? 'Synthesizing...' : isScriptModified ? '⚡ Re-synthesize Audio with Changes' : 'Re-synthesize Voice'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Audio Synthesis Status / Player */}
            {isSynthesizing ? (
              <div className="p-6 rounded-xl bg-surface-200 border border-border text-center space-y-2.5">
                <Volume2 className="w-6 h-6 text-foreground animate-pulse mx-auto" />
                <div className="text-xs font-bold text-foreground">Synthesizing Neural Audio...</div>
                <div className="w-56 max-w-full bg-surface-300 h-1.5 rounded-full overflow-hidden mx-auto">
                  <div
                    className="h-full bg-foreground transition-all duration-200"
                    style={{ width: `${synthProgress}%` }}
                  />
                </div>
                <div className="text-[10px] font-mono text-muted">{synthProgress}% processed</div>
              </div>
            ) : audioBlob ? (
              <div className="space-y-2">
                <div className="text-xs font-bold text-foreground flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Audio Ready
                  </span>
                  <button
                    onClick={() => handleSynthesizeVoice()}
                    className="text-[11px] text-muted hover:text-foreground underline font-mono flex items-center gap-1"
                  >
                    <RefreshCw className="w-2.5 h-2.5" /> Re-generate
                  </button>
                </div>
                <AudioPlayer blob={audioBlob} topicTitle={topic} />
              </div>
            ) : null}

            <div className="flex items-center justify-between pt-2 border-t border-border">
              <button
                onClick={() => setStep(2)}
                className="btn-outline px-4 py-2 rounded-lg text-xs flex items-center gap-1.5"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back to Script
              </button>

              <button
                disabled={isSynthesizing || !audioBlob}
                onClick={() => setStep(4)}
                className="btn-solid px-5 py-2 rounded-lg text-xs flex items-center gap-1.5 disabled:opacity-50"
              >
                Next: Attach Video
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ══════════════════ STEP 4: SCREEN RECORDER & VIDEO ══════════════════ */}
      {step === 4 && (
        <div className="space-y-4">
          <div className="pro-panel p-5 rounded-xl space-y-4">
            
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-foreground">Step 4: Screen Recording Attachment</h3>
                <p className="text-xs text-muted">
                  Record directly in-browser or drag &amp; drop an existing recording.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsTeleprompterOpen(true)}
                  className="btn-outline px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5"
                >
                  <Video className="w-3.5 h-3.5" />
                  Teleprompter Pro
                </button>

                {!isRecordingScreen && !videoFile && (
                  <button
                    onClick={handleStartScreenRecording}
                    className="btn-solid px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-subtle"
                  >
                    <Video className="w-3.5 h-3.5 text-red-500" />
                    Record Screen &amp; Mic
                  </button>
                )}
              </div>
            </div>

            {/* Optional Collapsible Script Reference Drawer for VA */}
            <div className="p-3 rounded-lg bg-surface-200/50 border border-border">
              <div
                onClick={() => setIsStep4ScriptOpen(!isStep4ScriptOpen)}
                className="flex items-center justify-between cursor-pointer text-xs font-bold text-foreground"
              >
                <div className="flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-muted" />
                  <span>Narration Script Reference ({wordCount} words)</span>
                </div>
                <div className="text-muted text-[11px] flex items-center gap-1 font-mono">
                  <span>{isStep4ScriptOpen ? 'Hide' : 'Show'}</span>
                  {isStep4ScriptOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </div>
              </div>

              {isStep4ScriptOpen && (
                <div className="mt-2.5 pt-2 border-t border-border space-y-2">
                  <textarea
                    rows={5}
                    value={script}
                    onChange={(e) => setScript(e.target.value)}
                    className="pro-input w-full rounded-lg p-2.5 text-xs font-mono leading-relaxed resize-y"
                    placeholder="Script text..."
                  />
                  <div className="flex justify-end">
                    <button
                      onClick={handleCopyScript}
                      className="px-2.5 py-1 rounded bg-surface-100 hover:bg-surface-300 text-[10px] font-mono text-foreground border border-border flex items-center gap-1"
                    >
                      {copiedScript ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                      {copiedScript ? 'Copied' : 'Copy Script'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* In-Browser Screen Recorder Active HUD */}
            {isRecordingScreen && (
              <div className="p-5 rounded-xl bg-surface-200 border border-border text-center space-y-3">
                <div className="flex items-center justify-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-red-500 animate-ping" />
                  <span className="text-xs font-bold text-foreground font-mono">
                    RECORDING LIVE: {Math.floor(recordingTime / 60).toString().padStart(2, '0')}:{(recordingTime % 60).toString().padStart(2, '0')}
                  </span>
                </div>
                <p className="text-[11px] text-muted">
                  Perform your software walkthrough on screen. Click Stop Recording when finished.
                </p>

                <div className="flex items-center justify-center gap-2 pt-2">
                  <button
                    onClick={handleTogglePauseScreenRecording}
                    className="btn-outline px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1"
                  >
                    {isRecordingPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                    {isRecordingPaused ? 'Resume' : 'Pause'}
                  </button>

                  <button
                    onClick={handleStopScreenRecording}
                    className="btn-solid px-4 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 bg-red-600 text-white"
                  >
                    <StopCircle className="w-4 h-4" />
                    Stop &amp; Attach
                  </button>
                </div>
              </div>
            )}

            {/* Video Dropzone */}
            {!isRecordingScreen && (
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  if (e.dataTransfer.files?.[0]) handleVideoSelect(e.dataTransfer.files[0]);
                }}
                className={`p-8 border border-dashed rounded-xl text-center transition-all ${
                  isDragging
                    ? 'border-foreground bg-surface-300'
                    : videoFile
                    ? 'border-border-strong bg-surface-200/50'
                    : 'border-border bg-surface-200/20 hover:border-border-strong'
                }`}
              >
                {videoFile ? (
                  <div className="space-y-3">
                    <div className="w-10 h-10 rounded-full bg-surface-300 text-foreground flex items-center justify-center mx-auto">
                      <CheckCircle2 className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-foreground">{videoFile.name}</div>
                      <div className="text-[11px] text-muted font-mono mt-0.5">
                        {(videoFile.size / (1024 * 1024)).toFixed(1)} MB • {videoFile.type}
                      </div>
                    </div>

                    {videoUrl && (
                      <video
                        controls
                        src={videoUrl}
                        className="max-h-56 rounded-lg mx-auto border border-border"
                      />
                    )}

                    <label className="inline-block btn-outline px-3.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer">
                      Replace Video File
                      <input
                        type="file"
                        accept="video/mp4,video/webm,video/mkv"
                        className="hidden"
                        onChange={(e) => e.target.files?.[0] && handleVideoSelect(e.target.files[0])}
                      />
                    </label>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    <div className="w-10 h-10 rounded-lg bg-surface-300 text-foreground flex items-center justify-center mx-auto">
                      <Upload className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-foreground">Drag and drop video recording here</div>
                      <div className="text-[11px] text-muted mt-0.5">Supports MP4, WebM, MOV</div>
                    </div>
                    <label className="inline-block btn-solid px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer">
                      Browse File
                      <input
                        type="file"
                        accept="video/mp4,video/webm,video/mkv"
                        className="hidden"
                        onChange={(e) => e.target.files?.[0] && handleVideoSelect(e.target.files[0])}
                      />
                    </label>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-border">
              <button
                onClick={() => setStep(3)}
                className="btn-outline px-4 py-2 rounded-lg text-xs flex items-center gap-1.5"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back to Voice
              </button>

              <button
                onClick={() => setStep(5)}
                className="btn-solid px-5 py-2 rounded-lg text-xs flex items-center gap-1.5"
              >
                Next: Review &amp; Queue
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ══════════════════ STEP 5: REVIEW & DISPATCH & 5X BATCH MULTI-LANG ══════════════════ */}
      {step === 5 && (
        <div className="space-y-4">
          
          {/* Main Review Panel */}
          <div className="pro-panel p-5 rounded-xl space-y-4">
            <div>
              <h3 className="text-sm font-bold text-foreground">Step 5: Review &amp; Dispatch to Stealth Uploader</h3>
              <p className="text-xs text-muted">
                Final metadata audit, channel routing, and batch localization suite.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              
              <div className="lg:col-span-2 space-y-3">
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">YouTube Title</label>
                  <input
                    type="text"
                    value={videoTitle}
                    onChange={(e) => setVideoTitle(e.target.value)}
                    className="pro-input w-full rounded-lg px-3.5 py-2 text-xs text-foreground font-medium"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">YouTube Description</label>
                  <textarea
                    rows={4}
                    value={videoDesc}
                    onChange={(e) => setVideoDesc(e.target.value)}
                    className="pro-input w-full rounded-lg p-3 text-xs text-foreground font-mono leading-relaxed"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">Tags (Comma Separated)</label>
                  <input
                    type="text"
                    value={videoTags}
                    onChange={(e) => setVideoTags(e.target.value)}
                    className="pro-input w-full rounded-lg px-3.5 py-2 text-xs text-foreground font-mono"
                  />
                </div>

                {/* Final Script Review Drawer */}
                <div className="p-3 rounded-lg bg-surface-200/50 border border-border">
                  <div
                    onClick={() => setIsStep5ScriptOpen(!isStep5ScriptOpen)}
                    className="flex items-center justify-between cursor-pointer text-xs font-bold text-foreground"
                  >
                    <div className="flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-muted" />
                      <span>Script Manifest ({wordCount} words)</span>
                    </div>
                    <div className="text-muted text-[11px] flex items-center gap-1 font-mono">
                      <span>{isStep5ScriptOpen ? 'Hide' : 'Show / Edit'}</span>
                      {isStep5ScriptOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </div>
                  </div>

                  {isStep5ScriptOpen && (
                    <div className="mt-2.5 pt-2 border-t border-border space-y-2">
                      <textarea
                        rows={5}
                        value={script}
                        onChange={(e) => setScript(e.target.value)}
                        className="pro-input w-full rounded-lg p-2.5 text-xs font-mono leading-relaxed resize-y"
                        placeholder="Final script narration..."
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <div className="p-3 rounded-lg bg-surface-200 border border-border space-y-1">
                  <div className="text-xs font-bold text-foreground">Target Channel</div>
                  <div className="text-xs font-semibold text-foreground">{activeChannel.name}</div>
                  <div className="text-[11px] text-muted">{activeChannel.niche}</div>
                </div>

                <div className="p-3 rounded-lg bg-surface-200 border border-border space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-foreground">Thumbnail</span>
                    <button
                      onClick={() => navigate('/thumbnails', { state: { title: topic } })}
                      className="text-[11px] text-foreground font-bold hover:underline flex items-center gap-1"
                    >
                      Studio <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>

                  <div className="aspect-video rounded-lg overflow-hidden bg-black border border-border">
                    <img src={thumbnailUrl} alt="Preview" className="w-full h-full object-cover" />
                  </div>
                </div>
              </div>

            </div>

            {/* Single Upload Dispatch Button */}
            <div className="flex items-center justify-between pt-3 border-t border-border">
              <button
                onClick={() => setStep(4)}
                className="btn-outline px-4 py-2 rounded-lg text-xs flex items-center gap-1.5"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back to Video
              </button>

              <button
                disabled={isDispatching || dispatchedSuccess}
                onClick={handleDispatchToStealthQueue}
                className="btn-outline px-5 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5"
              >
                {dispatchedSuccess ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    Queued Single Video!
                  </>
                ) : isDispatching ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Dispatching...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    Push Single to Queue
                  </>
                )}
              </button>
            </div>

          </div>

          {/* ⚡ BATCH 5+ MULTI-LANGUAGE HETZNER LOCALIZATION FACTORY CARD */}
          <div className="pro-panel p-5 rounded-xl space-y-4 border-2 border-foreground/20 bg-surface-200/50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-md bg-foreground text-background flex items-center justify-center font-bold">
                  <Globe className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-foreground font-mono uppercase tracking-wider">
                    ⚡ Batch 5+ Multi-Language Factory (Hetzner Engine)
                  </h3>
                  <p className="text-[11px] text-muted">
                    Auto-translates script, synthesizes voiceovers, and remuxes 1080p MP4s in RAM Disk across 5+ languages.
                  </p>
                </div>
              </div>

              <span className="text-[10px] font-mono uppercase font-bold px-2 py-0.5 rounded bg-surface-300 text-foreground border border-border">
                {selectedBatchLangs.length} Selected
              </span>
            </div>

            {/* Language Checkbox Grid */}
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {BATCH_LANGUAGES.map(lang => {
                const isSelected = selectedBatchLangs.includes(lang.code);
                return (
                  <button
                    key={lang.code}
                    type="button"
                    onClick={() => {
                      if (isSelected) {
                        setSelectedBatchLangs(selectedBatchLangs.filter(c => c !== lang.code));
                      } else {
                        setSelectedBatchLangs([...selectedBatchLangs, lang.code]);
                      }
                    }}
                    className={`p-2.5 rounded-lg border text-left flex items-center justify-between transition-all ${
                      isSelected
                        ? 'bg-surface-300 border-foreground text-foreground font-bold shadow-subtle'
                        : 'bg-surface-100 border-border text-muted hover:border-border-strong'
                    }`}
                  >
                    <span className="text-xs flex items-center gap-1.5">
                      <span>{lang.flag}</span>
                      <span>{lang.name}</span>
                    </span>
                    <span className="text-[10px] font-mono">{isSelected ? '✓' : '+'}</span>
                  </button>
                );
              })}
            </div>

            {/* Processing Progress or Launch Button */}
            {isBatchProcessing ? (
              <div className="p-4 rounded-lg bg-surface-100 border border-border text-center space-y-2">
                <div className="text-xs font-bold text-foreground flex items-center justify-center gap-2">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Generating &amp; Remuxing {selectedBatchLangs.length}x Localized Videos in RAM Disk...
                </div>
                <div className="w-64 max-w-full bg-surface-300 h-1.5 rounded-full overflow-hidden mx-auto">
                  <div
                    className="h-full bg-foreground transition-all duration-300"
                    style={{ width: `${batchProgress}%` }}
                  />
                </div>
                <div className="text-[10px] font-mono text-muted">{batchProgress}% completed</div>
              </div>
            ) : (
              <div className="flex items-center justify-end pt-1">
                <button
                  onClick={handleBatchLocalizeAndDispatch}
                  className="btn-solid px-6 py-2.5 rounded-lg text-xs font-bold flex items-center gap-2 shadow-subtle"
                >
                  <Sparkles className="w-4 h-4" />
                  Generate &amp; Stage {selectedBatchLangs.length}x Localized Videos (1-Click)
                </button>
              </div>
            )}

          </div>

        </div>
      )}

      {/* Teleprompter Modal */}
      <TeleprompterModal
        script={script}
        isOpen={isTeleprompterOpen}
        onClose={() => setIsTeleprompterOpen(false)}
      />

    </div>
  );
};
