import React, { useState } from 'react';
import { 
  Play, 
  Pause, 
  Download, 
  Upload, 
  RefreshCw, 
  Edit3, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  Sliders, 
  Volume2, 
  FolderCheck, 
  ExternalLink,
  ChevronRight,
  ChevronDown,
  Trash2,
  Sparkles,
  Save,
  Check,
  Video,
  FileText,
  RotateCcw,
  Film
} from 'lucide-react';
import { StudioJob, StudioJobStatus } from '../types';
import { StorageService } from '../services/storageService';
import { AIService } from '../services/aiService';
import { TTSService, AVAILABLE_VOICES } from '../services/ttsService';
import { GoogleDriveService } from '../services/googleDriveService';

interface StudioProps {
  jobs: StudioJob[];
  onJobUpdate: () => void;
  activeChannelFilter?: string;
}

const SPEED_PRESETS = [1.0, 1.15, 1.25, 1.4, 1.5, 1.6];
const ASSUMED_CAPTURE_FPS = 30;

const STATUS_LABELS: Record<StudioJobStatus, { label: string; bg: string; text: string; border: string }> = {
  QUEUED: { label: 'Queued', bg: 'bg-indigo-500/10', text: 'text-indigo-400', border: 'border-indigo-500/30' },
  GENERATING_SCRIPT: { label: 'Generating Script', bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/30' },
  GENERATING_AUDIO: { label: 'Synthesizing Audio', bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/30' },
  READY_TO_RECORD: { label: 'Ready to Record', bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/30' },
  AWAITING_UPLOAD: { label: 'Awaiting Upload', bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/30' },
  SPLICING: { label: 'Splicing & Rendering', bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/30' },
  COMPLETED: { label: 'Completed', bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/30' },
  FAILED_SCRIPT: { label: 'Failed Script', bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/30' },
  FAILED_AUDIO: { label: 'Failed Audio', bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/30' },
  FAILED_SPLICE: { label: 'Failed Splice', bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/30' },
  CANCELLED: { label: 'Cancelled', bg: 'bg-surface-300', text: 'text-muted', border: 'border-border' }
};

export const StandaloneStudio: React.FC<StudioProps> = ({ jobs, onJobUpdate, activeChannelFilter = 'all' }) => {
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [editingScriptJobId, setEditingScriptJobId] = useState<string | null>(null);
  const [scriptDraft, setScriptDraft] = useState<string>('');
  const [isSynthesizing, setIsSynthesizing] = useState<Record<string, boolean>>({});
  const [isDelivering, setIsDelivering] = useState<Record<string, boolean>>({});
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);

  const filteredJobs = jobs.filter(j => {
    if (activeChannelFilter !== 'all' && j.channelId !== activeChannelFilter) return false;
    return true;
  });

  const handleStartEditScript = (job: StudioJob) => {
    setEditingScriptJobId(job.id);
    setScriptDraft(job.script);
  };

  const handleSaveScript = (jobId: string) => {
    StorageService.updateStudioJob(jobId, { script: scriptDraft });
    onJobUpdate();
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      setEditingScriptJobId(null);
    }, 800);
  };

  const handleSpeedChange = (job: StudioJob, speed: number) => {
    StorageService.updateStudioJob(job.id, { voiceSpeed: speed });
    onJobUpdate();
  };

  const handleReSynthesizeAudio = async (job: StudioJob) => {
    setIsSynthesizing(prev => ({ ...prev, [job.id]: true }));
    try {
      const { blob: audioBlob, durationSeconds } = await TTSService.synthesizeVoice(
        job.script,
        job.voiceId || 'fish-paul-neutral',
        job.voiceSpeed || 1.15
      );
      const audioUrl = URL.createObjectURL(audioBlob);

      StorageService.updateStudioJob(job.id, {
        audioUrl,
        durationSeconds,
        status: 'READY_TO_RECORD'
      });
      onJobUpdate();
    } catch (e: any) {
      alert('Audio synthesis failed: ' + e.message);
    } finally {
      setIsSynthesizing(prev => ({ ...prev, [job.id]: false }));
    }
  };

  const handleRetryStage = async (job: StudioJob, stage: 'script' | 'audio' | 'splice') => {
    if (stage === 'script') {
      StorageService.updateStudioJob(job.id, { status: 'GENERATING_SCRIPT' });
      onJobUpdate();
      try {
        const generated = await AIService.generateScript(job.topic, '', 'standard');
        StorageService.updateStudioJob(job.id, { script: generated, status: 'QUEUED' });
      } catch {
        StorageService.updateStudioJob(job.id, { status: 'FAILED_SCRIPT' });
      }
      onJobUpdate();
    } else if (stage === 'audio') {
      handleReSynthesizeAudio(job);
    } else {
      StorageService.updateStudioJob(job.id, { status: 'SPLICING' });
      onJobUpdate();
      setTimeout(() => {
        StorageService.updateStudioJob(job.id, { status: 'COMPLETED' });
        onJobUpdate();
      }, 1500);
    }
  };

  const handleUploadRecording = (job: StudioJob, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadProgress(prev => ({ ...prev, [job.id]: 10 }));
    StorageService.updateStudioJob(job.id, { 
      status: 'AWAITING_UPLOAD',
      recordingUrl: URL.createObjectURL(file)
    });
    onJobUpdate();

    // Simulate progress and splice transition
    let p = 10;
    const interval = setInterval(() => {
      p += 25;
      if (p >= 100) {
        clearInterval(interval);
        setUploadProgress(prev => ({ ...prev, [job.id]: 100 }));
        
        StorageService.updateStudioJob(job.id, {
          status: 'SPLICING'
        });
        onJobUpdate();

        // Auto-splice completion & Google Drive dispatch
        setTimeout(async () => {
          const config = StorageService.getGoogleDriveConfig();
          let delivered = false;
          let drivePath = '';
          let driveUrl = '';

          if (config.autoUploadOnRender) {
            const delItem = await GoogleDriveService.dispatchUpload({
              jobId: job.id,
              title: job.title,
              topic: job.topic,
              channelName: job.channelName,
              fileSize: file.size
            });
            delivered = true;
            drivePath = delItem.drivePath;
            driveUrl = delItem.viewUrl || '';
          }

          StorageService.updateStudioJob(job.id, {
            status: 'COMPLETED',
            videoUrl: URL.createObjectURL(file),
            deliveredToDrive: delivered,
            drivePath,
            driveUrl
          });
          onJobUpdate();
        }, 1500);

      } else {
        setUploadProgress(prev => ({ ...prev, [job.id]: p }));
      }
    }, 300);
  };

  const handleTriggerDriveDelivery = async (job: StudioJob) => {
    setIsDelivering(prev => ({ ...prev, [job.id]: true }));
    try {
      const delItem = await GoogleDriveService.dispatchUpload({
        jobId: job.id,
        title: job.title,
        topic: job.topic,
        channelName: job.channelName,
        fileSize: 45 * 1024 * 1024
      });
      StorageService.updateStudioJob(job.id, {
        deliveredToDrive: true,
        drivePath: delItem.drivePath,
        driveUrl: delItem.viewUrl
      });
      onJobUpdate();
    } catch (e: any) {
      alert('Delivery failed: ' + e.message);
    } finally {
      setIsDelivering(prev => ({ ...prev, [job.id]: false }));
    }
  };

  return (
    <div className="space-y-4">
      {filteredJobs.length === 0 ? (
        <div className="pro-panel p-12 rounded-xl text-center space-y-2">
          <div className="text-muted font-mono text-xs">No active production jobs in this queue.</div>
          <p className="text-[11px] text-muted">Create a new job or claim topics from the Keyword Pool.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredJobs.map(job => {
            const statusConfig = STATUS_LABELS[job.status] || STATUS_LABELS.QUEUED;
            const isEditing = editingScriptJobId === job.id;
            const isSynth = isSynthesizing[job.id];
            const isDeliv = isDelivering[job.id];
            const prog = uploadProgress[job.id] || 0;
            const isExpanded = selectedJobId === job.id;
            const currentSpeed = job.voiceSpeed || 1.15;
            const uniqueFps = (ASSUMED_CAPTURE_FPS / currentSpeed).toFixed(1);

            return (
              <div key={job.id} className="pro-panel rounded-xl border border-border overflow-hidden transition-all">
                
                {/* Main Card Header Bar */}
                <div className="p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 bg-surface-100">
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase border ${statusConfig.bg} ${statusConfig.text} ${statusConfig.border}`}>
                        {statusConfig.label}
                      </span>
                      <span className="text-[10px] font-mono text-muted uppercase px-2 py-0.5 rounded bg-surface-200 border border-border">
                        {job.channelName}
                      </span>
                      {job.deliveredToDrive ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                          <FolderCheck className="w-3 h-3" /> In Google Drive
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono text-muted border border-border flex items-center gap-1">
                          <Clock className="w-3 h-3" /> Awaiting Delivery
                        </span>
                      )}
                    </div>

                    <h3 className="text-sm font-bold text-foreground font-display">
                      {job.title}
                    </h3>

                    <div className="flex items-center gap-4 text-[11px] font-mono text-muted">
                      <span>Topic: {job.topic}</span>
                      {job.durationSeconds ? (
                        <span>Duration: {Math.floor(job.durationSeconds / 60)}m {job.durationSeconds % 60}s</span>
                      ) : null}
                      <span>Speed: {currentSpeed}x (~{uniqueFps} fps)</span>
                    </div>
                  </div>

                  {/* Actions Right Side */}
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    
                    {/* Audio Synthesis / Re-Synthesize */}
                    <button
                      onClick={() => handleReSynthesizeAudio(job)}
                      disabled={isSynth}
                      className="btn-outline px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5"
                      title="Re-synthesize Neural Voice Audio from current script"
                    >
                      <Volume2 className={`w-3.5 h-3.5 ${isSynth ? 'animate-spin' : ''}`} />
                      {isSynth ? 'Synthesizing...' : job.audioUrl ? 'Re-gen Audio' : 'Synthesize Audio'}
                    </button>

                    {/* Audio Download */}
                    {job.audioUrl && (
                      <a
                        href={job.audioUrl}
                        download={`audio_${job.id}.wav`}
                        className="btn-outline px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1"
                        title="Download Voice Audio File"
                      >
                        <Download className="w-3.5 h-3.5" /> Audio (.wav)
                      </a>
                    )}

                    {/* Recording Dropper */}
                    <label className="btn-solid px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer">
                      <Upload className="w-3.5 h-3.5" />
                      <span>{job.recordingUrl ? 'Replace Take' : 'Drop Take (.mp4)'}</span>
                      <input
                        type="file"
                        accept="video/mp4,video/webm,video/quicktime"
                        className="hidden"
                        onChange={(e) => handleUploadRecording(job, e)}
                      />
                    </label>

                    {/* Google Drive Manual Push if Completed but not uploaded */}
                    {job.status === 'COMPLETED' && !job.deliveredToDrive && (
                      <button
                        onClick={() => handleTriggerDriveDelivery(job)}
                        disabled={isDeliv}
                        className="btn-outline px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 text-emerald-400 border-emerald-500/40"
                      >
                        <FolderCheck className={`w-3.5 h-3.5 ${isDeliv ? 'animate-spin' : ''}`} />
                        {isDeliv ? 'Delivering...' : 'Push to Drive'}
                      </button>
                    )}

                    {/* Toggle Drawer */}
                    <button
                      onClick={() => setSelectedJobId(isExpanded ? null : job.id)}
                      className="p-1.5 rounded-lg hover:bg-surface-200 text-muted hover:text-foreground"
                    >
                      {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Progress bar if uploading */}
                {prog > 0 && prog < 100 && (
                  <div className="w-full bg-surface-200 h-1 overflow-hidden">
                    <div className="bg-foreground h-full transition-all duration-200" style={{ width: `${prog}%` }} />
                  </div>
                )}

                {/* Expanded Script, Video Player & Delivery Inspector Drawer */}
                {isExpanded && (
                  <div className="p-4 bg-surface-200/50 border-t border-border space-y-4 animate-fadeIn">
                    
                    {/* Controls Bar: Speed selector, Voice selector, Stage Retries */}
                    <div className="p-3 rounded-lg bg-surface-100 border border-border flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-xs">
                      
                      {/* Speed Presets */}
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-muted uppercase font-bold text-[10px]">Recording Speed:</span>
                        <div className="flex items-center gap-1">
                          {SPEED_PRESETS.map(spd => (
                            <button
                              key={spd}
                              onClick={() => handleSpeedChange(job, spd)}
                              className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold transition-all ${
                                currentSpeed === spd
                                  ? 'bg-foreground text-background shadow-subtle'
                                  : 'bg-surface-200 text-muted hover:text-foreground'
                              }`}
                            >
                              {spd}x
                            </button>
                          ))}
                        </div>
                        <span className="text-[10px] font-mono text-muted">({uniqueFps} fps)</span>
                      </div>

                      {/* Stage Retries */}
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-muted text-[10px]">Stage Actions:</span>
                        <button
                          onClick={() => handleRetryStage(job, 'script')}
                          className="px-2 py-1 rounded bg-surface-200 hover:bg-surface-300 text-[11px] font-mono flex items-center gap-1"
                        >
                          <RotateCcw className="w-2.5 h-2.5" /> Re-Script
                        </button>
                        <button
                          onClick={() => handleRetryStage(job, 'splice')}
                          className="px-2 py-1 rounded bg-surface-200 hover:bg-surface-300 text-[11px] font-mono flex items-center gap-1"
                        >
                          <Film className="w-2.5 h-2.5" /> Re-Splice
                        </button>
                      </div>

                    </div>

                    {/* Audio Player if Audio exists */}
                    {job.audioUrl && (
                      <div className="p-3 rounded-lg bg-surface-100 border border-border flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 text-xs">
                          <Volume2 className="w-4 h-4 text-emerald-500" />
                          <span className="font-mono font-bold text-foreground">TTS Audio Track</span>
                          <span className="text-[10px] font-mono text-muted">({job.durationSeconds}s duration)</span>
                        </div>
                        <audio controls src={job.audioUrl} className="h-8 max-w-sm w-full" />
                      </div>
                    )}

                    {/* Video Preview Player if Take exists */}
                    {(job.videoUrl || job.recordingUrl) && (
                      <div className="p-3 rounded-lg bg-surface-100 border border-border space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <Video className="w-4 h-4 text-foreground" />
                            <span className="font-mono font-bold text-foreground">Recorded Take Preview</span>
                          </div>
                          <span className="text-[10px] font-mono text-muted">Ready for final mux / delivery</span>
                        </div>
                        <div className="aspect-video max-w-md mx-auto rounded-lg overflow-hidden bg-black border border-border">
                          <video
                            controls
                            src={job.videoUrl || job.recordingUrl}
                            className="w-full h-full object-contain"
                          />
                        </div>
                      </div>
                    )}

                    {/* Script Header & Edit Button */}
                    <div className="flex items-center justify-between pt-1">
                      <div className="flex items-center gap-2">
                        <Edit3 className="w-3.5 h-3.5 text-muted" />
                        <h4 className="text-xs font-bold font-mono uppercase text-foreground">
                          Tutorial Narration Script
                        </h4>
                        <span className="text-[10px] font-mono text-muted">
                          ({job.script.split(/\s+/).filter(Boolean).length} words · ~{Math.ceil(job.script.split(/\s+/).filter(Boolean).length / 150)} min read)
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        {isEditing ? (
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => setEditingScriptJobId(null)}
                              className="btn-outline px-2.5 py-1 rounded text-xs"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => handleSaveScript(job.id)}
                              className="btn-solid px-3 py-1 rounded text-xs font-semibold flex items-center gap-1"
                            >
                              {savedSuccess ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
                              {savedSuccess ? 'Saved' : 'Save Script'}
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => handleStartEditScript(job)}
                            className="btn-outline px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1"
                          >
                            <Edit3 className="w-3 h-3" /> Edit Script
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Script Content / Editor */}
                    {isEditing ? (
                      <textarea
                        rows={6}
                        value={scriptDraft}
                        onChange={(e) => setScriptDraft(e.target.value)}
                        className="pro-input w-full rounded-lg p-3 text-xs font-mono leading-relaxed resize-y"
                        placeholder="Edit tutorial script narration..."
                      />
                    ) : (
                      <div className="p-3 rounded-lg bg-surface-100 border border-border text-xs font-mono text-foreground leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap">
                        {job.script}
                      </div>
                    )}

                    {/* Delivery & Path Details */}
                    {job.deliveredToDrive && (
                      <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-between text-xs font-mono">
                        <div className="flex items-center gap-2 text-emerald-400">
                          <FolderCheck className="w-4 h-4" />
                          <span>Delivered to Drive: <strong className="text-foreground">{job.drivePath}</strong></span>
                        </div>
                        {job.driveUrl && (
                          <a
                            href={job.driveUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-emerald-400 hover:underline flex items-center gap-1"
                          >
                            Open Folder <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    )}

                  </div>
                )}

              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
