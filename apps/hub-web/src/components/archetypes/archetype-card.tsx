'use client';

import Link from 'next/link';
import { Check, X, Edit2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ArchetypeCardArchetype {
  id: string;
  name: string;
  description: string | null;
  image_style: string | null;
  style_prefix: string | null;
  style_suffix: string | null;
  is_active: boolean;
  hasStyleGuide: boolean;
}

interface ArchetypeCardProps {
  archetype: ArchetypeCardArchetype;
  onEdit: (archetype: ArchetypeCardArchetype) => void;
}

const IMAGE_STYLE_BADGE: Record<string, string> = {
  stickman:       'bg-[rgba(249,115,22,0.15)] text-[#f97316]',
  illustration:   'bg-[rgba(170,255,0,0.15)] text-[#aaff00]',
  photorealistic: 'bg-[rgba(35,222,203,0.15)] text-[#23decb]',
};

const IMAGE_STYLE_LABEL: Record<string, string> = {
  stickman:       'Stickman',
  illustration:   'Illustration',
  photorealistic: 'Photorealistic',
};

function truncate(str: string | null | undefined, max: number): string {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '…' : str;
}

export function ArchetypeCard({ archetype, onEdit }: ArchetypeCardProps) {
  const styleBadgeClass =
    IMAGE_STYLE_BADGE[archetype.image_style ?? ''] ??
    'bg-[#1c1c1c] text-[rgba(205,195,215,0.6)]';
  const styleLabel =
    IMAGE_STYLE_LABEL[archetype.image_style ?? ''] ??
    (archetype.image_style ?? 'Unknown');

  return (
    <div className="bg-[rgba(255,255,255,0.04)] backdrop-blur-[20px] border border-[rgba(255,255,255,0.09)] rounded-xl p-5 flex flex-col gap-3 hover:bg-[rgba(28,28,28,0.5)] transition-all duration-300 group">
      {/* Top row: style badge + active indicator */}
      <div className="flex items-center justify-between">
        <span
          className={cn(
            'px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wide',
            styleBadgeClass
          )}
        >
          {styleLabel}
        </span>

        <span
          className={cn(
            'w-2 h-2 rounded-full',
            archetype.is_active ? 'bg-[#23decb]' : 'bg-[rgba(205,195,215,0.3)]'
          )}
          title={archetype.is_active ? 'Active' : 'Inactive'}
        />
      </div>

      {/* Name */}
      <h3 className="text-lg font-bold text-[#e5e2e1] leading-tight">{archetype.name}</h3>

      {/* Description */}
      <p className="text-sm text-[rgba(205,195,215,0.6)] line-clamp-2 min-h-[2.5rem]">
        {archetype.description ?? 'No description provided.'}
      </p>

      {/* Style guide status */}
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium',
          archetype.hasStyleGuide
            ? 'bg-[rgba(35,222,203,0.1)] text-[#23decb] border border-[rgba(35,222,203,0.2)]'
            : 'bg-[rgba(239,68,68,0.1)] text-[#ef4444] border border-[rgba(239,68,68,0.2)]'
        )}
      >
        {archetype.hasStyleGuide ? (
          <Check className="w-3.5 h-3.5 flex-shrink-0" />
        ) : (
          <X className="w-3.5 h-3.5 flex-shrink-0" />
        )}
        {archetype.hasStyleGuide ? 'Style guide ready' : 'No style guide — jobs will fail'}
      </div>

      {/* Style prefix / suffix */}
      {(archetype.style_prefix || archetype.style_suffix) && (
        <div className="space-y-1.5">
          {archetype.style_prefix && (
            <div>
              <span className="text-[10px] font-semibold text-[rgba(205,195,215,0.6)] uppercase tracking-wide">
                Prefix
              </span>
              <p className="mt-0.5 font-mono text-[11px] text-[rgba(205,195,215,0.8)] bg-[#151515] rounded px-2 py-1 truncate">
                {truncate(archetype.style_prefix, 60)}
              </p>
            </div>
          )}
          {archetype.style_suffix && (
            <div>
              <span className="text-[10px] font-semibold text-[rgba(205,195,215,0.6)] uppercase tracking-wide">
                Suffix
              </span>
              <p className="mt-0.5 font-mono text-[11px] text-[rgba(205,195,215,0.8)] bg-[#151515] rounded px-2 py-1 truncate">
                {truncate(archetype.style_suffix, 60)}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1 mt-auto">
        <button
          onClick={() => onEdit(archetype)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[rgba(75,68,85,0.3)] text-[rgba(205,195,215,0.6)] text-xs font-medium hover:text-[#e5e2e1] hover:border-[rgba(170,255,0,0.3)] transition-colors"
        >
          <Edit2 className="w-3.5 h-3.5" />
          Edit
        </button>
        <Link
          href={`/asset-library?archetype_id=${archetype.id}`}
          className="text-xs text-[#aaff00] hover:text-[rgba(170,255,0,0.8)] transition-colors ml-auto"
        >
          View Assets →
        </Link>
      </div>
    </div>
  );
}
