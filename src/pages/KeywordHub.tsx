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
  Sparkles
} from 'lucide-react';
import { KeywordService, POPULAR_SOFTWARES } from '../services/keywordService';
import { KTv2SyncService } from '../services/ktv2SyncService';
import { DEFAULT_CHANNELS } from '../services/storageService';
import { KeywordItem, Channel } from '../types';

interface KeywordHubProps {
  activeChannel: Channel;
}

const PAGE_SIZE = 50;

export const KeywordHub: React.FC<KeywordHubProps> = () => {
  const navigate = useNavigate();

  const [keywords, setKeywords] = useState<KeywordItem[]>(() => KeywordService.getKeywords());
  const [search, setSearch] = useState<string>('');
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');
  const [selectedSoftware, setSelectedSoftware] = useState<string>('all');
  const [selectedChannelFilter, setSelectedChannelFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'NEW' | 'IN_PRODUCTION' | 'COMPLETED'>('ALL');
  const [onlyHowTo, setOnlyHowTo] = useState<boolean>(true);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncMessage, setSyncMessage] = useState<string>('');

  // Debounce search to keep UI at 60 FPS
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setCurrentPage(1);
    }, 180);
    return () => clearTimeout(timer);
  }, [search]);

  // Real-time metric counts
  const counts = useMemo(() => {
    return KeywordService.getKeywordCounts(keywords);
  }, [keywords]);

  // Filtered list
  const filteredKeywords = useMemo(() => {
    return keywords.filter(kw => {
      if (onlyHowTo && kw.contentType !== 'HOW_TO') return false;
      if (statusFilter === 'NEW' && (kw.status === 'COMPLETED' || kw.status === 'IN_PRODUCTION' || kw.status === 'CLAIMED')) return false;
      if (statusFilter === 'IN_PRODUCTION' && kw.status !== 'IN_PRODUCTION' && kw.status !== 'CLAIMED') return false;
      if (statusFilter === 'COMPLETED' && kw.status !== 'COMPLETED') return false;
      if (selectedSoftware !== 'all' && kw.software.toLowerCase() !== selectedSoftware.toLowerCase()) return false;
      if (selectedChannelFilter !== 'all' && kw.targetChannelId !== selectedChannelFilter) return false;
      if (debouncedSearch && !kw.keyword.toLowerCase().includes(debouncedSearch.toLowerCase())) return false;
      return true;
    });
  }, [keywords, debouncedSearch, selectedSoftware, selectedChannelFilter, onlyHowTo, statusFilter]);

  // Paginated slice
  const totalPages = Math.max(1, Math.ceil(filteredKeywords.length / PAGE_SIZE));
  const paginatedKeywords = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredKeywords.slice(start, start + PAGE_SIZE);
  }, [filteredKeywords, currentPage]);

  const handleClaimAndProduce = (kw: KeywordItem) => {
    KeywordService.updateKeywordStatus(kw.id, 'IN_PRODUCTION', 'Ian Christopher');
    setKeywords(KeywordService.getKeywords());
    navigate('/', {
      state: {
        topic: kw.keyword,
        keywordId: kw.id,
        channelId: kw.targetChannelId
      }
    });
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

  const handleSyncWithVPS = async () => {
    setIsSyncing(true);
    setSyncMessage('');
    try {
      const res = await KTv2SyncService.syncWithVPS('decastroian76@gmail.com');
      setKeywords(KeywordService.getKeywords());
      setSyncMessage(res.message);
      setTimeout(() => setSyncMessage(''), 3000);
    } catch (e: any) {
      setSyncMessage('Sync failed: ' + e.message);
    } finally {
      setIsSyncing(false);
    }
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
            Real-time keyword state management, production claim routing, and VPS syncing.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-end">
          {syncMessage && (
            <span className="text-[11px] font-mono text-emerald-500 font-bold animate-fadeIn">
              {syncMessage}
            </span>
          )}

          <button
            onClick={handleSyncWithVPS}
            disabled={isSyncing}
            className="btn-outline px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            {isSyncing ? 'Syncing...' : 'Sync KTv2 VPS'}
          </button>

          {/* Metric Status Badges */}
          <div className="px-2.5 py-1 rounded-lg bg-surface-200 border border-border text-center">
            <div className="text-[9px] uppercase font-mono font-bold text-muted">Available</div>
            <div className="text-xs font-mono font-bold text-foreground">{counts.available.toLocaleString()}</div>
          </div>
          <div className="px-2.5 py-1 rounded-lg bg-surface-200 border border-border text-center">
            <div className="text-[9px] uppercase font-mono font-bold text-amber-500">In Production</div>
            <div className="text-xs font-mono font-bold text-amber-500">{counts.inProduction.toLocaleString()}</div>
          </div>
          <div className="px-2.5 py-1 rounded-lg bg-surface-200 border border-border text-center">
            <div className="text-[9px] uppercase font-mono font-bold text-emerald-500">Done</div>
            <div className="text-xs font-mono font-bold text-emerald-500">{counts.completed.toLocaleString()}</div>
          </div>
        </div>
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
          <div className="flex items-center gap-2 bg-surface-200 px-3 py-1.5 rounded-lg border border-border text-xs animate-fadeIn">
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
            <button
              onClick={() => handleBatchStatus('NEW')}
              className="px-2 py-1 rounded hover:bg-surface-300 text-muted hover:text-foreground font-semibold text-[11px]"
            >
              Reset
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
            {DEFAULT_CHANNELS.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
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
                <th className="py-2.5 px-3">Channel</th>
                <th className="py-2.5 px-3">Status State</th>
                <th className="py-2.5 px-4 text-right">Action / Mark</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {paginatedKeywords.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-10 text-xs text-muted">
                    No keywords found matching current filter criteria.
                  </td>
                </tr>
              ) : (
                paginatedKeywords.map(row => {
                  const ch = DEFAULT_CHANNELS.find(c => c.id === row.targetChannelId);
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

                      {/* Action */}
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
                            <button
                              onClick={() => handleClaimAndProduce(row)}
                              className="btn-solid px-2.5 py-1 rounded text-[11px] inline-flex items-center gap-1 font-semibold"
                            >
                              <Send className="w-2.5 h-2.5" /> Produce
                            </button>
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

    </div>
  );
};
