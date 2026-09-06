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
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
  Clock,
  Video as VideoIcon,
  Trash2,
  Upload,
  Image as ImageIcon,
  Folder,
  Cloud,
  Archive,
  Table,
  Copy,
  Check,
  FileSpreadsheet,
} from 'lucide-react';
import { saveAs } from 'file-saver';
import { StorageService } from '../services/storageService';
import { useFinishedVideos, useChannels, useStore } from '../hooks/useStore';
import { useToast, useConfirm } from '../components/ui/Feedback';
import { Modal } from '../components/ui/Modal';
import { FinishedVideo } from '../types';

type SortOption = 'newest' | 'oldest' | 'title_asc' | 'title_desc';

/** Map a produced-video status to a semantic badge class (no raw color literals). */
const statusBadgeClass = (status: string): string => {
  switch (status) {
    case 'Uploaded to Drive':
      return 'badge-success';
    case 'Published':
      return 'badge-info';
    case 'Queued for Stealth Upload':
      return 'badge-warning';
    case 'Ready':
      return 'badge-accent';
    default:
      return 'badge-neutral';
  }
};

export const FinishedVideos: React.FC = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();

  // LIVE store data — re-renders automatically on any mutation (this tab or another).
  const videos = useFinishedVideos();
  const channels = useChannels();
  const driveConfig = useStore(() => StorageService.getGoogleDriveConfig(), ['google_drive_config']);
  const deliveries = useStore(() => StorageService.getDriveDeliveries(), ['drive_deliveries']);

  // Tabs: Media Library vs Google Drive Overview
  const [activeTab, setActiveTab] = useState<'media' | 'drive_overview'>('media');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // The inspector tracks an id; the record itself is derived from the live list,
  // so in-place edits (script / thumbnail) reflect instantly without manual refresh.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedVideo = useMemo(
    () => videos.find(v => v.id === selectedId) || null,
    [videos, selectedId]
  );
  const [editingScript, setEditingScript] = useState<string>('');
  const [isEditingScript, setIsEditingScript] = useState<boolean>(false);

  // Search and Filters
  const [search, setSearch] = useState<string>('');
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');
  const [selectedChannel, setSelectedChannel] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortOption, setSortOption] = useState<SortOption>('newest');

  // Dynamic Chunked / Paginated Loading
  const [pageSize, setPageSize] = useState<number>(12);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Derive the status filters from the ACTUAL data present so pills always
  // reflect reality (statuses that never occur are never offered).
  const availableStatuses = useMemo(() => {
    const seen = new Set<string>();
    videos.forEach(v => {
      if (v.status) seen.add(v.status);
    });
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }, [videos]);

  // If the active status filter is no longer represented in the data, fall back to "all".
  useEffect(() => {
    if (statusFilter !== 'all' && !availableStatuses.includes(statusFilter)) {
      setStatusFilter('all');
    }
  }, [availableStatuses, statusFilter]);

  const handleDeleteVideo = async (id: string, title: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const ok = await confirm({
      title: 'Delete video record',
      message: `Are you sure you want to delete "${title}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    StorageService.deleteFinishedVideo(id);
    if (selectedId === id) setSelectedId(null);
    toast('Video record deleted.', 'success');
  };

  const handleDownloadMedia = (video: FinishedVideo) => {
    if (!video.videoPath) {
      toast('No raw video file is associated with this entry.', 'warning');
      return;
    }
    const a = document.createElement('a');
    a.href = video.videoPath;
    a.download = `${video.title.replace(/[^a-zA-Z0-9_-]/g, '_')}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const copyToClipboard = (text: string, key: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
    toast(`Copied ${label} to clipboard.`, 'success');
  };

  const getDriveWebUrl = (folderIdOrPath: string) => {
    if (!folderIdOrPath || folderIdOrPath === 'root') return 'https://drive.google.com/drive/my-drive';
    if (folderIdOrPath.startsWith('http://') || folderIdOrPath.startsWith('https://')) {
      return folderIdOrPath;
    }
    if (folderIdOrPath.length > 20 && !folderIdOrPath.includes('/')) {
      return `https://drive.google.com/drive/folders/${folderIdOrPath}`;
    }
    return `https://drive.google.com/drive/search?q=${encodeURIComponent(folderIdOrPath)}`;
  };

  const parseDurationToSeconds = (dur: string): number => {
    if (!dur) return 180;
    const parts = dur.split(':').map(p => parseInt(p, 10));
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      return parts[0] * 60 + parts[1];
    }
    const match = dur.match(/(\d+)\s*m/);
    if (match) return parseInt(match[1], 10) * 60;
    return 180;
  };

  const formatSeconds = (secs: number): string => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}m ${s > 0 ? `${s}s` : ''}`;
  };

  const performanceRows = useMemo(() => {
    const map = new Map<string, { date: string; channel: string; count: number; totalSeconds: number }>();
    videos.forEach(v => {
      const d = v.createdAt ? v.createdAt.split('T')[0] : new Date().toISOString().split('T')[0];
      const key = `${d}_${v.channel}`;
      const durSecs = parseDurationToSeconds(v.duration);
      const existing = map.get(key) || { date: d, channel: v.channel, count: 0, totalSeconds: 0 };
      existing.count += 1;
      existing.totalSeconds += durSecs;
      map.set(key, existing);
    });
    return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
  }, [videos]);

  const assetIndexRows = useMemo(() => {
    return videos.map(v => ({
      id: v.id,
      title: v.title,
      channel: v.channel,
      keyword: v.tags?.[0] || v.title.replace(/^How to /i, ''),
      link: v.driveUrl || (v.drivePath ? getDriveWebUrl(v.drivePath) : '—'),
      duration: v.duration,
      status: v.status,
      date: v.createdAt ? v.createdAt.split('T')[0] : '—'
    }));
  }, [videos]);

  const handleExportPerformanceTrackerCSV = () => {
    if (performanceRows.length === 0) {
      toast('No performance data available to export.', 'warning');
      return;
    }
    const headers = ['Date', 'Channel / Creator', 'Videos Uploaded', 'Total Duration (Seconds)', 'Total Duration (Formatted)'];
    const rows = performanceRows.map(r => [
      `"${r.date}"`,
      `"${r.channel}"`,
      r.count,
      r.totalSeconds,
      `"${formatSeconds(r.totalSeconds)}"`
    ]);
    const csvContent = [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    saveAs(blob, `Creator_Performance_Tracker_${Date.now()}.csv`);
    toast('Creator Performance Tracker CSV exported.', 'success');
  };

  const handleExportAssetIndexCSV = () => {
    if (assetIndexRows.length === 0) {
      toast('No video assets available to export.', 'warning');
      return;
    }
    const headers = ['Target Keyword', 'Video Title', 'Channel', 'Drive / Published Link', 'Duration', 'Status', 'Date'];
    const rows = assetIndexRows.map(r => [
      `"${r.keyword.replace(/"/g, '""')}"`,
      `"${r.title.replace(/"/g, '""')}"`,
      `"${r.channel.replace(/"/g, '""')}"`,
      `"${r.link.replace(/"/g, '""')}"`,
      `"${r.duration}"`,
      `"${r.status}"`,
      `"${r.date}"`
    ]);
    const csvContent = [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    saveAs(blob, `Video_Asset_Index_${Date.now()}.csv`);
    toast('Video Asset Index CSV exported.', 'success');
  };

  // Debounce search input for silky-smooth typing without DOM lag
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setCurrentPage(1);
    }, 150);
    return () => clearTimeout(timer);
  }, [search]);

  // Keep pagination in range whenever the filtered set shrinks.
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

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

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
    setSelectedId(video.id);
    setEditingScript(video.script);
    setIsEditingScript(false);
  };

  const handleSaveScript = () => {
    if (!selectedVideo) return;
    StorageService.updateFinishedVideo(selectedVideo.id, { script: editingScript });
    setIsEditingScript(false);
    toast('Script updated.', 'success');
  };

  const handleReplaceThumbnail = (file: File) => {
    if (!file || !selectedVideo) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result) {
        const updatedThumb = e.target.result as string;
        StorageService.updateFinishedVideo(selectedVideo.id, { thumbnailUrl: updatedThumb });
        toast('Thumbnail replaced.', 'success');
      }
    };
    reader.onerror = () => toast('Failed to read the selected image file.', 'error');
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
    toast('Stealth manifest exported.', 'success');
  };

  const handleExportAllManifests = () => {
    if (filteredVideos.length === 0) {
      toast('No videos in the current view to export.', 'warning');
      return;
    }
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
    toast(`Batch manifest exported (${filteredVideos.length} videos).`, 'success');
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
            <span className="badge badge-neutral font-mono">
              {videos.length} Staged Assets
            </span>
          </div>
          <p className="text-[11px] text-muted mt-0.5">
            Staged video manifests, rendered video files, and Google Drive cloud delivery packages.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-end">
          <div className="px-2.5 py-1 rounded-lg bg-surface-200 border border-border text-center">
            <div className="text-[9px] uppercase font-mono font-bold text-success">In Google Drive</div>
            <div className="text-xs font-mono font-bold text-success">{totalUploadedToDrive}</div>
          </div>

          <button
            onClick={handleExportAllManifests}
            className="btn-outline focus-ring px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5"
            title="Download Batch Manifest JSON for filtered videos"
          >
            <FileJson className="w-3.5 h-3.5" />
            Batch Manifest ({filteredVideos.length})
          </button>

          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-surface-200 border border-border text-foreground text-xs font-mono font-semibold">
            <ShieldCheck className="w-3.5 h-3.5 text-success" />
            <span>Stealth Engine Active</span>
          </div>
        </div>
      </div>

      {/* Primary Tab Switcher: Media Library vs Google Drive Cloud Folders */}
      <div className="flex items-center gap-2 border-b border-border pb-2">
        <button
          onClick={() => setActiveTab('media')}
          className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all focus-ring ${
            activeTab === 'media'
              ? 'btn-solid shadow-subtle'
              : 'text-muted hover:text-foreground hover:bg-surface-200'
          }`}
        >
          <VideoIcon className="w-3.5 h-3.5" />
          <span>Media Library &amp; Upload Queue</span>
          <span className="badge badge-neutral text-[10px] ml-1">{videos.length}</span>
        </button>

        <button
          onClick={() => setActiveTab('drive_overview')}
          className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all focus-ring ${
            activeTab === 'drive_overview'
              ? 'btn-solid shadow-subtle'
              : 'text-muted hover:text-foreground hover:bg-surface-200'
          }`}
        >
          <Cloud className="w-3.5 h-3.5 text-accent" />
          <span>Google Drive Folders &amp; Tracking Overview</span>
          <span className="badge badge-success text-[10px] ml-1">{channels.length} Creator Folders</span>
        </button>
      </div>

      {/* TAB 1: GOOGLE DRIVE CLOUD FOLDERS & TRACKING SUITE */}
      {activeTab === 'drive_overview' ? (
        <div className="space-y-5 animate-fadeIn">
          {/* Drive Root & Master Archive Banner */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            <div className="pro-panel p-4 rounded-xl border border-border space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Cloud className="w-4 h-4 text-accent" />
                  <h3 className="text-xs font-bold font-mono text-foreground uppercase tracking-wider">Root Cloud Storage</h3>
                </div>
                <span className={`badge ${driveConfig.enabled ? 'badge-success' : 'badge-neutral'}`}>
                  {driveConfig.enabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              <p className="text-[11px] text-muted leading-relaxed">
                Master Google Drive root directory where channel folders and video assets are staged.
              </p>
              <div className="p-2.5 rounded-lg bg-surface-200 border border-border flex items-center justify-between font-mono text-xs text-foreground">
                <span className="truncate">{driveConfig.rootFolderId || 'root'}</span>
                <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                  <button
                    onClick={() => copyToClipboard(driveConfig.rootFolderId || 'root', 'root', 'Root Folder ID')}
                    className="p-1 rounded hover:bg-surface-300 text-muted hover:text-foreground"
                    title="Copy Folder ID"
                  >
                    {copiedKey === 'root' ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  <a
                    href={getDriveWebUrl(driveConfig.rootFolderId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-outline px-2 py-0.5 rounded text-[11px] font-semibold flex items-center gap-1"
                  >
                    Open Drive <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            </div>

            <div className="pro-panel p-4 rounded-xl border border-border space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Archive className="w-4 h-4 text-warning" />
                  <h3 className="text-xs font-bold font-mono text-foreground uppercase tracking-wider">Master Archive Folder</h3>
                </div>
                <span className="badge badge-warning">Master Archive</span>
              </div>
              <p className="text-[11px] text-muted leading-relaxed">
                Central archive directory where completed video projects move after upload to track overall progress.
              </p>
              <div className="p-2.5 rounded-lg bg-surface-200 border border-border flex items-center justify-between font-mono text-xs text-foreground">
                <span className="truncate">Master_Archive/Completed/</span>
                <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                  <button
                    onClick={() => copyToClipboard('Master_Archive/Completed/', 'archive', 'Archive Path')}
                    className="p-1 rounded hover:bg-surface-300 text-muted hover:text-foreground"
                    title="Copy Archive Path"
                  >
                    {copiedKey === 'archive' ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  <a
                    href={getDriveWebUrl('Master_Archive/Completed')}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-outline px-2 py-0.5 rounded text-[11px] font-semibold flex items-center gap-1"
                  >
                    Open Archive <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            </div>
          </div>

          {/* Active Creator Folders (Per Channel) */}
          <div className="pro-panel p-4 rounded-xl space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Folder className="w-4 h-4 text-accent" />
                <h3 className="text-xs font-bold font-mono text-foreground uppercase tracking-wider">
                  Active Creator Folders (Dedicated per Channel)
                </h3>
                <span className="badge badge-neutral font-mono">{channels.length} Channels</span>
              </div>
              <p className="text-[11px] text-muted">
                Each creator/channel uploads automatically into their own isolated folder.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {channels.map((ch) => {
                const channelVideos = videos.filter(v => v.channel === ch.name || v.channel === ch.id);
                const folderPath = ch.driveFolder || `${ch.name.replace(/\s+/g, '_')}/Tutorials`;
                return (
                  <div key={ch.id} className="p-3.5 rounded-xl bg-surface-100 border border-border flex flex-col justify-between space-y-3">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 truncate">
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: ch.badgeColor || '#00e5ff' }} />
                          <h4 className="text-xs font-bold text-foreground truncate">{ch.name}</h4>
                        </div>
                        <span className="text-[10px] font-mono text-muted">{channelVideos.length} videos</span>
                      </div>
                      <p className="text-[10px] text-muted truncate">{ch.niche || 'Software Tutorials'}</p>
                      <div className="p-2 rounded bg-surface-200 border border-border text-[11px] font-mono text-foreground break-all">
                        {folderPath}
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-border">
                      <button
                        onClick={() => copyToClipboard(folderPath, ch.id, `${ch.name} Folder Path`)}
                        className="text-[10px] font-mono text-muted hover:text-foreground flex items-center gap-1"
                      >
                        {copiedKey === ch.id ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
                        <span>Copy Path</span>
                      </button>
                      <a
                        href={getDriveWebUrl(folderPath)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-outline px-2 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1"
                      >
                        Open Folder <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Creator Performance Tracker (Shane's Setup) */}
          <div className="pro-panel p-4 rounded-xl space-y-3">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
              <div>
                <div className="flex items-center gap-2">
                  <Table className="w-4 h-4 text-success" />
                  <h3 className="text-xs font-bold font-mono text-foreground uppercase tracking-wider">
                    Creator Performance Tracker (Daily Sheet)
                  </h3>
                </div>
                <p className="text-[11px] text-muted mt-0.5">
                  Logs daily activity, number of videos uploaded, and total content duration produced per channel.
                </p>
              </div>

              <button
                onClick={handleExportPerformanceTrackerCSV}
                className="btn-solid px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 focus-ring"
                title="Export daily performance sheet to CSV"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                Export Tracker Sheet (CSV)
              </button>
            </div>

            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-left text-xs text-foreground">
                <thead className="bg-surface-200 text-[10px] font-mono uppercase font-bold text-muted border-b border-border">
                  <tr>
                    <th className="py-2 px-3">Date</th>
                    <th className="py-2 px-3">Channel / Creator</th>
                    <th className="py-2 px-3 text-center">Videos Uploaded</th>
                    <th className="py-2 px-3">Total Duration</th>
                    <th className="py-2 px-3">Activity Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-surface-100">
                  {performanceRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-xs text-muted">
                        No videos staged yet. Produce videos through the Creator Wizard to populate the tracker.
                      </td>
                    </tr>
                  ) : (
                    performanceRows.map((row, idx) => (
                      <tr key={idx} className="hover:bg-surface-200/50 transition-colors">
                        <td className="py-2.5 px-3 font-mono text-[11px] text-muted">{row.date}</td>
                        <td className="py-2.5 px-3 font-semibold text-foreground">{row.channel}</td>
                        <td className="py-2.5 px-3 font-mono text-center font-bold text-accent">
                          {row.count} {row.count === 1 ? 'video' : 'videos'}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[11px] text-foreground">
                          {formatSeconds(row.totalSeconds)}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="badge badge-success">Completed</span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Video Asset Index (Shane's Setup) */}
          <div className="pro-panel p-4 rounded-xl space-y-3">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
              <div>
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-accent" />
                  <h3 className="text-xs font-bold font-mono text-foreground uppercase tracking-wider">
                    Video Asset Index (Per-Video Subfolder Index)
                  </h3>
                </div>
                <p className="text-[11px] text-muted mt-0.5">
                  Tracks Target Keyword, Video Title, and Destination / Published Google Drive link for every video.
                </p>
              </div>

              <button
                onClick={handleExportAssetIndexCSV}
                className="btn-solid px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 focus-ring"
                title="Export Video Asset Index to CSV"
              >
                <Download className="w-3.5 h-3.5" />
                Export Asset Index (CSV)
              </button>
            </div>

            <div className="overflow-x-auto rounded-lg border border-border max-h-80 overflow-y-auto">
              <table className="w-full text-left text-xs text-foreground">
                <thead className="bg-surface-200 text-[10px] font-mono uppercase font-bold text-muted border-b border-border sticky top-0">
                  <tr>
                    <th className="py-2 px-3">Target Keyword</th>
                    <th className="py-2 px-3">Video Title</th>
                    <th className="py-2 px-3">Channel</th>
                    <th className="py-2 px-3">Duration</th>
                    <th className="py-2 px-3">Google Drive / Published Link</th>
                    <th className="py-2 px-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-surface-100">
                  {assetIndexRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-xs text-muted">
                        No video asset records available yet.
                      </td>
                    </tr>
                  ) : (
                    assetIndexRows.map((item) => (
                      <tr key={item.id} className="hover:bg-surface-200/50 transition-colors">
                        <td className="py-2 px-3 font-semibold text-accent text-[11px] max-w-xs truncate">{item.keyword}</td>
                        <td className="py-2 px-3 text-foreground text-[11px] max-w-sm truncate">{item.title}</td>
                        <td className="py-2 px-3 font-mono text-[11px] text-muted">{item.channel}</td>
                        <td className="py-2 px-3 font-mono text-[11px] text-foreground">{item.duration}</td>
                        <td className="py-2 px-3 font-mono text-[10px] max-w-xs truncate">
                          {item.link && item.link !== '—' ? (
                            <a href={item.link} target="_blank" rel="noopener noreferrer" className="underline text-accent flex items-center gap-1 truncate">
                              <span className="truncate">{item.link}</span>
                              <ExternalLink className="w-2.5 h-2.5 flex-shrink-0" />
                            </a>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td className="py-2 px-3">
                          <span className={`badge ${statusBadgeClass(item.status)}`}>{item.status}</span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Live Cloud Deliveries Audit */}
          {deliveries.length > 0 && (
            <div className="pro-panel p-4 rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FolderCheck className="w-4 h-4 text-success" />
                  <h3 className="text-xs font-bold font-mono text-foreground uppercase tracking-wider">
                    Recent Google Drive Cloud Deliveries
                  </h3>
                </div>
                <span className="badge badge-success">{deliveries.length} Recorded</span>
              </div>
              <div className="overflow-x-auto rounded-lg border border-border max-h-64 overflow-y-auto">
                <table className="w-full text-left text-xs text-foreground">
                  <thead className="bg-surface-200 text-[10px] font-mono uppercase font-bold text-muted border-b border-border sticky top-0">
                    <tr>
                      <th className="py-2 px-3">File Name</th>
                      <th className="py-2 px-3">Channel</th>
                      <th className="py-2 px-3">Drive Destination Path</th>
                      <th className="py-2 px-3">Uploaded At</th>
                      <th className="py-2 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border bg-surface-100">
                    {deliveries.map((del) => (
                      <tr key={del.id} className="hover:bg-surface-200/50 transition-colors">
                        <td className="py-2 px-3 font-mono font-semibold text-[11px] text-foreground">{del.fileName}</td>
                        <td className="py-2 px-3 text-[11px] text-muted">{del.channel}</td>
                        <td className="py-2 px-3 font-mono text-[10px] text-muted truncate max-w-xs">{del.drivePath}</td>
                        <td className="py-2 px-3 font-mono text-[10px] text-muted">{del.uploadedAt}</td>
                        <td className="py-2 px-3">
                          <span className={`badge ${del.status === 'IN_GOOGLE_DRIVE' ? 'badge-success' : 'badge-warning'}`}>
                            {del.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
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
              className="pro-input focus-ring w-full rounded-lg pl-8 pr-8 py-1.5 text-xs"
            />
            <Search className="w-3.5 h-3.5 text-muted absolute left-2.5 top-2.5" />
            {search && (
              <button
                onClick={() => setSearch('')}
                aria-label="Clear search"
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
              className="pro-input focus-ring text-xs rounded-lg px-2.5 py-1.5 cursor-pointer font-sans"
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
              className="pro-input focus-ring text-xs rounded-lg px-2.5 py-1.5 cursor-pointer font-sans"
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

        {/* Status Filter Pills — derived from actual data present */}
        <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-border">
          <span className="text-[10px] font-mono uppercase text-muted font-bold mr-1">Status:</span>
          {['all', ...availableStatuses].map(st => {
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
          <div className="text-muted font-mono text-xs">
            {videos.length === 0
              ? 'No finished videos yet — produce a tutorial to populate the library.'
              : 'No finished videos found matching your filters.'}
          </div>
          <p className="text-[11px] text-muted">
            {videos.length === 0
              ? 'Completed takes and their delivery packages will appear here.'
              : 'Try clearing your search query or selecting "All Channels".'}
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
                <div className="pt-2 border-t border-border flex items-center justify-between gap-2">
                  <span className={`badge ${statusBadgeClass(video.status)} font-mono flex items-center gap-1`}>
                    {video.status === 'Uploaded to Drive' ? (
                      <FolderCheck className="w-3 h-3" />
                    ) : (
                      <CheckCircle2 className="w-3 h-3" />
                    )}
                    {video.status}
                  </span>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleExportManifest(video)}
                      className="btn-outline focus-ring px-2 py-1 rounded text-[10px] font-mono font-bold flex items-center gap-1"
                      title="Download Stealth Manifest (.json)"
                    >
                      <Download className="w-3 h-3" /> Manifest
                    </button>
                    <button
                      onClick={(e) => handleDeleteVideo(video.id, video.title, e)}
                      className="p-1 rounded text-muted hover:text-danger hover:bg-danger/10 transition-colors"
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
              className="btn-outline focus-ring px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1 disabled:opacity-40"
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
              className="btn-outline focus-ring px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1 disabled:opacity-40"
            >
              Next <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
      </>
      )}

      {/* Video Inspector & Playback Modal */}
      <Modal
        isOpen={!!selectedVideo}
        onClose={() => {
          setSelectedId(null);
          setIsEditingScript(false);
        }}
        size="lg"
        title={selectedVideo?.title}
        subtitle={selectedVideo ? `${selectedVideo.channel} · ${selectedVideo.createdAt}` : undefined}
        footer={selectedVideo ? (
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 w-full">
            <button
              onClick={() => handleDeleteVideo(selectedVideo.id, selectedVideo.title)}
              className="text-xs text-danger hover:opacity-80 flex items-center gap-1 font-mono"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete Video Record
            </button>

            <div className="flex items-center gap-2">
              {selectedVideo.videoPath && (
                <button
                  onClick={() => handleDownloadMedia(selectedVideo)}
                  className="btn-outline focus-ring px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download Video (.webm)
                </button>
              )}

              <button
                onClick={() => handleExportManifest(selectedVideo)}
                className="btn-solid focus-ring px-4 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                Download Manifest JSON
              </button>
            </div>
          </div>
        ) : undefined}
      >
        {selectedVideo && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <span className={`badge ${statusBadgeClass(selectedVideo.status)} font-mono`}>
                {selectedVideo.status}
              </span>
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
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = '/background/bg-gradient-1.png';
                  }}
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
                <label className="btn-outline focus-ring px-2.5 py-1 rounded text-[11px] font-semibold flex items-center gap-1 cursor-pointer">
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
                    setSelectedId(null);
                    navigate('/thumbnails', { state: { title } });
                  }}
                  className="btn-outline focus-ring px-2.5 py-1 rounded text-[11px] font-semibold flex items-center gap-1 text-accent"
                >
                  <ExternalLink className="w-3 h-3" />
                  <span>Customize in Studio</span>
                </button>
              </div>
            </div>

            {/* Script (in-place edit) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-foreground font-mono uppercase">Narration Script</h3>
                <button
                  onClick={() => {
                    if (!isEditingScript) setEditingScript(selectedVideo.script);
                    setIsEditingScript(!isEditingScript);
                  }}
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
                    className="pro-input focus-ring w-full rounded-lg p-3 text-xs font-mono leading-relaxed resize-y"
                    placeholder="Edit script..."
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => {
                        setEditingScript(selectedVideo.script);
                        setIsEditingScript(false);
                      }}
                      className="btn-outline focus-ring px-3 py-1 rounded text-xs"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveScript}
                      className="btn-solid focus-ring px-3 py-1 rounded text-xs font-semibold"
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
              <div className="p-2.5 rounded-lg bg-success/10 border border-success/20 text-xs font-mono text-success flex items-center justify-between">
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
          </div>
        )}
      </Modal>

    </div>
  );
};
