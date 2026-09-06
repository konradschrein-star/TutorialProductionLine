import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  Send,
  Database,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  CheckSquare,
  Square,
  Sparkles,
  Plus,
  Sliders,
  Upload,
  Download,
  Trash2,
  Wand2,
  Compass,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Bookmark,
  Save,
  Loader2,
  Info,
  AlertTriangle,
  Youtube,
  UserCheck,
} from 'lucide-react';
import { saveAs } from 'file-saver';
import {
  KeywordService,
  POPULAR_SOFTWARES,
  ScoredKeyword,
  competitionAtMost,
} from '../services/keywordService';
import { ExternalKeywordService } from '../services/externalKeywordService';
import { SuggestService, SuggestCandidate, DiscoverResult } from '../services/suggestService';
import { StorageService } from '../services/storageService';
import { useChannels, useUsers, useConfig, useActiveUser, useActiveChannel, useStore } from '../hooks/useStore';
import { useToast, useConfirm } from '../components/ui/Feedback';
import { useRole } from '../context/RoleContext';
import { Modal } from '../components/ui/Modal';
import { Field, TextInput, Select, Toggle } from '../components/ui/Form';
import { KeywordItem, Channel, VAUser } from '../types';
import { CompetitionLevel, KeywordContentType, FilterPreset } from '../types/config';

type KeywordSource = 'starter' | 'own';
type SortKey = 'score' | 'volume' | 'competition' | 'keyword';
type SortDir = 'asc' | 'desc';

interface KeywordHubProps {
  activeChannel?: Channel;
}

const PAGE_SIZE = 50;
const CONTENT_TYPES: KeywordContentType[] = ['HOW_TO', 'FULL_TUTORIAL', 'LIST', 'REVIEW'];

const VERDICT_BADGE: Record<KeywordItem['screenVerdict'], string> = {
  APPROVE: 'badge-success',
  REVIEW: 'badge-warning',
  REJECT: 'badge-danger',
};

export const KeywordHub: React.FC<KeywordHubProps> = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const { can } = useRole();

  // Reactive domain data (store-backed).
  const channels = useChannels();
  const users = useUsers();
  const config = useConfig();
  const activeUser = useActiveUser();
  const activeChannel = useActiveChannel();
  const presets = useStore(() => StorageService.getFilterPresets(), ['filter_presets']);

  const canManage = can('keywordsManage');

  // Keyword pool lives in KeywordService (localStorage, non-emitting) — keep a
  // local mirror refreshed after every mutation via reload().
  const [keywords, setKeywords] = useState<KeywordItem[]>(() => KeywordService.getKeywords());
  const reload = () => setKeywords(KeywordService.getKeywords());

  const [sourceTab, setSourceTab] = useState<KeywordSource>('starter');

  // ---- Filters (config-seeded where applicable) ----
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedSoftware, setSelectedSoftware] = useState('all');
  const [selectedChannelFilter, setSelectedChannelFilter] = useState('all');
  const [assignedFilter, setAssignedFilter] = useState('all');
  const [mySoftwaresOnly, setMySoftwaresOnly] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'NEW' | 'IN_PRODUCTION' | 'COMPLETED'>('ALL');
  const [volumeFilter, setVolumeFilter] = useState('all');
  const [competitionFilter, setCompetitionFilter] = useState<'all' | CompetitionLevel>('all');
  const [verdictFilter, setVerdictFilter] = useState<'all' | KeywordItem['screenVerdict']>('all');
  const [contentTypeFilter, setContentTypeFilter] = useState<'all' | KeywordContentType>('all');

  // Config-derived defaults (initial state from config.keyword).
  const [minVolume, setMinVolume] = useState<number>(() => config.keyword.minVolume);
  const [maxCompetition, setMaxCompetition] = useState<CompetitionLevel>(() => config.keyword.maxCompetition);
  const [allowedTypes, setAllowedTypes] = useState<KeywordContentType[]>(() => config.keyword.allowedContentTypes);
  const [lengthCap, setLengthCap] = useState<number>(() => config.keyword.lengthCapMinutes);

  const [sortKey, setSortKey] = useState<SortKey>('score');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const [currentPage, setCurrentPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSyncing, setIsSyncing] = useState(false);

  // Screening progress
  const [screening, setScreening] = useState<{ active: boolean; done: number; total: number }>({
    active: false,
    done: 0,
    total: 0,
  });

  // Modals
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isDiscoverOpen, setIsDiscoverOpen] = useState(false);
  const [isScrapeOpen, setIsScrapeOpen] = useState(false);
  const [isPresetModalOpen, setIsPresetModalOpen] = useState(false);

  // Scrape Channel modal state
  const [scrapeChannelInput, setScrapeChannelInput] = useState('');
  const [scrapeSoftware, setScrapeSoftware] = useState('Excel');
  const [scrapeTargetChannel, setScrapeTargetChannel] = useState(channels[0]?.id || 'skool');
  const [scraping, setScraping] = useState(false);
  const [scrapeResult, setScrapeResult] = useState<DiscoverResult | null>(null);
  const [scrapeSelected, setScrapeSelected] = useState<Set<string>>(new Set());

  // Add Keyword modal state
  const [newKeywordText, setNewKeywordText] = useState('');
  const [newSoftware, setNewSoftware] = useState('Excel');
  const [newTargetChannelId, setNewTargetChannelId] = useState(channels[0]?.id || 'skool');

  // CSV Import modal state
  const [csvText, setCsvText] = useState('');
  const [importStats, setImportStats] = useState<{ added: number; skipped: number } | null>(null);

  // Discover modal state
  const [seed, setSeed] = useState('');
  const [discoverSoftware, setDiscoverSoftware] = useState('Excel');
  const [discoverChannel, setDiscoverChannel] = useState(channels[0]?.id || 'skool');
  const [discoverOpts, setDiscoverOpts] = useState({ modifiers: true, alphabet: true, youtube: true });
  const [discovering, setDiscovering] = useState(false);
  const [discoverResult, setDiscoverResult] = useState<DiscoverResult | null>(null);
  const [discoverSelected, setDiscoverSelected] = useState<Set<string>>(new Set());

  // Preset save modal state
  const [presetName, setPresetName] = useState('');

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setCurrentPage(1);
    }, 180);
    return () => clearTimeout(timer);
  }, [search]);

  const scoreContext = useMemo(
    () => ({
      activeChannelId: activeChannel.id,
      focusSoftware: config.focusSoftware,
      lengthCapMinutes: lengthCap,
    }),
    [activeChannel.id, config.focusSoftware, lengthCap]
  );

  // Per-source pool sizes.
  const sourceCounts = useMemo(
    () => ({
      starter: keywords.filter(k => (k.source ?? 'starter') === 'starter').length,
      own: keywords.filter(k => (k.source ?? 'starter') === 'own').length,
    }),
    [keywords]
  );

  const sourceKeywords = useMemo(
    () => keywords.filter(k => (k.source ?? 'starter') === sourceTab),
    [keywords, sourceTab]
  );

  const counts = useMemo(() => KeywordService.getKeywordCounts(sourceKeywords), [sourceKeywords]);

  // Filtered list.
  const filteredKeywords = useMemo(() => {
    const defaultEst = config.defaultTargetMinutes ?? 3;
    return sourceKeywords.filter(kw => {
      // Config-derived base restrictions.
      if (allowedTypes.length && !allowedTypes.includes(kw.contentType)) return false;
      if (!competitionAtMost(kw.competition, maxCompetition)) return false;
      if (kw.volume < minVolume) return false;
      if (lengthCap > 0 && (kw.estMinutes ?? defaultEst) > lengthCap) return false;

      // Explicit UI filters.
      if (contentTypeFilter !== 'all' && kw.contentType !== contentTypeFilter) return false;
      if (verdictFilter !== 'all' && kw.screenVerdict !== verdictFilter) return false;

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

      // Assigned VA filter
      if (assignedFilter === 'unassigned') {
        if (kw.assignedTo || kw.claimedBy) return false;
      } else if (assignedFilter !== 'all') {
        const matchesUser =
          kw.assignedTo === assignedFilter ||
          kw.claimedBy === assignedFilter ||
          kw.assignedToName === assignedFilter;
        if (!matchesUser) return false;
      }

      // My Softwares filter (for VAs with specialized software focus)
      if (mySoftwaresOnly && activeUser.assignedSoftwares && activeUser.assignedSoftwares.length > 0) {
        const lowerList = activeUser.assignedSoftwares.map(s => s.toLowerCase());
        if (!lowerList.includes((kw.software || '').toLowerCase())) return false;
      }

      if (debouncedSearch && !kw.keyword.toLowerCase().includes(debouncedSearch.toLowerCase())) return false;
      return true;
    });
  }, [
    sourceKeywords, allowedTypes, maxCompetition, minVolume, lengthCap, contentTypeFilter, verdictFilter,
    statusFilter, selectedSoftware, selectedChannelFilter, competitionFilter, volumeFilter, debouncedSearch,
    assignedFilter, mySoftwaresOnly, activeUser.assignedSoftwares,
    config.defaultTargetMinutes,
  ]);

  // Score + rank + sort.
  const rankedKeywords = useMemo(() => {
    const scored = KeywordService.rankKeywords(filteredKeywords, scoreContext);
    const dir = sortDir === 'asc' ? 1 : -1;
    const compRank: Record<CompetitionLevel, number> = { Low: 0, Medium: 1, High: 2 };
    scored.sort((a, b) => {
      switch (sortKey) {
        case 'volume': return (a.volume - b.volume) * dir;
        case 'competition': return (compRank[a.competition] - compRank[b.competition]) * dir;
        case 'keyword': return a.keyword.localeCompare(b.keyword) * dir;
        case 'score':
        default: return (a.score - b.score) * dir;
      }
    });
    return scored;
  }, [filteredKeywords, scoreContext, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(rankedKeywords.length / PAGE_SIZE));
  const paginatedKeywords = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return rankedKeywords.slice(start, start + PAGE_SIZE);
  }, [rankedKeywords, currentPage]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(1);
  }, [totalPages, currentPage]);

  // ---- Sorting ----
  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'keyword' ? 'asc' : 'desc');
    }
  };
  const SortIcon: React.FC<{ col: SortKey }> = ({ col }) => {
    if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 opacity-40" />;
    return sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />;
  };

  // ---- Claim / route ----
  const handleClaimAndProduceConveyor = (kw: KeywordItem) => {
    KeywordService.updateKeywordStatus(kw.id, 'IN_PRODUCTION', activeUser.id);
    reload();
    const meta = KeywordService.getScreenMetaFor(kw.id);
    navigate('/', {
      state: {
        topic: kw.keyword,
        keywordId: kw.id,
        channelId: kw.targetChannelId,
        software: kw.software,
        contentType: kw.contentType,
        angle: meta?.angle,
        suggestedTitle: meta?.title,
      },
    });
  };

  const handleClaimAndEnqueueStudio = (kw: KeywordItem) => {
    KeywordService.updateKeywordStatus(kw.id, 'IN_PRODUCTION', activeUser.id);
    reload();
    const ch = channels.find(c => c.id === kw.targetChannelId) || channels[0];
    StorageService.saveStudioJob({
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
      updatedAt: new Date().toISOString(),
    });
    toast(`Enqueued "${kw.keyword}" to the Studio pipeline.`, 'success');
    navigate('/studio');
  };

  const handleStatusChange = (id: string, nextStatus: 'NEW' | 'IN_PRODUCTION' | 'COMPLETED') => {
    KeywordService.updateKeywordStatus(id, nextStatus, nextStatus === 'NEW' ? undefined : activeUser.id);
    reload();
  };

  // ---- Selection ----
  const handleSelectAllOnPage = () => {
    const next = new Set(selectedIds);
    const allSelected = paginatedKeywords.length > 0 && paginatedKeywords.every(k => next.has(k.id));
    if (allSelected) paginatedKeywords.forEach(k => next.delete(k.id));
    else paginatedKeywords.forEach(k => next.add(k.id));
    setSelectedIds(next);
  };

  const toggleRow = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  // ---- Bulk ops ----
  const handleBatchStatus = (status: 'NEW' | 'IN_PRODUCTION' | 'COMPLETED') => {
    if (selectedIds.size === 0) return;
    KeywordService.batchUpdateStatus(Array.from(selectedIds), status);
    reload();
    setSelectedIds(new Set());
  };

  const handleBatchAssignChannel = (channelId: string) => {
    if (selectedIds.size === 0) return;
    KeywordService.batchAssignChannel(Array.from(selectedIds), channelId);
    reload();
    setSelectedIds(new Set());
  };

  const handleBatchAssignVA = (userId: string) => {
    if (selectedIds.size === 0) return;
    const targetUser = users.find(u => u.id === userId);
    KeywordService.batchAssignUser(
      Array.from(selectedIds),
      userId === 'unassigned' ? undefined : userId,
      targetUser ? targetUser.name : undefined
    );
    reload();
    setSelectedIds(new Set());
    toast(
      `Assigned ${selectedIds.size} keyword(s) to ${targetUser ? targetUser.name : 'Unassigned'}.`,
      'success'
    );
  };

  const handleAssignKeyword = (id: string, userId: string) => {
    const targetUser = users.find(u => u.id === userId);
    KeywordService.assignKeyword(
      id,
      userId === 'unassigned' ? undefined : userId,
      targetUser ? targetUser.name : undefined
    );
    reload();
    toast(`Assigned to ${targetUser ? targetUser.name : 'Unassigned'}.`, 'success');
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    const ok = await confirm({
      title: 'Delete keywords',
      message: `Delete ${selectedIds.size} selected keyword(s)? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    KeywordService.batchDelete(Array.from(selectedIds));
    reload();
    setSelectedIds(new Set());
    toast('Selected keywords deleted.', 'success');
  };

  const handleScreenSelected = async () => {
    if (selectedIds.size === 0) return;
    const targets = keywords.filter(k => selectedIds.has(k.id));
    setScreening({ active: true, done: 0, total: targets.length });
    try {
      const res = await KeywordService.screenKeywords(targets, (done, total) =>
        setScreening({ active: true, done, total })
      );
      reload();
      if (res.error) {
        toast(res.error, 'error', 'AI screening');
      } else if (res.screened > 0) {
        toast(
          `Screened ${res.screened} keyword(s)${res.failed ? ` (${res.failed} unresolved)` : ''}.`,
          'success',
          'AI screening'
        );
        setSelectedIds(new Set());
      } else {
        toast('No keywords could be screened.', 'warning', 'AI screening');
      }
    } catch (e: any) {
      toast(`Screening failed: ${e?.message || 'unknown error'}`, 'error');
    } finally {
      setScreening({ active: false, done: 0, total: 0 });
    }
  };

  // ---- CSV ----
  const handleExportCSV = () => {
    const csvData = KeywordService.exportKeywordsToCSV(rankedKeywords);
    saveAs(new Blob([csvData], { type: 'text/csv;charset=utf-8;' }), `keywords_export_${Date.now()}.csv`);
    toast(`Exported ${rankedKeywords.length} keyword(s) to CSV.`, 'success');
  };

  const handleImportCSV = () => {
    if (!csvText.trim()) return;
    const res = KeywordService.importKeywordsFromCSV(csvText, channels[0]?.id);
    setImportStats(res);
    reload();
    if (res.added > 0) setSourceTab('own');
    toast(`Imported ${res.added} new keyword(s), ${res.skipped} duplicate(s) skipped.`, res.added > 0 ? 'success' : 'info');
    setTimeout(() => {
      setIsImportModalOpen(false);
      setCsvText('');
      setImportStats(null);
    }, 1200);
  };

  const handleSyncExternal = async () => {
    setIsSyncing(true);
    try {
      const res = await ExternalKeywordService.sync();
      reload();
      if (res.source === 'external' && res.totalSynced > 0) setSourceTab('own');
      toast(res.message, res.source === 'external' ? 'success' : 'info', 'External sync');
    } catch (e: any) {
      toast(`Sync failed: ${e?.message || 'unknown error'}`, 'error');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleAddCustomKeyword = () => {
    if (!newKeywordText.trim()) return;
    const newItem: KeywordItem = {
      id: `kw_${Date.now()}`,
      keyword: newKeywordText.trim(),
      software: newSoftware.trim() || 'General Software',
      volume: 1200,
      competition: 'Low',
      screenVerdict: 'REVIEW',
      contentType: 'HOW_TO',
      targetChannelId: newTargetChannelId,
      status: 'NEW',
      dateAdded: new Date().toISOString().split('T')[0],
      source: 'own',
    };
    KeywordService.saveKeywords([newItem, ...KeywordService.getKeywords()]);
    reload();
    setSourceTab('own');
    setIsAddModalOpen(false);
    setNewKeywordText('');
    toast('Topic added to My Keywords.', 'success');
  };

  // ---- Discover ----
  const handleDiscover = async () => {
    if (!seed.trim()) return;
    setDiscovering(true);
    setDiscoverResult(null);
    setDiscoverSelected(new Set());
    try {
      const res = await SuggestService.discover(seed, {
        includeModifiers: discoverOpts.modifiers,
        includeAlphabet: discoverOpts.alphabet,
        includeYouTube: discoverOpts.youtube,
      });
      setDiscoverResult(res);
      if (!res.ok) {
        toast(res.error || 'Discovery failed.', 'error', 'Discover keywords');
      } else if (res.candidates.length === 0) {
        toast('No candidates found for that seed. Try a broader term.', 'warning');
      } else {
        // Pre-select all by default for a fast "add all" flow.
        setDiscoverSelected(new Set(res.candidates.map(c => c.keyword)));
      }
    } catch (e: any) {
      toast(`Discovery failed: ${e?.message || 'unknown error'}`, 'error');
    } finally {
      setDiscovering(false);
    }
  };

  const toggleDiscoverRow = (keyword: string) => {
    const next = new Set(discoverSelected);
    if (next.has(keyword)) next.delete(keyword);
    else next.add(keyword);
    setDiscoverSelected(next);
  };

  const handleAddDiscovered = () => {
    if (!discoverResult || discoverSelected.size === 0) return;
    const existing = KeywordService.getKeywords();
    const existingSet = new Set(existing.map(k => k.keyword.toLowerCase().trim()));
    const today = new Date().toISOString().split('T')[0];

    const chosen = discoverResult.candidates.filter(c => discoverSelected.has(c.keyword));
    const fresh: KeywordItem[] = [];
    let skipped = 0;
    for (const c of chosen) {
      const key = c.keyword.toLowerCase().trim();
      if (existingSet.has(key)) {
        skipped++;
        continue;
      }
      existingSet.add(key);
      fresh.push({
        id: `kw_disc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        keyword: c.keyword,
        software: discoverSoftware.trim() || 'General Software',
        volume: c.volumeEstimate,
        competition: c.competitionEstimate,
        screenVerdict: 'REVIEW',
        contentType: 'HOW_TO',
        targetChannelId: discoverChannel,
        status: 'NEW',
        dateAdded: today,
        estMinutes: config.defaultTargetMinutes ?? 3,
        source: 'own',
      });
    }

    if (fresh.length > 0) {
      KeywordService.saveKeywords([...fresh, ...existing]);
      reload();
      setSourceTab('own');
    }
    toast(
      `Added ${fresh.length} keyword(s) to My Keywords${skipped ? `, ${skipped} duplicate(s) skipped` : ''}.`,
      fresh.length > 0 ? 'success' : 'info'
    );
    setIsDiscoverOpen(false);
    setDiscoverResult(null);
    setDiscoverSelected(new Set());
    setSeed('');
  };

  // ---- Channel Scraping ----
  const handleScrapeChannel = async () => {
    if (!scrapeChannelInput.trim()) return;
    setScraping(true);
    setScrapeResult(null);
    setScrapeSelected(new Set());
    try {
      const res = await SuggestService.scrapeChannel(scrapeChannelInput, scrapeSoftware);
      setScrapeResult(res);
      if (res.ok) {
        setScrapeSelected(new Set(res.candidates.map(c => c.keyword)));
        toast(`Found ${res.candidates.length} candidate keywords from channel.`, 'success');
      } else {
        toast(res.error || 'Channel scraping failed', 'error');
      }
    } catch (e: any) {
      toast('Channel scraping failed: ' + (e?.message || 'Network error'), 'error');
    } finally {
      setScraping(false);
    }
  };

  const handleAddScraped = () => {
    if (!scrapeResult?.ok || scrapeSelected.size === 0) return;
    const existing = KeywordService.getKeywords();
    const existingSet = new Set(existing.map(k => k.keyword.toLowerCase().trim()));
    const today = new Date().toISOString().split('T')[0];

    const chosen = scrapeResult.candidates.filter(c => scrapeSelected.has(c.keyword));
    const fresh: KeywordItem[] = [];
    let skipped = 0;
    for (const c of chosen) {
      const key = c.keyword.toLowerCase().trim();
      if (existingSet.has(key)) {
        skipped++;
        continue;
      }
      existingSet.add(key);
      fresh.push({
        id: `kw_scrape_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        keyword: c.keyword,
        software: scrapeSoftware.trim() || 'General Software',
        volume: c.volumeEstimate,
        competition: c.competitionEstimate,
        screenVerdict: 'REVIEW',
        contentType: 'HOW_TO',
        targetChannelId: scrapeTargetChannel,
        status: 'NEW',
        dateAdded: today,
        estMinutes: config.defaultTargetMinutes ?? 3,
        source: 'own',
      });
    }

    if (fresh.length > 0) {
      KeywordService.saveKeywords([...fresh, ...existing]);
      reload();
      setSourceTab('own');
    }
    toast(
      `Added ${fresh.length} keyword(s) from channel to My Keywords${skipped ? `, ${skipped} duplicate(s) skipped` : ''}.`,
      fresh.length > 0 ? 'success' : 'info'
    );
    setIsScrapeOpen(false);
    setScrapeResult(null);
    setScrapeSelected(new Set());
    setScrapeChannelInput('');
  };

  // ---- Presets ----
  const applyPreset = (id: string) => {
    const p = presets.find(x => x.id === id);
    if (!p) return;
    const f = p.filters;
    setSearch(f.search ?? '');
    setSelectedSoftware(f.software ?? 'all');
    setSelectedChannelFilter(f.channel ?? 'all');
    setVolumeFilter(f.volume ?? 'all');
    setCompetitionFilter((f.competition as any) ?? 'all');
    setContentTypeFilter((f.contentType as any) ?? 'all');
    setStatusFilter((f.status as any) ?? 'ALL');
    setVerdictFilter((f.verdict as any) ?? 'all');
    if (f.sortBy) setSortKey(f.sortBy as SortKey);
    setCurrentPage(1);
    toast(`Applied preset "${p.name}".`, 'info');
  };

  const handleSavePreset = () => {
    if (!presetName.trim()) return;
    const preset: FilterPreset = {
      id: `fp_${Date.now()}`,
      name: presetName.trim(),
      filters: {
        search,
        software: selectedSoftware,
        channel: selectedChannelFilter,
        volume: volumeFilter,
        competition: competitionFilter,
        contentType: contentTypeFilter,
        status: statusFilter,
        verdict: verdictFilter,
        sortBy: sortKey,
      },
      createdAt: new Date().toISOString(),
    };
    StorageService.saveFilterPreset(preset);
    setIsPresetModalOpen(false);
    setPresetName('');
    toast(`Saved filter preset "${preset.name}".`, 'success');
  };

  const handleDeletePreset = async (id: string) => {
    const p = presets.find(x => x.id === id);
    const ok = await confirm({
      title: 'Delete preset',
      message: `Delete the "${p?.name || 'selected'}" filter preset?`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    StorageService.deleteFilterPreset(id);
    toast('Preset deleted.', 'success');
  };

  const resetConfigDefaults = () => {
    setMinVolume(config.keyword.minVolume);
    setMaxCompetition(config.keyword.maxCompetition);
    setAllowedTypes(config.keyword.allowedContentTypes);
    setLengthCap(config.keyword.lengthCapMinutes);
    setCompetitionFilter('all');
    setVolumeFilter('all');
    setVerdictFilter('all');
    setContentTypeFilter('all');
    toast('Filters reset to Studio Config defaults.', 'info');
  };

  const configDefaultsActive =
    minVolume !== config.keyword.minVolume ||
    maxCompetition !== config.keyword.maxCompetition ||
    lengthCap !== config.keyword.lengthCapMinutes;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-4 animate-fadeIn">
      {/* Header & Metrics Banner */}
      <div className="pro-panel p-4 rounded-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-foreground" />
            <h1 className="text-sm font-bold font-display text-foreground">Keyword Research &amp; Planning Hub</h1>
            <span className="px-2 py-0.5 rounded font-mono text-[10px] font-bold bg-surface-200 text-foreground border border-border">
              {keywords.length.toLocaleString()} Tracked
            </span>
          </div>
          <p className="text-[11px] text-muted mt-0.5">
            Discover new keywords, score opportunities, AI-screen intent, and route topics into production.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-end">
          {canManage && (
            <button
              onClick={() => setIsDiscoverOpen(true)}
              className="btn-accent px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 focus-ring"
              title="Discover new keywords from a seed term"
            >
              <Compass className="w-3.5 h-3.5" />
              Discover
            </button>
          )}

          {canManage && (
            <button
              onClick={() => setIsScrapeOpen(true)}
              className="btn-solid px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 focus-ring"
              title="Scrape tutorial topics from any YouTube channel handle or URL"
            >
              <Youtube className="w-3.5 h-3.5 text-danger" />
              Scrape Channel
            </button>
          )}

          {canManage && (
            <button
              onClick={() => setIsImportModalOpen(true)}
              className="btn-outline px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 focus-ring"
              title="Import keywords from CSV file or text"
            >
              <Upload className="w-3.5 h-3.5" />
              Import
            </button>
          )}

          <button
            onClick={handleExportCSV}
            className="btn-outline px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 focus-ring"
            title="Export the ranked, filtered list to CSV"
          >
            <Download className="w-3.5 h-3.5" />
            Export
          </button>

          {canManage && (
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="btn-solid px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 focus-ring"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Topic
            </button>
          )}

          {canManage && (
            <button
              onClick={handleSyncExternal}
              disabled={isSyncing}
              className="btn-outline px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 focus-ring"
              title="Pull keywords from your own external keyword tool (configure in Settings)"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              {isSyncing ? 'Syncing…' : 'Sync'}
            </button>
          )}

          <div className="px-2.5 py-1 rounded-lg bg-surface-200 border border-border text-center">
            <div className="text-[9px] uppercase font-mono font-bold text-muted">Available</div>
            <div className="text-xs font-mono font-bold text-foreground">{counts.available.toLocaleString()}</div>
          </div>
          <div className="px-2.5 py-1 rounded-lg bg-surface-200 border border-border text-center">
            <div className="text-[9px] uppercase font-mono font-bold text-warning">In Prod</div>
            <div className="text-xs font-mono font-bold text-warning">{counts.inProduction.toLocaleString()}</div>
          </div>
          <div className="px-2.5 py-1 rounded-lg bg-surface-200 border border-border text-center">
            <div className="text-[9px] uppercase font-mono font-bold text-success">Done</div>
            <div className="text-xs font-mono font-bold text-success">{counts.completed.toLocaleString()}</div>
          </div>
        </div>
      </div>

      {/* Source selector */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {([
          { key: 'starter' as KeywordSource, icon: <Sparkles className="w-4 h-4" />, title: 'Starter List', subtitle: 'Curated high-demand software topics, ready to score & claim.', count: sourceCounts.starter },
          { key: 'own' as KeywordSource, icon: <Database className="w-4 h-4" />, title: 'My Keywords', subtitle: 'Topics you discover, import, or add from your own research.', count: sourceCounts.own },
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
              className={`text-left p-3.5 rounded-xl border transition-all flex items-start gap-3 focus-ring ${
                active ? 'border-foreground/60 bg-surface-200 shadow-subtle' : 'border-border bg-surface-100 hover:bg-surface-200/60 opacity-80 hover:opacity-100'
              }`}
            >
              <div className={`mt-0.5 ${active ? 'text-foreground' : 'text-muted'}`}>{tab.icon}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-bold font-display ${active ? 'text-foreground' : 'text-muted'}`}>{tab.title}</span>
                  <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${active ? 'bg-foreground text-background' : 'bg-surface-200 text-muted border border-border'}`}>
                    {tab.count.toLocaleString()}
                  </span>
                </div>
                <p className="text-[11px] text-muted mt-0.5 truncate">{tab.subtitle}</p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Status filter tabs + presets + bulk bar */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3 bg-surface-100 p-2 rounded-xl border border-border">
        <div className="flex items-center gap-1 overflow-x-auto w-full lg:w-auto">
          {[
            { key: 'ALL', label: 'All', count: counts.total },
            { key: 'NEW', label: 'Available', count: counts.available },
            { key: 'IN_PRODUCTION', label: 'In Production', count: counts.inProduction },
            { key: 'COMPLETED', label: 'Done', count: counts.completed },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => {
                setStatusFilter(tab.key as any);
                setCurrentPage(1);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all whitespace-nowrap focus-ring ${
                statusFilter === tab.key ? 'btn-solid shadow-subtle' : 'text-muted hover:text-foreground hover:bg-surface-200'
              }`}
            >
              <span>{tab.label}</span>
              <span className={`text-[10px] font-mono px-1.5 rounded ${statusFilter === tab.key ? 'bg-background/20 text-background' : 'bg-surface-200 text-muted'}`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* Presets */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <Bookmark className="w-3.5 h-3.5 text-muted" />
          <select
            defaultValue=""
            onChange={e => {
              if (e.target.value) applyPreset(e.target.value);
              e.currentTarget.value = '';
            }}
            className="pro-input text-[11px] rounded-lg px-2 py-1 cursor-pointer font-sans"
            title="Apply a saved filter preset"
          >
            <option value="" disabled>
              {presets.length ? 'Apply preset…' : 'No presets yet'}
            </option>
            {presets.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {presets.length > 0 && (
            <select
              defaultValue=""
              onChange={e => {
                if (e.target.value) handleDeletePreset(e.target.value);
                e.currentTarget.value = '';
              }}
              className="pro-input text-[11px] rounded-lg px-2 py-1 cursor-pointer font-sans"
              title="Delete a saved preset"
            >
              <option value="" disabled>Delete…</option>
              {presets.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
          <button
            onClick={() => setIsPresetModalOpen(true)}
            className="btn-outline px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 focus-ring"
            title="Save the current filters as a preset"
          >
            <Save className="w-3 h-3" /> Save filters
          </button>
        </div>
      </div>

      {/* Bulk actions bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 bg-surface-200 px-3 py-2 rounded-lg border border-border text-xs animate-fadeIn flex-wrap">
          <span className="font-mono text-muted text-[11px] font-bold">{selectedIds.size} selected</span>
          <div className="h-3 w-px bg-border mx-1" />
          {canManage && (
            <button
              onClick={handleScreenSelected}
              disabled={screening.active}
              className="btn-accent px-2.5 py-1 rounded text-[11px] font-semibold flex items-center gap-1 focus-ring disabled:opacity-60"
              title="AI-screen the selected keywords (verdict, content type, angle)"
            >
              {screening.active ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
              {screening.active ? `Screening ${screening.done}/${screening.total}` : 'AI Screen'}
            </button>
          )}
          <button onClick={() => handleBatchStatus('COMPLETED')} className="px-2 py-1 rounded bg-success/10 hover:bg-success/20 text-success font-semibold text-[11px]">
            Mark Done
          </button>
          <button onClick={() => handleBatchStatus('IN_PRODUCTION')} className="px-2 py-1 rounded bg-warning/10 hover:bg-warning/20 text-warning font-semibold text-[11px]">
            Mark In Production
          </button>
          {canManage && (
            <select
              onChange={e => {
                if (e.target.value) handleBatchAssignChannel(e.target.value);
              }}
              defaultValue=""
              className="pro-input text-[11px] rounded px-2 py-0.5 cursor-pointer font-sans"
            >
              <option value="" disabled>Assign Channel…</option>
              {channels.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
          {canManage && (
            <select
              onChange={e => {
                if (e.target.value) {
                  handleBatchAssignVA(e.target.value);
                  e.currentTarget.value = '';
                }
              }}
              defaultValue=""
              className="pro-input text-[11px] rounded px-2 py-0.5 cursor-pointer font-sans"
            >
              <option value="" disabled>Assign to VA…</option>
              <option value="unassigned">— Unassign —</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.name} ({u.role.toUpperCase()})</option>
              ))}
            </select>
          )}
          {canManage && (
            <button onClick={handleBatchDelete} className="px-2 py-1 rounded hover:bg-surface-300 text-danger font-semibold text-[11px] flex items-center gap-1">
              <Trash2 className="w-3 h-3" /> Delete
            </button>
          )}
        </div>
      )}

      {/* Filter bar */}
      <div className="pro-panel p-3 rounded-xl flex flex-col gap-2.5">
        <div className="flex flex-col md:flex-row items-center justify-between gap-2.5">
          <div className="relative w-full md:w-80">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter keywords, topics, software…"
              className="pro-input w-full rounded-lg pl-8 pr-3 py-1.5 text-xs font-sans focus-ring"
            />
            <Search className="w-3.5 h-3.5 text-muted absolute left-2.5 top-2" />
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto justify-end">
            <select value={selectedSoftware} onChange={e => { setSelectedSoftware(e.target.value); setCurrentPage(1); }} className="pro-input text-xs rounded-lg px-2.5 py-1.5 cursor-pointer font-sans">
              <option value="all">All Software ({POPULAR_SOFTWARES.length})</option>
              {POPULAR_SOFTWARES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={selectedChannelFilter} onChange={e => { setSelectedChannelFilter(e.target.value); setCurrentPage(1); }} className="pro-input text-xs rounded-lg px-2.5 py-1.5 cursor-pointer font-sans">
              <option value="all">All Channels</option>
              {channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={assignedFilter} onChange={e => { setAssignedFilter(e.target.value); setCurrentPage(1); }} className="pro-input text-xs rounded-lg px-2.5 py-1.5 cursor-pointer font-sans">
              <option value="all">All Assignees</option>
              <option value="unassigned">Unassigned Only</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
            {activeUser.assignedSoftwares && activeUser.assignedSoftwares.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setMySoftwaresOnly(!mySoftwaresOnly);
                  setCurrentPage(1);
                }}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                  mySoftwaresOnly ? 'btn-accent shadow-subtle' : 'btn-outline text-muted hover:text-foreground'
                }`}
                title={`Filter to your assigned softwares: ${activeUser.assignedSoftwares.join(', ')}`}
              >
                <Sparkles className="w-3 h-3" />
                <span>My Softwares ({activeUser.assignedSoftwares.length})</span>
              </button>
            )}
            <select value={volumeFilter} onChange={e => { setVolumeFilter(e.target.value); setCurrentPage(1); }} className="pro-input text-xs rounded-lg px-2.5 py-1.5 cursor-pointer font-sans">
              <option value="all">All Volumes</option>
              <option value="10k_plus">&gt; 10,000 / mo</option>
              <option value="5k_plus">&gt; 5,000 / mo</option>
              <option value="1k_plus">&gt; 1,000 / mo</option>
              <option value="under_1k">&lt; 1,000 / mo</option>
            </select>
            <select value={competitionFilter} onChange={e => { setCompetitionFilter(e.target.value as any); setCurrentPage(1); }} className="pro-input text-xs rounded-lg px-2.5 py-1.5 cursor-pointer font-sans">
              <option value="all">All Competition</option>
              <option value="Low">Low</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
            </select>
            <select value={verdictFilter} onChange={e => { setVerdictFilter(e.target.value as any); setCurrentPage(1); }} className="pro-input text-xs rounded-lg px-2.5 py-1.5 cursor-pointer font-sans">
              <option value="all">All Verdicts</option>
              <option value="APPROVE">Approved</option>
              <option value="REVIEW">Needs review</option>
              <option value="REJECT">Rejected</option>
            </select>
            <select value={contentTypeFilter} onChange={e => { setContentTypeFilter(e.target.value as any); setCurrentPage(1); }} className="pro-input text-xs rounded-lg px-2.5 py-1.5 cursor-pointer font-sans">
              <option value="all">All Formats</option>
              {CONTENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        {/* Config defaults row */}
        <div className="flex items-center gap-2 flex-wrap text-[10px] text-muted border-t border-border pt-2">
          <span className="uppercase font-mono font-bold">Config defaults</span>
          <span className="badge badge-neutral">min vol {config.keyword.minVolume.toLocaleString()}</span>
          <span className="badge badge-neutral">max comp {maxCompetition}</span>
          <span className="badge badge-neutral">length cap {lengthCap > 0 ? `${lengthCap}m` : 'off'}</span>
          <span className="badge badge-neutral">{allowedTypes.length}/{CONTENT_TYPES.length} formats</span>
          {configDefaultsActive && (
            <button onClick={resetConfigDefaults} className="underline hover:text-foreground">Reset to config</button>
          )}
        </div>
      </div>

      {/* Ranked data table */}
      <div className="pro-panel rounded-xl overflow-hidden shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-foreground">
            <thead className="bg-surface-200/80 text-[10px] uppercase font-mono font-bold text-muted border-b border-border">
              <tr>
                <th className="py-2.5 px-3 w-8 text-center">
                  <button onClick={handleSelectAllOnPage} className="text-muted hover:text-foreground inline-flex items-center justify-center focus-ring">
                    {paginatedKeywords.length > 0 && paginatedKeywords.every(k => selectedIds.has(k.id)) ? <CheckSquare className="w-3.5 h-3.5 text-foreground" /> : <Square className="w-3.5 h-3.5" />}
                  </button>
                </th>
                <th className="py-2.5 px-3">
                  <button onClick={() => toggleSort('score')} className="inline-flex items-center gap-1 hover:text-foreground focus-ring">Score <SortIcon col="score" /></button>
                </th>
                <th className="py-2.5 px-4">
                  <button onClick={() => toggleSort('keyword')} className="inline-flex items-center gap-1 hover:text-foreground focus-ring">Topic / Keyword <SortIcon col="keyword" /></button>
                </th>
                <th className="py-2.5 px-3">Software</th>
                <th className="py-2.5 px-3">
                  <button onClick={() => toggleSort('volume')} className="inline-flex items-center gap-1 hover:text-foreground focus-ring">Vol <SortIcon col="volume" /></button>
                </th>
                <th className="py-2.5 px-3">
                  <button onClick={() => toggleSort('competition')} className="inline-flex items-center gap-1 hover:text-foreground focus-ring">Comp <SortIcon col="competition" /></button>
                </th>
                <th className="py-2.5 px-3">Verdict</th>
                <th className="py-2.5 px-3">Channel</th>
                <th className="py-2.5 px-3">Assignee</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-4 text-right">Route</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {paginatedKeywords.length === 0 ? (
                <tr>
                  <td colSpan={11} className="text-center py-10 text-xs text-muted">
                    {sourceTab === 'own' && sourceCounts.own === 0 ? (
                      <div className="flex flex-col items-center gap-2.5">
                        <Compass className="w-6 h-6 text-muted/60" />
                        <p className="font-semibold text-foreground">Your keyword pool is empty.</p>
                        <p className="max-w-sm">
                          Use <strong>Discover</strong> to fan out from a seed term, <strong>Scrape Channel</strong> to extract ideas from YouTube, <strong>Import CSV</strong> from your research,
                          or <strong>Add Topic</strong> manually. Or work from the <strong>Starter List</strong>.
                        </p>
                        {canManage && (
                          <div className="flex items-center gap-2 mt-1">
                            <button onClick={() => setIsDiscoverOpen(true)} className="btn-accent px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 focus-ring">
                              <Compass className="w-3.5 h-3.5" /> Discover
                            </button>
                            <button onClick={() => setIsScrapeOpen(true)} className="btn-solid px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 focus-ring">
                              <Youtube className="w-3.5 h-3.5 text-danger" /> Scrape Channel
                            </button>
                            <button onClick={() => setSourceTab('starter')} className="btn-outline px-3 py-1.5 rounded-lg text-xs font-semibold focus-ring">Use Starter List</button>
                          </div>
                        )}
                      </div>
                    ) : (
                      'No keywords match the current filters.'
                    )}
                  </td>
                </tr>
              ) : (
                paginatedKeywords.map(row => (
                  <KeywordRow
                    key={row.id}
                    row={row}
                    channels={channels}
                    users={users}
                    canManage={canManage}
                    onAssignVA={handleAssignKeyword}
                    isSelected={selectedIds.has(row.id)}
                    onToggle={() => toggleRow(row.id)}
                    onStatusChange={handleStatusChange}
                    onConveyor={() => handleClaimAndProduceConveyor(row)}
                    onStudio={() => handleClaimAndEnqueueStudio(row)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination footer */}
        <div className="p-3 bg-surface-200/50 border-t border-border flex items-center justify-between text-xs">
          <div className="text-muted font-mono text-[11px]">
            Showing <span className="text-foreground font-bold">{Math.min(rankedKeywords.length, (currentPage - 1) * PAGE_SIZE + 1)}</span> to{' '}
            <span className="text-foreground font-bold">{Math.min(rankedKeywords.length, currentPage * PAGE_SIZE)}</span> of{' '}
            <span className="text-foreground font-bold">{rankedKeywords.length.toLocaleString()}</span> · sorted by {sortKey} {sortDir}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="btn-outline px-2.5 py-1 rounded text-xs disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1 focus-ring">
              <ChevronLeft className="w-3.5 h-3.5" /> Prev
            </button>
            <span className="px-3 font-mono text-[11px] font-bold text-foreground">Page {currentPage} of {totalPages}</span>
            <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages} className="btn-outline px-2.5 py-1 rounded text-xs disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1 focus-ring">
              Next <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Scrape Channel Modal */}
      <Modal
        isOpen={isScrapeOpen}
        onClose={() => setIsScrapeOpen(false)}
        title="Scrape Channel for Keywords"
        subtitle="Extract high-demand tutorial topics from any YouTube channel handle or URL."
        size="xl"
        footer={
          <>
            <span className="text-[11px] text-muted mr-auto">
              {scrapeResult?.ok ? `${scrapeSelected.size}/${scrapeResult.candidates.length} selected` : ''}
            </span>
            <button onClick={() => setIsScrapeOpen(false)} className="btn-outline focus-ring rounded-md px-3.5 py-2 text-sm">Close</button>
            <button
              onClick={handleAddScraped}
              disabled={!scrapeResult?.ok || scrapeSelected.size === 0}
              className="btn-accent focus-ring rounded-md px-3.5 py-2 text-sm font-semibold disabled:opacity-50"
            >
              Import {scrapeSelected.size || ''} to My Keywords
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              autoFocus
              value={scrapeChannelInput}
              onChange={e => setScrapeChannelInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !scraping) handleScrapeChannel(); }}
              placeholder="e.g. @guiderealmvideos or https://youtube.com/@LearnSkillsDaily"
              className="pro-input flex-1 rounded-lg px-3 py-2 text-sm focus-ring font-mono"
            />
            <button onClick={handleScrapeChannel} disabled={scraping || !scrapeChannelInput.trim()} className="btn-accent rounded-lg px-4 py-2 text-sm font-semibold flex items-center justify-center gap-2 focus-ring disabled:opacity-50">
              {scraping ? <Loader2 className="w-4 h-4 animate-spin" /> : <Youtube className="w-4 h-4" />}
              {scraping ? 'Scraping…' : 'Scrape Channel'}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Assign software to discovered topics">
              <TextInput value={scrapeSoftware} onChange={e => setScrapeSoftware(e.target.value)} placeholder="e.g. Excel, Notion, Photoshop" />
            </Field>
            <Field label="Assign target channel">
              <Select value={scrapeTargetChannel} onChange={e => setScrapeTargetChannel(e.target.value)}>
                {channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
          </div>

          {scrapeResult && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-mono text-muted">
                <span>{scrapeResult.candidates.length} topics extracted</span>
                <div className="flex gap-2">
                  <button onClick={() => setScrapeSelected(new Set(scrapeResult.candidates.map(c => c.keyword)))} className="underline hover:text-foreground">Select All</button>
                  <button onClick={() => setScrapeSelected(new Set())} className="underline hover:text-foreground">Deselect All</button>
                </div>
              </div>
              <div className="max-h-72 overflow-y-auto border border-border rounded-lg divide-y divide-border bg-surface-200/40">
                {scrapeResult.candidates.map(cand => {
                  const isChecked = scrapeSelected.has(cand.keyword);
                  return (
                    <label key={cand.keyword} className="flex items-center justify-between p-2.5 hover:bg-surface-200 cursor-pointer text-xs">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {
                            const next = new Set(scrapeSelected);
                            if (next.has(cand.keyword)) next.delete(cand.keyword);
                            else next.add(cand.keyword);
                            setScrapeSelected(next);
                          }}
                          className="rounded accent-foreground"
                        />
                        <span className="font-medium text-foreground">{cand.keyword}</span>
                      </div>
                      <div className="flex items-center gap-2 font-mono text-[11px] text-muted">
                        <span>{cand.volumeEstimate.toLocaleString()} vol</span>
                        <span className={`badge ${cand.competitionEstimate === 'Low' ? 'badge-success' : cand.competitionEstimate === 'Medium' ? 'badge-warning' : 'badge-danger'}`}>
                          {cand.competitionEstimate}
                        </span>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* ---- Discover Modal ---- */}
      <Modal
        isOpen={isDiscoverOpen}
        onClose={() => setIsDiscoverOpen(false)}
        title="Discover keywords"
        subtitle="Fan a seed term out into real autocomplete queries from Google & YouTube."
        size="xl"
        footer={
          <>
            <span className="text-[11px] text-muted mr-auto">
              {discoverResult?.ok ? `${discoverSelected.size}/${discoverResult.candidates.length} selected` : ''}
            </span>
            <button onClick={() => setIsDiscoverOpen(false)} className="btn-outline focus-ring rounded-md px-3.5 py-2 text-sm">Close</button>
            <button
              onClick={handleAddDiscovered}
              disabled={!discoverResult?.ok || discoverSelected.size === 0}
              className="btn-accent focus-ring rounded-md px-3.5 py-2 text-sm font-semibold disabled:opacity-50"
            >
              Add {discoverSelected.size || ''} to My Keywords
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              autoFocus
              value={seed}
              onChange={e => setSeed(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !discovering) handleDiscover(); }}
              placeholder="Seed term, e.g. “notion database” or “excel vlookup”"
              className="pro-input flex-1 rounded-lg px-3 py-2 text-sm focus-ring"
            />
            <button onClick={handleDiscover} disabled={discovering || !seed.trim()} className="btn-accent rounded-lg px-4 py-2 text-sm font-semibold flex items-center justify-center gap-2 focus-ring disabled:opacity-50">
              {discovering ? <Loader2 className="w-4 h-4 animate-spin" /> : <Compass className="w-4 h-4" />}
              {discovering ? 'Discovering…' : 'Discover'}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <Toggle checked={discoverOpts.modifiers} onChange={v => setDiscoverOpts(o => ({ ...o, modifiers: v }))} label="Modifier permutations" />
            <Toggle checked={discoverOpts.alphabet} onChange={v => setDiscoverOpts(o => ({ ...o, alphabet: v }))} label="Alphabet soup (a–z)" />
            <Toggle checked={discoverOpts.youtube} onChange={v => setDiscoverOpts(o => ({ ...o, youtube: v }))} label="Include YouTube" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Assign software to added keywords">
              <TextInput value={discoverSoftware} onChange={e => setDiscoverSoftware(e.target.value)} placeholder="e.g. Notion" />
            </Field>
            <Field label="Target channel">
              <Select value={discoverChannel} onChange={e => setDiscoverChannel(e.target.value)}>
                {channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
          </div>

          <div className="flex items-start gap-2 text-[11px] text-muted bg-surface-200/60 border border-border rounded-lg p-2.5">
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-info" />
            <span>
              The keyword phrasings are real autocomplete data. <strong>Volume &amp; competition are heuristic estimates</strong> (broader
              phrases banded higher), not live search-metric API data — treat them as directional only.
            </span>
          </div>

          {discoverResult && !discoverResult.ok && (
            <div className="flex items-center gap-2 text-xs text-danger bg-danger/10 border border-danger/20 rounded-lg p-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {discoverResult.error}
            </div>
          )}

          {discoverResult?.ok && discoverResult.candidates.length > 0 && (
            <div className="border border-border rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 bg-surface-200/60 text-[11px] text-muted">
                <span>{discoverResult.candidates.length} candidates · {discoverResult.succeededQueries}/{discoverResult.attemptedQueries} queries returned data</span>
                <div className="flex gap-2">
                  <button onClick={() => setDiscoverSelected(new Set(discoverResult.candidates.map(c => c.keyword)))} className="underline hover:text-foreground">Select all</button>
                  <button onClick={() => setDiscoverSelected(new Set())} className="underline hover:text-foreground">None</button>
                </div>
              </div>
              <div className="max-h-72 overflow-y-auto divide-y divide-border">
                {discoverResult.candidates.map((c: SuggestCandidate) => {
                  const checked = discoverSelected.has(c.keyword);
                  return (
                    <button
                      key={c.keyword}
                      onClick={() => toggleDiscoverRow(c.keyword)}
                      className={`w-full text-left px-3 py-2 flex items-center gap-3 hover:bg-surface-200/50 focus-ring ${checked ? 'bg-surface-200/40' : ''}`}
                    >
                      {checked ? <CheckSquare className="w-3.5 h-3.5 text-accent shrink-0" /> : <Square className="w-3.5 h-3.5 text-muted shrink-0" />}
                      <span className="flex-1 text-xs text-foreground truncate">{c.keyword}</span>
                      <span className="badge badge-neutral shrink-0">{c.engine}</span>
                      <span className="badge badge-accent shrink-0">{c.band}</span>
                      <span className="font-mono text-[10px] text-muted shrink-0 w-20 text-right">~{c.volumeEstimate.toLocaleString()}<span className="opacity-60"> est</span></span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* ---- Add Topic Modal ---- */}
      <Modal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        title="Add tutorial topic"
        size="md"
        footer={
          <>
            <button onClick={() => setIsAddModalOpen(false)} className="btn-outline focus-ring rounded-md px-3.5 py-2 text-sm">Cancel</button>
            <button onClick={handleAddCustomKeyword} disabled={!newKeywordText.trim()} className="btn-accent focus-ring rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-50">Save topic</button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Topic / keyword title">
            <TextInput value={newKeywordText} onChange={e => setNewKeywordText(e.target.value)} placeholder="e.g. How to build an automated sales pipeline in HubSpot" />
          </Field>
          <Field label="Software">
            <TextInput value={newSoftware} onChange={e => setNewSoftware(e.target.value)} placeholder="e.g. HubSpot, Excel, Notion" />
          </Field>
          <Field label="Target channel">
            <Select value={newTargetChannelId} onChange={e => setNewTargetChannelId(e.target.value)}>
              {channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
        </div>
      </Modal>

      {/* ---- Import CSV Modal ---- */}
      <Modal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        title="Ingest CSV keywords"
        size="lg"
        footer={
          <>
            <button onClick={() => setIsImportModalOpen(false)} className="btn-outline focus-ring rounded-md px-3.5 py-2 text-sm">Cancel</button>
            <button onClick={handleImportCSV} disabled={!csvText.trim()} className="btn-accent focus-ring rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-50">Import keywords</button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-xs text-muted">
            Paste rows exported from Ahrefs, Semrush, or Google Sheets.
            <br />
            <span className="font-mono text-[10px]">Format: Keyword, Software, Volume, Competition, ChannelID</span>
          </p>
          <label className="btn-outline w-full py-2.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer border-dashed focus-ring">
            <Upload className="w-4 h-4 text-muted" /> Select .csv file from disk
            <input
              type="file"
              accept=".csv,.tsv,.txt"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = evt => setCsvText(evt.target?.result as string);
                reader.readAsText(file);
              }}
            />
          </label>
          <textarea
            rows={6}
            value={csvText}
            onChange={e => setCsvText(e.target.value)}
            placeholder="How to use VLOOKUP in Excel,Excel,14000,Low,skool"
            className="pro-input w-full rounded-lg p-3 text-xs font-mono resize-y leading-relaxed focus-ring"
          />
          {importStats && (
            <div className="p-2.5 rounded-lg bg-success/10 text-success border border-success/20 text-xs font-mono">
              Imported {importStats.added} new keyword(s) · {importStats.skipped} duplicate(s) skipped.
            </div>
          )}
        </div>
      </Modal>

      {/* ---- Save Preset Modal ---- */}
      <Modal
        isOpen={isPresetModalOpen}
        onClose={() => setIsPresetModalOpen(false)}
        title="Save filter preset"
        size="sm"
        footer={
          <>
            <button onClick={() => setIsPresetModalOpen(false)} className="btn-outline focus-ring rounded-md px-3.5 py-2 text-sm">Cancel</button>
            <button onClick={handleSavePreset} disabled={!presetName.trim()} className="btn-accent focus-ring rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-50">Save preset</button>
          </>
        }
      >
        <Field label="Preset name" hint="Captures the current search, dropdown filters, and sort.">
          <TextInput autoFocus value={presetName} onChange={e => setPresetName(e.target.value)} placeholder="e.g. High-volume Excel, low comp" onKeyDown={e => { if (e.key === 'Enter') handleSavePreset(); }} />
        </Field>
      </Modal>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Row (kept as a small component so screen-meta lookups stay cheap per row)
// ---------------------------------------------------------------------------
const KeywordRow: React.FC<{
  row: ScoredKeyword;
  channels: Channel[];
  users: VAUser[];
  canManage: boolean;
  isSelected: boolean;
  onToggle: () => void;
  onStatusChange: (id: string, s: 'NEW' | 'IN_PRODUCTION' | 'COMPLETED') => void;
  onAssignVA: (id: string, userId: string) => void;
  onConveyor: () => void;
  onStudio: () => void;
}> = ({ row, channels, users, canManage, isSelected, onToggle, onStatusChange, onAssignVA, onConveyor, onStudio }) => {
  const ch = channels.find(c => c.id === row.targetChannelId);
  const isDone = row.status === 'COMPLETED';
  const isInProd = row.status === 'IN_PRODUCTION' || row.status === 'CLAIMED';
  const meta = KeywordService.getScreenMetaFor(row.id);

  const scoreColor = row.score >= 70 ? 'text-success' : row.score >= 45 ? 'text-warning' : 'text-muted';

  return (
    <tr className={`hover:bg-surface-200/40 transition-colors ${isSelected ? 'bg-surface-200/60' : ''}`}>
      <td className="py-2.5 px-3 text-center">
        <button onClick={onToggle} className="text-muted hover:text-foreground inline-flex items-center justify-center focus-ring">
          {isSelected ? <CheckSquare className="w-3.5 h-3.5 text-foreground" /> : <Square className="w-3.5 h-3.5" />}
        </button>
      </td>

      <td className="py-2.5 px-3">
        <div className="flex items-center gap-2">
          <div className="w-9 h-1.5 rounded-full bg-surface-300 overflow-hidden">
            <div className="h-full bg-accent" style={{ width: `${row.score}%` }} />
          </div>
          <span className={`font-mono font-bold text-[11px] ${scoreColor}`}>{row.score}</span>
        </div>
      </td>

      <td className="py-2.5 px-4 font-medium text-foreground max-w-sm">
        <div className={isDone ? 'line-through text-muted' : 'text-foreground font-semibold'}>{row.keyword}</div>
        {meta?.angle && <div className="text-[10px] text-muted mt-0.5 truncate italic">{meta.angle}</div>}
      </td>

      <td className="py-2.5 px-3">
        <span className="px-1.5 py-0.5 rounded bg-surface-200 text-[10px] font-mono text-foreground border border-border">{row.software}</span>
      </td>

      <td className="py-2.5 px-3 font-mono font-semibold text-foreground text-[11px]">{row.volume.toLocaleString()}</td>

      <td className="py-2.5 px-3">
        <span className={`badge ${row.competition === 'Low' ? 'badge-success' : row.competition === 'Medium' ? 'badge-warning' : 'badge-danger'}`}>{row.competition}</span>
      </td>

      <td className="py-2.5 px-3">
        <span className={`badge ${VERDICT_BADGE[row.screenVerdict]}`}>{row.screenVerdict}</span>
      </td>

      <td className="py-2.5 px-3">
        {ch ? (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-surface-200 text-foreground border border-border">{ch.name}</span>
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>

      <td className="py-2.5 px-3">
        {canManage ? (
          <select
            value={row.assignedTo || (row.claimedBy ? users.find(u => u.name === row.claimedBy || u.id === row.claimedBy)?.id || 'unassigned' : 'unassigned')}
            onChange={e => onAssignVA(row.id, e.target.value)}
            className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-border bg-surface-200 text-foreground cursor-pointer focus-ring"
            title="Assign to specific VA"
          >
            <option value="unassigned">— Unassigned —</option>
            {users.map(u => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        ) : row.assignedToName || row.assignedTo || row.claimedBy ? (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-accent/10 text-accent border border-accent/20">
            {row.assignedToName || users.find(u => u.id === row.assignedTo || u.id === row.claimedBy)?.name || row.claimedBy || row.assignedTo}
          </span>
        ) : (
          <span className="text-muted text-[10px] font-mono">—</span>
        )}
      </td>

      <td className="py-2.5 px-3">
        <select
          value={row.status === 'CLAIMED' ? 'IN_PRODUCTION' : row.status === 'REJECTED' ? 'NEW' : row.status}
          onChange={e => onStatusChange(row.id, e.target.value as any)}
          className={`text-[10px] font-mono font-bold px-2 py-1 rounded border cursor-pointer focus-ring ${
            isDone ? 'bg-success/10 text-success border-success/30' : isInProd ? 'bg-warning/10 text-warning border-warning/30' : 'bg-surface-200 text-foreground border-border'
          }`}
        >
          <option value="NEW">Available</option>
          <option value="IN_PRODUCTION">In Production</option>
          <option value="COMPLETED">Done</option>
        </select>
      </td>

      <td className="py-2.5 px-4 text-right">
        <div className="inline-flex items-center gap-1.5 justify-end">
          {isDone ? (
            <button onClick={() => onStatusChange(row.id, 'NEW')} className="text-muted hover:text-foreground text-[10px] font-mono underline px-1 focus-ring" title="Reset status">Reset</button>
          ) : (
            <>
              <button onClick={onConveyor} className="btn-solid px-2.5 py-1 rounded text-[11px] inline-flex items-center gap-1 font-semibold focus-ring" title="Produce in Creator Conveyor">
                <Send className="w-2.5 h-2.5" /> Conveyor
              </button>
              <button onClick={onStudio} className="btn-outline px-2.5 py-1 rounded text-[11px] inline-flex items-center gap-1 font-semibold focus-ring" title="Enqueue to Studio pipeline">
                <Sliders className="w-2.5 h-2.5" /> Studio
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
};
