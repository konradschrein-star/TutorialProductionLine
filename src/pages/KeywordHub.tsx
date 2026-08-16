import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Search, 
  Filter, 
  Flame, 
  Send, 
  CheckCircle2, 
  Tv, 
  Sparkles, 
  TrendingUp, 
  Layers, 
  ExternalLink,
  ShieldCheck
} from 'lucide-react';
import { KeywordService, POPULAR_SOFTWARES } from '../services/keywordService';
import { DEFAULT_CHANNELS } from '../services/storageService';
import { KeywordItem, Channel } from '../types';

interface KeywordHubProps {
  activeChannel: Channel;
}

export const KeywordHub: React.FC<KeywordHubProps> = ({ activeChannel }) => {
  const navigate = useNavigate();

  const [keywords, setKeywords] = useState<KeywordItem[]>(() => KeywordService.getKeywords());
  const [search, setSearch] = useState<string>('');
  const [selectedSoftware, setSelectedSoftware] = useState<string>('all');
  const [selectedChannelFilter, setSelectedChannelFilter] = useState<string>('all');
  const [onlyHowTo, setOnlyHowTo] = useState<boolean>(true);

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

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      
      {/* Header & Stats Banner */}
      <div className="glass-panel p-6 rounded-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-black font-display text-white">
              Keyword Intelligence Hub (KTv2)
            </h1>
            <span className="px-2 py-0.5 rounded-full text-xs font-extrabold bg-accent-emerald/20 text-accent-emerald border border-accent-emerald/30">
              10,066 DeepSeek Screened
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Real search volume metrics with quality triage &amp; automated channel routing.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="px-3.5 py-2 rounded-xl bg-surface-200 border border-white/5 text-center">
            <div className="text-[10px] uppercase font-bold text-slate-400">Approved Pool</div>
            <div className="text-sm font-black text-accent-emerald">16,146</div>
          </div>
          <div className="px-3.5 py-2 rounded-xl bg-surface-200 border border-white/5 text-center">
            <div className="text-[10px] uppercase font-bold text-slate-400">HOW_TO Screened</div>
            <div className="text-sm font-black text-accent-cyan">14,985</div>
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="glass-panel p-4 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-3">
        
        {/* Search */}
        <div className="relative w-full md:w-80">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search keywords or topics..."
            className="w-full bg-surface-200 border border-white/10 rounded-xl pl-9 pr-3.5 py-2 text-xs text-white outline-none focus:border-accent-purple"
          />
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto justify-end">
          
          {/* Software Filter */}
          <select
            value={selectedSoftware}
            onChange={(e) => setSelectedSoftware(e.target.value)}
            className="bg-surface-200 border border-white/10 text-xs font-semibold text-white rounded-xl px-3 py-2 outline-none cursor-pointer"
          >
            <option value="all">All Software (115)</option>
            {POPULAR_SOFTWARES.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          {/* Target Channel Filter */}
          <select
            value={selectedChannelFilter}
            onChange={(e) => setSelectedChannelFilter(e.target.value)}
            className="bg-surface-200 border border-white/10 text-xs font-semibold text-white rounded-xl px-3 py-2 outline-none cursor-pointer"
          >
            <option value="all">All Owned Channels</option>
            {DEFAULT_CHANNELS.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>

          {/* Toggle HOW_TO only */}
          <button
            onClick={() => setOnlyHowTo(!onlyHowTo)}
            className={`px-3 py-2 rounded-xl text-xs font-bold transition-colors ${
              onlyHowTo
                ? 'bg-accent-purple text-white shadow-glow'
                : 'bg-surface-200 text-slate-400 hover:text-white'
            }`}
          >
            {onlyHowTo ? '✓ HOW_TO Only' : 'All Formats'}
          </button>

        </div>

      </div>

      {/* Keywords Table */}
      <div className="glass-panel rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-surface-200/80 text-[11px] uppercase tracking-wider text-slate-400 font-bold border-b border-border">
              <tr>
                <th className="py-3.5 px-4">Keyword / Video Topic</th>
                <th className="py-3.5 px-4">Software</th>
                <th className="py-3.5 px-4">Monthly Volume</th>
                <th className="py-3.5 px-4">Target Channel</th>
                <th className="py-3.5 px-4">Screen Verdict</th>
                <th className="py-3.5 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 font-medium">
              {filteredKeywords.map(row => {
                const ch = DEFAULT_CHANNELS.find(c => c.id === row.targetChannelId);

                return (
                  <tr key={row.id} className="hover:bg-white/[0.02] transition-colors">
                    
                    {/* Keyword */}
                    <td className="py-3.5 px-4 font-bold text-white max-w-xs truncate">
                      {row.keyword}
                    </td>

                    {/* Software */}
                    <td className="py-3.5 px-4">
                      <span className="px-2 py-0.5 rounded bg-white/5 font-semibold text-accent-cyan">
                        {row.software}
                      </span>
                    </td>

                    {/* Volume */}
                    <td className="py-3.5 px-4 font-mono font-bold text-white">
                      {row.volume.toLocaleString()} /mo
                    </td>

                    {/* Channel */}
                    <td className="py-3.5 px-4">
                      {ch ? (
                        <span
                          className="px-2 py-0.5 rounded text-[10px] font-extrabold border"
                          style={{
                            borderColor: `${ch.badgeColor}40`,
                            backgroundColor: `${ch.badgeColor}15`,
                            color: ch.badgeColor
                          }}
                        >
                          {ch.name}
                        </span>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>

                    {/* Verdict */}
                    <td className="py-3.5 px-4">
                      <span className="px-2 py-0.5 rounded bg-accent-emerald/20 text-accent-emerald text-[10px] font-bold">
                        APPROVE (DeepSeek)
                      </span>
                    </td>

                    {/* Action */}
                    <td className="py-3.5 px-4 text-right">
                      {row.status === 'COMPLETED' ? (
                        <span className="text-slate-500 font-semibold text-[11px] flex items-center justify-end gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5 text-accent-emerald" /> Completed
                        </span>
                      ) : (
                        <button
                          onClick={() => handleClaimAndProduce(row)}
                          className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-accent-purple to-accent-violet hover:opacity-90 text-white font-bold text-[11px] shadow-glow inline-flex items-center gap-1.5 transition-all"
                        >
                          <Send className="w-3 h-3" /> Send to Production
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
