import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Key,
  Check,
  Save,
  Tv,
  RefreshCw,
  Server,
  Shield,
  Download,
  Upload,
  FolderCheck,
  HardDrive,
  Plus,
  Trash2,
  Edit2,
  UserCircle,
  ExternalLink,
  Users,
  ShieldCheck,
  UserCheck,
  Eye,
  EyeOff,
  Lock,
} from 'lucide-react';
import { StorageService } from '../services/storageService';
import { GoogleDriveService } from '../services/googleDriveService';
import { Channel, GoogleDriveConfig, VAUser } from '../types';
import { useChannels, useUsers, useActiveUser } from '../hooks/useStore';
import { useRole } from '../context/RoleContext';
import { useToast, useConfirm } from '../components/ui/Feedback';
import { Modal } from '../components/ui/Modal';

const SERVER_URL_KEY = 'server_url';
const DEFAULT_SERVER_URL = 'http://localhost:3001';

// --- Small reusable secret input with a show/hide toggle ----------------------
const SecretInput: React.FC<{
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  id?: string;
}> = ({ value, onChange, placeholder, id }) => {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pro-input w-full rounded-lg px-3 py-2 pr-10 text-xs font-mono"
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-foreground focus-ring rounded p-0.5"
        aria-label={show ? 'Hide value' : 'Show value'}
        title={show ? 'Hide' : 'Show'}
      >
        {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
};

// --- Note shown in place of a section the current role may not access ---------
const LockedNote: React.FC<{ id: string; title: string; note: string }> = ({ id, title, note }) => (
  <div id={id} className="pro-panel p-4 rounded-xl scroll-mt-28 opacity-80">
    <div className="flex items-center gap-2">
      <Lock className="w-4 h-4 text-muted" />
      <h3 className="text-xs font-bold font-mono text-foreground uppercase tracking-wider">{title}</h3>
      <span className="badge badge-neutral">Restricted</span>
    </div>
    <p className="text-xs text-muted mt-2">{note}</p>
  </div>
);

const roleBadgeClass = (role: string) =>
  role === 'admin'
    ? 'badge-accent'
    : role === 'manager'
      ? 'badge-info'
      : role === 'va'
        ? 'badge-success'
        : 'badge-neutral';

export const Settings: React.FC = () => {
  const { can } = useRole();
  const toast = useToast();
  const confirm = useConfirm();

  const canTeam = can('manageTeam');
  const canChannels = can('manageChannels');
  const canKeys = can('manageApiKeys');
  const canReset = can('factoryReset');

  // Reactive domain data (updates live when the store changes here or elsewhere)
  const channels = useChannels();
  const users = useUsers();
  const activeUser = useActiveUser();

  // --- Edit buffers (persisted on Save) --------------------------------------
  const [geminiKey, setGeminiKey] = useState<string>(() => StorageService.getApiKey('gemini'));
  const [groqKey, setGroqKey] = useState<string>(() => StorageService.getApiKey('groq'));
  const [deepseekKey, setDeepseekKey] = useState<string>(() => StorageService.getApiKey('deepseek'));
  const [elevenKey, setElevenKey] = useState<string>(() => StorageService.getApiKey('elevenlabs'));
  const [fishKey, setFishKey] = useState<string>(() => StorageService.getApiKey('fishaudio'));
  const [openAiKey, setOpenAiKey] = useState<string>(() => StorageService.getApiKey('openai'));

  const [serverUrl, setServerUrl] = useState<string>(() =>
    StorageService.get<string>(SERVER_URL_KEY, DEFAULT_SERVER_URL)
  );
  const [externalKeywordApi, setExternalKeywordApi] = useState<string>(() =>
    StorageService.getExternalKeywordApi()
  );

  const [driveConfig, setDriveConfig] = useState<GoogleDriveConfig>(() =>
    StorageService.getGoogleDriveConfig()
  );

  // --- Modals ----------------------------------------------------------------
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null);
  const [isChannelModalOpen, setIsChannelModalOpen] = useState<boolean>(false);
  const [editingUser, setEditingUser] = useState<VAUser | null>(null);
  const [isUserModalOpen, setIsUserModalOpen] = useState<boolean>(false);

  // --- Status & pings --------------------------------------------------------
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);
  const [testingService, setTestingService] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string }>>({});

  // --- Save (only persists what the current role is allowed to touch) --------
  const handleSaveAll = () => {
    if (canKeys) {
      StorageService.setApiKey('gemini', geminiKey);
      StorageService.setApiKey('groq', groqKey);
      StorageService.setApiKey('deepseek', deepseekKey);
      StorageService.setApiKey('elevenlabs', elevenKey);
      StorageService.setApiKey('fishaudio', fishKey);
      StorageService.setApiKey('openai', openAiKey);
      StorageService.setGoogleDriveConfig(driveConfig);
    }
    StorageService.set(SERVER_URL_KEY, serverUrl);
    StorageService.setExternalKeywordApi(externalKeywordApi);

    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2000);
    toast('Configuration saved.', 'success', 'Settings');
  };

  // --- Connection tests ------------------------------------------------------
  const handleTestGemini = async () => {
    setTestingService('gemini');
    if (!geminiKey.trim()) {
      setTestResults((prev) => ({ ...prev, gemini: { ok: false, message: 'No API Key Entered' } }));
      setTestingService(null);
      return;
    }
    try {
      const start = Date.now();
      const isVertexExpress = geminiKey.trim().startsWith('AQ.');
      const testUrl = isVertexExpress
        ? `https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-2.5-flash:countTokens?key=${encodeURIComponent(geminiKey.trim())}`
        : `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(geminiKey.trim())}`;
      const res = await fetch(testUrl, {
        method: isVertexExpress ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json' },
        ...(isVertexExpress
          ? { body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'ping' }] }] }) }
          : {}),
      });
      const latency = Date.now() - start;
      if (res.ok) {
        setTestResults((prev) => ({
          ...prev,
          gemini: { ok: true, message: `Connected (${isVertexExpress ? 'Vertex Express' : 'AI Studio'} ${latency}ms)` },
        }));
      } else {
        setTestResults((prev) => ({ ...prev, gemini: { ok: false, message: `Auth Failed (${res.status})` } }));
      }
    } catch (e: any) {
      setTestResults((prev) => ({ ...prev, gemini: { ok: false, message: e.message } }));
    } finally {
      setTestingService(null);
    }
  };

  const handleTestGroq = async () => {
    setTestingService('groq');
    if (!groqKey.trim()) {
      setTestResults((prev) => ({ ...prev, groq: { ok: false, message: 'No API Key Entered' } }));
      setTestingService(null);
      return;
    }
    try {
      const start = Date.now();
      const res = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${groqKey}` },
      });
      const latency = Date.now() - start;
      if (res.ok) {
        setTestResults((prev) => ({ ...prev, groq: { ok: true, message: `Connected (${latency}ms)` } }));
      } else {
        setTestResults((prev) => ({ ...prev, groq: { ok: false, message: `Auth Failed (${res.status})` } }));
      }
    } catch (e: any) {
      setTestResults((prev) => ({ ...prev, groq: { ok: false, message: e.message } }));
    } finally {
      setTestingService(null);
    }
  };

  const handleTestDeepSeek = async () => {
    setTestingService('deepseek');
    if (!deepseekKey.trim()) {
      setTestResults((prev) => ({ ...prev, deepseek: { ok: false, message: 'No API Key Entered' } }));
      setTestingService(null);
      return;
    }
    try {
      const start = Date.now();
      const res = await fetch('https://api.deepseek.com/models', {
        headers: { Authorization: `Bearer ${deepseekKey}` },
      });
      const latency = Date.now() - start;
      if (res.ok) {
        setTestResults((prev) => ({ ...prev, deepseek: { ok: true, message: `Connected (${latency}ms)` } }));
      } else {
        setTestResults((prev) => ({ ...prev, deepseek: { ok: false, message: `Auth Failed (${res.status})` } }));
      }
    } catch (e: any) {
      setTestResults((prev) => ({ ...prev, deepseek: { ok: false, message: e.message } }));
    } finally {
      setTestingService(null);
    }
  };

  const handleTestGoogleDrive = async () => {
    setTestingService('drive');
    try {
      const res = await GoogleDriveService.testConnection(driveConfig);
      setTestResults((prev) => ({
        ...prev,
        drive: { ok: res.ok, message: `${res.message} (${res.latencyMs}ms)` },
      }));
    } catch (e: any) {
      setTestResults((prev) => ({ ...prev, drive: { ok: false, message: e.message } }));
    } finally {
      setTestingService(null);
    }
  };

  const handleTestServer = async () => {
    setTestingService('server');
    try {
      const start = Date.now();
      const res = await fetch(`${serverUrl}/api/system/health`);
      const latency = Date.now() - start;
      if (res.ok) {
        const data = await res.json();
        setTestResults((prev) => ({
          ...prev,
          server: { ok: true, message: `Active: RAM Disk=${data.isRamDisk ? 'Yes' : 'No'} (${latency}ms)` },
        }));
      } else {
        setTestResults((prev) => ({ ...prev, server: { ok: false, message: `HTTP ${res.status}` } }));
      }
    } catch {
      setTestResults((prev) => ({ ...prev, server: { ok: false, message: 'Server Offline' } }));
    } finally {
      setTestingService(null);
    }
  };

  // --- Consolidated backup / restore / reset ---------------------------------
  const handleExportBackup = () => {
    const backup = StorageService.exportFullBackup();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const dateStr = new Date().toISOString().split('T')[0];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tutorial_studio_backup_${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast('Backup exported.', 'success', 'Backup');
  };

  const handleImportBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        const ok = StorageService.importFullBackup(json);
        if (ok) {
          toast('Backup restored. Data updated live.', 'success', 'Restore');
        } else {
          toast('Invalid backup file format.', 'error', 'Restore');
        }
      } catch (err: any) {
        toast('Failed to parse backup JSON: ' + err.message, 'error', 'Restore');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleResetFactoryData = async () => {
    const ok = await confirm({
      title: 'Reset to factory defaults?',
      message:
        'This clears custom channels, users, finished videos, and local configuration on this workstation. This cannot be undone.',
      confirmLabel: 'Reset everything',
      cancelLabel: 'Keep my data',
      danger: true,
    });
    if (!ok) return;
    StorageService.resetFactoryData();
    toast('Workstation reset to defaults.', 'success', 'Reset');
  };

  // --- Channel operations ----------------------------------------------------
  const handleSaveChannel = (channel: Channel) => {
    StorageService.saveChannel(channel);
    setIsChannelModalOpen(false);
    setEditingChannel(null);
    toast('Channel saved.', 'success', 'Channels');
  };

  const handleDeleteChannel = async (id: string) => {
    const ok = await confirm({
      title: 'Delete channel?',
      message: 'This channel profile will be permanently removed.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    StorageService.deleteChannel(id);
    toast('Channel deleted.', 'success', 'Channels');
  };

  // --- User / account operations ---------------------------------------------
  const handleSaveUser = (user: VAUser) => {
    StorageService.saveUser(user);
    if (user.id === activeUser.id) {
      StorageService.setActiveUser(user);
    }
    setIsUserModalOpen(false);
    setEditingUser(null);
    toast('Account saved.', 'success', 'Team');
  };

  const handleDeleteUser = async (id: string) => {
    if (users.length <= 1) {
      toast('Cannot delete the only remaining account.', 'warning', 'Team');
      return;
    }
    const ok = await confirm({
      title: 'Delete account?',
      message: 'This operator account will be permanently removed.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    StorageService.deleteUser(id);
    toast('Account deleted.', 'success', 'Team');
  };

  const handleSwitchActiveUser = (user: VAUser) => {
    StorageService.setActiveUser(user);
    toast(`Switched to ${user.name || user.email}.`, 'info', 'Active session');
  };

  // --- Drive template previews -----------------------------------------------
  const folderPreview = GoogleDriveService.resolveFolderPath(
    { channelName: channels[0]?.name || 'Entrepreneurs Skool', topic: 'How to Automate Invoices', title: 'Automate Invoices' },
    driveConfig.folderStructureTemplate
  );
  const filePreview = GoogleDriveService.resolveFileName(
    { channelName: channels[0]?.name || 'Entrepreneurs Skool', topic: 'How to Automate Invoices', title: 'Automate_Invoices', lang: 'en', extension: 'mp4' },
    driveConfig.fileNamingTemplate
  );

  // --- Section navigation ----------------------------------------------------
  const navItems = [
    canTeam && { id: 'sec-team', label: 'Team', icon: Users },
    { id: 'sec-channels', label: 'Channels', icon: Tv },
    canKeys && { id: 'sec-apikeys', label: 'API Keys', icon: Key },
    canKeys && { id: 'sec-drive', label: 'Drive', icon: FolderCheck },
    { id: 'sec-backend', label: 'Backend', icon: Server },
    canReset && { id: 'sec-backup', label: 'Backup', icon: HardDrive },
  ].filter(Boolean) as { id: string; label: string; icon: typeof Users }[];

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const resultCls = (ok: boolean) => (ok ? 'text-success' : 'text-danger');

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6 animate-fadeIn">
      {/* Header Bar */}
      <div className="pro-panel p-4 rounded-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-foreground" />
            <h1 className="text-sm font-bold font-display text-foreground">Workstation Settings &amp; Cloud Integration</h1>
          </div>
          <p className="text-[11px] text-muted mt-0.5">
            Team accounts, channels, provider API keys, Google Drive delivery, backend health, and backup.
          </p>
        </div>

        <button
          onClick={handleSaveAll}
          className="btn-solid px-4 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-subtle"
        >
          {savedSuccess ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
          {savedSuccess ? 'Saved!' : 'Save Configuration'}
        </button>
      </div>

      {/* Section navigation (sticky) */}
      <div className="sticky top-2 z-30 pro-panel rounded-xl px-2 py-1.5 flex items-center gap-1 flex-wrap">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => scrollToSection(item.id)}
              className="px-2.5 py-1 rounded-lg text-xs font-semibold text-muted hover:text-foreground hover:bg-surface-200 focus-ring flex items-center gap-1.5 transition-colors"
            >
              <Icon className="w-3.5 h-3.5" />
              {item.label}
            </button>
          );
        })}
      </div>

      {/* Team & Account Management */}
      {canTeam ? (
        <div id="sec-team" className="pro-panel p-4 rounded-xl space-y-4 scroll-mt-28">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-foreground" />
              <h3 className="text-xs font-bold font-mono text-foreground uppercase tracking-wider">Team &amp; Account Management</h3>
              <span className="badge badge-neutral">{users.length} Operator Accounts</span>
            </div>

            <button
              onClick={() => {
                setEditingUser({
                  id: `usr_${Date.now()}`,
                  name: '',
                  email: '',
                  role: 'va',
                  assignedChannels: [channels[0]?.id || 'virtualfd'],
                  assignedSoftwares: [],
                });
                setIsUserModalOpen(true);
              }}
              className="btn-solid px-3 py-1 rounded text-xs font-semibold flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> Add Account
            </button>
          </div>

          <p className="text-xs text-muted">
            Manage administrator, manager, and VA operator profiles with granular channel access and software specializations.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {users.map((u) => {
              const isActive = activeUser.id === u.id;
              return (
                <div
                  key={u.id}
                  className={`p-3.5 rounded-xl border flex flex-col justify-between space-y-3 transition-all ${
                    isActive ? 'bg-surface-200 border-foreground/50 shadow-subtle' : 'bg-surface-100 border-border hover:bg-surface-200/50'
                  }`}
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 truncate">
                        <UserCircle className="w-4 h-4 text-muted flex-shrink-0" />
                        <h4 className="text-xs font-bold text-foreground truncate">{u.name}</h4>
                      </div>
                      <span className={`badge ${roleBadgeClass(u.role)} uppercase`}>{u.role}</span>
                    </div>

                    <p className="text-[11px] font-mono text-muted truncate">{u.email}</p>

                    <div className="flex items-center gap-1 flex-wrap pt-1">
                      <span className="text-[10px] font-mono text-muted">Channels:</span>
                      {u.assignedChannels?.map((chId) => {
                        const chObj = channels.find((c) => c.id === chId);
                        return (
                          <span key={chId} className="px-1.5 py-0.5 rounded bg-surface-300 text-[10px] font-mono text-foreground">
                            {chObj ? chObj.name : chId}
                          </span>
                        );
                      })}
                    </div>

                    {u.assignedSoftwares && u.assignedSoftwares.length > 0 && (
                      <div className="flex items-center gap-1 flex-wrap pt-0.5">
                        <span className="text-[10px] font-mono text-muted">Softwares:</span>
                        {u.assignedSoftwares.map((soft) => (
                          <span key={soft} className="px-1.5 py-0.5 rounded bg-surface-300 text-[10px] font-mono text-foreground border border-border">
                            {soft}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="pt-2 border-t border-border flex items-center justify-between">
                    {isActive ? (
                      <span className="text-[10px] font-mono font-bold text-success flex items-center gap-1">
                        <ShieldCheck className="w-3.5 h-3.5" /> Active Session
                      </span>
                    ) : (
                      <button
                        onClick={() => handleSwitchActiveUser(u)}
                        className="text-[10px] font-mono font-bold text-muted hover:text-foreground underline flex items-center gap-1"
                      >
                        <UserCheck className="w-3 h-3" /> Switch to User
                      </button>
                    )}

                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          setEditingUser(u);
                          setIsUserModalOpen(true);
                        }}
                        className="p-1 rounded hover:bg-surface-300 text-muted hover:text-foreground"
                        title="Edit Account"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => handleDeleteUser(u.id)}
                        className="p-1 rounded hover:bg-surface-300 text-muted hover:text-danger"
                        title="Delete Account"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <LockedNote
          id="sec-team"
          title="Team & Account Management"
          note="Managing operator accounts requires the Team Management permission. Ask an administrator for access."
        />
      )}

      {/* Channels */}
      <div id="sec-channels" className="pro-panel p-4 rounded-xl space-y-4 scroll-mt-28">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Tv className="w-4 h-4 text-foreground" />
            <h3 className="text-xs font-bold font-mono text-foreground uppercase tracking-wider">Channel Profiles &amp; Niches</h3>
            <span className="badge badge-neutral">{channels.length} Configured</span>
            {!canChannels && <span className="badge badge-warning">Read-only</span>}
          </div>

          {canChannels && (
            <button
              onClick={() => {
                setEditingChannel({
                  id: `chan_${Date.now()}`,
                  name: '',
                  niche: '',
                  description: '',
                  badgeColor: '#00e5ff',
                  defaultVoiceId: 'fish-paul-neutral',
                  targetCategory: 'Tutorials',
                  driveFolder: 'Tutorials/',
                });
                setIsChannelModalOpen(true);
              }}
              className="btn-solid px-3 py-1 rounded text-xs font-semibold flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> Add Channel
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {channels.map((c) => (
            <div key={c.id} className="p-3.5 rounded-xl bg-surface-100 border border-border flex flex-col justify-between space-y-3">
              <div>
                <div className="flex items-center justify-between">
                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: c.badgeColor || '#00e5ff' }} />
                  {canChannels && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          setEditingChannel(c);
                          setIsChannelModalOpen(true);
                        }}
                        className="p-1 rounded hover:bg-surface-200 text-muted hover:text-foreground"
                        title="Edit Channel"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                      {channels.length > 1 && (
                        <button
                          onClick={() => handleDeleteChannel(c.id)}
                          className="p-1 rounded hover:bg-surface-200 text-muted hover:text-danger"
                          title="Delete Channel"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <h4 className="text-xs font-bold text-foreground mt-1">{c.name}</h4>
                <p className="text-[11px] font-mono text-muted mt-0.5">{c.niche}</p>
                <p className="text-[11px] text-muted mt-1 line-clamp-2">{c.description}</p>
              </div>

              <div className="pt-2 border-t border-border flex items-center justify-between text-[10px] font-mono text-muted">
                <span>Voice: {c.defaultVoiceId?.split('-')[1] || 'Default'}</span>
                <span>{c.subscribers || 'New'}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* API Keys */}
      {canKeys ? (
        <div id="sec-apikeys" className="pro-panel p-4 rounded-xl space-y-4 scroll-mt-28">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-foreground" />
            <h3 className="text-xs font-bold font-mono text-foreground uppercase tracking-wider">API Keys &amp; Intelligence Models</h3>
          </div>
          <p className="text-[11px] text-muted">
            Keys are stored locally in this browser only. A server-side key proxy is a known future improvement.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Google AI Studio (Gemini) */}
            <div className="space-y-1.5 p-3 rounded-lg bg-surface-200/50 border border-border md:col-span-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <label className="text-xs font-bold text-foreground">Google AI Studio API Key (Gemini 2.0 Flash / Pro)</label>
                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] font-mono text-info hover:underline flex items-center gap-0.5"
                  >
                    Get Key <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                </div>
                <div className="flex items-center gap-1.5">
                  {testResults.gemini && (
                    <span className={`text-[10px] font-mono font-bold ${resultCls(testResults.gemini.ok)}`}>
                      {testResults.gemini.message}
                    </span>
                  )}
                  <button
                    onClick={handleTestGemini}
                    disabled={testingService === 'gemini'}
                    className="text-[10px] font-mono text-muted hover:text-foreground underline flex items-center gap-1"
                  >
                    {testingService === 'gemini' ? <RefreshCw className="w-2.5 h-2.5 animate-spin" /> : null}
                    Test Ping
                  </button>
                </div>
              </div>
              <SecretInput value={geminiKey} onChange={setGeminiKey} placeholder="AIzaSy..." />
              <p className="text-[10px] text-muted font-mono">
                Primary high-speed LLM engine for spoken tutorial scripts, metadata generation, and multilingual translations.
              </p>
            </div>

            {/* Groq */}
            <div className="space-y-1.5 p-3 rounded-lg bg-surface-200/50 border border-border">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-foreground">Groq API Key (LLaMA 3.3 70B Failover)</label>
                <div className="flex items-center gap-1.5">
                  {testResults.groq && (
                    <span className={`text-[10px] font-mono font-bold ${resultCls(testResults.groq.ok)}`}>{testResults.groq.message}</span>
                  )}
                  <button
                    onClick={handleTestGroq}
                    disabled={testingService === 'groq'}
                    className="text-[10px] font-mono text-muted hover:text-foreground underline flex items-center gap-1"
                  >
                    {testingService === 'groq' ? <RefreshCw className="w-2.5 h-2.5 animate-spin" /> : null}
                    Test Ping
                  </button>
                </div>
              </div>
              <SecretInput value={groqKey} onChange={setGroqKey} placeholder="gsk_..." />
            </div>

            {/* DeepSeek */}
            <div className="space-y-1.5 p-3 rounded-lg bg-surface-200/50 border border-border">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-foreground">DeepSeek Flash API Key (deepseek-chat Fallback)</label>
                <div className="flex items-center gap-1.5">
                  {testResults.deepseek && (
                    <span className={`text-[10px] font-mono font-bold ${resultCls(testResults.deepseek.ok)}`}>{testResults.deepseek.message}</span>
                  )}
                  <button
                    onClick={handleTestDeepSeek}
                    disabled={testingService === 'deepseek'}
                    className="text-[10px] font-mono text-muted hover:text-foreground underline flex items-center gap-1"
                  >
                    {testingService === 'deepseek' ? <RefreshCw className="w-2.5 h-2.5 animate-spin" /> : null}
                    Test Ping
                  </button>
                </div>
              </div>
              <SecretInput value={deepseekKey} onChange={setDeepseekKey} placeholder="sk-..." />
            </div>

            {/* ElevenLabs */}
            <div className="space-y-1.5 p-3 rounded-lg bg-surface-200/50 border border-border">
              <label className="block text-xs font-bold text-foreground">ElevenLabs API Key (Neural Voice)</label>
              <SecretInput value={elevenKey} onChange={setElevenKey} placeholder="xi-api-key..." />
            </div>

            {/* Fish Audio */}
            <div className="space-y-1.5 p-3 rounded-lg bg-surface-200/50 border border-border">
              <label className="block text-xs font-bold text-foreground">Fish Audio API Key</label>
              <SecretInput value={fishKey} onChange={setFishKey} placeholder="fish-api-key..." />
            </div>

            {/* OpenAI */}
            <div className="space-y-1.5 p-3 rounded-lg bg-surface-200/50 border border-border md:col-span-2">
              <label className="block text-xs font-bold text-foreground">OpenAI API Key (TTS &amp; Embeddings)</label>
              <SecretInput value={openAiKey} onChange={setOpenAiKey} placeholder="sk-proj-..." />
            </div>
          </div>
        </div>
      ) : (
        <LockedNote
          id="sec-apikeys"
          title="API Keys & Intelligence Models"
          note="Provider API keys are restricted to roles with the API Keys permission (administrators)."
        />
      )}

      {/* Google Drive */}
      {canKeys ? (
        <div id="sec-drive" className="pro-panel p-4 rounded-xl space-y-4 scroll-mt-28">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FolderCheck className="w-4 h-4 text-foreground" />
              <h3 className="text-xs font-bold font-mono text-foreground uppercase tracking-wider">Google Drive Cloud Delivery Suite</h3>
            </div>
            <div className="flex items-center gap-2">
              {testResults.drive && (
                <span className={`text-[10px] font-mono font-bold ${resultCls(testResults.drive.ok)}`}>{testResults.drive.message}</span>
              )}
              <button
                onClick={handleTestGoogleDrive}
                disabled={testingService === 'drive'}
                className="btn-outline px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1"
              >
                {testingService === 'drive' ? <RefreshCw className="w-3 h-3 animate-spin" /> : null}
                Test Connection
              </button>
              <Link
                to="/finished"
                className="btn-outline px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1 text-accent hover:text-foreground"
                title="Open Google Drive Cloud Folders & Tracking Overview"
              >
                <FolderCheck className="w-3 h-3" />
                Folder Overview
              </Link>
            </div>
          </div>

          <p className="text-xs text-muted">
            Configure how the render engine automatically delivers finished tutorial files and thumbnails to Google Drive.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Connection Mode & Credentials */}
            <div className="space-y-3 p-3.5 rounded-lg bg-surface-200/50 border border-border">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-foreground">Authentication Method</label>
                <div className="flex items-center gap-1">
                  {(['service_account', 'oauth', 'api_key'] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setDriveConfig({ ...driveConfig, connectionMode: mode })}
                      className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase transition-all ${
                        driveConfig.connectionMode === mode ? 'bg-foreground text-background shadow-subtle' : 'bg-surface-200 text-muted hover:text-foreground'
                      }`}
                    >
                      {mode.replace('_', ' ')}
                    </button>
                  ))}
                </div>
              </div>

              {driveConfig.connectionMode === 'service_account' ? (
                <div>
                  <label className="block text-[11px] font-mono text-muted mb-1">
                    Service Account JSON (paste raw Google Cloud credentials JSON)
                  </label>
                  <textarea
                    rows={4}
                    value={driveConfig.serviceAccountJson || ''}
                    onChange={(e) => setDriveConfig({ ...driveConfig, serviceAccountJson: e.target.value })}
                    placeholder={`{\n  "type": "service_account",\n  "client_email": "tutorial-bot@project.iam.gserviceaccount.com",\n  "private_key": "-----BEGIN PRIVATE KEY-----..."\n}`}
                    className="pro-input w-full rounded-lg p-2 text-[11px] font-mono resize-y leading-relaxed"
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-[11px] font-mono text-muted mb-1">Google Cloud API Key / Token</label>
                  <SecretInput
                    value={driveConfig.apiKey || ''}
                    onChange={(v) => setDriveConfig({ ...driveConfig, apiKey: v })}
                    placeholder="AIzaSy..."
                  />
                </div>
              )}

              <div>
                <label className="block text-[11px] font-mono text-muted mb-1">Root Destination Folder ID (optional, defaults to 'root')</label>
                <input
                  type="text"
                  value={driveConfig.rootFolderId || ''}
                  onChange={(e) => setDriveConfig({ ...driveConfig, rootFolderId: e.target.value })}
                  placeholder="1aBcDeFgHiJkLmNoPqRsTuVwXyZ"
                  className="pro-input w-full rounded-lg px-3 py-1.5 text-xs font-mono"
                />
              </div>
            </div>

            {/* Folder & Naming Hierarchy Builder */}
            <div className="space-y-3 p-3.5 rounded-lg bg-surface-200/50 border border-border">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-foreground">Folder Structure Template</label>
                  <span className="text-[10px] font-mono text-muted">
                    Tokens: {'{channel}'}, {'{year}'}, {'{month}'}, {'{topic_slug}'}
                  </span>
                </div>
                <input
                  type="text"
                  value={driveConfig.folderStructureTemplate || '{channel}/{year}_{month}/{topic_slug}/'}
                  onChange={(e) => setDriveConfig({ ...driveConfig, folderStructureTemplate: e.target.value })}
                  className="pro-input w-full rounded-lg px-3 py-1.5 text-xs font-mono"
                />
                <div className="mt-1 p-2 rounded bg-surface-100 border border-border text-[11px] font-mono text-muted truncate">
                  Preview: <strong className="text-success">{folderPreview}</strong>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-foreground">File Naming Template</label>
                  <span className="text-[10px] font-mono text-muted">
                    Tokens: {'{date}'}, {'{title}'}, {'{lang}'}
                  </span>
                </div>
                <input
                  type="text"
                  value={driveConfig.fileNamingTemplate || '{date}_{title}_{lang}.mp4'}
                  onChange={(e) => setDriveConfig({ ...driveConfig, fileNamingTemplate: e.target.value })}
                  className="pro-input w-full rounded-lg px-3 py-1.5 text-xs font-mono"
                />
                <div className="mt-1 p-2 rounded bg-surface-100 border border-border text-[11px] font-mono text-muted truncate">
                  Preview: <strong className="text-success">{filePreview}</strong>
                </div>
              </div>

              <div className="space-y-1.5 pt-1">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-foreground">
                  <input
                    type="checkbox"
                    checked={driveConfig.autoUploadOnRender}
                    onChange={(e) => setDriveConfig({ ...driveConfig, autoUploadOnRender: e.target.checked })}
                    className="rounded accent-foreground"
                  />
                  <span>Automatically dispatch upload when video is rendered / spliced</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-foreground">
                  <input
                    type="checkbox"
                    checked={driveConfig.uploadThumbnail}
                    onChange={(e) => setDriveConfig({ ...driveConfig, uploadThumbnail: e.target.checked })}
                    className="rounded accent-foreground"
                  />
                  <span>Also upload generated Thumbnail PNG alongside video</span>
                </label>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <LockedNote
          id="sec-drive"
          title="Google Drive Cloud Delivery Suite"
          note="Google Drive credentials are restricted to roles with the API Keys permission (administrators)."
        />
      )}

      {/* Backend Server Health */}
      <div id="sec-backend" className="pro-panel p-4 rounded-xl space-y-3 scroll-mt-28">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className="w-3.5 h-3.5 text-muted" />
            <h3 className="text-xs font-bold font-mono text-foreground uppercase tracking-wider">Backend Render Pipeline Server</h3>
          </div>

          <div className="flex items-center gap-2">
            {testResults.server && (
              <span className={`text-[10px] font-mono font-bold ${resultCls(testResults.server.ok)}`}>{testResults.server.message}</span>
            )}
            <button
              onClick={handleTestServer}
              disabled={testingService === 'server'}
              className="text-[10px] font-mono text-muted hover:text-foreground underline flex items-center gap-1"
            >
              {testingService === 'server' ? <RefreshCw className="w-2.5 h-2.5 animate-spin" /> : null}
              Check Health
            </button>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-foreground mb-1">Backend API Endpoint URL</label>
          <input
            type="text"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder={DEFAULT_SERVER_URL}
            className="pro-input w-full rounded-lg px-3 py-2 text-xs font-mono"
          />
          <p className="text-[10px] text-muted mt-1 font-mono">Saved with "Save Configuration".</p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-foreground mb-1">
            External Keyword Source URL <span className="text-muted font-normal">(optional)</span>
          </label>
          <input
            type="text"
            value={externalKeywordApi}
            onChange={(e) => setExternalKeywordApi(e.target.value)}
            placeholder="https://your-own-keyword-tool.example.com  (leave blank to work fully offline)"
            className="pro-input w-full rounded-lg px-3 py-2 text-xs font-mono"
          />
          <p className="text-[10px] text-muted mt-1 font-mono">
            Point this at your <strong>own</strong> keyword tool to pull live topics into the "My Keywords" pool. Leave blank to run
            self-contained on the Starter List + CSV imports.
          </p>
        </div>
      </div>

      {/* Backup / Restore / Reset */}
      {canReset ? (
        <div id="sec-backup" className="pro-panel p-4 rounded-xl space-y-3 scroll-mt-28">
          <div className="flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-foreground" />
            <h3 className="text-xs font-bold font-mono text-foreground uppercase tracking-wider">Workstation Data Backup &amp; Migration</h3>
          </div>
          <p className="text-xs text-muted">
            Export the entire workstation database (channels, users, config, targets, presets, finished videos, drive config) to a
            single JSON file, restore it on another machine, or reset to factory defaults.
          </p>

          <div className="flex items-center gap-3 flex-wrap pt-1">
            <button
              onClick={handleExportBackup}
              className="btn-outline px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              Export Backup (.json)
            </button>

            <label className="btn-outline px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer">
              <Upload className="w-3.5 h-3.5" />
              <span>Import &amp; Restore (.json)</span>
              <input type="file" accept=".json" onChange={handleImportBackup} className="hidden" />
            </label>

            <button
              onClick={handleResetFactoryData}
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-danger hover:bg-danger/10 border border-danger/30 flex items-center gap-1.5 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Reset to Factory Defaults
            </button>
          </div>
        </div>
      ) : (
        <LockedNote
          id="sec-backup"
          title="Workstation Data Backup & Migration"
          note="Backup, restore, and factory reset are restricted to roles with the Factory Reset permission (administrators)."
        />
      )}

      {/* User Account Edit / Create Modal */}
      <Modal
        isOpen={isUserModalOpen && !!editingUser}
        onClose={() => {
          setIsUserModalOpen(false);
          setEditingUser(null);
        }}
        title={editingUser && users.some((u) => u.id === editingUser.id) ? 'Edit Operator Account' : 'Add Operator Account'}
        size="md"
        footer={
          <>
            <button
              onClick={() => {
                setIsUserModalOpen(false);
                setEditingUser(null);
              }}
              className="btn-outline px-3 py-1.5 rounded-lg text-xs font-semibold"
            >
              Cancel
            </button>
            <button onClick={() => editingUser && handleSaveUser(editingUser)} className="btn-solid px-4 py-1.5 rounded-lg text-xs font-bold">
              Save Account
            </button>
          </>
        }
      >
        {editingUser && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1">Operator Name</label>
              <input
                type="text"
                value={editingUser.name}
                onChange={(e) => setEditingUser({ ...editingUser, name: e.target.value })}
                placeholder="e.g. Alex (VA)"
                className="pro-input w-full rounded-lg px-3 py-2 text-xs"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1">Email Address</label>
              <input
                type="email"
                value={editingUser.email}
                onChange={(e) => setEditingUser({ ...editingUser, email: e.target.value })}
                placeholder="e.g. alex@production.team"
                className="pro-input w-full rounded-lg px-3 py-2 text-xs font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1">Role Permission</label>
              <select
                value={editingUser.role}
                onChange={(e) => setEditingUser({ ...editingUser, role: e.target.value as VAUser['role'] })}
                className="pro-input w-full rounded-lg px-2.5 py-1.5 text-xs"
              >
                <option value="admin">Administrator (Full Access)</option>
                <option value="manager">Manager (Production Lead)</option>
                <option value="va">Virtual Assistant (Recording &amp; Conveyor)</option>
                <option value="viewer">Viewer (Read-only)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1">Accessible Channels</label>
              <div className="space-y-1 max-h-32 overflow-y-auto p-2 rounded bg-surface-200 border border-border">
                {channels.map((ch) => {
                  const isChecked = editingUser.assignedChannels?.includes(ch.id);
                  return (
                    <label key={ch.id} className="flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => {
                          const current = editingUser.assignedChannels || [];
                          const updated = e.target.checked ? [...current, ch.id] : current.filter((id) => id !== ch.id);
                          setEditingUser({ ...editingUser, assignedChannels: updated });
                        }}
                        className="rounded accent-foreground"
                      />
                      <span className="text-foreground">{ch.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-foreground">Assigned Softwares (VA Specialization)</label>
                <span className="text-[10px] font-mono text-muted">Filter keywords by these topics</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 max-h-36 overflow-y-auto p-2 rounded bg-surface-200 border border-border mb-2">
                {[
                  'Excel', 'Word', 'PowerPoint', 'Power BI', 'Outlook',
                  'Notion', 'Figma', 'Canva', 'Photoshop', 'Illustrator',
                  'Premiere Pro', 'Blender', 'Google Sheets', 'Google Docs',
                  'Slack', 'Trello', 'Zapier', 'Make'
                ].map((software) => {
                  const isChecked = editingUser.assignedSoftwares?.includes(software);
                  return (
                    <label key={software} className="flex items-center gap-1.5 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => {
                          const current = editingUser.assignedSoftwares || [];
                          const updated = e.target.checked ? [...current, software] : current.filter((s) => s !== software);
                          setEditingUser({ ...editingUser, assignedSoftwares: updated });
                        }}
                        className="rounded accent-foreground"
                      />
                      <span className="text-foreground text-[11px] truncate">{software}</span>
                    </label>
                  );
                })}
              </div>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  placeholder="Add custom software (e.g. QuickBooks)..."
                  className="pro-input flex-1 rounded px-2.5 py-1 text-xs"
                  id="setting_custom_soft_input"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const val = (e.currentTarget.value || '').trim();
                      if (val && !editingUser.assignedSoftwares?.includes(val)) {
                        setEditingUser({
                          ...editingUser,
                          assignedSoftwares: [...(editingUser.assignedSoftwares || []), val]
                        });
                        e.currentTarget.value = '';
                      }
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    const input = document.getElementById('setting_custom_soft_input') as HTMLInputElement;
                    const val = input?.value.trim();
                    if (val && !editingUser.assignedSoftwares?.includes(val)) {
                      setEditingUser({
                        ...editingUser,
                        assignedSoftwares: [...(editingUser.assignedSoftwares || []), val]
                      });
                      input.value = '';
                    }
                  }}
                  className="btn-outline px-3 py-1 rounded text-xs font-semibold"
                >
                  Add
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Channel Edit / Create Modal */}
      <Modal
        isOpen={isChannelModalOpen && !!editingChannel}
        onClose={() => {
          setIsChannelModalOpen(false);
          setEditingChannel(null);
        }}
        title={editingChannel && channels.some((c) => c.id === editingChannel.id) ? 'Edit Channel Profile' : 'Create New Channel'}
        size="lg"
        footer={
          <>
            <button
              onClick={() => {
                setIsChannelModalOpen(false);
                setEditingChannel(null);
              }}
              className="btn-outline px-3 py-1.5 rounded-lg text-xs font-semibold"
            >
              Cancel
            </button>
            <button
              onClick={() => editingChannel && handleSaveChannel(editingChannel)}
              className="btn-solid px-4 py-1.5 rounded-lg text-xs font-bold"
            >
              Save Channel
            </button>
          </>
        }
      >
        {editingChannel && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1">Channel Name</label>
              <input
                type="text"
                value={editingChannel.name}
                onChange={(e) => setEditingChannel({ ...editingChannel, name: e.target.value })}
                placeholder="e.g. Masterclass Tutorials"
                className="pro-input w-full rounded-lg px-3 py-2 text-xs"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1">Niche / Topic Focus</label>
              <input
                type="text"
                value={editingChannel.niche}
                onChange={(e) => setEditingChannel({ ...editingChannel, niche: e.target.value })}
                placeholder="e.g. Productivity &amp; Notion Workflows"
                className="pro-input w-full rounded-lg px-3 py-2 text-xs"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1">Channel Description</label>
              <textarea
                rows={2}
                value={editingChannel.description}
                onChange={(e) => setEditingChannel({ ...editingChannel, description: e.target.value })}
                placeholder="Describe the style and audience of this channel..."
                className="pro-input w-full rounded-lg p-2.5 text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">Badge Accent Color</label>
                <input
                  type="color"
                  value={editingChannel.badgeColor}
                  onChange={(e) => setEditingChannel({ ...editingChannel, badgeColor: e.target.value })}
                  className="w-full h-8 rounded border border-border cursor-pointer bg-surface-200"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">Default Neural Voice</label>
                <select
                  value={editingChannel.defaultVoiceId}
                  onChange={(e) => setEditingChannel({ ...editingChannel, defaultVoiceId: e.target.value })}
                  className="pro-input w-full rounded-lg px-2.5 py-1.5 text-xs"
                >
                  <option value="fish-paul-neutral">Paul (Neutral Professional)</option>
                  <option value="fish-adam-punchy">Adam (Punchy / Energetic)</option>
                  <option value="fish-sarah-calm">Sarah (Calm / Authoritative)</option>
                  <option value="eleven-rachel">Rachel (ElevenLabs Natural)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1">Drive Destination Folder</label>
              <input
                type="text"
                value={editingChannel.driveFolder || ''}
                onChange={(e) => setEditingChannel({ ...editingChannel, driveFolder: e.target.value })}
                placeholder="e.g. Tutorials/"
                className="pro-input w-full rounded-lg px-3 py-2 text-xs font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1">Custom AI Prompting Rules (Tone &amp; Style)</label>
              <input
                type="text"
                value={editingChannel.customPromptRules || ''}
                onChange={(e) => setEditingChannel({ ...editingChannel, customPromptRules: e.target.value })}
                placeholder="e.g. Fast-paced, zero fluff, concise steps"
                className="pro-input w-full rounded-lg px-3 py-2 text-xs font-mono"
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
