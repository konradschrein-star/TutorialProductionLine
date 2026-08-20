'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Plus,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Video,
  BookOpen,
  GripVertical,
  Check,
  X,
  ArrowLeft,
  Play,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Course, CourseChapter, CourseVideo } from '@repo/db';

// ---------------------------------------------------------------------------
// Role options for access selector
// ---------------------------------------------------------------------------
const ROLES = [
  { value: 'ADMIN', label: 'Admin', color: '#aaff00' },
  { value: 'MANAGER', label: 'Manager', color: '#3b82f6' },
  { value: 'PRODUCTION_VA', label: 'Production VA', color: '#f97316' },
  { value: 'UPLOADER_VA', label: 'Uploader VA', color: '#f59e0b' },
  { value: 'VIEWER', label: 'Investor', color: '#22c55e' },
];

// ---------------------------------------------------------------------------
// Inline text edit helper
// ---------------------------------------------------------------------------
function InlineEdit({
  value,
  onSave,
  placeholder = 'Edit...',
  multiline = false,
  className = '',
}: {
  value: string;
  onSave: (val: string) => void;
  placeholder?: string;
  multiline?: boolean;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  function save() {
    if (draft.trim()) onSave(draft.trim());
    setEditing(false);
  }

  if (!editing) {
    return (
      <button
        onClick={() => { setDraft(value); setEditing(true); }}
        className={cn('text-left hover:text-primary transition-colors', className)}
      >
        {value || <span className="text-text-muted/40 italic">{placeholder}</span>}
      </button>
    );
  }

  return (
    <div className="flex items-start gap-2">
      {multiline ? (
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          className="flex-1 bg-surface border border-primary/50 rounded px-2 py-1 text-sm text-text focus:outline-none resize-none"
        />
      ) : (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
          className="flex-1 bg-surface border border-primary/50 rounded px-2 py-1 text-sm text-text focus:outline-none"
        />
      )}
      <button onClick={save} className="text-primary hover:text-primary/80"><Check className="w-4 h-4" /></button>
      <button onClick={() => setEditing(false)} className="text-text-muted hover:text-text"><X className="w-4 h-4" /></button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Role access selector
// ---------------------------------------------------------------------------
function RoleSelector({
  value,
  onChange,
}: {
  value: string[];
  onChange: (roles: string[]) => void;
}) {
  function toggle(role: string) {
    onChange(
      value.includes(role) ? value.filter((r) => r !== role) : [...value, role]
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      <span className="text-[10px] uppercase tracking-widest text-text-muted self-center mr-1">Access:</span>
      {ROLES.map((r) => {
        const active = value.includes(r.value);
        return (
          <button
            key={r.value}
            onClick={() => toggle(r.value)}
            title={active ? `Remove ${r.label} access` : `Grant ${r.label} access`}
            className={cn(
              'flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-all',
              active
                ? 'text-black border-transparent'
                : 'text-text-muted border-surface-bright bg-surface hover:border-primary/30'
            )}
            style={active ? { background: r.color, borderColor: r.color } : {}}
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: active ? '#000' : r.color }}
            />
            {r.label}
          </button>
        );
      })}
      {value.length === 0 && (
        <span className="text-[10px] text-primary/70 self-center">All roles</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Video row
// ---------------------------------------------------------------------------
function VideoRow({
  video,
  chapterId,
  onUpdate,
  onDelete,
}: {
  video: CourseVideo;
  chapterId: string;
  onUpdate: (updated: CourseVideo) => void;
  onDelete: (id: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);

  async function patchVideo(patch: Partial<CourseVideo>) {
    const res = await fetch('/api/knowledge/admin/videos', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: video.id, ...patch }),
    });
    if (res.ok) {
      const { video: updated } = await res.json();
      onUpdate(updated);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    await fetch(`/api/knowledge/admin/videos?id=${video.id}`, { method: 'DELETE' });
    onDelete(video.id);
  }

  return (
    <div className="flex items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-surface/40 group/video border border-transparent hover:border-surface-bright transition-all">
      <GripVertical className="w-4 h-4 text-text-muted/30 mt-0.5 flex-shrink-0 cursor-grab" />
      <Video className="w-4 h-4 text-text-muted/50 mt-0.5 flex-shrink-0" />

      <div className="flex-1 min-w-0 space-y-1">
        <InlineEdit
          value={video.title}
          onSave={(title) => patchVideo({ title })}
          placeholder="Video title"
          className="text-sm font-medium text-text w-full"
        />
        <InlineEdit
          value={video.description ?? ''}
          onSave={(description) => patchVideo({ description })}
          placeholder="Add description..."
          multiline
          className="text-xs text-text-muted w-full"
        />
        {/* Video key */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-text-muted/50 uppercase tracking-widest">Path:</span>
          <InlineEdit
            value={video.video_key}
            onSave={(video_key) => patchVideo({ video_key })}
            placeholder="/opt/content-forge/media/knowledge/..."
            className="text-[11px] font-mono text-text-muted/70 truncate max-w-sm"
          />
        </div>
        {/* Duration */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-text-muted/50 uppercase tracking-widest">Duration (s):</span>
          <InlineEdit
            value={video.duration_seconds != null ? String(video.duration_seconds) : ''}
            onSave={(v) => patchVideo({ duration_seconds: parseInt(v, 10) || null })}
            placeholder="e.g. 942"
            className="text-[11px] text-text-muted/70"
          />
        </div>
      </div>

      <div className="flex items-center gap-1.5 opacity-0 group-hover/video:opacity-100 transition-opacity flex-shrink-0">
        <button
          title={video.is_published ? 'Unpublish' : 'Publish'}
          onClick={() => patchVideo({ is_published: !video.is_published })}
          className="text-text-muted hover:text-primary transition-colors"
        >
          {video.is_published ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
        </button>
        <Link
          href={`/knowledge/${(video as any).chapter?.course?.id ?? ''}/${video.id}`}
          target="_blank"
          className="text-text-muted hover:text-primary transition-colors"
          title="Preview"
        >
          <Play className="w-3.5 h-3.5" />
        </Link>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="text-text-muted hover:text-red-400 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add video form
// ---------------------------------------------------------------------------
function AddVideoForm({
  chapterId,
  orderIndex,
  onAdded,
  onCancel,
}: {
  chapterId: string;
  orderIndex: number;
  onAdded: (video: CourseVideo) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const [videoKey, setVideoKey] = useState('');
  const [durationSeconds, setDurationSeconds] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !videoKey.trim()) return;
    setSaving(true);
    const res = await fetch('/api/knowledge/admin/videos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chapter_id: chapterId,
        title: title.trim(),
        video_key: videoKey.trim(),
        order_index: orderIndex,
        duration_seconds: durationSeconds ? parseInt(durationSeconds, 10) : null,
        is_published: true,
      }),
    });
    setSaving(false);
    if (res.ok) {
      const { video } = await res.json();
      onAdded(video);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="ml-7 mt-1 glass rounded-xl p-4 border border-primary/20 space-y-3">
      <p className="text-[10px] uppercase tracking-widest text-primary font-semibold">New Video</p>
      <div className="grid grid-cols-1 gap-2">
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Video title *"
          className="w-full bg-surface border border-surface-bright rounded-lg px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-primary/50 transition-all"
        />
        <input
          value={videoKey}
          onChange={(e) => setVideoKey(e.target.value)}
          placeholder="Server file path, e.g. /opt/content-forge/media/knowledge/... *"
          className="w-full bg-surface border border-surface-bright rounded-lg px-3 py-2 text-sm font-mono text-text placeholder:text-text-muted focus:outline-none focus:border-primary/50 transition-all"
        />
        <input
          value={durationSeconds}
          onChange={(e) => setDurationSeconds(e.target.value)}
          type="number"
          min="0"
          placeholder="Duration in seconds (optional)"
          className="w-full bg-surface border border-surface-bright rounded-lg px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-primary/50 transition-all"
        />
      </div>
      <div className="flex items-center gap-2 justify-end">
        <button type="button" onClick={onCancel} className="text-xs text-text-muted hover:text-text transition-colors px-3 py-1.5">
          Cancel
        </button>
        <button
          type="submit"
          disabled={!title.trim() || !videoKey.trim() || saving}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-widest text-black disabled:opacity-40 transition-all"
          style={{ background: 'hsl(var(--primary))' }}
        >
          <Plus className="w-3.5 h-3.5" />
          {saving ? 'Adding…' : 'Add Video'}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Chapter row
// ---------------------------------------------------------------------------
function ChapterRow({
  chapter,
  courseId,
  onUpdate,
  onDelete,
}: {
  chapter: CourseChapter & { videos: CourseVideo[] };
  courseId: string;
  onUpdate: (c: CourseChapter & { videos: CourseVideo[] }) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [addingVideo, setAddingVideo] = useState(false);
  const [videos, setVideos] = useState<CourseVideo[]>(chapter.videos);

  async function patchChapter(patch: Partial<CourseChapter>) {
    const res = await fetch('/api/knowledge/admin/chapters', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: chapter.id, ...patch }),
    });
    if (res.ok) {
      const { chapter: updated } = await res.json();
      onUpdate({ ...updated, videos });
    }
  }

  async function handleDeleteChapter() {
    await fetch(`/api/knowledge/admin/chapters?id=${chapter.id}`, { method: 'DELETE' });
    onDelete(chapter.id);
  }

  function handleVideoAdded(video: CourseVideo) {
    const updated = [...videos, video];
    setVideos(updated);
    setAddingVideo(false);
    onUpdate({ ...chapter, videos: updated });
  }

  function handleVideoUpdated(updatedVideo: CourseVideo) {
    const updated = videos.map((v) => (v.id === updatedVideo.id ? updatedVideo : v));
    setVideos(updated);
    onUpdate({ ...chapter, videos: updated });
  }

  function handleVideoDeleted(id: string) {
    const updated = videos.filter((v) => v.id !== id);
    setVideos(updated);
    onUpdate({ ...chapter, videos: updated });
  }

  return (
    <div className="border border-surface-bright rounded-xl overflow-hidden">
      {/* Chapter header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-surface-container/50 group/chapter">
        <button onClick={() => setOpen(!open)} className="text-text-muted hover:text-text transition-colors">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>

        <div className="flex-1 min-w-0">
          <InlineEdit
            value={chapter.title}
            onSave={(title) => patchChapter({ title })}
            placeholder="Chapter title"
            className="text-sm font-bold text-text"
          />
        </div>

        <span className="text-[10px] text-text-muted/50 flex-shrink-0">
          {videos.length} video{videos.length !== 1 ? 's' : ''}
        </span>

        <div className="flex items-center gap-2 opacity-0 group-hover/chapter:opacity-100 transition-opacity">
          <button
            onClick={() => setAddingVideo(true)}
            className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-primary hover:text-primary/80 transition-colors"
          >
            <Plus className="w-3 h-3" /> Video
          </button>
          <button onClick={handleDeleteChapter} className="text-text-muted/40 hover:text-red-400 transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Videos */}
      {open && (
        <div className="p-2 space-y-0.5">
          {videos.length === 0 && !addingVideo && (
            <p className="text-center text-text-muted/40 text-xs py-4">
              No videos yet.{' '}
              <button onClick={() => setAddingVideo(true)} className="text-primary hover:underline">
                Add one
              </button>
            </p>
          )}
          {videos.map((video) => (
            <VideoRow
              key={video.id}
              video={video}
              chapterId={chapter.id}
              onUpdate={handleVideoUpdated}
              onDelete={handleVideoDeleted}
            />
          ))}
          {addingVideo && (
            <AddVideoForm
              chapterId={chapter.id}
              orderIndex={videos.length}
              onAdded={handleVideoAdded}
              onCancel={() => setAddingVideo(false)}
            />
          )}
          {!addingVideo && videos.length > 0 && (
            <button
              onClick={() => setAddingVideo(true)}
              className="w-full flex items-center justify-center gap-1.5 py-2 text-[10px] uppercase tracking-widest text-text-muted/50 hover:text-primary transition-colors rounded-lg hover:bg-primary/5 mt-1"
            >
              <Plus className="w-3 h-3" /> Add Video
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Course panel
// ---------------------------------------------------------------------------
function CoursePanel({
  course,
  onUpdate,
  onDelete,
}: {
  course: Course & { chapters: (CourseChapter & { videos: CourseVideo[] })[] };
  onUpdate: (c: Course & { chapters: (CourseChapter & { videos: CourseVideo[] })[] }) => void;
  onDelete: (id: string) => void;
}) {
  const [chapters, setChapters] = useState(course.chapters);
  const [allowedRoles, setAllowedRoles] = useState<string[]>(course.allowed_roles ?? []);
  const [addingChapter, setAddingChapter] = useState(false);
  const [newChapterTitle, setNewChapterTitle] = useState('');

  async function patchCourse(patch: Partial<Course>) {
    const res = await fetch('/api/knowledge/admin/courses', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: course.id, ...patch }),
    });
    if (res.ok) {
      const { course: updated } = await res.json();
      onUpdate({ ...updated, chapters });
    }
  }

  async function handleRolesChange(roles: string[]) {
    setAllowedRoles(roles);
    await patchCourse({ allowed_roles: roles });
  }

  async function handleTogglePublish() {
    await patchCourse({ is_published: !course.is_published });
  }

  async function handleDeleteCourse() {
    await fetch(`/api/knowledge/admin/courses?id=${course.id}`, { method: 'DELETE' });
    onDelete(course.id);
  }

  async function handleAddChapter(e: React.FormEvent) {
    e.preventDefault();
    if (!newChapterTitle.trim()) return;
    const res = await fetch('/api/knowledge/admin/chapters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        course_id: course.id,
        title: newChapterTitle.trim(),
        order_index: chapters.length,
      }),
    });
    if (res.ok) {
      const { chapter } = await res.json();
      const updated = [...chapters, { ...chapter, videos: [] }];
      setChapters(updated);
      setNewChapterTitle('');
      setAddingChapter(false);
      onUpdate({ ...course, chapters: updated, allowed_roles: allowedRoles });
    }
  }

  function handleChapterUpdated(updated: CourseChapter & { videos: CourseVideo[] }) {
    const next = chapters.map((c) => (c.id === updated.id ? updated : c));
    setChapters(next);
    onUpdate({ ...course, chapters: next, allowed_roles: allowedRoles });
  }

  function handleChapterDeleted(id: string) {
    const next = chapters.filter((c) => c.id !== id);
    setChapters(next);
    onUpdate({ ...course, chapters: next, allowed_roles: allowedRoles });
  }

  return (
    <div className="glass-card rounded-2xl border border-surface-bright overflow-hidden">
      {/* Course header */}
      <div className="p-5 border-b border-surface-bright space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0 space-y-1">
            <InlineEdit
              value={course.title}
              onSave={(title) => patchCourse({ title })}
              placeholder="Course title"
              className="text-lg font-bold text-text"
            />
            <InlineEdit
              value={course.description ?? ''}
              onSave={(description) => patchCourse({ description })}
              placeholder="Course description..."
              multiline
              className="text-sm text-text-muted"
            />
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={handleTogglePublish}
              title={course.is_published ? 'Unpublish' : 'Publish'}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all',
                course.is_published
                  ? 'text-black'
                  : 'text-text-muted border border-surface-bright hover:border-primary/30'
              )}
              style={course.is_published ? { background: 'hsl(var(--primary))' } : {}}
            >
              {course.is_published ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
              {course.is_published ? 'Live' : 'Draft'}
            </button>
            <Link
              href={`/knowledge/${course.id}`}
              target="_blank"
              className="p-1.5 text-text-muted hover:text-primary transition-colors"
              title="View course"
            >
              <BookOpen className="w-4 h-4" />
            </Link>
            <button
              onClick={handleDeleteCourse}
              className="p-1.5 text-text-muted/40 hover:text-red-400 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Role access */}
        <RoleSelector value={allowedRoles} onChange={handleRolesChange} />
      </div>

      {/* Chapters */}
      <div className="p-4 space-y-3">
        {chapters.map((chapter) => (
          <ChapterRow
            key={chapter.id}
            chapter={chapter}
            courseId={course.id}
            onUpdate={handleChapterUpdated}
            onDelete={handleChapterDeleted}
          />
        ))}

        {/* Add chapter */}
        {addingChapter ? (
          <form onSubmit={handleAddChapter} className="flex items-center gap-2">
            <input
              autoFocus
              value={newChapterTitle}
              onChange={(e) => setNewChapterTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setAddingChapter(false)}
              placeholder="Chapter title..."
              className="flex-1 bg-surface border border-primary/50 rounded-lg px-3 py-2 text-sm text-text focus:outline-none"
            />
            <button
              type="submit"
              disabled={!newChapterTitle.trim()}
              className="px-3 py-2 rounded-lg text-xs font-bold text-black disabled:opacity-40 transition-all"
              style={{ background: 'hsl(var(--primary))' }}
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => setAddingChapter(false)}
              className="text-text-muted hover:text-text text-xs px-2 py-2"
            >
              Cancel
            </button>
          </form>
        ) : (
          <button
            onClick={() => setAddingChapter(true)}
            className="w-full flex items-center justify-center gap-2 py-3 text-[10px] uppercase tracking-widest text-text-muted/50 hover:text-primary transition-colors rounded-xl border border-dashed border-surface-bright hover:border-primary/30 hover:bg-primary/5"
          >
            <Plus className="w-3.5 h-3.5" /> Add Chapter
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add course form
// ---------------------------------------------------------------------------
function AddCourseForm({ onAdded }: { onAdded: (course: Course & { chapters: [] }) => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [allowedRoles, setAllowedRoles] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    const res = await fetch('/api/knowledge/admin/courses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: title.trim(),
        description: description.trim(),
        allowed_roles: allowedRoles,
        is_published: false,
      }),
    });
    setSaving(false);
    if (res.ok) {
      const { course } = await res.json();
      onAdded({ ...course, chapters: [] });
      setTitle('');
      setDescription('');
      setAllowedRoles([]);
      setOpen(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl border-2 border-dashed border-surface-bright hover:border-primary/40 hover:bg-primary/5 text-text-muted/50 hover:text-primary transition-all"
      >
        <Plus className="w-5 h-5" />
        <span className="text-sm font-semibold uppercase tracking-widest">New Course</span>
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="glass-card rounded-2xl border border-primary/30 p-5 space-y-4">
      <p className="text-[10px] uppercase tracking-widest text-primary font-semibold">New Course</p>
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Course title *"
        className="w-full bg-surface border border-surface-bright rounded-lg px-3 py-2.5 text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-primary/50 transition-all"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description (optional)"
        rows={2}
        className="w-full bg-surface border border-surface-bright rounded-lg px-3 py-2.5 text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-primary/50 transition-all resize-none"
      />
      <RoleSelector value={allowedRoles} onChange={setAllowedRoles} />
      <div className="flex items-center gap-2 justify-end">
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-text-muted hover:text-text transition-colors px-3 py-1.5">
          Cancel
        </button>
        <button
          type="submit"
          disabled={!title.trim() || saving}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest text-black disabled:opacity-40 transition-all"
          style={{ background: 'hsl(var(--primary))' }}
        >
          <Plus className="w-3.5 h-3.5" />
          {saving ? 'Creating…' : 'Create Course'}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Main KnowledgeManager component
// ---------------------------------------------------------------------------
type CourseWithChaptersAndVideos = Course & {
  chapters: (CourseChapter & { videos: CourseVideo[] })[];
};

export function KnowledgeManager({ initialCourses }: { initialCourses: Course[] }) {
  const [courses, setCourses] = useState<CourseWithChaptersAndVideos[]>(
    initialCourses.map((c) => ({ ...c, chapters: [] }))
  );
  const [loading, setLoading] = useState(true);

  // Hydrate chapters and videos for each course
  useEffect(() => {
    async function hydrate() {
      const hydrated = await Promise.all(
        initialCourses.map(async (course) => {
          const chaptersRes = await fetch(`/api/knowledge/admin/chapters?courseId=${course.id}`);
          if (!chaptersRes.ok) return { ...course, chapters: [] };
          const { chapters } = await chaptersRes.json();

          const chaptersWithVideos = await Promise.all(
            chapters.map(async (chapter: CourseChapter) => {
              const videosRes = await fetch(`/api/knowledge/admin/videos?chapterId=${chapter.id}`);
              if (!videosRes.ok) return { ...chapter, videos: [] };
              const { videos } = await videosRes.json();
              return { ...chapter, videos };
            })
          );

          return { ...course, chapters: chaptersWithVideos };
        })
      );
      setCourses(hydrated);
      setLoading(false);
    }
    hydrate();
  }, []);

  function handleCourseAdded(course: CourseWithChaptersAndVideos) {
    setCourses((prev) => [...prev, course]);
  }

  function handleCourseUpdated(updated: CourseWithChaptersAndVideos) {
    setCourses((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  }

  function handleCourseDeleted(id: string) {
    setCourses((prev) => prev.filter((c) => c.id !== id));
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-text-muted text-sm">
        Loading courses...
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Nav to viewer */}
      <div className="flex items-center gap-3">
        <Link
          href="/knowledge"
          className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-text-muted hover:text-primary transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Library
        </Link>
        <span className="text-text-muted/20">|</span>
        <span className="text-[10px] uppercase tracking-widest text-text-muted/50">
          {courses.length} course{courses.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Course list */}
      {courses.map((course) => (
        <CoursePanel
          key={course.id}
          course={course}
          onUpdate={handleCourseUpdated}
          onDelete={handleCourseDeleted}
        />
      ))}

      {/* Add course */}
      <AddCourseForm onAdded={handleCourseAdded} />
    </div>
  );
}
