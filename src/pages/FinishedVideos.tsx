import React, { useState } from 'react';
import { CheckCircle2, Clock, Play, Send, ExternalLink, ShieldCheck, Tag } from 'lucide-react';
import { StorageService } from '../services/storageService';
import { FinishedVideo } from '../types';

export const FinishedVideos: React.FC = () => {
  const [videos] = useState<FinishedVideo[]>(() => StorageService.getFinishedVideos());

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      
      {/* Header */}
      <div className="glass-panel p-6 rounded-2xl flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black font-display text-white">Finished Videos &amp; Stealth Queue</h1>
          <p className="text-xs text-slate-400 mt-1">
            Track staged manifests awaiting execution by the Dolphin Anty + Windows SendInput agent.
          </p>
        </div>

        <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-accent-purple/10 border border-accent-purple/30 text-accent-purple text-xs font-bold">
          <ShieldCheck className="w-4 h-4" />
          <span>Stealth Dispatch Protected</span>
        </div>
      </div>

      {/* Videos List Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {videos.map(video => (
          <div key={video.id} className="glass-card rounded-2xl overflow-hidden flex flex-col group">
            
            {/* Thumbnail Header */}
            <div className="aspect-video relative overflow-hidden bg-black">
              <img
                src={video.thumbnailUrl}
                alt={video.title}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              />
              <div className="absolute top-2 right-2 px-2 py-0.5 rounded bg-black/70 backdrop-blur-md text-[10px] font-bold text-white font-mono">
                {video.duration}
              </div>
              <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-accent-purple text-[10px] font-extrabold text-white uppercase tracking-wider">
                {video.channel}
              </div>
            </div>

            {/* Content Details */}
            <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
              <div>
                <h4 className="text-sm font-bold text-white line-clamp-2 leading-snug">
                  {video.title}
                </h4>
                <p className="text-xs text-slate-400 mt-1.5 line-clamp-2">
                  {video.script}
                </p>
              </div>

              {/* Status Badge & Date */}
              <div className="pt-2 border-t border-white/5 flex items-center justify-between">
                <span className="px-2 py-0.5 rounded-full bg-accent-emerald/20 text-accent-emerald text-[10px] font-extrabold flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  {video.status}
                </span>

                <span className="text-[10px] text-slate-400 font-mono">
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
