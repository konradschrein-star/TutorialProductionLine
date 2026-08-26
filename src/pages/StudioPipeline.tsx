import React, { useState } from 'react';
import { 
  Sliders, 
  Plus, 
  Search, 
  Filter, 
  Tv, 
  RefreshCw, 
  X, 
  Sparkles, 
  FolderCheck,
  Play
} from 'lucide-react';
import { StandaloneStudio } from '../components/studio';
import { StorageService } from '../services/storageService';
import { AIService } from '../services/aiService';
import { StudioJob, Channel } from '../types';

export const StudioPipeline: React.FC = () => {
  const [jobs, setJobs] = useState<StudioJob[]>(() => StorageService.getStudioJobs());
  const channels = StorageService.getChannels();
  const [selectedChannel, setSelectedChannel] = useState<string>('all');
  const [search, setSearch] = useState<string>('');
  
  // New Job Modal State
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [newTopic, setNewTopic] = useState<string>('');
  const [newTitle, setNewTitle] = useState<string>('');
  const [newChannelId, setNewChannelId] = useState<string>(channels[0]?.id || 'virtualfd');
  const [newScript, setNewScript] = useState<string>('');
  const [isGeneratingScript, setIsGeneratingScript] = useState<boolean>(false);

  const refreshJobs = () => {
    setJobs(StorageService.getStudioJobs());
  };

  const handleGenerateScriptForNewJob = async () => {
    if (!newTopic.trim()) {
      alert('Please enter a topic first.');
      return;
    }
    setIsGeneratingScript(true);
    try {
      const generated = await AIService.generateScript(newTopic, '', 'standard');
      setNewScript(generated);
      if (!newTitle.trim()) {
        setNewTitle(`How to ${newTopic.replace(/^how to\s+/i, '')}`);
      }
    } catch (e: any) {
      alert('Failed to generate script: ' + e.message);
    } finally {
      setIsGeneratingScript(false);
    }
  };

  const handleCreateJob = () => {
    if (!newTopic.trim() || !newScript.trim()) {
      alert('Please provide a topic and script.');
      return;
    }

    const ch = channels.find(c => c.id === newChannelId) || channels[0];
    const newJob: StudioJob = {
      id: `job_${Date.now()}`,
      title: newTitle || `How to ${newTopic}`,
      topic: newTopic,
      channelId: ch.id,
      channelName: ch.name,
      status: 'QUEUED',
      script: newScript,
      voiceId: ch.defaultVoiceId || 'fish-paul-neutral',
      voiceSpeed: 1.15,
      deliveredToDrive: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    StorageService.saveStudioJob(newJob);
    refreshJobs();
    setIsModalOpen(false);
    setNewTopic('');
    setNewTitle('');
    setNewScript('');
  };

  const filtered = jobs.filter(j => {
    if (selectedChannel !== 'all' && j.channelId !== selectedChannel) return false;
    if (search && !j.title.toLowerCase().includes(search.toLowerCase()) && !j.topic.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const totalDelivered = jobs.filter(j => j.deliveredToDrive).length;
  const totalCompleted = jobs.filter(j => j.status === 'COMPLETED').length;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-4 animate-fadeIn">
      
      {/* Header Bar */}
      <div className="pro-panel p-4 rounded-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-foreground" />
            <h1 className="text-sm font-bold font-display text-foreground">
              Studio Production Pipeline
            </h1>
            <span className="px-2 py-0.5 rounded font-mono text-[10px] font-bold bg-surface-200 text-foreground border border-border">
              {jobs.length} Jobs Active
            </span>
          </div>
          <p className="text-[11px] text-muted mt-0.5">
            Standalone assembly pipeline: in-place scriptwriting, neural voice synthesis, take ingest, and automatic Google Drive delivery.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="px-2.5 py-1 rounded-lg bg-surface-200 border border-border text-center">
            <div className="text-[9px] uppercase font-mono font-bold text-emerald-500">In Drive</div>
            <div className="text-xs font-mono font-bold text-emerald-500">{totalDelivered}</div>
          </div>

          <button
            onClick={() => setIsModalOpen(true)}
            className="btn-solid px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            Create Studio Job
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="pro-panel p-3 rounded-xl flex flex-col md:flex-row items-center justify-between gap-2.5">
        <div className="relative w-full md:w-80">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search studio jobs, topics..."
            className="pro-input w-full rounded-lg pl-8 pr-3 py-1.5 text-xs font-sans"
          />
          <Search className="w-3.5 h-3.5 text-muted absolute left-2.5 top-2" />
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto justify-end">
          <select
            value={selectedChannel}
            onChange={(e) => setSelectedChannel(e.target.value)}
            className="pro-input text-xs rounded-lg px-2.5 py-1.5 cursor-pointer font-sans"
          >
            <option value="all">All Channels ({channels.length})</option>
            {channels.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>

          <button
            onClick={refreshJobs}
            className="btn-outline p-1.5 rounded-lg text-xs"
            title="Refresh jobs"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Pipeline Component */}
      <StandaloneStudio
        jobs={filtered}
        onJobUpdate={refreshJobs}
        activeChannelFilter={selectedChannel}
      />

      {/* Create New Studio Job Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface-100 border border-border rounded-xl max-w-xl w-full p-5 space-y-4 shadow-elevation animate-fadeIn">
            
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-foreground font-display flex items-center gap-1.5">
                <Sliders className="w-4 h-4" /> Create New Studio Job
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1 rounded hover:bg-surface-200 text-muted hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  Target Channel
                </label>
                <select
                  value={newChannelId}
                  onChange={(e) => setNewChannelId(e.target.value)}
                  className="pro-input w-full rounded-lg px-3 py-2 text-xs"
                >
                  {channels.map(c => (
                    <option key={c.id} value={c.id}>{c.name} ({c.niche})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  Tutorial Topic / Software Feature
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newTopic}
                    onChange={(e) => setNewTopic(e.target.value)}
                    placeholder="e.g. Automate Customer Invoices in QuickBooks Online"
                    className="pro-input flex-1 rounded-lg px-3 py-2 text-xs"
                  />
                  <button
                    disabled={isGeneratingScript}
                    onClick={handleGenerateScriptForNewJob}
                    className="btn-outline px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-1 flex-shrink-0"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    {isGeneratingScript ? 'Writing...' : 'AI Script'}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  Video Display Title
                </label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. How to Automate Invoices in QuickBooks Online (2026 Tutorial)"
                  className="pro-input w-full rounded-lg px-3 py-2 text-xs font-semibold"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  Tutorial Narration Script
                </label>
                <textarea
                  rows={6}
                  value={newScript}
                  onChange={(e) => setNewScript(e.target.value)}
                  placeholder="Paste or write the step-by-step tutorial script here..."
                  className="pro-input w-full rounded-lg p-3 text-xs font-mono resize-y leading-relaxed"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <button
                onClick={() => setIsModalOpen(false)}
                className="btn-outline px-3 py-1.5 rounded-lg text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateJob}
                className="btn-solid px-4 py-1.5 rounded-lg text-xs font-bold"
              >
                Enqueue Studio Job
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};
