import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { 
  Sparkles, 
  ArrowRight, 
  ArrowLeft, 
  RefreshCw, 
  Upload, 
  Volume2, 
  CheckCircle2, 
  Send, 
  FileText, 
  Tv, 
  Layers, 
  HelpCircle,
  Clock,
  Search,
  ExternalLink,
  Flame
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { StepBar } from '../components/StepBar';
import { AudioPlayer } from '../components/AudioPlayer';
import { AIService } from '../services/aiService';
import { TTSService, AVAILABLE_VOICES } from '../services/ttsService';
import { KeywordService } from '../services/keywordService';
import { StorageService, DEFAULT_CHANNELS } from '../services/storageService';
import { uploadManager } from '../services/uploadManager';
import { Channel, KeywordItem, VAUser } from '../types';

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
  const [regenPrompt, setRegenPrompt] = useState<string>('');
  const [isGeneratingScript, setIsGeneratingScript] = useState<boolean>(false);
  const [scriptError, setScriptError] = useState<string>('');

  // Step 3 State
  const [selectedVoice, setSelectedVoice] = useState<string>(activeChannel.defaultVoiceId || 'fish-paul-neutral');
  const [voiceSpeed, setVoiceSpeed] = useState<number>(1.0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [isSynthesizing, setIsSynthesizing] = useState<boolean>(false);
  const [synthProgress, setSynthProgress] = useState<number>(0);
  const [synthError, setSynthError] = useState<string>('');

  // Step 4 State
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // Step 5 State
  const [videoTitle, setVideoTitle] = useState<string>('');
  const [videoDesc, setVideoDesc] = useState<string>('');
  const [videoTags, setVideoTags] = useState<string>('');
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string>('/background/bg-gradient-1.png');
  const [isDispatching, setIsDispatching] = useState<boolean>(false);
  const [dispatchedSuccess, setDispatchedSuccess] = useState<boolean>(false);

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

  // Step 1 ➔ 2: Generate Script
  const handleGenerateScript = async (customTopic?: string) => {
    const t = customTopic || topic;
    if (!t.trim()) return;

    setIsGeneratingScript(true);
    setScriptError('');
    try {
      const generated = await AIService.generateScript(t, regenPrompt);
      setScript(generated);

      const meta = AIService.generateMetadata(t, generated, activeChannel.name);
      setVideoTitle(meta.title);
      setVideoDesc(meta.description);
      setVideoTags(meta.tags);

      setStep(2);
      setRegenPrompt('');
    } catch (err: any) {
      setScriptError(err.message || 'Script generation failed.');
    } finally {
      setIsGeneratingScript(false);
    }
  };

  // Step 2 ➔ 3: Generate Audio
  const handleGenerateAudio = async () => {
    if (!script.trim()) return;
    setStep(3);
    setIsSynthesizing(true);
    setSynthError('');
    setSynthProgress(10);

    try {
      const { blob } = await TTSService.synthesizeVoice(
        script,
        selectedVoice,
        voiceSpeed,
        (pct) => setSynthProgress(pct)
      );
      setAudioBlob(blob);
    } catch (err: any) {
      setSynthError(err.message || 'Speech synthesis failed.');
    } finally {
      setIsSynthesizing(false);
    }
  };

  // Step 4: Handle Video File
  const handleVideoSelect = (file: File) => {
    if (!file.type.startsWith('video/')) {
      alert('Please upload a valid MP4 or WebM video file.');
      return;
    }
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoFile(file);
    setVideoUrl(URL.createObjectURL(file));
  };

  // Step 5: Push to Stealth Upload Queue
  const handleDispatchToStealthQueue = () => {
    setIsDispatching(true);

    try {
      const jobId = `job_${Date.now()}`;
      
      // 1. Enqueue in background upload manager
      if (videoFile) {
        uploadManager.enqueue({
          jobId,
          jobTitle: videoTitle || topic,
          channelName: activeChannel.name,
          file: videoFile,
          thumbnailUrl,
        });
      }

      // 2. Save to finished videos list
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

      // 3. Mark keyword completed
      if (keywordId) {
        KeywordService.completeKeyword(keywordId);
      }

      // Confetti celebration
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 }
      });

      setDispatchedSuccess(true);
      setTimeout(() => {
        navigate('/finished');
      }, 2000);
    } catch (e) {
      console.error(e);
    } finally {
      setIsDispatching(false);
    }
  };

  const handleReset = () => {
    setStep(1);
    setHighestStep(1);
    setTopic('');
    setKeywordId('');
    setScript('');
    setAudioBlob(null);
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoFile(null);
    setVideoUrl('');
    setDispatchedSuccess(false);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      
      {/* Header & Step Stepper */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black font-display text-white tracking-tight flex items-center gap-2.5">
              <span>Tutorial Production Line</span>
              <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-accent-purple/20 text-accent-purple border border-accent-purple/30">
                5-Step Conveyor
              </span>
            </h1>
            <p className="text-xs text-slate-400">
              High-retention tutorial creation pipeline from idea to Stealth Upload Queue.
            </p>
          </div>

          <button
            onClick={handleReset}
            className="px-3 py-1.5 rounded-xl bg-surface-100 hover:bg-surface-50 text-xs font-semibold text-slate-400 hover:text-white border border-border transition-colors flex items-center gap-1.5"
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
        <div className="space-y-6">
          
          {/* Claimed Keywords Queue (From KTv2) */}
          <div className="glass-panel p-5 rounded-2xl">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-accent-emerald animate-ping" />
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                  Your Claimed Keywords Queue ({claimedKeywords.length})
                </h3>
              </div>
              <span className="text-xs text-slate-400">
                Assigned in Keyword Tool v2
              </span>
            </div>

            {claimedKeywords.length === 0 ? (
              <div className="text-center py-6 text-xs text-slate-400 bg-white/[0.02] rounded-xl border border-white/5">
                No keywords claimed yet. Pick from the Keyword Hub or enter a custom topic below.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {claimedKeywords.map(kw => (
                  <div
                    key={kw.id}
                    className={`p-3 rounded-xl border transition-all flex items-center justify-between gap-3 ${
                      keywordId === kw.id
                        ? 'bg-accent-purple/15 border-accent-purple shadow-glow'
                        : 'bg-white/[0.02] border-white/5 hover:border-white/20'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-white truncate">{kw.keyword}</div>
                      <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-400">
                        <span className="text-accent-cyan font-semibold">{kw.software}</span>
                        <span>•</span>
                        <span>{kw.volume.toLocaleString()} searches/mo</span>
                        {kw.targetChannelId && (
                          <span className="px-1.5 py-0.2 rounded bg-white/5 text-[10px] font-bold text-slate-300">
                            {DEFAULT_CHANNELS.find(c => c.id === kw.targetChannelId)?.name}
                          </span>
                        )}
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        setTopic(kw.keyword);
                        setKeywordId(kw.id);
                        if (kw.targetChannelId) setSelectedChannelId(kw.targetChannelId);
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex-shrink-0 ${
                        keywordId === kw.id
                          ? 'bg-accent-purple text-white'
                          : 'bg-white/10 hover:bg-white/20 text-white'
                      }`}
                    >
                      {keywordId === kw.id ? 'Selected' : 'Use This'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Custom Topic Input */}
          <div className="glass-panel p-6 rounded-2xl space-y-4">
            <h3 className="text-base font-bold text-white">Choose or Type Video Topic</h3>
            <p className="text-xs text-slate-400">
              Enter any problem, workflow, or software tutorial topic you want to produce.
            </p>

            <div className="relative">
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleGenerateScript()}
                placeholder="e.g. How to Automate Invoices in Excel 2026..."
                className="w-full bg-surface-200 border border-white/10 focus:border-accent-purple rounded-xl px-4 py-3.5 text-sm text-white placeholder-slate-500 outline-none transition-all"
              />
              <Sparkles className="w-5 h-5 text-accent-purple absolute right-4 top-3.5" />
            </div>

            {/* Google Suggest pills */}
            {suggestions.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="text-[11px] text-slate-400 font-semibold">Trending Autocomplete:</span>
                {suggestions.map((sug, i) => (
                  <button
                    key={i}
                    onClick={() => setTopic(sug)}
                    className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-accent-purple/20 text-[11px] text-slate-300 hover:text-white border border-white/10 transition-colors"
                  >
                    {sug}
                  </button>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <div className="text-xs text-slate-400">
                Target Channel: <span className="text-white font-bold">{DEFAULT_CHANNELS.find(c => c.id === selectedChannelId)?.name}</span>
              </div>

              <button
                disabled={!topic.trim() || isGeneratingScript}
                onClick={() => handleGenerateScript()}
                className="px-6 py-3 rounded-xl bg-gradient-to-r from-accent-purple to-accent-violet hover:opacity-90 disabled:opacity-50 text-white font-bold text-xs flex items-center gap-2 shadow-glow transition-all"
              >
                {isGeneratingScript ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Generating Script with Groq...
                  </>
                ) : (
                  <>
                    Next: Generate Script
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </div>

        </div>
      )}

      {/* ══════════════════ STEP 2: AI SCRIPTWRITER ══════════════════ */}
      {step === 2 && (
        <div className="space-y-6">
          <div className="glass-panel p-6 rounded-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-white">Step 2: Review &amp; Edit Spoken Script</h3>
                <p className="text-xs text-slate-400">
                  Formatted for maximum retention with early hook, spoken pauses ("..."), and zero fluff.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-accent-purple/10 text-accent-purple border border-accent-purple/30">
                  {script.split(/\s+/).filter(Boolean).length} words (~{Math.round(script.split(/\s+/).filter(Boolean).length / 2.5)}s)
                </span>
              </div>
            </div>

            {/* Editable Script Textarea */}
            <textarea
              rows={12}
              value={script}
              onChange={(e) => setScript(e.target.value)}
              className="w-full bg-surface-200 border border-white/15 focus:border-accent-purple rounded-xl p-4 text-sm text-white font-sans leading-relaxed outline-none transition-all"
              placeholder="Script narration..."
            />

            {/* Prompt Tuning & Regenerator */}
            <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 flex flex-col sm:flex-row gap-3 items-center">
              <input
                type="text"
                value={regenPrompt}
                onChange={(e) => setRegenPrompt(e.target.value)}
                placeholder="Regen instructions (e.g. 'add step about shortcuts' or 'make opening punchier')..."
                className="flex-1 bg-surface-300 border border-white/10 rounded-lg px-3.5 py-2 text-xs text-white outline-none focus:border-accent-purple"
              />
              <button
                disabled={isGeneratingScript}
                onClick={() => handleGenerateScript()}
                className="px-4 py-2 rounded-lg bg-surface-50 hover:bg-surface-100 border border-white/10 text-xs font-bold text-white flex items-center gap-1.5 flex-shrink-0 transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isGeneratingScript ? 'animate-spin' : ''}`} />
                Regenerate
              </button>
            </div>

            {/* Navigation buttons */}
            <div className="flex items-center justify-between pt-2">
              <button
                onClick={() => setStep(1)}
                className="px-4 py-2.5 rounded-xl bg-surface-100 hover:bg-surface-50 border border-border text-xs font-semibold text-slate-300 hover:text-white flex items-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>

              <button
                disabled={!script.trim()}
                onClick={handleGenerateAudio}
                className="px-6 py-3 rounded-xl bg-gradient-to-r from-accent-purple to-accent-cyan hover:opacity-90 disabled:opacity-50 text-white font-bold text-xs flex items-center gap-2 shadow-glow transition-all"
              >
                Next: Synthesize Audio
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ══════════════════ STEP 3: VOICEOVER SYNTHESIS ══════════════════ */}
      {step === 3 && (
        <div className="space-y-6">
          <div className="glass-panel p-6 rounded-2xl space-y-6">
            
            <div>
              <h3 className="text-base font-bold text-white">Step 3: Neural Voiceover Synthesis</h3>
              <p className="text-xs text-slate-400">
                Generate crisp studio audio using Fish Audio or ElevenLabs neural models.
              </p>
            </div>

            {/* Voice Options Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {AVAILABLE_VOICES.map(voice => (
                <div
                  key={voice.id}
                  onClick={() => setSelectedVoice(voice.id)}
                  className={`p-4 rounded-xl border cursor-pointer transition-all ${
                    selectedVoice === voice.id
                      ? 'bg-accent-purple/15 border-accent-purple shadow-glow'
                      : 'bg-white/[0.02] border-white/5 hover:border-white/20'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-xs font-bold text-white">{voice.name}</div>
                      <div className="text-[10px] text-accent-cyan font-semibold mt-0.5">{voice.accent}</div>
                    </div>
                    <span className="text-[9px] px-1.5 py-0.5 rounded uppercase font-bold bg-white/5 text-slate-400">
                      {voice.provider}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-2 line-clamp-2">{voice.description}</p>
                </div>
              ))}
            </div>

            {/* Audio Synthesis Progress or Player */}
            {isSynthesizing ? (
              <div className="p-8 rounded-2xl bg-black/40 border border-white/10 text-center space-y-3">
                <Volume2 className="w-8 h-8 text-accent-purple animate-bounce mx-auto" />
                <div className="text-sm font-bold text-white">Synthesizing Neural Audio...</div>
                <div className="w-64 max-w-full bg-white/10 h-2 rounded-full overflow-hidden mx-auto">
                  <div
                    className="h-full bg-gradient-to-r from-accent-purple to-accent-cyan transition-all duration-300"
                    style={{ width: `${synthProgress}%` }}
                  />
                </div>
                <div className="text-xs text-slate-400">{synthProgress}% completed</div>
              </div>
            ) : audioBlob ? (
              <div className="space-y-3">
                <div className="text-xs font-bold text-accent-emerald flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" /> Audio Voiceover Generated Successfully
                </div>
                <AudioPlayer blob={audioBlob} topicTitle={topic} />
              </div>
            ) : null}

            {/* Navigation buttons */}
            <div className="flex items-center justify-between pt-2">
              <button
                onClick={() => setStep(2)}
                className="px-4 py-2.5 rounded-xl bg-surface-100 hover:bg-surface-50 border border-border text-xs font-semibold text-slate-300 hover:text-white flex items-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" /> Back to Script
              </button>

              <button
                disabled={isSynthesizing || !audioBlob}
                onClick={() => setStep(4)}
                className="px-6 py-3 rounded-xl bg-gradient-to-r from-accent-purple to-accent-cyan hover:opacity-90 disabled:opacity-50 text-white font-bold text-xs flex items-center gap-2 shadow-glow transition-all"
              >
                Next: Attach Video
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ══════════════════ STEP 4: VIDEO ATTACHMENT ══════════════════ */}
      {step === 4 && (
        <div className="space-y-6">
          <div className="glass-panel p-6 rounded-2xl space-y-6">
            
            <div>
              <h3 className="text-base font-bold text-white">Step 4: Attach Screen Recording</h3>
              <p className="text-xs text-slate-400">
                Upload the video recording matching the narration voiceover.
              </p>
            </div>

            {/* Video Dropzone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                if (e.dataTransfer.files?.[0]) handleVideoSelect(e.dataTransfer.files[0]);
              }}
              className={`p-10 border-2 border-dashed rounded-2xl text-center transition-all ${
                isDragging
                  ? 'border-accent-purple bg-accent-purple/10'
                  : videoFile
                  ? 'border-accent-emerald bg-accent-emerald/5'
                  : 'border-white/15 bg-white/[0.02] hover:border-white/30'
              }`}
            >
              {videoFile ? (
                <div className="space-y-4">
                  <div className="w-12 h-12 rounded-full bg-accent-emerald/20 text-accent-emerald flex items-center justify-center mx-auto">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-white">{videoFile.name}</div>
                    <div className="text-xs text-slate-400 mt-1">
                      {(videoFile.size / (1024 * 1024)).toFixed(1)} MB • {videoFile.type}
                    </div>
                  </div>

                  {videoUrl && (
                    <video
                      controls
                      src={videoUrl}
                      className="max-h-64 rounded-xl mx-auto border border-white/10 shadow-lg"
                    />
                  )}

                  <label className="inline-block px-4 py-2 rounded-xl bg-surface-100 hover:bg-surface-50 border border-white/10 text-xs font-bold text-white cursor-pointer transition-colors">
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
                <div className="space-y-3">
                  <div className="w-12 h-12 rounded-full bg-accent-purple/20 text-accent-purple flex items-center justify-center mx-auto">
                    <Upload className="w-6 h-6 animate-bounce" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-white">Drag &amp; drop video recording here</div>
                    <div className="text-xs text-slate-400 mt-1">Supports MP4, WebM, MOV (1080p recommended)</div>
                  </div>
                  <label className="inline-block px-5 py-2.5 rounded-xl bg-accent-purple text-white text-xs font-bold cursor-pointer hover:opacity-90 shadow-glow transition-all">
                    Browse Files
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

            {/* Navigation buttons */}
            <div className="flex items-center justify-between pt-2">
              <button
                onClick={() => setStep(3)}
                className="px-4 py-2.5 rounded-xl bg-surface-100 hover:bg-surface-50 border border-border text-xs font-semibold text-slate-300 hover:text-white flex items-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" /> Back to Audio
              </button>

              <button
                onClick={() => setStep(5)}
                className="px-6 py-3 rounded-xl bg-gradient-to-r from-accent-purple to-accent-cyan hover:opacity-90 text-white font-bold text-xs flex items-center gap-2 shadow-glow transition-all"
              >
                Next: Review &amp; Dispatch
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ══════════════════ STEP 5: REVIEW & DISPATCH ══════════════════ */}
      {step === 5 && (
        <div className="space-y-6">
          <div className="glass-panel p-6 rounded-2xl space-y-6">
            
            <div>
              <h3 className="text-base font-bold text-white">Step 5: Review &amp; Dispatch to Stealth Uploader</h3>
              <p className="text-xs text-slate-400">
                Final check of video metadata, target channel routing, and thumbnail before queuing.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Left Column: Metadata */}
              <div className="lg:col-span-2 space-y-4">
                
                {/* Title */}
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1.5">YouTube Video Title</label>
                  <input
                    type="text"
                    value={videoTitle}
                    onChange={(e) => setVideoTitle(e.target.value)}
                    className="w-full bg-surface-200 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white outline-none focus:border-accent-purple"
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1.5">YouTube Description</label>
                  <textarea
                    rows={6}
                    value={videoDesc}
                    onChange={(e) => setVideoDesc(e.target.value)}
                    className="w-full bg-surface-200 border border-white/10 rounded-xl p-3 text-xs text-white outline-none focus:border-accent-purple font-sans"
                  />
                </div>

                {/* Tags */}
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1.5">Tags (Comma Separated)</label>
                  <input
                    type="text"
                    value={videoTags}
                    onChange={(e) => setVideoTags(e.target.value)}
                    className="w-full bg-surface-200 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white outline-none focus:border-accent-purple"
                  />
                </div>

              </div>

              {/* Right Column: Thumbnail & Target Channel */}
              <div className="space-y-4">
                
                {/* Channel Confirmation */}
                <div className="p-4 rounded-xl bg-surface-200 border border-white/10 space-y-2">
                  <div className="text-xs font-bold text-slate-300">Target Channel Routing</div>
                  <div className="flex items-center gap-2">
                    <Tv className="w-4 h-4 text-accent-purple" />
                    <span className="text-xs font-black text-white">{activeChannel.name}</span>
                  </div>
                  <div className="text-[11px] text-slate-400">{activeChannel.niche}</div>
                </div>

                {/* Thumbnail Preview */}
                <div className="p-4 rounded-xl bg-surface-200 border border-white/10 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-300">Thumbnail Preview</span>
                    <button
                      onClick={() => navigate('/thumbnails', { state: { title: topic } })}
                      className="text-[11px] text-accent-purple hover:underline font-bold flex items-center gap-1"
                    >
                      Open Studio <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>

                  <div className="aspect-video rounded-lg overflow-hidden bg-black border border-white/10 relative">
                    <img
                      src={thumbnailUrl}
                      alt="Thumbnail preview"
                      className="w-full h-full object-cover"
                    />
                  </div>

                  <label className="block text-center py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-white cursor-pointer transition-colors">
                    Upload Custom Thumbnail
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) {
                          setThumbnailFile(f);
                          setThumbnailUrl(URL.createObjectURL(f));
                        }
                      }}
                    />
                  </label>
                </div>

              </div>

            </div>

            {/* Navigation buttons */}
            <div className="flex items-center justify-between pt-4 border-t border-white/10">
              <button
                onClick={() => setStep(4)}
                className="px-4 py-2.5 rounded-xl bg-surface-100 hover:bg-surface-50 border border-border text-xs font-semibold text-slate-300 hover:text-white flex items-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" /> Back to Video
              </button>

              <button
                disabled={isDispatching || dispatchedSuccess}
                onClick={handleDispatchToStealthQueue}
                className="px-8 py-3.5 rounded-xl bg-gradient-to-r from-accent-purple via-accent-cyan to-accent-emerald hover:opacity-95 text-white font-black text-sm flex items-center gap-2 shadow-glow transition-all"
              >
                {dispatchedSuccess ? (
                  <>
                    <CheckCircle2 className="w-5 h-5 text-white" />
                    Queued for Stealth Upload!
                  </>
                ) : isDispatching ? (
                  <>
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    Dispatching to Queue...
                  </>
                ) : (
                  <>
                    <Send className="w-5 h-5" />
                    Push to Stealth Upload Queue
                  </>
                )}
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};
