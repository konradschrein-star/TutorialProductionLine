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
  AlertCircle,
  Gauge,
  Target,
  Languages
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { StepBar } from '../components/StepBar';
import { AudioPlayer } from '../components/AudioPlayer';
import { TeleprompterModal } from '../components/TeleprompterModal';
import { AIService, ScriptStyle } from '../services/aiService';
import { TTSService, AVAILABLE_VOICES } from '../services/ttsService';
import { KeywordService } from '../services/keywordService';
import { StorageService } from '../services/storageService';
import { GoogleDriveService } from '../services/googleDriveService';
import { uploadManager } from '../services/uploadManager';
import { screenRecorder } from '../services/screenRecorder';
import { languageByCode } from '../data/languages';
import { useToast, useConfirm } from '../components/ui/Feedback';
import { useConfig, useFinishedVideos } from '../hooks/useStore';
import { Channel, KeywordItem, VAUser } from '../types';

type RefineAction = 'add_pauses' | 'punch_hook' | 'shorten_fluff';

/** Format a whole-second count as m:ss. */
const formatSeconds = (secs: number): string => {
  const m = Math.floor(secs / 60);
  const s = Math.max(0, Math.round(secs % 60));
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const countWords = (text: string): number => text.split(/\s+/).filter(Boolean).length;

// ───────────────────────────────────────────────────────────────────────────
// Single-source-of-truth script editor. Every step that shows the narration
// script renders THIS component, bound to the same `script`/`onChange` state —
// so it is always unambiguous which edit drives audio + dispatch.
// ───────────────────────────────────────────────────────────────────────────
interface ScriptEditorProps {
  script: string;
  onChange: (value: string) => void;
  targetMinutes: number;
  rows?: number;
  placeholder?: string;
  copied: boolean;
  onCopy: () => void;
  onRefine?: (action: RefineAction) => void;
  refining?: boolean;
  /** Extra controls (e.g. re-synthesize) rendered on the right of the toolbar. */
  trailing?: React.ReactNode;
}

const ScriptEditor: React.FC<ScriptEditorProps> = ({
  script,
  onChange,
  targetMinutes,
  rows = 10,
  placeholder = 'Type or paste narration script here...',
  copied,
  onCopy,
  onRefine,
  refining,
  trailing
}) => {
  const words = countWords(script);
  const estSeconds = Math.round(words / 2.5);
  const targetSeconds = Math.round(targetMinutes * 60);
  // "On target" when within ±25% of the configured length.
  const ratio = targetSeconds > 0 ? estSeconds / targetSeconds : 1;
  const onTarget = ratio >= 0.75 && ratio <= 1.25;

  return (
    <div className="space-y-2.5">
      <textarea
        rows={rows}
        value={script}
        onChange={(e) => onChange(e.target.value)}
        className="pro-input w-full rounded-lg p-3 text-xs text-foreground font-mono leading-relaxed resize-y focus:ring-1 focus:ring-foreground/30"
        placeholder={placeholder}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            className={`text-[11px] font-mono px-2 py-1 rounded bg-surface-200 border border-border font-bold ${
              onTarget ? 'text-success' : 'text-muted'
            }`}
            title={`Estimated spoken length vs. configured target of ${targetMinutes} min`}
          >
            {words} words · ~{formatSeconds(estSeconds)} / target {targetMinutes}m
          </span>

          <button
            onClick={onCopy}
            className="px-2.5 py-1 rounded bg-surface-100 hover:bg-surface-300 text-[11px] font-semibold text-foreground border border-border flex items-center gap-1"
          >
            {copied ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
            {copied ? 'Copied' : 'Copy'}
          </button>

          {onRefine && (
            <>
              <button
                disabled={refining}
                onClick={() => onRefine('add_pauses')}
                className="px-2 py-1 rounded bg-surface-100 hover:bg-surface-300 text-[11px] text-foreground border border-border disabled:opacity-50"
              >
                + Add Spoken Pauses
              </button>
              <button
                disabled={refining}
                onClick={() => onRefine('punch_hook')}
                className="px-2 py-1 rounded bg-surface-100 hover:bg-surface-300 text-[11px] text-foreground border border-border disabled:opacity-50"
              >
                ⚡ Punch Up Hook
              </button>
              <button
                disabled={refining}
                onClick={() => onRefine('shorten_fluff')}
                className="px-2 py-1 rounded bg-surface-100 hover:bg-surface-300 text-[11px] text-foreground border border-border disabled:opacity-50"
              >
                ✂️ Cut Fluff
              </button>
            </>
          )}
        </div>

        {trailing && <div className="flex items-center gap-2">{trailing}</div>}
      </div>
    </div>
  );
};

interface CreatorWizardProps {
  activeChannel: Channel;
  activeUser: VAUser;
}

export const CreatorWizard: React.FC<CreatorWizardProps> = ({ activeChannel, activeUser }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const confirm = useConfirm();
  const config = useConfig();
  const finishedVideos = useFinishedVideos();

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
  const [voiceSpeed, setVoiceSpeed] = useState<number>(config.defaultSpeed);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [lastSynthesizedScript, setLastSynthesizedScript] = useState<string>('');
  const [lastSynthesizedVoice, setLastSynthesizedVoice] = useState<string>('');
  const [lastSynthesizedSpeed, setLastSynthesizedSpeed] = useState<number>(0);
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
  const [isGeneratingAiThumb, setIsGeneratingAiThumb] = useState<boolean>(false);
  const [isDispatching, setIsDispatching] = useState<boolean>(false);
  const [dispatchedSuccess, setDispatchedSuccess] = useState<boolean>(false);
  const [isStep5ScriptOpen, setIsStep5ScriptOpen] = useState<boolean>(false);

  // Batch Multi-Language Localization State (real AI translation)
  const [selectedBatchLangs, setSelectedBatchLangs] = useState<string[]>(config.standardLanguages);
  const [isBatchProcessing, setIsBatchProcessing] = useState<boolean>(false);
  const [batchProgress, setBatchProgress] = useState<number>(0);
  const [batchStatus, setBatchStatus] = useState<string>('');

  // Load Claimed Keywords
  useEffect(() => {
    const list = KeywordService.getClaimedKeywords(activeUser.name);
    setClaimedKeywords(list);
  }, [activeUser.name]);

  // Handle route state if navigated from the Keyword Hub / deep-links.
  // Supports the rich shape { topic, keywordId, channelId, software, contentType, angle }
  // and stays backward-compatible with { topic } / { title }.
  useEffect(() => {
    const st: any = location.state;
    const initTopic: string | undefined = st?.topic || st?.title;
    if (!initTopic) return;

    setTopic(initTopic);
    if (st.keywordId) setKeywordId(st.keywordId);
    if (st.channelId) setSelectedChannelId(st.channelId);

    // Seed the generation prompt with any angle/software/format context provided.
    const seedParts: string[] = [];
    if (st.angle) seedParts.push(`Angle: ${st.angle}`);
    if (st.software) seedParts.push(`Software: ${st.software}`);
    if (st.contentType) seedParts.push(`Format: ${st.contentType}`);
    const seed = seedParts.join('. ');
    if (seed) setRegenPrompt(seed);

    handleGenerateScript(initTopic, undefined, seed || undefined);
    window.history.replaceState({}, document.title);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // ── Today strip: this VA's daily target vs. what's finished today ──────────
  const todayStr = new Date().toISOString().split('T')[0];
  const vaTarget = StorageService.getVATarget(activeUser.id);
  const producedToday = finishedVideos.filter((v) => v.createdAt === todayStr).length;
  const dailyTarget = vaTarget.dailyTarget || config.defaultDailyTarget || 0;
  const todayPct = dailyTarget > 0 ? Math.min(100, Math.round((producedToday / dailyTarget) * 100)) : 0;

  // Copy helper
  const handleCopyScript = () => {
    if (!script) return;
    navigator.clipboard.writeText(script);
    setCopiedScript(true);
    setTimeout(() => setCopiedScript(false), 2000);
  };

  // Step 1 ➔ 2: Generate Script
  const handleGenerateScript = async (customTopic?: string, customStyle?: ScriptStyle, promptOverride?: string) => {
    const t = customTopic || topic;
    const s = customStyle || scriptStyle;
    const p = promptOverride !== undefined ? promptOverride : regenPrompt;
    if (!t.trim()) return;

    setIsGeneratingScript(true);
    try {
      const generated = await AIService.generateScript(t, p, s);
      setScript(generated);

      const meta = AIService.generateMetadata(t, generated, activeChannel.name);
      setVideoTitle(meta.title);
      setVideoDesc(meta.description);
      setVideoTags(meta.tags);

      setStep(2);
      setRegenPrompt('');
    } catch (err: any) {
      console.error(err);
      toast('Script generation failed: ' + (err?.message || 'Unknown error'), 'error', 'AI Script');
    } finally {
      setIsGeneratingScript(false);
    }
  };

  // Quick Refine Action
  const handleRefine = async (action: RefineAction) => {
    if (!script.trim()) return;
    setIsGeneratingScript(true);
    try {
      const refined = await AIService.refineScript(script, action);
      setScript(refined);
    } catch (e: any) {
      toast('Refine failed: ' + (e?.message || 'Unknown error'), 'error');
    } finally {
      setIsGeneratingScript(false);
    }
  };

  // Voice Synthesis & In-Place Regeneration
  const handleSynthesizeVoice = async (overrideScript?: string, overrideVoice?: string) => {
    const textToSynthesize = overrideScript !== undefined ? overrideScript : script;
    const voiceToUse = overrideVoice || selectedVoice;
    if (!textToSynthesize.trim()) {
      toast('Nothing to synthesize — the script is empty.', 'warning');
      return;
    }

    setIsSynthesizing(true);
    setSynthProgress(15);

    try {
      const { blob, isPlaceholder, warning } = await TTSService.synthesizeVoice(
        textToSynthesize,
        voiceToUse,
        voiceSpeed,
        (pct) => setSynthProgress(pct)
      );
      setAudioBlob(blob);
      setLastSynthesizedScript(textToSynthesize);
      setLastSynthesizedVoice(voiceToUse);
      setLastSynthesizedSpeed(voiceSpeed);
      if (isPlaceholder) {
        toast(warning || 'No TTS provider configured — this is a placeholder track, not real narration.', 'warning', 'Placeholder audio');
      }
    } catch (err: any) {
      console.error(err);
      toast('Voice synthesis failed: ' + (err?.message || 'Unknown error'), 'error', 'TTS');
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
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } catch (err: any) {
      console.warn('Screen recording cancelled or failed:', err);
      const msg = (err?.message || '').toLowerCase();
      if (err?.name === 'NotAllowedError' || msg.includes('permission') || msg.includes('denied')) {
        toast('Screen capture permission was denied. Allow screen + mic access and try again.', 'error', 'Recorder');
      } else {
        toast('Could not start screen recording. ' + (err?.message || 'Please try again.'), 'error', 'Recorder');
      }
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
      toast('Screen recording captured and attached.', 'success');
    } catch (e: any) {
      console.error(e);
      toast('Failed to finalize the recording: ' + (e?.message || 'Unknown error'), 'error', 'Recorder');
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
      toast('Please upload a valid MP4 or WebM video file.', 'error');
      return;
    }
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoFile(file);
    setVideoUrl(URL.createObjectURL(file));
  };

  // Guarded advance from Step 4 → Step 5 (dispatch integrity: no video, no Review).
  const handleAdvanceToReview = () => {
    if (!videoFile) {
      toast('Record or upload a screen recording before continuing to Review.', 'warning', 'Video required');
      return;
    }
    setStep(5);
  };

  // Step 5: Push Single Video to Stealth Queue
  const handleDispatchToStealthQueue = async () => {
    // Integrity guard — never enqueue an empty job or fake success.
    if (!videoFile) {
      toast('No video attached. Go back to Step 4 and record or upload a recording first.', 'error', 'Nothing to dispatch');
      return;
    }

    setIsDispatching(true);

    try {
      const jobId = `job_${Date.now()}`;
      const finalTitle = videoTitle || topic;
      const finalDuration = formatSeconds(Math.round(countWords(script) / 2.5)) || '0:00';

      uploadManager.enqueue({
        jobId,
        jobTitle: finalTitle,
        channelName: activeChannel.name,
        file: videoFile,
        thumbnailUrl,
      });

      // Auto-dispatch to Google Drive only if the operator enabled it AND Drive
      // is actually connected. The finished-video status reflects the REAL
      // delivery outcome — never a blanket "Uploaded to Drive".
      const driveConfig = StorageService.getGoogleDriveConfig();
      let deliveredToDrive = false;
      let driveUrl: string | undefined;
      let drivePath: string | undefined;
      if (driveConfig.enabled && driveConfig.autoUploadOnRender && driveConfig.isConnected) {
        try {
          const delivery = await GoogleDriveService.dispatchUpload({
            jobId,
            title: finalTitle,
            topic,
            channelName: activeChannel.name,
            fileSize: videoFile.size,
          });
          deliveredToDrive = delivery.status === 'IN_GOOGLE_DRIVE';
          driveUrl = delivery.viewUrl;
          drivePath = delivery.drivePath;
        } catch {
          deliveredToDrive = false;
        }
      }

      StorageService.addFinishedVideo({
        id: jobId,
        title: finalTitle,
        channel: activeChannel.name,
        status: deliveredToDrive ? 'Uploaded to Drive' : 'Queued for Stealth Upload',
        thumbnailUrl: thumbnailUrl || '/background/bg-gradient-1.png',
        duration: finalDuration,
        script,
        tags: videoTags.split(',').map((t) => t.trim()).filter(Boolean),
        driveUrl,
        drivePath,
        createdAt: todayStr,
        producedByUserId: activeUser.id,
        producedByName: activeUser.name,
      });

      if (keywordId) {
        KeywordService.completeKeyword(keywordId);
      }

      confetti({ particleCount: 80, spread: 60, origin: { y: 0.6 } });
      toast('Video queued for upload.', 'success', 'Dispatched');
      setDispatchedSuccess(true);
      setTimeout(() => navigate('/finished'), 1800);
    } catch (e: any) {
      console.error(e);
      toast('Dispatch failed: ' + (e?.message || 'Unknown error'), 'error');
    } finally {
      setIsDispatching(false);
    }
  };

  // Step 5: Real batch translation → queue localized uploads (honest; no fake renders)
  const handleBatchLocalizeAndDispatch = async () => {
    if (!videoFile) {
      toast('Attach or record a video before batch-localizing.', 'error', 'Video required');
      return;
    }
    if (!script.trim()) {
      toast('There is no script to translate.', 'error');
      return;
    }
    if (selectedBatchLangs.length === 0) {
      toast('Select at least one target language.', 'warning');
      return;
    }

    const ok = await confirm({
      title: 'Translate & queue localized uploads?',
      message: `This will translate the narration script into ${selectedBatchLangs.length} language(s) with AI and queue this video for a localized upload in each. Voiceover re-recording still happens on the render box.`,
      confirmLabel: `Translate ${selectedBatchLangs.length}×`,
    });
    if (!ok) return;

    setIsBatchProcessing(true);
    setBatchProgress(5);
    let staged = 0;

    try {
      const finalDuration = formatSeconds(Math.round(countWords(script) / 2.5)) || '0:00';

      for (let i = 0; i < selectedBatchLangs.length; i++) {
        const code = selectedBatchLangs[i];
        const langInfo = languageByCode(code);
        if (!langInfo) continue;

        setBatchStatus(`Translating script into ${langInfo.name}...`);

        let translated = '';
        try {
          translated = await AIService.translateScript(script, langInfo.name);
        } catch (e: any) {
          toast(`Translation to ${langInfo.name} failed: ${e?.message || 'error'}`, 'error');
          setBatchProgress(Math.round(((i + 1) / selectedBatchLangs.length) * 100));
          continue;
        }
        if (!translated.trim()) {
          toast(`Translation to ${langInfo.name} returned empty output — skipped.`, 'warning');
          setBatchProgress(Math.round(((i + 1) / selectedBatchLangs.length) * 100));
          continue;
        }

        const localizedJobId = `batch_${code}_${Date.now()}`;

        StorageService.addFinishedVideo({
          id: localizedJobId,
          title: `[${langInfo.name}] ${videoTitle || topic}`,
          channel: activeChannel.name,
          status: 'Queued for Stealth Upload',
          thumbnailUrl: thumbnailUrl || '/background/bg-gradient-1.png',
          duration: finalDuration,
          script: translated,
          tags: [`${topic} ${langInfo.name}`, ...videoTags.split(',').map((t) => t.trim()).filter(Boolean)],
          createdAt: todayStr,
        });

        uploadManager.enqueue({
          jobId: localizedJobId,
          jobTitle: `[${langInfo.name}] ${videoTitle || topic}`,
          channelName: activeChannel.name,
          file: videoFile,
          thumbnailUrl,
        });

        staged++;
        setBatchProgress(Math.round(((i + 1) / selectedBatchLangs.length) * 100));
      }

      setBatchStatus('');

      if (staged === 0) {
        toast('No languages were localized — nothing was queued.', 'error');
        return;
      }

      if (keywordId) {
        KeywordService.completeKeyword(keywordId);
      }

      confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 } });
      toast(`Translated & queued ${staged} localized ${staged === 1 ? 'upload' : 'uploads'}.`, 'success', 'Localized');
      setTimeout(() => navigate('/finished'), 1500);
    } catch (e: any) {
      console.error(e);
      toast('Batch localization failed: ' + (e?.message || 'Unknown error'), 'error');
    } finally {
      setIsBatchProcessing(false);
      setBatchStatus('');
    }
  };

  const handleGenerateAiThumbnail = async () => {
    const prompt = `High-CTR YouTube thumbnail background for tutorial on ${videoTitle || topic || 'Software Tutorial'}, dramatic lighting, clean modern 3D composition, bold style, 16:9. Text must be black for contrast and have no mistakes. Only one person on the Thumbnail`;
    setIsGeneratingAiThumb(true);
    try {
      const dataUri = await AIService.generateThumbnailImage(prompt, { aspectRatio: '16:9' });
      setThumbnailUrl(dataUri);
      toast('AI thumbnail generated.', 'success');
    } catch (e: any) {
      console.error('AI thumbnail generation failed:', e);
      toast('AI thumbnail generation failed: ' + (e?.message || 'Unknown error'), 'error', 'Thumbnail');
    } finally {
      setIsGeneratingAiThumb(false);
    }
  };

  const handleManualThumbnailUpload = (file: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result) {
        setThumbnailUrl(e.target.result as string);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleReset = async () => {
    const dirty = topic.trim() || script.trim() || videoFile || audioBlob;
    if (dirty) {
      const ok = await confirm({
        title: 'Reset the conveyor?',
        message: 'This clears the current topic, script, voiceover and attached video so you can start a new tutorial.',
        confirmLabel: 'Reset',
        danger: true,
      });
      if (!ok) return;
    }
    setStep(1);
    setHighestStep(1);
    setTopic('');
    setKeywordId('');
    setScript('');
    setLastSynthesizedScript('');
    setLastSynthesizedVoice('');
    setLastSynthesizedSpeed(0);
    setAudioBlob(null);
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoFile(null);
    setVideoUrl('');
    setDispatchedSuccess(false);
  };

  const wordCount = countWords(script);
  const needsResynth =
    audioBlob !== null &&
    (script !== lastSynthesizedScript ||
      selectedVoice !== lastSynthesizedVoice ||
      voiceSpeed !== lastSynthesizedSpeed);

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
              Tutorial production line: Script ➔ Voice ➔ Screen Recording ➔ Review & Dispatch.
            </p>
          </div>

          <button
            onClick={handleReset}
            className="btn-outline px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 focus-ring"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Reset Conveyor
          </button>
        </div>

        {/* Today strip — active VA daily target vs. produced today */}
        <div className="pro-panel rounded-xl px-4 py-2.5 flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-md bg-accent-soft text-accent flex items-center justify-center flex-shrink-0">
              <Target className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-mono uppercase tracking-wider text-muted leading-none">Today</div>
              <div className="text-xs font-bold text-foreground truncate">{activeUser.name}</div>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-1 min-w-[180px]">
            <div className="flex-1 h-1.5 rounded-full bg-surface-300 overflow-hidden">
              <div
                className="h-full bg-accent transition-all duration-500"
                style={{ width: `${todayPct}%` }}
              />
            </div>
            <span className="text-xs font-mono font-bold text-foreground whitespace-nowrap">
              {producedToday}
              <span className="text-muted"> / {dailyTarget || '—'}</span>
            </span>
            {dailyTarget > 0 && producedToday >= dailyTarget && (
              <span className="badge badge-success">Target hit</span>
            )}
          </div>
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
                {claimedKeywords.map((kw) => (
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
                        keywordId === kw.id ? 'btn-solid' : 'btn-outline'
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
                  This is the single source of truth for the script — the same text drives audio and dispatch.
                </p>
              </div>

              <button
                onClick={() => setIsTeleprompterOpen(true)}
                className="btn-outline px-3 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5"
              >
                <Video className="w-3.5 h-3.5" />
                Teleprompter Pro
              </button>
            </div>

            <ScriptEditor
              script={script}
              onChange={setScript}
              targetMinutes={config.defaultTargetMinutes}
              rows={12}
              copied={copiedScript}
              onCopy={handleCopyScript}
              onRefine={handleRefine}
              refining={isGeneratingScript}
            />

            {/* Custom Regen Prompt (step-2 specific) */}
            <div className="flex flex-wrap items-center justify-end gap-2 p-2.5 rounded-lg bg-surface-200/60 border border-border">
              <div className="flex items-center gap-2 flex-1 max-w-md">
                <input
                  type="text"
                  value={regenPrompt}
                  onChange={(e) => setRegenPrompt(e.target.value)}
                  placeholder="Custom regen prompt (angle, tone, must-mention...)"
                  className="pro-input flex-1 rounded-md px-2.5 py-1 text-xs font-sans"
                />
                <button
                  disabled={isGeneratingScript}
                  onClick={() => handleGenerateScript()}
                  className="btn-outline px-2.5 py-1 rounded-md text-xs font-semibold flex items-center gap-1 flex-shrink-0 disabled:opacity-50"
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

              <button
                onClick={() => setIsTeleprompterOpen(true)}
                className="btn-outline px-3 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5"
              >
                <Video className="w-3.5 h-3.5" />
                Teleprompter Pro
              </button>
            </div>

            {/* Voice Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {AVAILABLE_VOICES.map((voice) => (
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
                    <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-surface-300 text-muted font-bold">
                      {voice.provider}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted mt-1.5 line-clamp-2">{voice.description}</p>
                </div>
              ))}
            </div>

            {/* Voice speed control (config-driven presets) */}
            <div className="flex items-center gap-2 flex-wrap p-2.5 rounded-lg bg-surface-200/60 border border-border">
              <span className="text-[10px] font-mono uppercase text-muted font-bold flex items-center gap-1">
                <Gauge className="w-3.5 h-3.5" /> Narration Speed
              </span>
              {config.speedPresets.map((sp) => (
                <button
                  key={sp}
                  onClick={() => setVoiceSpeed(sp)}
                  className={`px-2.5 py-1 rounded text-[11px] font-mono font-bold border transition-all ${
                    voiceSpeed === sp
                      ? 'bg-surface-300 border-foreground text-foreground shadow-subtle'
                      : 'bg-surface-100 border-border text-muted hover:border-border-strong'
                  }`}
                >
                  {sp.toFixed(2)}×
                </button>
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
                  {needsResynth && (
                    <span className="px-2 py-0.5 rounded bg-warning/10 text-warning border border-warning/30 text-[10px] font-mono font-bold flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> Changed — Re-synthesize
                    </span>
                  )}
                </div>

                <button
                  onClick={() => setIsStep3ScriptOpen(!isStep3ScriptOpen)}
                  className="p-1 rounded hover:bg-surface-300 text-muted hover:text-foreground"
                  title={isStep3ScriptOpen ? 'Collapse script' : 'Expand script'}
                >
                  {isStep3ScriptOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>
              </div>

              {isStep3ScriptOpen && (
                <ScriptEditor
                  script={script}
                  onChange={setScript}
                  targetMinutes={config.defaultTargetMinutes}
                  rows={6}
                  placeholder="Edit narration script here..."
                  copied={copiedScript}
                  onCopy={handleCopyScript}
                  onRefine={handleRefine}
                  refining={isGeneratingScript}
                  trailing={
                    <button
                      disabled={isSynthesizing || !script.trim()}
                      onClick={() => handleSynthesizeVoice()}
                      className={`px-4 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all shadow-subtle disabled:opacity-50 ${
                        needsResynth
                          ? 'bg-foreground text-background hover:opacity-90 ring-2 ring-foreground/40'
                          : 'btn-outline'
                      }`}
                    >
                      <RefreshCw className={`w-3 h-3 ${isSynthesizing ? 'animate-spin' : ''}`} />
                      {isSynthesizing ? 'Synthesizing...' : needsResynth ? '⚡ Re-synthesize with Changes' : 'Re-synthesize Voice'}
                    </button>
                  }
                />
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
                    <CheckCircle2 className="w-3.5 h-3.5 text-success" /> Audio Ready
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
                  Record directly in-browser or drag &amp; drop an existing recording. A video is required to reach Review.
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
                    <Video className="w-3.5 h-3.5 text-danger" />
                    Record Screen &amp; Mic
                  </button>
                )}
              </div>
            </div>

            {/* Collapsible Script Reference Drawer (same single source of truth) */}
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
                <div className="mt-2.5 pt-2 border-t border-border">
                  <ScriptEditor
                    script={script}
                    onChange={setScript}
                    targetMinutes={config.defaultTargetMinutes}
                    rows={5}
                    placeholder="Script text..."
                    copied={copiedScript}
                    onCopy={handleCopyScript}
                  />
                </div>
              )}
            </div>

            {/* In-Browser Screen Recorder Active HUD */}
            {isRecordingScreen && (
              <div className="p-5 rounded-xl bg-surface-200 border border-border text-center space-y-3">
                <div className="flex items-center justify-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-danger animate-ping" />
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
                    className="btn-solid px-4 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 bg-danger text-white"
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

              <div className="flex items-center gap-2">
                {!videoFile && (
                  <span className="text-[11px] text-muted font-mono hidden sm:inline">
                    Attach a recording to continue
                  </span>
                )}
                <button
                  disabled={!videoFile}
                  onClick={handleAdvanceToReview}
                  className="btn-solid px-5 py-2 rounded-lg text-xs flex items-center gap-1.5 disabled:opacity-50"
                >
                  Next: Review &amp; Queue
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* ══════════════════ STEP 5: REVIEW & DISPATCH & BATCH MULTI-LANG ══════════════════ */}
      {step === 5 && (
        <div className="space-y-4">

          {/* Main Review Panel */}
          <div className="pro-panel p-5 rounded-xl space-y-4">
            <div>
              <h3 className="text-sm font-bold text-foreground">Step 5: Review &amp; Dispatch to Stealth Uploader</h3>
              <p className="text-xs text-muted">
                Final metadata audit, channel routing, and batch localization.
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

                {/* Final Script Review Drawer (same single source of truth) */}
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
                    <div className="mt-2.5 pt-2 border-t border-border">
                      <ScriptEditor
                        script={script}
                        onChange={setScript}
                        targetMinutes={config.defaultTargetMinutes}
                        rows={5}
                        placeholder="Final script narration..."
                        copied={copiedScript}
                        onCopy={handleCopyScript}
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

                {/* Attached video confirmation */}
                <div className={`p-3 rounded-lg border space-y-1 ${videoFile ? 'bg-surface-200 border-border' : 'bg-danger/5 border-danger/30'}`}>
                  <div className="text-xs font-bold text-foreground flex items-center gap-1.5">
                    {videoFile ? <CheckCircle2 className="w-3.5 h-3.5 text-success" /> : <AlertCircle className="w-3.5 h-3.5 text-danger" />}
                    Attached Recording
                  </div>
                  {videoFile ? (
                    <div className="text-[11px] text-muted font-mono truncate">
                      {videoFile.name} · {(videoFile.size / (1024 * 1024)).toFixed(1)} MB
                    </div>
                  ) : (
                    <div className="text-[11px] text-danger">No video attached — go back to Step 4.</div>
                  )}
                </div>

                <div className="p-3 rounded-lg bg-surface-200 border border-border space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-foreground">Thumbnail Delivery</span>
                    <button
                      onClick={() => navigate('/thumbnails', { state: { title: videoTitle || topic } })}
                      className="text-[11px] text-foreground font-bold hover:underline flex items-center gap-1"
                    >
                      Studio <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>

                  <div className="aspect-video rounded-lg overflow-hidden bg-black border border-border relative group">
                    <img src={thumbnailUrl} alt="Preview" className="w-full h-full object-cover" />
                    <label className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center cursor-pointer transition-opacity text-white text-xs font-bold gap-1">
                      <Upload className="w-4 h-4" />
                      <span>Upload Manual Image</span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={(e) => e.target.files?.[0] && handleManualThumbnailUpload(e.target.files[0])}
                      />
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                    <button
                      onClick={handleGenerateAiThumbnail}
                      disabled={isGeneratingAiThumb}
                      className="btn-solid py-1.5 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 disabled:opacity-50"
                    >
                      {isGeneratingAiThumb ? (
                        <>
                          <RefreshCw className="w-3 h-3 animate-spin" />
                          <span>Generating...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3 h-3 text-info" />
                          <span>AI Auto</span>
                        </>
                      )}
                    </button>

                    <label className="btn-outline py-1.5 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 cursor-pointer text-center">
                      <Upload className="w-3 h-3" />
                      <span>Manual File</span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={(e) => e.target.files?.[0] && handleManualThumbnailUpload(e.target.files[0])}
                      />
                    </label>
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
                disabled={isDispatching || dispatchedSuccess || !videoFile}
                onClick={handleDispatchToStealthQueue}
                className="btn-solid px-5 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 disabled:opacity-50"
              >
                {dispatchedSuccess ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-success" />
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

          {/* ══ BATCH MULTI-LANGUAGE TRANSLATION (honest: real AI translation → queued uploads) ══ */}
          <div className="pro-panel p-5 rounded-xl space-y-4 border-2 border-foreground/20 bg-surface-200/50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-md bg-foreground text-background flex items-center justify-center font-bold">
                  <Globe className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-foreground font-mono uppercase tracking-wider flex items-center gap-1.5">
                    <Languages className="w-3.5 h-3.5" />
                    Batch Translate &amp; Queue Localized Uploads
                  </h3>
                  <p className="text-[11px] text-muted">
                    Translates the narration script into each language with AI, then queues this video for a localized
                    upload. Voiceover re-recording happens on the render box — nothing is rendered here.
                  </p>
                </div>
              </div>

              <span className="text-[10px] font-mono uppercase font-bold px-2 py-0.5 rounded bg-surface-300 text-foreground border border-border">
                {selectedBatchLangs.length} Selected
              </span>
            </div>

            {/* Language Checkbox Grid (from config.standardLanguages) */}
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {config.standardLanguages.map((code) => {
                const lang = languageByCode(code);
                if (!lang) return null;
                const isSelected = selectedBatchLangs.includes(code);
                return (
                  <button
                    key={code}
                    type="button"
                    onClick={() => {
                      if (isSelected) {
                        setSelectedBatchLangs(selectedBatchLangs.filter((c) => c !== code));
                      } else {
                        setSelectedBatchLangs([...selectedBatchLangs, code]);
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
                  {batchStatus || `Translating ${selectedBatchLangs.length} language(s)...`}
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
              <div className="flex items-center justify-between pt-1 gap-2 flex-wrap">
                {!videoFile && (
                  <span className="text-[11px] text-danger font-mono">Attach a video (Step 4) to enable batch localization.</span>
                )}
                <button
                  disabled={!videoFile || selectedBatchLangs.length === 0}
                  onClick={handleBatchLocalizeAndDispatch}
                  className="btn-solid px-6 py-2.5 rounded-lg text-xs font-bold flex items-center gap-2 shadow-subtle disabled:opacity-50 ml-auto"
                >
                  <Sparkles className="w-4 h-4" />
                  Translate &amp; Queue {selectedBatchLangs.length}× Localized
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
