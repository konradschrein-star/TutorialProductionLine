import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  CheckCircle2, 
  ShieldCheck, 
  Download, 
  Play, 
  X, 
  Search, 
  Tv, 
  FileJson,
  ExternalLink,
  FolderCheck,
  Filter,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
  Clock,
  Video as VideoIcon,
  HardDrive,
  Trash2,
  Upload,
  Image as ImageIcon
} from 'lucide-react';
import { saveAs } from 'file-saver';
import { StorageService } from '../services/storageService';
import { FinishedVideo } from '../types';

type SortOption = 'newest' | 'oldest' | 'title_asc' | 'title_desc';
type StatusFilter = 'all' | 'Uploaded to Drive' | 'Queued for Stealth Upload' | 'Published' | 'Ready';

export const FinishedVideos: React.FC = () => {
  const navigate = useNavigate();
  const [videos, setVideos] = useState<FinishedVideo[]>(() => StorageService.getFinishedVideos());
  const [selectedVideo, setSelectedVideo] = useState<FinishedVideo | null>(null);
  const [editingScript, setEditingScript] = useState<string>('');
  const [isEditingScript, setIsEditingScript] = useState<boolean>(false);
  
  // Search and Filters
  const [search, setSearch] = useState<string>('');
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');
  const [selectedChannel, setSelectedChannel] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortOption, setSortOption] = useState<SortOption>('newest');
  
  // Dynamic Chunked / Paginated Loading
  const [pageSize, setPageSize] = useState<number>(12);
  const [currentPage, setCurrentPage] = useState<number>(1);

  const channels = StorageService.getChannels();

  const handleDeleteVideo = (id: string, title: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (window.confirm(`Are you sure you want to delete "${title}"?`)) {
      StorageService.deleteFinishedVideo(id);
      setVideos(StorageService.getFinishedVideos());
      if (selectedVideo?.id === id) {
        setSelectedVideo(null);
      }
    }
  };

  const handleClearAll = () => {
    if (window.confirm('Are you sure you want to clear all finished videos? This cannot be undone.')) {
      StorageService.clearFinishedVideos();
      setVideos([]);
      setSelectedVideo(null);
    }
  };

  const handleDownloadMedia = (video: FinishedVideo) => {
    if (!video.videoPath) {
      alert('No raw video file associated with this entry.');
      return;
    }
    const a = document.createElement('a');
    a.href = video.videoPath;
    a.download = `${video.title.replace(/[^a-zA-Z0-9_-]/g, '_')}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // Debounce search input for silky-smooth typing without DOM lag
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setCurrentPage(1);
    }, 150);
    return () => clearTimeout(timer);
  }, [search]);

  // Fast filtered & sorted list computation
  const filteredVideos = useMemo(() => {
    return videos
      .filter(v => {
        // Channel filter
        if (selectedChannel !== 'all' && v.channel !== selectedChannel) return false;
        
        // Status filter
        if (statusFilter !== 'all' && v.status !== statusFilter) return false;

        // Multi-field search
        if (debouncedSearch.trim()) {
          const q = debouncedSearch.toLowerCase().trim();
          const matchTitle = v.title?.toLowerCase().includes(q);
          const matchScript = v.script?.toLowerCase().includes(q);
          const matchChannel = v.channel?.toLowerCase().includes(q);
          const matchTags = v.tags?.some(t => t.toLowerCase().includes(q));
          const matchDrive = v.drivePath?.toLowerCase().includes(q);

          if (!matchTitle && !matchScript && !matchChannel && !matchTags && !matchDrive) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => {
        if (sortOption === 'newest') {
          return (b.createdAt || '').localeCompare(a.createdAt || '');
        }
        if (sortOption === 'oldest') {
          return (a.createdAt || '').localeCompare(b.createdAt || '');
        }
        if (sortOption === 'title_asc') {
          return (a.title || '').localeCompare(b.title || '');
        }
        if (sortOption === 'title_desc') {
          return (b.title || '').localeCompare(a.title || '');
        }
        return 0;
      });
  }, [videos, selectedChannel, statusFilter, debouncedSearch, sortOption]);

  // Dynamic pagination slice (prevents browser compositor lag by rendering only visible items)
  const totalPages = Math.max(1, Math.ceil(filteredVideos.length / pageSize));
  const paginatedVideos = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredVideos.slice(startIndex, startIndex + pageSize);
  }, [filteredVideos, currentPage, pageSize]);

  // Quick stats
  const totalUploadedToDrive = useMemo(
    () => videos.filter(v => v.status === 'Uploaded to Drive').length,
    [videos]
  );

  const handleOpenVideo = (video: FinishedVideo) => {
    setSelectedVideo(video);
    setEditingScript(video.script);
    setIsEditingScript(false);
  };

  const handleSaveScript = () => {
    if (!selectedVideo) return;
    StorageService.updateFinishedVideo(selectedVideo.id, { script: editingScript });
    setVideos(StorageService.getFinishedVideos());
    setSelectedVideo({ ...selectedVideo, script: editingScript });
    setIsEditingScript(false);
  };

  const handleReplaceThumbnail = (file: File) => {
    if (!file || !selectedVideo) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result) {
        const updatedThumb = e.target.result as string;
        StorageService.updateFinishedVideo(selectedVideo.id, { thumbnailUrl: updatedThumb });
        const updatedList = StorageService.getFinishedVideos();
        setVideos(updatedList);
        setSelectedVideo(prev => prev ? { ...prev, thumbnailUrl: updatedThumb } : null);
      }
    };
    reader.readAsDataURL(file);
  };

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
      totalJobs: filteredVideos.length,
      jobs: filteredVideos.map(v => ({
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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-4 animate-fadeIn">
      
      {/* Header Bar */}
      <div className="pro-panel p-4 rounded-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <VideoIcon className="w-4 h-4 text-foreground" />
            <h1 className="text-sm font-bold font-display text-foreground">
              Finished Media &amp; Stealth Upload Queue
            </h1>
            <span className="px-2 py-0.5 rounded font-mono text-[10px] font-bold bg-surface-200 text-foreground border border-border">
              {videos.length} Staged Assets
            </span>
          </div>
          <p className="text-[11px] text-muted mt-0.5">
            Staged video manifests, rendered video files, and Google Drive cloud delivery packages.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-end">
          <div className="px-2.5 py-1 rounded-lg bg-surface-200 border border-border text-center">
            <div className="text-[9px] uppercase font-mono font-bold text-emerald-500">In Google Drive</div>
            <div className="text-xs font-mono font-bold text-emerald-500">{totalUploadedToDrive}</div>
          </div>

          <button
            onClick={handleExportAllManifests}
            className="btn-outline px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5"
            title="Download Batch Manifest JSON for filtered videos"
          >
            <FileJson className="w-3.5 h-3.5" />
            Batch Manifest ({filteredVideos.length})
          </button>
          
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-surface-200 border border-border text-foreground text-xs font-mono font-semibold">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
            <span>Stealth Engine Active</span>
          </div>
        </div>
      </div>

      {/* Advanced Filter & Search Toolbar */}
      <div className="pro-panel p-3.5 rounded-xl space-y-3">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2.5">
          
          {/* Real-time Search */}
          <div className="relative flex-1 min-w-[240px]">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by title, script, channel, tags, or drive path..."
              className="pro-input w-full rounded-lg pl-8 pr-8 py-1.5 text-xs"
            />
            <Search className="w-3.5 h-3.5 text-muted absolute left-2.5 top-2.5" />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-2.5 text-muted hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Channel Selector */}
          <div className="flex items-center gap-2">
            <Tv className="w-3.5 h-3.5 text-muted" />
            <select
              value={selectedChannel}
              onChange={(e) => {
                setSelectedChannel(e.target.value);
                setCurrentPage(1);
              }}
              className="pro-input text-xs rounded-lg px-2.5 py-1.5 cursor-pointer font-sans"
            >
              <option value="all">All Channels ({videos.length})</option>
              {channels.map(c => {
                const count = videos.filter(v => v.channel === c.name).length;
                return (
                  <option key={c.id} value={c.name}>{c.name} ({count})</option>
                );
              })}
            </select>
          </div>

          {/* Sort Order */}
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-3.5 h-3.5 text-muted" />
            <select
              value={sortOption}
              onChange={(e) => setSortOption(e.target.value as SortOption)}
              className="pro-input text-xs rounded-lg px-2.5 py-1.5 cursor-pointer font-sans"
            >
              <option value="newest">Sort: Newest First</option>
              <option value="oldest">Sort: Oldest First</option>
              <option value="title_asc">Sort: Title (A-Z)</option>
              <option value="title_desc">Sort: Title (Z-A)</option>
            </select>
          </div>

          {/* Page Size Selector */}
          <div className="flex items-center gap-1.5 text-xs text-muted font-mono">
            <span>Show:</span>
            {[12, 24, 48].map(size => (
              <button
                key={size}
                onClick={() => {
                  setPageSize(size);
                  setCurrentPage(1);
                }}
                className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold transition-all ${
                  pageSize === size
                    ? 'bg-foreground text-background shadow-subtle'
                    : 'bg-surface-200 text-muted hover:text-foreground'
                }`}
              >
                {size}
              </button>
            ))}
          </div>

        </div>

        {/* Status Filter Pills */}
        <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-border">
          <span className="text-[10px] font-mono uppercase text-muted font-bold mr-1">Status:</span>
          {(['all', 'Uploaded to Drive', 'Queued for Stealth Upload', 'Published', 'Ready'] as StatusFilter[]).map(st => {
            const count = st === 'all' 
              ? videos.length 
              : videos.filter(v => v.status === st).length;
            const isSelected = statusFilter === st;

            return (
              <button
                key={st}
                onClick={() => {
                  setStatusFilter(st);
                  setCurrentPage(1);
                }}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all flex items-center gap-1.5 ${
                  isSelected
                    ? 'bg-surface-300 border border-foreground/40 text-foreground shadow-subtle'
                    : 'bg-surface-200/60 border border-border text-muted hover:text-foreground'
                }`}
              >
                <span>{st === 'all' ? 'All Videos' : st}</span>
                <span className={`text-[10px] font-mono px-1 rounded ${
                  isSelected ? 'bg-foreground text-background' : 'bg-surface-300 text-muted'
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Results Header Info */}
      <div className="flex items-center justify-between text-xs text-muted font-mono px-1">
        <span>
          Showing <strong>{paginatedVideos.length}</strong> of <strong>{filteredVideos.length}</strong> videos
          {debouncedSearch && ` matching "${debouncedSearch}"`}
        </span>
        {totalPages > 1 && (
          <span>Page {currentPage} of {totalPages}</span>
        )}
      </div>

      {/* Videos List Grid */}
      {filteredVideos.length === 0 ? (
        <div className="pro-panel p-12 rounded-xl text-center space-y-2">
          <div className="text-muted font-mono text-xs">No finished videos found matching your filters.</div>
          <p className="text-[11px] text-muted">
            Try clearing your search query or selecting "All Channels".
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {paginatedVideos.map(video => (
            <div key={video.id} className="pro-card rounded-xl overflow-hidden flex flex-col group hover:border-border-strong transition-all">
              
              {/* Thumbnail Header */}
              <div
                onClick={() => handleOpenVideo(video)}
                className="aspect-video relative overflow-hidden bg-black cursor-pointer"
              >
                <img
                  src={video.thumbnailUrl || '/background/bg-gradient-1.png'}
                  alt={video.title}
                  loading="lazy"
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = '/background/bg-gradient-1.png';
                  }}
                />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                  <div className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center text-white">
                    <Play className="w-4 h-4 fill-current ml-0.5" />
                  </div>
                </div>
                <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-black/80 backdrop-blur-md text-[10px] font-mono text-white flex items-center gap-1">
                  <Clock className="w-2.5 h-2.5 text-muted" />
                  {video.duration || '3:45'}
                </div>
                <div className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded bg-black/80 backdrop-blur-md text-[9px] font-mono uppercase font-bold text-white border border-white/15 truncate max-w-[180px]">
                  {video.channel}
                </div>
              </div>

              {/* Content Details */}
              <div className="p-3.5 flex-1 flex flex-col justify-between space-y-2.5">
                <div>
                  <h4
                    onClick={() => handleOpenVideo(video)}
                    className="text-xs font-bold text-foreground line-clamp-2 leading-snug cursor-pointer hover:underline"
                    title={video.title}
                  >
                    {video.title}
                  </h4>
                  <p className="text-[11px] text-muted mt-1 line-clamp-2 font-mono leading-relaxed">
                    {video.script}
                  </p>
                </div>

                {/* Status Badge & Actions */}
                <div className="pt-2 border-t border-border flex items-center justify-between">
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-surface-200 text-foreground border border-border flex items-center gap-1">
                    {video.status === 'Uploaded to Drive' ? (
                      <FolderCheck className="w-3.5 h-3.5 text-emerald-500" />
                    ) : (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    )}
                    {video.status}
                  </span>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleExportManifest(video)}
                      className="btn-outline px-2 py-1 rounded text-[10px] font-mono font-bold flex items-center gap-1"
                      title="Download Stealth Manifest (.json)"
                    >
                      <Download className="w-3 h-3" /> Manifest
                    </button>
                    <button
                      onClick={(e) => handleDeleteVideo(video.id, video.title, e)}
                      className="p-1 rounded text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      title="Delete video record"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

              </div>

            </div>
          ))}
        </div>
      )}

      {/* Dynamic Pagination Controls & "Load More" Bar */}
      {totalPages > 1 && (
        <div className="pro-panel p-3 rounded-xl flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-xs font-mono text-muted">
            Page {currentPage} of {totalPages} ({filteredVideos.length} total videos)
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="btn-outline px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1 disabled:opacity-40"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Prev
            </button>

            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let pageNum = i + 1;
              if (totalPages > 5 && currentPage > 3) {
                pageNum = currentPage - 2 + i;
                if (pageNum > totalPages) pageNum = totalPages - (4 - i);
              }
              return (
                <button
                  key={pageNum}
                  onClick={() => setCurrentPage(pageNum)}
                  className={`w-7 h-7 rounded text-xs font-mono font-bold transition-all ${
                    currentPage === pageNum
                      ? 'bg-foreground text-background shadow-subtle'
                      : 'bg-surface-200 text-muted hover:text-foreground'
                  }`}
                >
                  {pageNum}
                </button>
              );
            })}

            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="btn-outline px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1 disabled:opacity-40"
            >
              Next <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Video Inspector & Playback Modal */}
      {selectedVideo && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-surface-100 border border-border rounded-xl max-w-2xl w-full p-5 space-y-4 shadow-elevation max-h-[90vh] overflow-y-auto">
            
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

            {/* Video Player or Thumbnail */}
            <div className="aspect-video bg-black rounded-lg overflow-hidden border border-border relative">
              {selectedVideo.videoPath ? (
                <video
                  controls
                  src={selectedVideo.videoPath}
                  poster={selectedVideo.thumbnailUrl}
                  className="w-full h-full object-contain"
                />
              ) : (
                <img
                  src={selectedVideo.thumbnailUrl || '/background/bg-gradient-1.png'}
                  alt={selectedVideo.title}
                  className="w-full h-full object-cover"
                />
              )}
            </div>

            {/* Thumbnail Management Bar */}
            <div className="p-2 rounded-lg bg-surface-200 border border-border flex items-center justify-between gap-2 flex-wrap text-xs">
              <div className="flex items-center gap-1.5 text-muted font-mono text-[11px]">
                <ImageIcon className="w-3.5 h-3.5 text-foreground" />
                <span>Thumbnail Asset: Attached</span>
              </div>

              <div className="flex items-center gap-2">
                <label className="btn-outline px-2.5 py-1 rounded text-[11px] font-semibold flex items-center gap-1 cursor-pointer">
                  <Upload className="w-3 h-3" />
                  <span>Replace Thumbnail File</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && handleReplaceThumbnail(e.target.files[0])}
                  />
                </label>
                <button
                  onClick={() => {
                    const title = selectedVideo.title;
                    setSelectedVideo(null);
                    navigate('/thumbnails', { state: { title } });
                  }}
                  className="btn-outline px-2.5 py-1 rounded text-[11px] font-semibold flex items-center gap-1 text-blue-400 border-blue-500/30"
                >
                  <ExternalLink className="w-3 h-3" />
                  <span>Customize in Studio</span>
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-foreground">{selectedVideo.title}</h3>
                <button
                  onClick={() => setIsEditingScript(!isEditingScript)}
                  className="text-xs text-muted hover:text-foreground underline font-mono"
                >
                  {isEditingScript ? 'Cancel Edit' : 'Edit Script'}
                </button>
              </div>

              {isEditingScript ? (
                <div className="space-y-2">
                  <textarea
                    rows={5}
                    value={editingScript}
                    onChange={(e) => setEditingScript(e.target.value)}
                    className="pro-input w-full rounded-lg p-3 text-xs font-mono leading-relaxed resize-y"
                    placeholder="Edit script..."
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => {
                        setEditingScript(selectedVideo.script);
                        setIsEditingScript(false);
                      }}
                      className="btn-outline px-3 py-1 rounded text-xs"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveScript}
                      className="btn-solid px-3 py-1 rounded text-xs font-semibold"
                    >
                      Save Script
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-3 rounded-lg bg-surface-200 text-xs font-mono text-muted leading-relaxed max-h-32 overflow-y-auto whitespace-pre-wrap">
                  {selectedVideo.script}
                </div>
              )}
            </div>

            {selectedVideo.drivePath && (
              <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs font-mono text-emerald-400 flex items-center justify-between">
                <div className="flex items-center gap-1.5 truncate">
                  <FolderCheck className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="truncate">Google Drive: <strong>{selectedVideo.drivePath}</strong></span>
                </div>
                {selectedVideo.driveUrl && (
                  <a
                    href={selectedVideo.driveUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline flex items-center gap-1 flex-shrink-0 ml-2"
                  >
                    Open Folder <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            )}

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 pt-2 border-t border-border">
              <button
                onClick={() => handleDeleteVideo(selectedVideo.id, selectedVideo.title)}
                className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1 font-mono"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete Video Record
              </button>

              <div className="flex items-center gap-2">
                {selectedVideo.videoPath && (
                  <button
                    onClick={() => handleDownloadMedia(selectedVideo)}
                    className="btn-outline px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download Video (.webm)
                  </button>
                )}

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
        </div>
      )}

    </div>
  );
};
