'use client';

import { Edit2, Image as ImageIcon, Package } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface EnvironmentCardEnvironment {
  id: string;
  name: string;
  description: string;
  archetype_id: string | null;
  background_asset_id: string;
  prop_asset_ids: string[];
  spatial_hints: {
    character_x_percent?: number;
    character_scale?: number;
    safe_zone_right_percent?: number;
  } | null;
}

interface ArchetypeRef {
  id: string;
  name: string;
}

interface EnvironmentCardProps {
  environment: EnvironmentCardEnvironment;
  archetypes: ArchetypeRef[];
  onEdit: (environment: EnvironmentCardEnvironment) => void;
}

export function EnvironmentCard({ environment, archetypes, onEdit }: EnvironmentCardProps) {
  const archetype = archetypes.find((a) => a.id === environment.archetype_id);
  const propCount = environment.prop_asset_ids?.length ?? 0;
  const safeZone = environment.spatial_hints?.safe_zone_right_percent;

  return (
    <div className="glass-card rounded-xl overflow-hidden group hover:bg-surface-bright/50 transition-all duration-300 relative">
      {/* Background preview */}
      <div className="relative h-36 bg-surface-container flex items-center justify-center overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/assets/${environment.background_asset_id}`}
          alt={environment.name}
          className="h-full w-full object-cover"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
        <div className="absolute inset-0 flex items-center justify-center text-text-muted/30 bg-surface-container">
          <ImageIcon className="w-10 h-10" />
        </div>

        {/* Hover edit overlay */}
        <div className="absolute inset-0 bg-background/70 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
          <button
            onClick={() => onEdit(environment)}
            className="p-2.5 rounded-lg bg-surface-bright text-text-muted hover:text-primary transition-colors"
            title="Edit environment"
          >
            <Edit2 className="w-4 h-4" />
          </button>
        </div>

        {/* Prop count badge */}
        {propCount > 0 && (
          <span className="absolute top-2 right-2 flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-surface-container/90 text-text-muted">
            <Package className="w-3 h-3" />
            {propCount} prop{propCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Info area */}
      <div className="p-4 space-y-2">
        <h3 className="text-sm font-bold text-text">{environment.name}</h3>

        <div className="flex items-center gap-2 flex-wrap">
          {archetype && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-primary/15 text-primary uppercase tracking-wide">
              {archetype.name}
            </span>
          )}

          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-surface-bright text-text-muted">
            {propCount} props
          </span>

          {safeZone !== undefined && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-warning/10 text-warning border border-warning/20">
              Safe zone: right {safeZone}%
            </span>
          )}
        </div>

        <p className="text-xs text-text-muted line-clamp-2">{environment.description}</p>
      </div>
    </div>
  );
}
