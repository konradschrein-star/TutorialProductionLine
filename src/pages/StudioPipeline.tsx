import React, { useState } from 'react';
import { Sliders, Plus, Search, Sparkles } from 'lucide-react';
import { StandaloneStudio } from '../components/studio';
import { StorageService } from '../services/storageService';
import { AIService } from '../services/aiService';
import { StudioJob, StudioJobStatus } from '../types';
import { useStudioJobs, useChannels } from '../hooks/useStore';
import { useToast } from '../components/ui/Feedback';
import { Modal } from '../components/ui/Modal';
import { Field, TextInput, Select } from '../components/ui/Form';

const TERMINAL: StudioJobStatus[] = ['COMPLETED', 'CANCELLED', 'FAILED_SCRIPT', 'FAILED_AUDIO', 'FAILED_SPLICE'];

export const StudioPipeline: React.FC = () => {
  const jobs = useStudioJobs();
  const channels = useChannels();
  const toast = useToast();
  const [selectedChannel, setSelectedChannel] = useState<string>('all');
  const [search, setSearch] = useState<string>('');

  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [newTopic, setNewTopic] = useState<string>('');
  const [newTitle, setNewTitle] = useState<string>('');
  const [newChannelId, setNewChannelId] = useState<string>(channels[0]?.id || 'virtualfd');
  const [newScript, setNewScript] = useState<string>('');
  const [isGeneratingScript, setIsGeneratingScript] = useState<boolean>(false);

  const handleGenerateScriptForNewJob = async () => {
    if (!newTopic.trim()) {
      toast('Please enter a topic first.', 'warning');
      return;
    }
    setIsGeneratingScript(true);
    try {
      const generated = await AIService.generateScript(newTopic, '', 'standard');
      setNewScript(generated);
      if (!newTitle.trim()) setNewTitle(`How to ${newTopic.replace(/^how to\s+/i, '')}`);
    } catch (e: any) {
      toast('Failed to generate script: ' + e.message, 'error');
    } finally {
      setIsGeneratingScript(false);
    }
  };

  const handleCreateJob = () => {
    if (!newTopic.trim() || !newScript.trim()) {
      toast('Please provide a topic and script.', 'warning');
      return;
    }
    const ch = channels.find((c) => c.id === newChannelId) || channels[0];
    const newJob: StudioJob = {
      id: `job_${Date.now()}`,
      title: newTitle || `How to ${newTopic}`,
      topic: newTopic,
      channelId: ch.id,
      channelName: ch.name,
      status: 'QUEUED',
      script: newScript,
      voiceId: ch.defaultVoiceId || 'fish-paul-neutral',
      voiceSpeed: StorageService.getConfig().defaultSpeed,
      deliveredToDrive: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    StorageService.saveStudioJob(newJob);
    setIsModalOpen(false);
    setNewTopic('');
    setNewTitle('');
    setNewScript('');
    toast('Studio job enqueued.', 'success');
  };

  const filtered = jobs.filter((j) => {
    if (selectedChannel !== 'all' && j.channelId !== selectedChannel) return false;
    if (search && !j.title.toLowerCase().includes(search.toLowerCase()) && !j.topic.toLowerCase().includes(search.toLowerCase()))
      return false;
    return true;
  });

  const activeCount = jobs.filter((j) => !TERMINAL.includes(j.status)).length;
  const totalDelivered = jobs.filter((j) => j.deliveredToDrive).length;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-4 animate-fadeIn">
      {/* Header */}
      <div className="pro-panel p-4 rounded-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <Sliders className="w-4 h-4 text-foreground" />
            <h1 className="text-sm font-bold font-display text-foreground">Studio Production Pipeline</h1>
            <span className="badge badge-neutral font-mono">{activeCount} active</span>
          </div>
          <p className="text-[11px] text-muted mt-0.5">
            Async assembly: in-place scriptwriting, neural voice synthesis, take ingest, and Google Drive delivery.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="px-2.5 py-1 rounded-lg bg-surface-200 border border-border text-center">
            <div className="text-[9px] uppercase font-mono font-bold text-success">In Drive</div>
            <div className="text-xs font-mono font-bold text-success">{totalDelivered}</div>
          </div>
          <button
            onClick={() => setIsModalOpen(true)}
            className="btn-accent focus-ring px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" /> Create Studio Job
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="pro-panel p-3 rounded-xl flex flex-col md:flex-row items-center justify-between gap-2.5">
        <div className="relative w-full md:w-80">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search studio jobs, topics…"
            className="pro-input focus-ring w-full rounded-lg pl-8 pr-3 py-1.5 text-xs"
          />
          <Search className="w-3.5 h-3.5 text-muted absolute left-2.5 top-2" />
        </div>
        <div className="flex items-center gap-2 w-full md:w-auto justify-end">
          <select
            value={selectedChannel}
            onChange={(e) => setSelectedChannel(e.target.value)}
            className="pro-input focus-ring text-xs rounded-lg px-2.5 py-1.5 cursor-pointer"
          >
            <option value="all">All channels ({channels.length})</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Pipeline */}
      <StandaloneStudio jobs={filtered} onJobUpdate={() => {}} activeChannelFilter={selectedChannel} />

      {/* Create job modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Create new studio job"
        size="lg"
        footer={
          <>
            <button onClick={() => setIsModalOpen(false)} className="btn-outline focus-ring rounded-md px-3.5 py-2 text-sm">
              Cancel
            </button>
            <button onClick={handleCreateJob} className="btn-accent focus-ring rounded-md px-4 py-2 text-sm font-semibold">
              Enqueue job
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Target channel">
            <Select value={newChannelId} onChange={(e) => setNewChannelId(e.target.value)}>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.niche})
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Tutorial topic / software feature">
            <div className="flex items-center gap-2">
              <TextInput
                value={newTopic}
                onChange={(e) => setNewTopic(e.target.value)}
                placeholder="e.g. Automate Customer Invoices in QuickBooks Online"
                className="flex-1"
              />
              <button
                disabled={isGeneratingScript}
                onClick={handleGenerateScriptForNewJob}
                className="btn-outline focus-ring px-3 py-2 rounded-md text-xs font-semibold flex items-center gap-1 flex-shrink-0"
              >
                <Sparkles className="w-3.5 h-3.5" />
                {isGeneratingScript ? 'Writing…' : 'AI Script'}
              </button>
            </div>
          </Field>

          <Field label="Video display title">
            <TextInput value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="How to … (2026 Tutorial)" />
          </Field>

          <Field label="Tutorial narration script">
            <textarea
              rows={6}
              value={newScript}
              onChange={(e) => setNewScript(e.target.value)}
              placeholder="Paste or write the step-by-step tutorial script here…"
              className="pro-input focus-ring w-full rounded-md p-3 text-xs font-mono resize-y leading-relaxed"
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
};
