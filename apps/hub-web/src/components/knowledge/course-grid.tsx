'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Search, BookOpen, Play, Lock } from 'lucide-react';
import type { Course } from '@repo/db';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Role dot colours
// ---------------------------------------------------------------------------
const ROLE_DOTS: Record<string, { label: string; color: string }> = {
  ADMIN: { label: 'Admin', color: '#aaff00' },
  MANAGER: { label: 'Manager', color: '#3b82f6' },
  PRODUCTION_VA: { label: 'Production VA', color: '#f97316' },
  UPLOADER_VA: { label: 'Uploader VA', color: '#f59e0b' },
  VIEWER: { label: 'Investor', color: '#22c55e' },
};
const ALL_ROLES = Object.keys(ROLE_DOTS);

interface CourseWithProgress extends Course {
  progress: { completedCount: number; totalCount: number; percentComplete: number };
}

interface Props {
  courses: CourseWithProgress[];
  canManage: boolean;
}

// ---------------------------------------------------------------------------
// Access dot component
// ---------------------------------------------------------------------------
function AccessDots({ allowedRoles }: { allowedRoles: string[] }) {
  const roles = allowedRoles.length === 0 ? ALL_ROLES : allowedRoles;
  return (
    <div className="flex items-center gap-1">
      {roles.map((role) => {
        const dot = ROLE_DOTS[role];
        if (!dot) return null;
        return (
          <div
            key={role}
            title={dot.label}
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: dot.color }}
          />
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Course card
// ---------------------------------------------------------------------------
function CourseCard({ course }: { course: CourseWithProgress }) {
  const { completedCount, totalCount, percentComplete } = course.progress;
  const isRestricted = course.allowed_roles.length > 0;

  return (
    <Link
      href={`/knowledge/${course.id}`}
      className="group glass-card rounded-xl overflow-hidden border border-surface-bright hover:border-primary/40 transition-all duration-300 hover:shadow-[0_0_20px_hsl(var(--primary)/0.15)] flex flex-col"
    >
      {/* Thumbnail */}
      <div className="relative aspect-video bg-surface-container overflow-hidden">
        {course.thumbnail_key ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/timeline/image-by-key?key=${encodeURIComponent(course.thumbnail_key)}`}
            alt={course.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-surface-container to-surface">
            <BookOpen className="w-12 h-12 text-primary/30" />
          </div>
        )}

        {/* Play overlay */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-black/40">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center shadow-[0_0_20px_rgba(170,255,0,0.4)]"
            style={{ background: 'linear-gradient(to bottom right, hsl(var(--primary)), hsl(var(--primary-700)))' }}
          >
            <Play className="w-6 h-6 text-black ml-0.5" />
          </div>
        </div>

        {/* Progress bar */}
        {totalCount > 0 && percentComplete > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/40">
            <div
              className="h-full transition-all duration-500"
              style={{
                width: `${percentComplete}%`,
                background: 'hsl(var(--primary))',
                boxShadow: '0 0 8px hsl(var(--primary)/0.6)',
              }}
            />
          </div>
        )}
      </div>

      {/* Body */}
      <div className="p-4 flex flex-col gap-3 flex-1">
        {/* Title row */}
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-bold text-text leading-tight line-clamp-2 group-hover:text-primary transition-colors">
            {course.title}
          </h3>
          {isRestricted && (
            <Lock className="w-3.5 h-3.5 text-primary/60 flex-shrink-0 mt-0.5" />
          )}
        </div>

        {/* Description */}
        {course.description && (
          <p className="text-text-muted text-xs leading-relaxed line-clamp-2">
            {course.description}
          </p>
        )}

        {/* Footer */}
        <div className="mt-auto pt-3 border-t border-surface-bright flex items-center justify-between">
          {/* Progress text */}
          <span className="text-[10px] font-medium uppercase tracking-widest text-text-muted">
            {totalCount === 0
              ? 'No videos yet'
              : completedCount === totalCount
              ? '✓ Completed'
              : `${completedCount} / ${totalCount} watched`}
          </span>

          {/* Access dots */}
          <AccessDots allowedRoles={course.allowed_roles} />
        </div>

        {/* Progress bar under footer */}
        {totalCount > 0 && (
          <div className="h-0.5 bg-surface-bright rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${percentComplete}%`,
                background: 'hsl(var(--primary))',
              }}
            />
          </div>
        )}
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Main grid component
// ---------------------------------------------------------------------------
export function KnowledgeCourseGrid({ courses, canManage }: Props) {
  const [search, setSearch] = useState('');

  const filtered = courses.filter(
    (c) =>
      c.title.toLowerCase().includes(search.toLowerCase()) ||
      c.description.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
        <input
          type="text"
          placeholder="Search courses..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 bg-surface-container border border-surface-bright rounded-lg text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 transition-all"
        />
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 space-y-4">
          <BookOpen className="w-12 h-12 text-primary/20" />
          <p className="text-text-muted text-sm">
            {search ? 'No courses match your search.' : 'No courses available yet.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((course) => (
            <CourseCard key={course.id} course={course} />
          ))}
        </div>
      )}
    </div>
  );
}
