import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Search, 
  Send, 
  CheckCircle2, 
  Database,
  RefreshCw,
  Clock,
  CircleDot,
  ChevronLeft,
  ChevronRight,
  Filter,
  CheckSquare,
  Square,
  Sparkles,
  Plus,
  Sliders,
  X,
  Upload,
  Download,
  Trash2,
  Tv
} from 'lucide-react';
import { saveAs } from 'file-saver';
import { KeywordService, POPULAR_SOFTWARES } from '../services/keywordService';
import { ExternalKeywordService } from '../services/externalKeywordService';
import { StorageService } from '../services/storageService';
import { KeywordItem, Channel, StudioJob } from '../types';

type KeywordSource = 'starter' | 'own';

interface KeywordHubProps {
  activeChannel: Channel;
}

const PAGE_SIZE = 50;

export const KeywordHub: React.FC<KeywordHubProps> = () => {
  const navigate = useNavigate();
  const channels = StorageService.getChannels();
  const activeUserName = StorageService.getActiveUser().name;

  const [keywords, setKeywords] = useState<KeywordItem[]>(() => KeywordService.getKeywords());
  const [sourceTab, setSourceTab] = useState<KeywordSource>('starter');
  const [search, setSearch] = useState<string>('');
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');
  const [selectedSoftware, setSelectedSoftware] = useState<string>('all');
  const [selectedChannelFilter, setSelectedChannelFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'NEW' | 'IN_PRODUCTION' | 'COMPLETED'>('ALL');
  const [volumeFilter, setVolumeFilter] = useState<string>('all');
  const [competitionFilter, setCompetitionFilter] = useState<string>('all');
  const [onlyHowTo, setOnlyHowTo] = useState<boolean>(true);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncMessage, setSyncMessage] = useState<string>('');

  // Add Keyword Modal
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [newKeywordText, setNewKeywordText] = useState<string>('');
  const [newSoftware, setNewSoftware] = useState<string>('Excel');
  const [newTargetChannelId, setNewTargetChannelId] = useState<string>(channels[0]?.id || 'skool');

  // CSV Import Modal
  const [isImportModalOpen, setIsImportModalOpen] = useState<boolean>(false);
  const [csvText, setCsvText] = useState<string>('');
  const [importStats, setImportStats] = useState<{ added: number; skipped: number } | null>(null);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setCurrentPage(1);
    }, 180);
    return () => clearTimeout(timer);
  }, [search]);

  // Per-source pool sizes (for the tab badges)
  const sourceCounts = useMemo(() => ({
    starter: keywords.filter(k => (k.source ?? 'starter') === 'starter').length,
    own: keywords.filter(k => (k.source ?? 'starter') === 'own').length,
  }), [keywords]);

  // Keywords in the currently-selected pool
  const sourceKeywords = useMemo(
    () => keywords.filter(k => (k.source ?? 'starter') === sourceTab),
    [keywords, sourceTab]
  );

  // Real-time metric counts (scoped to the active pool)
  const counts = useMemo(() => {
    return KeywordService.getKeywordCounts(sourceKeywords);
  }, [sourceKeywords]);

  // Filtered list (scoped to the active pool)
  const filteredKeywords = useMemo(() => {
    return sourceKeywords.filter(kw => {
      if (onlyHowTo && kw.contentType !== 'HOW_TO') return false;
      if (statusFilter === 'NEW' && (kw.status === 'COMPLETED' || kw.status === 'IN_PRODUCTION' || kw.status === 'CLAIMED')) return false;
      if (statusFilter === 'IN_PRODUCTION' && kw.status !== 'IN_PRODUCTION' && kw.status !== 'CLAIMED') return false;
      if (statusFilter === 'COMPLETED' && kw.status !== 'COMPLETED') return false;
      if (selectedSoftware !== 'all' && kw.software.toLowerCase() !== selectedSoftware.toLowerCase()) return false;
      if (selectedChannelFilter !== 'all' && kw.targetChannelId !== selectedChannelFilter) return false;
      if (competitionFilter !== 'all' && kw.competition !== competitionFilter) return false;
      
      if (volumeFilter === '10k_plus' && kw.volume < 10000) return false;
      if (volumeFilter === '5k_plus' && kw.volume < 5000) return false;
      if (volumeFilter === '1k_plus' && kw.volume < 1000) return false;
      if (volumeFilter === 'under_1k' && kw.volume >= 1000) return false;

      if (debouncedSearch && !kw.keyword.toLowerCase().includes(debouncedSearch.toLowerCase())) return false;
      return true;
    });
  }, [sourceKeywords, debouncedSearch, selectedSoftware, selectedChannelFilter, volumeFilter, competitionFilter, onlyHowTo, statusFilter]);

  // Paginated slice
  const totalPages = Math.max(1, Math.ceil(filteredKeywords.length / PAGE_SIZE));
  const paginatedKeywords = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredKeywords.slice(start, start + PAGE_SIZE);
  }, [filteredKeywords, currentPage]);

  const handleClaimAndProduceConveyor = (kw: KeywordItem) => {
    KeywordService.updateKeywordStatus(kw.id, 'IN_PRODUCTION', activeUserName);
    setKeywords(KeywordService.getKeywords());
    navigate('/', {
      state: {
        topic: kw.keyword,
        keywordId: kw.id,
        channelId: kw.targetChannelId
      }
    });
  };

  const handleClaimAndEnqueueStudio = (kw: KeywordItem) => {
    KeywordService.updateKeywordStatus(kw.id, 'IN_PRODUCTION', activeUserName);
    setKeywords(KeywordService.getKeywords());
    
    const ch = channels.find(c => c.id === kw.targetChannelId) || channels[0];
    const newJob: StudioJob = {
      id: `job_${Date.now()}`,
      title: `How to ${kw.keyword.replace(/^how to\s+/i, '')}`,
      topic: kw.keyword,
      channelId: ch.id,
      channelName: ch.name,
      status: 'QUEUED',
      script: `Welcome to this tutorial on ${kw.keyword}. In this video we will cover step-by-step instructions.`,
      voiceId: ch.defaultVoiceId || 'fish-paul-neutral',
      voiceSpeed: 1.15,
      deliveredToDrive: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    StorageService.saveStudioJob(newJob);
    navigate('/studio');
  };

  const handleStatusChange = (id: string, nextStatus: 'NEW' | 'IN_PRODUCTION' | 'COMPLETED') => {
    KeywordService.updateKeywordStatus(id, nextStatus);
    setKeywords(KeywordService.getKeywords());
  };

  const handleSelectAllOnPage = () => {
    const next = new Set(selectedIds);
    const allSelected = paginatedKeywords.every(k => next.has(k.id));
    if (allSelected) {
      paginatedKeywords.forEach(k => next.delete(k.id));
    } else {
      paginatedKeywords.forEach(k => next.add(k.id));
    }
    setSelectedIds(next);
  };

  const handleBatchStatus = (status: 'NEW' | 'IN_PRODUCTION' | 'COMPLETED') => {
    if (selectedIds.size === 0) return;
    KeywordService.batchUpdateStatus(Array.from(selectedIds), status);
    setKeywords(KeywordService.getKeywords());
    setSelectedIds(new Set());
  };

  const handleBatchAssignChannel = (channelId: string) => {
    if (selectedIds.size === 0) return;
    KeywordService.batchAssignChannel(Array.from(selectedIds), channelId);
    setKeywords(KeywordService.getKeywords());
    setSelectedIds(new Set());
  };

  const handleBatchDelete = () => {
    if (selectedIds.size === 0) return;
    if (confirm(`Are you sure you want to delete ${selectedIds.size} selected keywords?`)) {
      KeywordService.batchDelete(Array.from(selectedIds));
      setKeywords(KeywordService.getKeywords());
      setSelectedIds(new Set());
    }
  };

  const handleExportCSV = () => {
    const csvData = KeywordService.exportKeywordsToCSV(filteredKeywords);
    const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
    saveAs(blob, `keywords_export_${Date.now()}.csv`);
  };

  const handleImportCSV = () => {
    if (!csvText.trim()) return;
    const res = KeywordService.importKeywordsFromCSV(csvText, channels[0]?.id);
    setImportStats(res);
    setKeywords(KeywordService.getKeywords());
    if (res.added > 0) setSourceTab('own'); // imported keywords land in the operator's own pool
    setTimeout(() => {
      setIsImportModalOpen(false);
      setCsvText('');
      setImportStats(null);
    }, 1500);
  };

  const handleSyncExternal = async () => {
    setIsSyncing(true);
    setSyncMessage('');
    try {
      const res = await ExternalKeywordService.sync();
      setKeywords(KeywordService.getKeywords());
      setSyncMessage(res.message);
      if (res.source === 'external' && res.totalSynced > 0) setSourceTab('own');
      setTimeout(() => setSyncMessage(''), 4000);
    } catch (e: any) {
      setSyncMessage('Sync failed: ' + e.message);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleAddCustomKeyword = () => {
    if (!newKeywordText.trim()) return;

    const newItem: KeywordItem = {
      id: `kw_${Date.now()}`,
      keyword: newKeywordText.trim(),
      software: newSoftware,
      volume: 1200,
      competition: 'Low',
      screenVerdict: 'APPROVE',
      contentType: 'HOW_TO',
      targetChannelId: newTargetChannelId,
      status: 'NEW',
      dateAdded: new Date().toISOString().split('T')[0],
      source: 'own'
    };

    const currentList = KeywordService.getKeywords();
    KeywordService.saveKeywords([newItem, ...currentList]);
    setKeywords(KeywordService.getKeywords());
    setSourceTab('own'); // custom topics live in the operator's own pool
    setIsAddModalOpen(false);
    setNewKeywordText('');
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-4 animate-fadeIn">
      
      {/* Header & Metrics Banner */}
      <div className="pro-panel p-4 rounded-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-foreground" />
            <h1 className="text-sm font-bold font-display text-foreground">
              Keyword Intelligence &amp; Status Hub
            </h1>
            <span className="px-2 py-0.5 rounded font-mono text-[10px] font-bold bg-surface-200 text-foreground border border-border">
              {keywords.length.toLocaleString()} Tracked Keywords
            </span>
          </div>
          <p className="text-[11px] text-muted mt-0.5">
            Real-time keyword state management, CSV ingest/export, claim routing, and your own keyword-source syncing.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-end">
          {syncMessage && (
            <span className="text-[11px] font-mono text-emerald-500 font-bold animate-fadeIn">
              {syncMessage}
            </span>
          )}

          <button
            onClick={() => setIsImportModalOpen(true)}
            className="btn-outline px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5"
            title="Import keywords from CSV file or text"
          >
            <Upload className="w-3.5 h-3.5" />
            Import CSV
          </button>

          <button
            onClick={handleExportCSV}
            className="btn-outline px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5"
            title="Export filtered keywords to CSV"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>

          <button
            onClick={() => setIsAddModalOpen(true)}
            className="btn-solid px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Topic
          </button>

          <button
            onClick={handleSyncExternal}
            disabled={isSyncing}
            className="btn-outline px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5"
            title="Pull keywords from your own external keyword tool (configure the endpoint in Settings)"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            {isSyncing ? 'Syncing...' : 'Sync External'}
          </button>

          {/* Metric Status Badges */}
          <div className="px-2.5 py-1 rounded-lg bg-surface-200 border border-border text-center">
            <div className="text-[9px] uppercase font-mono font-bold text-muted">Available</div>
            <div className="text-xs font-mono font-bold text-foreground">{counts.available.toLocaleString()}</div>
          </div>
          <div className="px-2.5 py-1 rounded-lg bg-surface-200 border border-border text-center">
            <div className="text-[9px] uppercase font-mono font-bold text-amber-500">In Prod</div>
            <div className="text-xs font-mono font-bold text-amber-500">{counts.inProduction.toLocaleString()}</div>
          </div>
          <div className="px-2.5 py-1 rounded-lg bg-surface-200 border border-border text-center">
            <div className="text-[9px] uppercase font-mono font-bold text-emerald-500">Done</div>
            <div className="text-xs font-mono font-bold text-emerald-500">{counts.completed.toLocaleString()}</div>
          </div>
        </div>
      </div>

      {/* Keyword Source Selector — the operator chooses which pool to work from */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {([
          {
            key: 'starter' as KeywordSource,
            icon: <Sparkles className="w-4 h-4" />,
            title: 'Starter List',
            subtitle: 'Curated 2,150 high-demand software topics, ready to claim.',
            count: sourceCounts.starter,
          },
          {
            key: 'own' as KeywordSource,
            icon: <Database className="w-4 h-4" />,
            title: 'My Keywords',
            subtitle: 'Topics you import, scrape, or add from your own channels.',
            count: sourceCounts.own,
          },
        ]).map(tab => {
          const active = sourceTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => {
                setSourceTab(tab.key);
                setCurrentPage(1);
                setSelectedIds(new Set());
              }}
              className={`text-left p-3.5 rounded-xl border transition-all flex items-start gap-3 ${
                active
                  ? 'border-foreground/60 bg-surface-200 shadow-subtle'
                  : 'border-border bg-surface-100 hover:bg-surface-200/60 opacity-80 hover:opacity-100'
              }`}
            >
              <div className={`mt-0.5 ${active ? 'text-foreground' : 'text-muted'}`}>{tab.icon}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-bold font-display ${active ? 'text-foreground' : 'text-muted'}`}>
                    {tab.title}
                  </span>
                  <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                    active ? 'bg-foreground text-background' : 'bg-surface-200 text-muted border border-border'
                  }`}>
                    {tab.count.toLocaleString()}
                  </span>
                </div>
                <p className="text-[11px] text-muted mt-0.5 truncate">{tab.subtitle}</p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Status Filter Tabs & Bulk Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-surface-100 p-2 rounded-xl border border-border">
        {/* Filter Pills */}
        <div className="flex items-center gap-1 overflow-x-auto w-full sm:w-auto">
          {[
            { key: 'ALL', label: 'All Keywords', count: counts.total },
            { key: 'NEW', label: 'Available', count: counts.available },
            { key: 'IN_PRODUCTION', label: 'In Production', count: counts.inProduction },
            { key: 'COMPLETED', label: 'Done / Finished', count: counts.completed },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => {
                setStatusFilter(tab.key as any);
                setCurrentPage(1);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all whitespace-nowrap ${
                statusFilter === tab.key
                  ? 'btn-solid shadow-subtle'
                  : 'text-muted hover:text-foreground hover:bg-surface-200'
              }`}
            >
              <span>{tab.label}</span>
              <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${
                statusFilter === tab.key ? 'bg-background/20 text-background' : 'bg-surface-200 text-muted'
              }`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* Batch Actions Bar (when rows are selected) */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2 bg-surface-200 px-3 py-1.5 rounded-lg border border-border text-xs animate-fadeIn flex-wrap">
            <span className="font-mono text-muted text-[11px] font-bold">
              {selectedIds.size} selected
            </span>
            <div className="h-3 w-px bg-border mx-1" />
            
            <button
              onClick={() => handleBatchStatus('COMPLETED')}
              className="px-2 py-1 rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 font-semibold text-[11px]"
            >
              Mark Done
            </button>
            <button
              onClick={() => handleBatchStatus('IN_PRODUCTION')}
              className="px-2 py-1 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 font-semibold text-[11px]"
            >
              Mark In Production
            </button>

            {/* Batch Assign Channel */}
            <select
              onChange={(e) => {
                if (e.target.value) handleBatchAssignChannel(e.target.value);
              }}
              defaultValue=""
              className="pro-input text-[11px] rounded px-2 py-0.5 cursor-pointer font-sans"
            >
              <option value="" disabled>Assign Channel...</option>
              {channels.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>

            <button
              onClick={handleBatchDelete}
              className="px-2 py-1 rounded hover:bg-surface-300 text-red-400 hover:text-red-300 font-semibold text-[11px] flex items-center gap-1"
            >
              <Trash2 className="w-3 h-3" /> Delete
            </button>
          </div>
        )}
      </div>

      {/* Filter Bar */}
      <div className="pro-panel p-3 rounded-xl flex flex-col md:flex-row items-center justify-between gap-2.5">
        
        {/* Search */}
        <div className="relative w-full md:w-80">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter keywords, topics, software..."
            className="pro-input w-full rounded-lg pl-8 pr-3 py-1.5 text-xs font-sans"
          />
          <Search className="w-3.5 h-3.5 text-muted absolute left-2.5 top-2" />
        </div>

        {/* Dropdown Filters */}
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto justify-end">
          
          <select
            value={selectedSoftware}
            onChange={(e) => {
              setSelectedSoftware(e.target.value);
              setCurrentPage(1);
            }}
            className="pro-input text-xs rounded-lg px-2.5 py-1.5 cursor-pointer font-sans"
          >
            <option value="all">All Software ({POPULAR_SOFTWARES.length})</option>
            {POPULAR_SOFTWARES.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          <select
            value={selectedChannelFilter}
            onChange={(e) => {
              setSelectedChannelFilter(e.target.value);
              setCurrentPage(1);
            }}
            className="pro-input text-xs rounded-lg px-2.5 py-1.5 cursor-pointer font-sans"
          >
            <option value="all">All Channels</option>
            {channels.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>

          <select
            value={volumeFilter}
            onChange={(e) => {
              setVolumeFilter(e.target.value);
              setCurrentPage(1);
            }}
            className="pro-input text-xs rounded-lg px-2.5 py-1.5 cursor-pointer font-sans"
          >
            <option value="all">All Search Volumes</option>
            <option value="10k_plus">&gt; 10,000 / mo</option>
            <option value="5k_plus">&gt; 5,000 / mo</option>
            <option value="1k_plus">&gt; 1,000 / mo</option>
            <option value="under_1k">&lt; 1,000 / mo</option>
          </select>

          <select
            value={competitionFilter}
            onChange={(e) => {
              setCompetitionFilter(e.target.value);
              setCurrentPage(1);
            }}
            className="pro-input text-xs rounded-lg px-2.5 py-1.5 cursor-pointer font-sans"
          >
            <option value="all">All Competition</option>
            <option value="Low">Low Competition</option>
            <option value="Medium">Medium Competition</option>
            <option value="High">High Competition</option>
          </select>

          <button
            onClick={() => {
              setOnlyHowTo(!onlyHowTo);
              setCurrentPage(1);
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              onlyHowTo
                ? 'btn-solid'
                : 'btn-outline'
            }`}
          >
            {onlyHowTo ? '✓ HOW_TO Only' : 'All Formats'}
          </button>

        </div>

      </div>

      {/* Palantir / Linear Data Table */}
      <div className="pro-panel rounded-xl overflow-hidden shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-foreground">
            <thead className="bg-surface-200/80 text-[10px] uppercase font-mono font-bold text-muted border-b border-border">
              <tr>
                <th className="py-2.5 px-3 w-8 text-center">
                  <button
                    onClick={handleSelectAllOnPage}
                    className="text-muted hover:text-foreground inline-flex items-center justify-center"
                  >
                    {paginatedKeywords.length > 0 && paginatedKeywords.every(k => selectedIds.has(k.id)) ? (
                      <CheckSquare className="w-3.5 h-3.5 text-foreground" />
                    ) : (
                      <Square className="w-3.5 h-3.5" />
                    )}
                  </button>
                </th>
                <th className="py-2.5 px-4">Topic / Keyword</th>
                <th className="py-2.5 px-3">Software</th>
                <th className="py-2.5 px-3">Monthly Vol</th>
                <th className="py-2.5 px-3">Competition</th>
                <th className="py-2.5 px-3">Channel</th>
                <th className="py-2.5 px-3">Status State</th>
                <th className="py-2.5 px-4 text-right">Produce / Route</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {paginatedKeywords.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-10 text-xs text-muted">
                    {sourceTab === 'own' && sourceCounts.own === 0 ? (
                      <div className="flex flex-col items-center gap-2.5">
                        <Database className="w-6 h-6 text-muted/60" />
                        <p className="font-semibold text-foreground">Your keyword pool is empty.</p>
                        <p className="max-w-sm">
                          Bring in your own topics: <strong>Import CSV</strong> from your channel research,
                          <strong> Add Topic</strong> manually, or <strong>Sync External</strong> from your own
                          keyword tool (set its endpoint in Settings). Or work from the <strong>Starter List</strong> tab.
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <button onClick={() => setIsImportModalOpen(true)} className="btn-solid px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5">
                            <Upload className="w-3.5 h-3.5" /> Import CSV
                          </button>
                          <button onClick={() => setSourceTab('starter')} className="btn-outline px-3 py-1.5 rounded-lg text-xs font-semibold">
                            Use Starter List
                          </button>
                        </div>
                      </div>
                    ) : (
                      'No keywords found matching current filter criteria.'
                    )}
                  </td>
                </tr>
              ) : (
                paginatedKeywords.map(row => {
                  const ch = channels.find(c => c.id === row.targetChannelId);
                  const isSelected = selectedIds.has(row.id);
                  const isDone = row.status === 'COMPLETED';
                  const isInProd = row.status === 'IN_PRODUCTION' || row.status === 'CLAIMED';

                  return (
                    <tr 
                      key={row.id} 
                      className={`hover:bg-surface-200/40 transition-colors ${
                        isSelected ? 'bg-surface-200/60' : ''
                      }`}
                    >
                      {/* Checkbox */}
                      <td className="py-2.5 px-3 text-center">
                        <button
                          onClick={() => {
                            const next = new Set(selectedIds);
                            if (next.has(row.id)) next.delete(row.id);
                            else next.add(row.id);
                            setSelectedIds(next);
                          }}
                          className="text-muted hover:text-foreground inline-flex items-center justify-center"
                        >
                          {isSelected ? (
                            <CheckSquare className="w-3.5 h-3.5 text-foreground" />
                          ) : (
                            <Square className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </td>

                      {/* Title */}
                      <td className="py-2.5 px-4 font-medium text-foreground max-w-sm">
                        <div className="flex items-center gap-1.5">
                          <span className={isDone ? 'line-through text-muted' : 'text-foreground font-semibold'}>
                            {row.keyword}
                          </span>
                        </div>
                      </td>

                      {/* Software */}
                      <td className="py-2.5 px-3">
                        <span className="px-1.5 py-0.5 rounded bg-surface-200 text-[10px] font-mono text-foreground border border-border">
                          {row.software}
                        </span>
                      </td>

                      {/* Volume */}
                      <td className="py-2.5 px-3 font-mono font-semibold text-foreground text-[11px]">
                        {row.volume.toLocaleString()}
                      </td>

                      {/* Competition */}
                      <td className="py-2.5 px-3">
                        <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                          row.competition === 'Low' ? 'text-emerald-500 bg-emerald-500/10' :
                          row.competition === 'Medium' ? 'text-amber-500 bg-amber-500/10' :
                          'text-red-500 bg-red-500/10'
                        }`}>
                          {row.competition}
                        </span>
                      </td>

                      {/* Target Channel */}
                      <td className="py-2.5 px-3">
                        {ch ? (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-surface-200 text-foreground border border-border">
                            {ch.name}
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>

                      {/* Status Selector Dropdown */}
                      <td className="py-2.5 px-3">
                        <select
                          value={row.status === 'CLAIMED' ? 'IN_PRODUCTION' : row.status}
                          onChange={(e) => handleStatusChange(row.id, e.target.value as any)}
                          className={`text-[10px] font-mono font-bold px-2 py-1 rounded border cursor-pointer ${
                            isDone
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                              : isInProd
                                ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                                : 'bg-surface-200 text-foreground border-border'
                          }`}
                        >
                          <option value="NEW">Available</option>
                          <option value="IN_PRODUCTION">In Production</option>
                          <option value="COMPLETED">Done (Finished)</option>
                        </select>
                      </td>

                      {/* Actions */}
                      <td className="py-2.5 px-4 text-right">
                        <div className="inline-flex items-center gap-1.5 justify-end">
                          {isDone ? (
                            <button
                              onClick={() => handleStatusChange(row.id, 'NEW')}
                              className="text-muted hover:text-foreground text-[10px] font-mono underline px-1"
                              title="Reset status back to available"
                            >
                              Reset
                            </button>
                          ) : (
                            <>
                              <button
                                onClick={() => handleClaimAndProduceConveyor(row)}
                                className="btn-solid px-2.5 py-1 rounded text-[11px] inline-flex items-center gap-1 font-semibold"
                                title="Produce in Creator Conveyor"
                              >
                                <Send className="w-2.5 h-2.5" /> Conveyor
                              </button>
                              <button
                                onClick={() => handleClaimAndEnqueueStudio(row)}
                                className="btn-outline px-2.5 py-1 rounded text-[11px] inline-flex items-center gap-1 font-semibold"
                                title="Enqueue to Studio Pipeline"
                              >
                                <Sliders className="w-2.5 h-2.5" /> Studio
                              </button>
                            </>
                          )}
                        </div>
                      </td>

                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="p-3 bg-surface-200/50 border-t border-border flex items-center justify-between text-xs">
          <div className="text-muted font-mono text-[11px]">
            Showing <span className="text-foreground font-bold">{Math.min(filteredKeywords.length, (currentPage - 1) * PAGE_SIZE + 1)}</span> to{' '}
            <span className="text-foreground font-bold">{Math.min(filteredKeywords.length, currentPage * PAGE_SIZE)}</span> of{' '}
            <span className="text-foreground font-bold">{filteredKeywords.length.toLocaleString()}</span> keywords
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="btn-outline px-2.5 py-1 rounded text-xs disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Prev
            </button>

            <span className="px-3 font-mono text-[11px] font-bold text-foreground">
              Page {currentPage} of {totalPages}
            </span>

            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              className="btn-outline px-2.5 py-1 rounded text-xs disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1"
            >
              Next <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

      </div>

      {/* Add Custom Keyword Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface-100 border border-border rounded-xl max-w-md w-full p-5 space-y-4 shadow-elevation animate-fadeIn">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-foreground font-display flex items-center gap-1.5">
                <Plus className="w-4 h-4" /> Add Tutorial Topic / Keyword
              </h3>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="p-1 rounded text-muted hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  Topic / Keyword Title
                </label>
                <input
                  type="text"
                  value={newKeywordText}
                  onChange={(e) => setNewKeywordText(e.target.value)}
                  placeholder="e.g. How to Build an automated sales pipeline in HubSpot"
                  className="pro-input w-full rounded-lg px-3 py-2 text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  Software
                </label>
                <input
                  type="text"
                  value={newSoftware}
                  onChange={(e) => setNewSoftware(e.target.value)}
                  placeholder="e.g. HubSpot, Excel, Notion"
                  className="pro-input w-full rounded-lg px-3 py-2 text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  Target Channel
                </label>
                <select
                  value={newTargetChannelId}
                  onChange={(e) => setNewTargetChannelId(e.target.value)}
                  className="pro-input w-full rounded-lg px-3 py-2 text-xs"
                >
                  {channels.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="btn-outline px-3 py-1.5 rounded-lg text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={handleAddCustomKeyword}
                className="btn-solid px-4 py-1.5 rounded-lg text-xs font-bold"
              >
                Save Topic
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import CSV Modal */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface-100 border border-border rounded-xl max-w-lg w-full p-5 space-y-4 shadow-elevation animate-fadeIn">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-foreground font-display flex items-center gap-1.5">
                <Upload className="w-4 h-4" /> Ingest CSV Keywords
              </h3>
              <button
                onClick={() => setIsImportModalOpen(false)}
                className="p-1 rounded text-muted hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <p className="text-xs text-muted">
                Paste CSV contents or drop rows exported from Ahrefs, Semrush, or Google Sheets. <br />
                <span className="font-mono text-[10px]">Format: Keyword, Software, Volume, Competition, ChannelID</span>
              </p>

              <div>
                <label className="btn-outline w-full py-2.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer border-dashed">
                  <Upload className="w-4 h-4 text-muted" /> Select .csv File from Disk
                  <input
                    type="file"
                    accept=".csv,.tsv,.txt"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = (evt) => {
                        setCsvText(evt.target?.result as string);
                      };
                      reader.readAsText(file);
                    }}
                  />
                </label>
              </div>

              <div>
                <textarea
                  rows={6}
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                  placeholder="How to use VLOOKUP in Excel,Excel,14000,Low,skool&#10;How to connect Stripe to QuickBooks,QuickBooks,8500,Medium,virtualfd"
                  className="pro-input w-full rounded-lg p-3 text-xs font-mono resize-y leading-relaxed"
                />
              </div>

              {importStats && (
                <div className="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-mono">
                  ✓ Successfully imported {importStats.added} new keywords ({importStats.skipped} duplicates skipped).
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <button
                onClick={() => setIsImportModalOpen(false)}
                className="btn-outline px-3 py-1.5 rounded-lg text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                disabled={!csvText.trim()}
                onClick={handleImportCSV}
                className="btn-solid px-4 py-1.5 rounded-lg text-xs font-bold"
              >
                Import Keywords
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
