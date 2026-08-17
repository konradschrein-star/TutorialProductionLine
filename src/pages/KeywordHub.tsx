import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Search, 
  Send, 
  CheckCircle2, 
  Database,
  RefreshCw,
  Server
} from 'lucide-react';
import { KeywordService, POPULAR_SOFTWARES } from '../services/keywordService';
import { KTv2SyncService } from '../services/ktv2SyncService';
import { DEFAULT_CHANNELS } from '../services/storageService';
import { KeywordItem, Channel } from '../types';

interface KeywordHubProps {
  activeChannel: Channel;
}

export const KeywordHub: React.FC<KeywordHubProps> = () => {
  const navigate = useNavigate();

  const [keywords, setKeywords] = useState<KeywordItem[]>(() => KeywordService.getKeywords());
  const [search, setSearch] = useState<string>('');
  const [selectedSoftware, setSelectedSoftware] = useState<string>('all');
  const [selectedChannelFilter, setSelectedChannelFilter] = useState<string>('all');
  const [onlyHowTo, setOnlyHowTo] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncMessage, setSyncMessage] = useState<string>('');

  // Filtered list
  const filteredKeywords = useMemo(() => {
    return keywords.filter(kw => {
      if (onlyHowTo && kw.contentType !== 'HOW_TO') return false;
      if (selectedSoftware !== 'all' && kw.software.toLowerCase() !== selectedSoftware.toLowerCase()) return false;
      if (selectedChannelFilter !== 'all' && kw.targetChannelId !== selectedChannelFilter) return false;
      if (search && !kw.keyword.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [keywords, search, selectedSoftware, selectedChannelFilter, onlyHowTo]);

  const handleClaimAndProduce = (kw: KeywordItem) => {
    KeywordService.claimKeyword(kw.id, 'Ian Christopher');
    navigate('/', {
      state: {
        topic: kw.keyword,
        keywordId: kw.id,
        channelId: kw.targetChannelId
      }
    });
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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-4">
      
      {/* Header & Metrics Banner */}
      <div className="pro-panel p-4 rounded-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-foreground" />
            <h1 className="text-sm font-bold font-display text-foreground">
              Keyword Intelligence Pool (KTv2)
            </h1>
            <span className="px-1.5 py-0.2 rounded font-mono text-[10px] font-bold bg-surface-200 text-foreground border border-border">
              10,066 DeepSeek Screened
            </span>
          </div>
          <p className="text-[11px] text-muted mt-0.5">
            Verified search volume metrics with quality triage &amp; automated channel routing.
          </p>
        </div>

        <div className="flex items-center gap-2">
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

          <div className="px-3 py-1.5 rounded-lg bg-surface-200 border border-border text-center">
            <div className="text-[9px] uppercase font-mono font-bold text-muted">Approved Pool</div>
            <div className="text-xs font-mono font-bold text-foreground">16,146</div>
          </div>
          <div className="px-3 py-1.5 rounded-lg bg-surface-200 border border-border text-center">
            <div className="text-[9px] uppercase font-mono font-bold text-muted">HOW_TO Pool</div>
            <div className="text-xs font-mono font-bold text-foreground">14,985</div>
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="pro-panel p-3 rounded-xl flex flex-col md:flex-row items-center justify-between gap-2.5">
        
        {/* Search */}
        <div className="relative w-full md:w-72">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter keywords or topics..."
            className="pro-input w-full rounded-lg pl-8 pr-3 py-1.5 text-xs"
          />
          <Search className="w-3.5 h-3.5 text-muted absolute left-2.5 top-2" />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto justify-end">
          
          <select
            value={selectedSoftware}
            onChange={(e) => setSelectedSoftware(e.target.value)}
            className="pro-input text-xs rounded-lg px-2.5 py-1.5 cursor-pointer font-sans"
          >
            <option value="all">All Software (115)</option>
            {POPULAR_SOFTWARES.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          <select
            value={selectedChannelFilter}
            onChange={(e) => setSelectedChannelFilter(e.target.value)}
            className="pro-input text-xs rounded-lg px-2.5 py-1.5 cursor-pointer font-sans"
          >
            <option value="all">All Channels</option>
            {DEFAULT_CHANNELS.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>

          <button
            onClick={() => setOnlyHowTo(!onlyHowTo)}
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
      <div className="pro-panel rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-foreground">
            <thead className="bg-surface-200/80 text-[10px] uppercase font-mono font-bold text-muted border-b border-border">
              <tr>
                <th className="py-2.5 px-4">Topic / Keyword</th>
                <th className="py-2.5 px-4">Software</th>
                <th className="py-2.5 px-4">Monthly Search</th>
                <th className="py-2.5 px-4">Channel Routing</th>
                <th className="py-2.5 px-4">Verdict</th>
                <th className="py-2.5 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredKeywords.map(row => {
                const ch = DEFAULT_CHANNELS.find(c => c.id === row.targetChannelId);

                return (
                  <tr key={row.id} className="hover:bg-surface-200/40 transition-colors">
                    
                    <td className="py-2.5 px-4 font-medium text-foreground max-w-sm truncate">
                      {row.keyword}
                    </td>

                    <td className="py-2.5 px-4">
                      <span className="px-1.5 py-0.5 rounded bg-surface-200 text-[11px] font-mono text-foreground border border-border">
                        {row.software}
                      </span>
                    </td>

                    <td className="py-2.5 px-4 font-mono font-semibold text-foreground">
                      {row.volume.toLocaleString()}
                    </td>

                    <td className="py-2.5 px-4">
                      {ch ? (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-surface-200 text-foreground border border-border">
                          {ch.name}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>

                    <td className="py-2.5 px-4">
                      <span className="px-1.5 py-0.2 rounded bg-surface-200 text-[10px] font-mono font-semibold text-foreground border border-border">
                        APPROVE
                      </span>
                    </td>

                    <td className="py-2.5 px-4 text-right">
                      {row.status === 'COMPLETED' ? (
                        <span className="text-muted font-mono text-[11px] inline-flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Done
                        </span>
                      ) : (
                        <button
                          onClick={() => handleClaimAndProduce(row)}
                          className="btn-solid px-2.5 py-1 rounded text-[11px] inline-flex items-center gap-1"
                        >
                          <Send className="w-2.5 h-2.5" /> Produce
                        </button>
                      )}
                    </td>

                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
};
