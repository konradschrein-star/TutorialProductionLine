import React, { useState } from 'react';
import { CheckCircle2, ShieldCheck } from 'lucide-react';
import { StorageService } from '../services/storageService';
import { FinishedVideo } from '../types';

export const FinishedVideos: React.FC = () => {
  const [videos] = useState<FinishedVideo[]>(() => StorageService.getFinishedVideos());

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-4">
      
      {/* Header */}
      <div className="pro-panel p-4 rounded-xl flex items-center justify-between">
        <div>
          <h1 className="text-sm font-bold font-display text-foreground">Finished Media &amp; Stealth Upload Queue</h1>
          <p className="text-[11px] text-muted mt-0.5">
            Staged video manifests awaiting execution by the Dolphin Anty + Windows SendInput agent.
          </p>
        </div>

        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface-200 border border-border text-foreground text-xs font-mono font-semibold">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Stealth Protection Active</span>
        </div>
      </div>

      {/* Videos List Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {videos.map(video => (
          <div key={video.id} className="pro-card rounded-xl overflow-hidden flex flex-col group">
            
            {/* Thumbnail Header */}
            <div className="aspect-video relative overflow-hidden bg-black">
              <img
                src={video.thumbnailUrl}
                alt={video.title}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
              />
              <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-black/80 backdrop-blur-md text-[10px] font-mono text-white">
                {video.duration}
              </div>
              <div className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded bg-black/80 backdrop-blur-md text-[9px] font-mono uppercase font-bold text-white border border-white/15">
                {video.channel}
              </div>
            </div>

            {/* Content Details */}
            <div className="p-3.5 flex-1 flex flex-col justify-between space-y-2.5">
              <div>
                <h4 className="text-xs font-bold text-foreground line-clamp-2 leading-snug">
                  {video.title}
                </h4>
                <p className="text-[11px] text-muted mt-1 line-clamp-2 font-mono">
                  {video.script}
                </p>
              </div>

              {/* Status Badge & Date */}
              <div className="pt-2 border-t border-border flex items-center justify-between">
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-surface-200 text-foreground border border-border flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  {video.status}
                </span>

                <span className="text-[10px] text-muted font-mono">
                  {video.createdAt}
                </span>
              </div>

            </div>

          </div>
        ))}
      </div>

    </div>
  );
};
