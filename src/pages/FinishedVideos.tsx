import React, { useState } from 'react';
import { 
  CheckCircle2, 
  ShieldCheck, 
  Download, 
  Play, 
  X, 
  Search, 
  Tv, 
  FileJson,
  ExternalLink
} from 'lucide-react';
import { saveAs } from 'file-saver';
import { StorageService, DEFAULT_CHANNELS } from '../services/storageService';
import { FinishedVideo } from '../types';

export const FinishedVideos: React.FC = () => {
  const [videos] = useState<FinishedVideo[]>(() => StorageService.getFinishedVideos());
  const [selectedVideo, setSelectedVideo] = useState<FinishedVideo | null>(null);
  const [search, setSearch] = useState<string>('');
  const [selectedChannel, setSelectedChannel] = useState<string>('all');

  const filtered = videos.filter(v => {
    if (selectedChannel !== 'all' && v.channel !== selectedChannel) return false;
    if (search && !v.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const handleExportManifest = (video: FinishedVideo) => {
    const manifest = {
      version: '1.0',
      jobId: video.id,
      channel: video.channel,
      title: video.title,
      description: `Learn how to ${video.title} in this step-by-step tutorial.\n\n${video.script.slice(0, 200)}...`,
      tags: video.tags,
      category: '27', // Education
      privacy: 'public',
      stealthConfig: {
        typingDelayMs: 45,
        useHumanScroll: true,
        dolphinProfileId: video.channel.toLowerCase().includes('skool') ? 'prof_skool_01' : 'prof_vfd_01'
      },
      createdAt: video.createdAt
    };

    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
    saveAs(blob, `stealth_manifest_${video.id}.json`);
  };

  const handleExportAllManifests = () => {
    const batch = {
      version: '1.0',
      batchId: `batch_${Date.now()}`,
      totalJobs: videos.length,
      jobs: videos.map(v => ({
        jobId: v.id,
        channel: v.channel,
        title: v.title,
        tags: v.tags,
        createdAt: v.createdAt
      }))
    };
    const blob = new Blob([JSON.stringify(batch, null, 2)], { type: 'application/json' });
    saveAs(blob, `stealth_batch_manifest_${Date.now()}.json`);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-4">
      
      {/* Header */}
      <div className="pro-panel p-4 rounded-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
        <div>
          <h1 className="text-sm font-bold font-display text-foreground">Finished Media &amp; Stealth Upload Queue</h1>
          <p className="text-[11px] text-muted mt-0.5">
            Staged video manifests awaiting execution by the Dolphin Anty + Windows SendInput agent.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExportAllManifests}
            className="btn-outline px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5"
          >
            <FileJson className="w-3.5 h-3.5" />
            Batch Manifest (.json)
          </button>
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-surface-200 border border-border text-foreground text-xs font-mono font-semibold">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
            <span>Stealth Active</span>
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="pro-panel p-3 rounded-xl flex flex-col md:flex-row items-center justify-between gap-2.5">
        <div className="relative w-full md:w-72">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search finished videos..."
            className="pro-input w-full rounded-lg pl-8 pr-3 py-1.5 text-xs"
          />
          <Search className="w-3.5 h-3.5 text-muted absolute left-2.5 top-2" />
        </div>

        <select
          value={selectedChannel}
          onChange={(e) => setSelectedChannel(e.target.value)}
          className="pro-input text-xs rounded-lg px-2.5 py-1.5 cursor-pointer font-sans"
        >
          <option value="all">All Channels ({videos.length})</option>
          {DEFAULT_CHANNELS.map(c => (
            <option key={c.id} value={c.name}>{c.name}</option>
          ))}
        </select>
      </div>

      {/* Videos List Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map(video => (
          <div key={video.id} className="pro-card rounded-xl overflow-hidden flex flex-col group">
            
            {/* Thumbnail Header */}
            <div
              onClick={() => setSelectedVideo(video)}
              className="aspect-video relative overflow-hidden bg-black cursor-pointer"
            >
              <img
                src={video.thumbnailUrl}
                alt={video.title}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
              />
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                <div className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center text-white">
                  <Play className="w-4 h-4 fill-current ml-0.5" />
                </div>
              </div>
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
                <h4
                  onClick={() => setSelectedVideo(video)}
                  className="text-xs font-bold text-foreground line-clamp-2 leading-snug cursor-pointer hover:underline"
                >
                  {video.title}
                </h4>
                <p className="text-[11px] text-muted mt-1 line-clamp-2 font-mono">
                  {video.script}
                </p>
              </div>

              {/* Status Badge & Actions */}
              <div className="pt-2 border-t border-border flex items-center justify-between">
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-surface-200 text-foreground border border-border flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                  {video.status}
                </span>

                <button
                  onClick={() => handleExportManifest(video)}
                  className="btn-outline px-2 py-1 rounded text-[10px] font-mono font-bold flex items-center gap-1"
                  title="Download Stealth Manifest (.json)"
                >
                  <Download className="w-3 h-3" /> Manifest
                </button>
              </div>

            </div>

          </div>
        ))}
      </div>

      {/* Video Inspector & Playback Modal */}
      {selectedVideo && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface-100 border border-border rounded-xl max-w-2xl w-full p-5 space-y-4 shadow-elevation">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-surface-200 text-foreground font-bold border border-border">
                  {selectedVideo.channel}
                </span>
                <span className="text-xs text-muted font-mono">{selectedVideo.createdAt}</span>
              </div>

              <button
                onClick={() => setSelectedVideo(null)}
                className="p-1 rounded hover:bg-surface-200 text-muted hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="aspect-video bg-black rounded-lg overflow-hidden border border-border">
              <img src={selectedVideo.thumbnailUrl} alt={selectedVideo.title} className="w-full h-full object-cover" />
            </div>

            <div>
              <h3 className="text-sm font-bold text-foreground">{selectedVideo.title}</h3>
              <div className="mt-2 p-3 rounded-lg bg-surface-200 text-xs font-mono text-muted leading-relaxed max-h-32 overflow-y-auto">
                {selectedVideo.script}
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-border">
              <span className="text-[11px] text-muted font-mono">
                Tags: {selectedVideo.tags?.slice(0, 4).join(', ')}...
              </span>

              <button
                onClick={() => handleExportManifest(selectedVideo)}
                className="btn-solid px-4 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                Download Manifest JSON
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
