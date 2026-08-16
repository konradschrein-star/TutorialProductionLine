import React, { useState, useEffect } from 'react';
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
  Sparkles
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

  // Step 3 State
  const [selectedVoice, setSelectedVoice] = useState<string>(activeChannel.defaultVoiceId || 'fish-paul-neutral');
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [isSynthesizing, setIsSynthesizing] = useState<boolean>(false);
  const [synthProgress, setSynthProgress] = useState<number>(0);

  // Step 4 State
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // Step 5 State
  const [videoTitle, setVideoTitle] = useState<string>('');
  const [videoDesc, setVideoDesc] = useState<string>('');
  const [videoTags, setVideoTags] = useState<string>('');
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
      console.error(err);
      alert('Script generation failed: ' + err.message);
    } finally {
      setIsGeneratingScript(false);
    }
  };

  // Step 2 ➔ 3: Generate Audio
  const handleGenerateAudio = async () => {
    if (!script.trim()) return;
    setStep(3);
    setIsSynthesizing(true);
    setSynthProgress(15);

    try {
      const { blob } = await TTSService.synthesizeVoice(
        script,
        selectedVoice,
        1.0,
        (pct) => setSynthProgress(pct)
      );
      setAudioBlob(blob);
    } catch (err: any) {
      console.error(err);
      alert('Voice synthesis failed: ' + err.message);
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
        particleCount: 80,
        spread: 60,
        origin: { y: 0.6 }
      });

      setDispatchedSuccess(true);
      setTimeout(() => {
        navigate('/finished');
      }, 1800);
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
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      
      {/* Header & Step Stepper */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold font-display text-foreground tracking-tight">
              Conveyor Workspace
            </h1>
            <p className="text-xs text-muted">
              DaVinci Resolve inspired production line: Script ➔ Voice ➔ Video ➔ Stealth Queue.
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
          
          {/* Claimed Keywords Queue */}
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

          {/* Custom Topic Input */}
          <div className="pro-panel p-5 rounded-xl space-y-3.5">
            <h3 className="text-sm font-bold text-foreground">Video Topic &amp; Channel Target</h3>

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

            {/* Trending Suggestions */}
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
              <div className="text-xs text-muted font-mono">
                Target: <span className="text-foreground font-bold">{DEFAULT_CHANNELS.find(c => c.id === selectedChannelId)?.name}</span>
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

      {/* ══════════════════ STEP 2: SCRIPTWRITING ══════════════════ */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="pro-panel p-5 rounded-xl space-y-3.5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-foreground">Step 2: Spoken Narration Script</h3>
                <p className="text-xs text-muted">
                  High-retention tutorial layout with early hook, natural pauses ("..."), and zero fluff.
                </p>
              </div>

              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-surface-200 border border-border text-muted font-bold">
                {script.split(/\s+/).filter(Boolean).length} words (~{Math.round(script.split(/\s+/).filter(Boolean).length / 2.5)}s)
              </span>
            </div>

            <textarea
              rows={11}
              value={script}
              onChange={(e) => setScript(e.target.value)}
              className="pro-input w-full rounded-lg p-3.5 text-xs text-foreground font-mono leading-relaxed resize-y"
              placeholder="Script narration..."
            />

            {/* Regen tuning */}
            <div className="p-2.5 rounded-lg bg-surface-200/60 border border-border flex flex-col sm:flex-row gap-2 items-center">
              <input
                type="text"
                value={regenPrompt}
                onChange={(e) => setRegenPrompt(e.target.value)}
                placeholder="Regen instructions (e.g. 'add shortcut steps' or 'shorten intro')..."
                className="pro-input flex-1 rounded-md px-3 py-1.5 text-xs"
              />
              <button
                disabled={isGeneratingScript}
                onClick={() => handleGenerateScript()}
                className="btn-outline px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 flex-shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isGeneratingScript ? 'animate-spin' : ''}`} />
                Regen
              </button>
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
                onClick={handleGenerateAudio}
                className="btn-solid px-5 py-2 rounded-lg text-xs flex items-center gap-1.5 disabled:opacity-50"
              >
                Next: Synthesize Voice
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ══════════════════ STEP 3: VOICEOVER ══════════════════ */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="pro-panel p-5 rounded-xl space-y-4">
            
            <div>
              <h3 className="text-sm font-bold text-foreground">Step 3: Neural Voice Synthesis</h3>
              <p className="text-xs text-muted">
                Studio voiceover generated via Fish Audio or ElevenLabs models.
              </p>
            </div>

            {/* Voices Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {AVAILABLE_VOICES.map(voice => (
                <div
                  key={voice.id}
                  onClick={() => setSelectedVoice(voice.id)}
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

            {/* Synthesis Progress / Player */}
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
                <div className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Audio Ready
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

      {/* ══════════════════ STEP 4: VIDEO ATTACHMENT ══════════════════ */}
      {step === 4 && (
        <div className="space-y-4">
          <div className="pro-panel p-5 rounded-xl space-y-4">
            
            <div>
              <h3 className="text-sm font-bold text-foreground">Step 4: Attach Screen Recording</h3>
              <p className="text-xs text-muted">
                Drop your recorded software walkthrough to pair with the audio.
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

      {/* ══════════════════ STEP 5: REVIEW & DISPATCH ══════════════════ */}
      {step === 5 && (
        <div className="space-y-4">
          <div className="pro-panel p-5 rounded-xl space-y-4">
            
            <div>
              <h3 className="text-sm font-bold text-foreground">Step 5: Review &amp; Dispatch to Stealth Uploader</h3>
              <p className="text-xs text-muted">
                Final metadata audit and stealth staging.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              
              {/* Metadata */}
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
                    rows={5}
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
              </div>

              {/* Thumbnail & Channel Preview */}
              <div className="space-y-3">
                <div className="p-3.5 rounded-lg bg-surface-200 border border-border space-y-1">
                  <div className="text-xs font-bold text-foreground">Target Channel</div>
                  <div className="text-xs font-semibold text-foreground">{activeChannel.name}</div>
                  <div className="text-[11px] text-muted">{activeChannel.niche}</div>
                </div>

                <div className="p-3.5 rounded-lg bg-surface-200 border border-border space-y-2.5">
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

                  <label className="block text-center py-1.5 rounded-md btn-outline text-[11px] font-semibold cursor-pointer">
                    Upload Custom Image
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) setThumbnailUrl(URL.createObjectURL(f));
                      }}
                    />
                  </label>
                </div>
              </div>

            </div>

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
                className="btn-solid px-6 py-2.5 rounded-lg text-xs font-bold flex items-center gap-2"
              >
                {dispatchedSuccess ? (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    Queued for Stealth Upload!
                  </>
                ) : isDispatching ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Dispatching...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
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
