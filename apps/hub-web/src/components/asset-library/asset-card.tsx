'use client';

import { useState } from 'react';
import {
  Edit2,
  Trash2,
  Check,
  Star,
  Image as ImageIcon,
  FileText,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export interface AssetCardAsset {
  id: string;
  name: string;
  description: string;
  asset_type: string;
  origin: string;
  status: string;
  file_format: string;
  tags: string[];
  quality_rating: number | null;
  archetype_id: string | null;
  character_id: string | null;
  size_bytes?: number | null;
  created_at: string;
  file_path?: string | null;
  thumbnail_path?: string | null;
  waveform_data?: number[] | null;
  duration_seconds?: number | null;
}

interface AssetCardProps {
  asset: AssetCardAsset;
  onEdit: (asset: AssetCardAsset) => void;
  onApprove: (id: string) => void;
  onDelete: (id: string) => void;
}

/** Color badge class per asset_type */
const TYPE_BADGE: Record<string, string> = {
  style_guide:      'text-primary bg-primary/15',
  character:        'text-success bg-success/15',
  character_state:  'text-success/70 bg-success/10',
  background:       'text-warning bg-warning/15',
  object:           'text-blue-400 bg-blue-400/15',
  prompt_template:  'text-purple-400 bg-purple-400/15',
  color_palette:    'text-pink-400 bg-pink-400/15',
};

const TYPE_LABEL: Record<string, string> = {
  style_guide:      'Style Guide',
  character:        'Character',
  character_state:  'Char State',
  background:       'Background',
  object:           'Object',
  prompt_template:  'Prompt',
  color_palette:    'Palette',
};

const STATUS_DOT: Record<string, string> = {
  approved:   'bg-success',
  draft:      'bg-warning',
  deprecated: 'bg-error',
};

export function AssetCard({ asset, onEdit, onApprove, onDelete }: AssetCardProps) {
  const [imgError, setImgError] = useState(false);

  const badgeClass = TYPE_BADGE[asset.asset_type] ?? 'text-text-muted bg-surface-bright';
  const badgeLabel = TYPE_LABEL[asset.asset_type] ?? asset.asset_type;
  const dotClass = STATUS_DOT[asset.status] ?? 'bg-text-muted';

  const isPromptTemplate = asset.asset_type === 'prompt_template';

  return (
    <div className="glass-card rounded-xl overflow-hidden group relative hover:bg-surface-bright/50 transition-all duration-300">
      {/* Preview area */}
      <div className="relative h-36 bg-surface-container flex items-center justify-center overflow-hidden">
        {!imgError && !isPromptTemplate ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={`/api/assets/${asset.id}`}
            alt={asset.name}
            className="h-full w-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-text-muted/40">
            {isPromptTemplate
              ? <FileText className="w-10 h-10" />
              : <ImageIcon className="w-10 h-10" />}
            <span className="text-[10px] uppercase tracking-widest">{badgeLabel}</span>
          </div>
        )}

        {/* Type badge (top-left) */}
        <span className={cn(
          'absolute top-2 left-2 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide',
          badgeClass
        )}>
          {badgeLabel}
        </span>

        {/* Status dot (top-right) */}
        <span
          className={cn('absolute top-2.5 right-2.5 w-2 h-2 rounded-full', dotClass)}
          title={asset.status}
        />

        {/* Hover overlay with actions */}
        <div className="absolute inset-0 bg-background/70 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center gap-2">
          <button
            onClick={() => onEdit(asset)}
            className="p-2 rounded-lg bg-surface-bright text-text-muted hover:text-primary transition-colors"
            title="Edit"
          >
            <Edit2 className="w-4 h-4" />
          </button>
          {asset.status === 'draft' && (
            <button
              onClick={() => onApprove(asset.id)}
              className="p-2 rounded-lg bg-success/20 text-success hover:bg-success/30 transition-colors"
              title="Approve"
            >
              <Check className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => onDelete(asset.id)}
            className="p-2 rounded-lg bg-error/20 text-error hover:bg-error/30 transition-colors"
            title="Delete"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Info area */}
      <div className="p-3 space-y-1.5">
        <p className="text-sm font-semibold text-text truncate" title={asset.name}>
          {asset.name}
        </p>
        <p className="text-xs text-text-muted line-clamp-1" title={asset.description}>
          {asset.description}
        </p>

        <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface-bright text-text-muted uppercase tracking-wide">
            {asset.origin === 'ai_generated' ? 'AI' : 'Real'}
          </span>
          <span className="text-[10px] text-text-muted/50 uppercase tracking-wide">
            {asset.file_format.toUpperCase()}
          </span>

          {/* Quality stars */}
          {asset.quality_rating !== null && (
            <div className="flex items-center gap-0.5 ml-auto">
              {[1, 2, 3, 4, 5].map((n) => (
                <Star
                  key={n}
                  className={cn(
                    'w-3 h-3',
                    n <= (asset.quality_rating ?? 0)
                      ? 'text-warning fill-warning'
                      : 'text-text-muted/30'
                  )}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
