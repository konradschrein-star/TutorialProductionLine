'use client';

import { useRouter } from 'next/navigation';
import { User2, Edit } from 'lucide-react';
import type { Character } from '@/lib/repositories/character-repository';

interface CharacterCardProps {
  character: Character;
  archetypeName: string | null;
}

export function CharacterCard({ character, archetypeName }: CharacterCardProps) {
  const router = useRouter();

  return (
    <div
      className="bg-[rgba(255,255,255,0.04)] backdrop-blur-[20px] border border-[rgba(255,255,255,0.09)] rounded-xl p-5 flex flex-col gap-3 cursor-pointer hover:bg-[rgba(28,28,28,0.5)] transition-all duration-300 group relative"
      onClick={() => router.push(`/characters/${character.id}`)}
      role="link"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && router.push(`/characters/${character.id}`)}
    >
      {/* Edit button */}
      <button
        className="absolute top-4 right-4 p-1.5 rounded-lg text-[rgba(205,195,215,0.6)] hover:text-[#e5e2e1] hover:bg-[#1c1c1c] transition-colors opacity-0 group-hover:opacity-100"
        onClick={(e) => {
          e.stopPropagation();
          router.push(`/characters/${character.id}`);
        }}
        aria-label="Edit character"
      >
        <Edit className="w-3.5 h-3.5" />
      </button>

      {/* Reference sheet image or placeholder */}
      <div className="w-full h-36 rounded-lg overflow-hidden bg-[#151515] flex items-center justify-center">
        {character.reference_sheet_asset_id ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/assets/${character.reference_sheet_asset_id}`}
            alt={`${character.name} reference sheet`}
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-[rgba(205,195,215,0.4)]">
            <User2 className="w-10 h-10" />
            <span className="text-[10px] uppercase tracking-widest font-semibold">No reference sheet</span>
          </div>
        )}
      </div>

      {/* Name */}
      <p className="font-bold text-[#e5e2e1] truncate pr-6">{character.name}</p>

      {/* Description */}
      {character.description && (
        <p className="text-xs text-[rgba(205,195,215,0.6)] truncate leading-relaxed">{character.description}</p>
      )}

      {/* Footer row */}
      <div className="flex items-center justify-between mt-auto pt-1">
        {archetypeName ? (
          <span className="px-2 py-0.5 rounded-full bg-[rgba(170,255,0,0.15)] text-[#aaff00] text-xs font-medium truncate max-w-[60%]">
            {archetypeName}
          </span>
        ) : (
          <span />
        )}

        <span className="text-xs text-[#aaff00] font-medium hover:text-[rgba(170,255,0,0.8)] transition-colors whitespace-nowrap">
          View images →
        </span>
      </div>
    </div>
  );
}
