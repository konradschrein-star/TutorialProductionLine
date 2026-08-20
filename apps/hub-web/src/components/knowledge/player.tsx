'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  CheckCircle,
  Circle,
  Clock,
  Plus,
  Trash2,
  FileText,
  Info,
  Rocket,
  BookOpen,
  Search,
  Sliders,
  Zap,
  Users,
  TrendingUp,
  DollarSign,
  type LucideIcon,
} from 'lucide-react';

const ICON_MAP: Record<string, LucideIcon> = {
  Rocket, BookOpen, Search, Sliders, Zap, Users, TrendingUp, DollarSign,
};
function ChapterIcon({ name, className }: { name?: string | null; className?: string }) {
  const Icon = (name && ICON_MAP[name]) ? ICON_MAP[name] : BookOpen;
  return <Icon className={className} />;
}
import { cn } from '@/lib/utils';
import type { Course, CourseChapter, CourseVideo, VideoWatchProgress, VideoNote } from '@repo/db';

// ---------------------------------------------------------------------------
// Types passed from the server page
// ---------------------------------------------------------------------------
interface CourseVideoWithProgress extends CourseVideo {
  progress: VideoWatchProgress | null;
}
interface ChapterWithVideos extends CourseChapter {
  videos: CourseVideoWithProgress[];
}
interface CourseWithChapters extends Course {
  chapters: ChapterWithVideos[];
  totalVideos: number;
  completedVideos: number;
}
interface VideoDetail extends CourseVideo {
  chapter: CourseChapter & { course: Course };
  progress: VideoWatchProgress | null;
}

interface PlayerProps {
  course: CourseWithChapters;
  video: VideoDetail;
  streamUrl: string;
  initialNotes: VideoNote[];
  userId: string;
}

// ---------------------------------------------------------------------------
// Utility — format seconds as m:ss
// ---------------------------------------------------------------------------
function formatTime(secs: number): string {
  if (!isFinite(secs) || secs < 0) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Chapter sidebar
// ---------------------------------------------------------------------------
function ChapterSidebar({
  course,
  currentVideoId,
  completionMap,
}: {
  course: CourseWithChapters;
  currentVideoId: string;
  completionMap: Record<string, boolean>;
}) {
  const [openChapters, setOpenChapters] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const chapter of course.chapters) {
      const hasCurrentVideo = chapter.videos.some((v) => v.id === currentVideoId);
      initial[chapter.id] = hasCurrentVideo || chapter.order_index === 0;
    }
    return initial;
  });

  const completedCount = Object.values(completionMap).filter(Boolean).length;
  const totalCount = course.totalVideos;
  const percent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  function toggleChapter(id: string) {
    setOpenChapters((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <aside className="w-72 flex-shrink-0 h-full flex flex-col border-r border-surface-bright bg-surface-container overflow-hidden">
      {/* Back link */}
      <div className="p-4 border-b border-surface-bright flex-shrink-0">
        <Link
          href="/knowledge"
          className="flex items-center gap-2 text-text-muted hover:text-primary transition-colors text-xs uppercase tracking-widest font-medium"
        >
          <ChevronLeft className="w-4 h-4" />
          All Courses
        </Link>
      </div>

      {/* Course header */}
      <div className="p-4 border-b border-surface-bright flex-shrink-0 space-y-2">
        <h2 className="text-sm font-bold text-text leading-snug">{course.title}</h2>
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[10px] text-text-muted uppercase tracking-widest">
            <span>{completedCount} / {totalCount} watched</span>
            <span className="text-primary font-bold">{percent}%</span>
          </div>
          <div className="h-1 bg-surface-bright rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${percent}%`,
                background: 'hsl(var(--primary))',
                boxShadow: '0 0 6px hsl(var(--primary)/0.5)',
              }}
            />
          </div>
        </div>
      </div>

      {/* Chapter list */}
      <nav className="flex-1 overflow-y-auto scrollbar-custom">
        {course.chapters.map((chapter) => {
          const isOpen = !!openChapters[chapter.id];
          const chapterCompleted = chapter.videos.every((v) => completionMap[v.id]);

          return (
            <div key={chapter.id} className="border-b border-surface-bright/50">
              {/* Chapter header */}
              <button
                onClick={() => toggleChapter(chapter.id)}
                className={cn(
                  'w-full flex items-center justify-between px-4 py-3 text-left transition-colors hover:bg-surface/50',
                  isOpen && 'bg-surface/30'
                )}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {chapterCompleted ? (
                    <CheckCircle className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                  ) : (
                    <ChapterIcon
                      name={(chapter as any).icon}
                      className="w-3.5 h-3.5 text-text-muted/50 flex-shrink-0"
                    />
                  )}
                  <span className="text-xs font-semibold text-text truncate">
                    {chapter.title.replace(/^Module \d+ — /, '')}
                  </span>
                </div>
                <ChevronDown
                  className={cn(
                    'w-4 h-4 text-text-muted flex-shrink-0 transition-transform duration-200',
                    isOpen && 'rotate-180'
                  )}
                />
              </button>

              {/* Videos */}
              {isOpen && (
                <div className="py-1">
                  {chapter.videos.map((video) => {
                    const isActive = video.id === currentVideoId;
                    const isDone = !!completionMap[video.id];

                    return (
                      <Link
                        key={video.id}
                        href={`/knowledge/${course.id}/${video.id}`}
                        className={cn(
                          'flex items-center gap-3 px-4 py-2.5 text-left transition-all duration-150',
                          isActive
                            ? 'bg-gradient-to-r from-primary/20 to-transparent border-l-2 border-primary'
                            : 'hover:bg-surface/40 border-l-2 border-transparent'
                        )}
                      >
                        <div className="flex-shrink-0 mt-0.5">
                          {isDone ? (
                            <CheckCircle className="w-3.5 h-3.5 text-primary" />
                          ) : (
                            <Circle className={cn('w-3.5 h-3.5', isActive ? 'text-primary' : 'text-text-muted/30')} />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p
                            className={cn(
                              'text-xs leading-snug line-clamp-2',
                              isActive ? 'text-primary font-semibold' : isDone ? 'text-text-muted' : 'text-text'
                            )}
                          >
                            {video.title}
                          </p>
                          {video.duration_seconds != null && (
                            <span className="text-[10px] text-text-muted/60 flex items-center gap-0.5 mt-0.5">
                              <Clock className="w-2.5 h-2.5" />
                              {formatTime(video.duration_seconds)}
                            </span>
                          )}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Video player controls
// ---------------------------------------------------------------------------
function VideoPlayer({
  streamUrl,
  videoId,
  initialPosition,
  onComplete,
  onProgress,
  onTimeChange,
}: {
  streamUrl: string;
  videoId: string;
  initialPosition: number;
  onComplete: () => void;
  onProgress: (pos: number) => void;
  onTimeChange?: (pos: number) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const progressSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completedRef = useRef(false);

  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(initialPosition);
  const [duration, setDuration] = useState(0);
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideControlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Seek to saved position on first load
  useEffect(() => {
    const video = videoRef.current;
    if (!video || initialPosition <= 0) return;
    const onMeta = () => {
      video.currentTime = initialPosition;
    };
    video.addEventListener('loadedmetadata', onMeta, { once: true });
    return () => video.removeEventListener('loadedmetadata', onMeta);
  }, [initialPosition, streamUrl]);

  // Reset completed flag when video changes
  useEffect(() => {
    completedRef.current = false;
  }, [videoId]);

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const t = video.currentTime;
    setCurrentTime(t);

    // Auto-complete at 90%
    if (!completedRef.current && video.duration > 0 && t / video.duration >= 0.9) {
      completedRef.current = true;
      onComplete();
    }

    // Live time for notes timestamp
    onTimeChange?.(t);

    // Debounced progress save
    if (progressSaveTimer.current) clearTimeout(progressSaveTimer.current);
    progressSaveTimer.current = setTimeout(() => onProgress(Math.floor(t)), 5000);
  }, [onComplete, onProgress]);

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  }

  function handleSeek(e: React.ChangeEvent<HTMLInputElement>) {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = parseFloat(e.target.value);
  }

  function toggleMute() {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }

  function toggleFullscreen() {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      el.requestFullscreen();
    }
  }

  function showControls() {
    setControlsVisible(true);
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    if (playing) {
      hideControlsTimer.current = setTimeout(() => setControlsVisible(false), 3000);
    }
  }

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div
      ref={containerRef}
      className="relative w-full aspect-video bg-black group/player rounded-xl overflow-hidden"
      onMouseMove={showControls}
      onMouseLeave={() => playing && setControlsVisible(false)}
    >
      <video
        ref={videoRef}
        src={streamUrl}
        className="w-full h-full object-contain"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onClick={togglePlay}
        preload="metadata"
      />

      {/* Big play button overlay (when paused) */}
      {!playing && (
        <div
          className="absolute inset-0 flex items-center justify-center cursor-pointer"
          onClick={togglePlay}
        >
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center shadow-[0_0_30px_rgba(170,255,0,0.35)] transition-transform hover:scale-110"
            style={{ background: 'linear-gradient(to bottom right, hsl(var(--primary)), hsl(var(--primary-700)))' }}
          >
            <Play className="w-7 h-7 text-black ml-0.5" />
          </div>
        </div>
      )}

      {/* Custom controls bar */}
      <div
        className={cn(
          'absolute bottom-0 left-0 right-0 px-4 pt-8 pb-3 flex flex-col gap-2 transition-opacity duration-300',
          'bg-gradient-to-t from-black/80 to-transparent',
          controlsVisible || !playing ? 'opacity-100' : 'opacity-0'
        )}
      >
        {/* Scrubber */}
        <input
          type="range"
          min={0}
          max={duration || 100}
          step={0.5}
          value={currentTime}
          onChange={handleSeek}
          className="w-full h-1 appearance-none bg-white/20 rounded-full outline-none cursor-pointer"
          style={{
            background: `linear-gradient(to right, hsl(var(--primary)) ${progressPercent}%, rgba(255,255,255,0.2) ${progressPercent}%)`,
          }}
        />

        {/* Buttons row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={togglePlay} className="text-white hover:text-primary transition-colors">
              {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
            </button>
            <button onClick={toggleMute} className="text-white hover:text-primary transition-colors">
              {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <span className="text-white/70 text-xs font-mono tabular-nums">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>
          <button onClick={toggleFullscreen} className="text-white hover:text-primary transition-colors">
            <Maximize className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Notes panel
// ---------------------------------------------------------------------------
function NotesPanel({
  videoId,
  initialNotes,
  currentTime,
}: {
  videoId: string;
  initialNotes: VideoNote[];
  currentTime: number;
}) {
  const [notes, setNotes] = useState<VideoNote[]>(initialNotes);
  const [content, setContent] = useState('');
  const [useTimestamp, setUseTimestamp] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!content.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/knowledge/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId,
          content: content.trim(),
          timestampSeconds: useTimestamp ? Math.floor(currentTime) : null,
        }),
      });
      if (res.ok) {
        const { note } = await res.json();
        setNotes((prev) => [note, ...prev]);
        setContent('');
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(noteId: string) {
    await fetch(`/api/knowledge/notes?noteId=${noteId}`, { method: 'DELETE' });
    setNotes((prev) => prev.filter((n) => n.id !== noteId));
  }

  return (
    <div className="space-y-4">
      {/* Add note form */}
      <div className="glass-card rounded-xl p-4 space-y-3">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Add a note..."
          rows={3}
          className="w-full bg-surface border border-surface-bright rounded-lg px-3 py-2.5 text-sm text-text placeholder:text-text-muted resize-none focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 transition-all"
        />
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={useTimestamp}
              onChange={(e) => setUseTimestamp(e.target.checked)}
              className="accent-primary"
            />
            <span className="text-xs text-text-muted">
              Link to {formatTime(currentTime)}
            </span>
          </label>
          <button
            onClick={handleSave}
            disabled={!content.trim() || saving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-widest text-black disabled:opacity-40 transition-all"
            style={{ background: 'hsl(var(--primary))' }}
          >
            <Plus className="w-3.5 h-3.5" />
            {saving ? 'Saving…' : 'Save Note'}
          </button>
        </div>
      </div>

      {/* Notes list */}
      {notes.length === 0 ? (
        <p className="text-center text-text-muted text-xs py-4">No notes yet.</p>
      ) : (
        <div className="space-y-2">
          {notes.map((note) => (
            <div
              key={note.id}
              className="glass rounded-xl p-3 border border-surface-bright space-y-1.5"
            >
              {note.timestamp_seconds != null && (
                <span className="inline-flex items-center gap-1 text-[10px] text-primary font-mono px-2 py-0.5 rounded-full border border-primary/30 bg-primary/10">
                  <Clock className="w-2.5 h-2.5" />
                  {formatTime(note.timestamp_seconds)}
                </span>
              )}
              <p className="text-sm text-text leading-relaxed whitespace-pre-wrap">{note.content}</p>
              <div className="flex items-center justify-between pt-1">
                <span className="text-[10px] text-text-muted/50">
                  {new Date(note.created_at).toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </span>
                <button
                  onClick={() => handleDelete(note.id)}
                  className="text-text-muted/40 hover:text-red-400 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main KnowledgePlayer
// ---------------------------------------------------------------------------
export function KnowledgePlayer({
  course,
  video,
  streamUrl,
  initialNotes,
  userId,
}: PlayerProps) {
  const [currentTime, setCurrentTime] = useState(0);
  const [activeTab, setActiveTab] = useState<'info' | 'notes'>('info');

  // Client-side completion state overlaid on top of server-loaded data
  const [completionMap, setCompletionMap] = useState<Record<string, boolean>>(() => {
    const map: Record<string, boolean> = {};
    for (const ch of course.chapters) {
      for (const v of ch.videos) {
        map[v.id] = v.progress?.is_completed ?? false;
      }
    }
    return map;
  });

  const handleComplete = useCallback(async () => {
    setCompletionMap((prev) => ({ ...prev, [video.id]: true }));
    await fetch('/api/knowledge/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId: video.id, lastPositionSeconds: Math.floor(currentTime), isCompleted: true }),
    });
  }, [video.id, currentTime]);

  const handleProgress = useCallback(async (pos: number) => {
    await fetch('/api/knowledge/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId: video.id, lastPositionSeconds: pos, isCompleted: completionMap[video.id] ?? false }),
    });
  }, [video.id, completionMap]);

  const initialPosition = video.progress?.last_position_seconds ?? 0;

  return (
    <div className="flex h-[calc(100vh-4rem)] -m-6 overflow-hidden">
      {/* Left chapter sidebar */}
      <ChapterSidebar
        course={course}
        currentVideoId={video.id}
        completionMap={completionMap}
      />

      {/* Main content area */}
      <div className="flex-1 overflow-y-auto scrollbar-custom">
        <div className="p-6 space-y-5 max-w-5xl mx-auto">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-text-muted">
            <Link href="/knowledge" className="hover:text-primary transition-colors">Knowledge</Link>
            <ChevronRight className="w-3 h-3" />
            <span className="truncate">{video.chapter.course.title}</span>
            <ChevronRight className="w-3 h-3" />
            <span className="truncate">{video.chapter.title}</span>
          </div>

          {/* Video title */}
          <h1 className="text-xl font-bold text-text leading-snug">{video.title}</h1>

          {/* Video player */}
          <VideoPlayer
            streamUrl={streamUrl}
            videoId={video.id}
            initialPosition={initialPosition}
            onComplete={handleComplete}
            onProgress={handleProgress}
            onTimeChange={setCurrentTime}
          />

          {/* Info / Notes tabs */}
          <div className="glass-card rounded-xl overflow-hidden border border-surface-bright">
            {/* Tab bar */}
            <div className="flex border-b border-surface-bright">
              <button
                onClick={() => setActiveTab('info')}
                className={cn(
                  'flex items-center gap-2 px-5 py-3 text-xs font-semibold uppercase tracking-widest transition-colors',
                  activeTab === 'info'
                    ? 'text-primary border-b-2 border-primary bg-primary/5'
                    : 'text-text-muted hover:text-text'
                )}
              >
                <Info className="w-3.5 h-3.5" />
                Info
              </button>
              <button
                onClick={() => setActiveTab('notes')}
                className={cn(
                  'flex items-center gap-2 px-5 py-3 text-xs font-semibold uppercase tracking-widest transition-colors',
                  activeTab === 'notes'
                    ? 'text-primary border-b-2 border-primary bg-primary/5'
                    : 'text-text-muted hover:text-text'
                )}
              >
                <FileText className="w-3.5 h-3.5" />
                Notes
                {initialNotes.length > 0 && (
                  <span className="ml-1 text-[10px] bg-primary/20 text-primary rounded-full px-1.5 py-px">
                    {initialNotes.length}
                  </span>
                )}
              </button>
            </div>

            {/* Tab content */}
            <div className="p-5">
              {activeTab === 'info' ? (
                <div className="space-y-4">
                  {video.description ? (
                    <p className="text-sm text-text-muted leading-relaxed whitespace-pre-wrap">
                      {video.description}
                    </p>
                  ) : (
                    <p className="text-sm text-text-muted/50 italic">No description available.</p>
                  )}
                  {video.duration_seconds != null && (
                    <div className="flex items-center gap-2 text-xs text-text-muted">
                      <Clock className="w-3.5 h-3.5" />
                      <span>Duration: {formatTime(video.duration_seconds)}</span>
                    </div>
                  )}
                </div>
              ) : (
                <NotesPanel
                  videoId={video.id}
                  initialNotes={initialNotes}
                  currentTime={currentTime}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
