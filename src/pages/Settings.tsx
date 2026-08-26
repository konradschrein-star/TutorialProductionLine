import React, { useState } from 'react';
import { 
  Key, 
  Check, 
  Save, 
  Tv, 
  Activity, 
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
  HelpCircle,
  Users,
  ShieldCheck,
  UserCheck
} from 'lucide-react';
import { StorageService, DEFAULT_CHANNELS, DEFAULT_USERS } from '../services/storageService';
import { GoogleDriveService } from '../services/googleDriveService';
import { Channel, GoogleDriveConfig, VAUser } from '../types';

export const Settings: React.FC = () => {
  // API Keys
  const [groqKey, setGroqKey] = useState<string>(() => StorageService.getApiKey('groq'));
  const [deepseekKey, setDeepseekKey] = useState<string>(() => StorageService.getApiKey('deepseek'));
  const [elevenKey, setElevenKey] = useState<string>(() => StorageService.getApiKey('elevenlabs'));
  const [fishKey, setFishKey] = useState<string>(() => StorageService.getApiKey('fishaudio'));
  const [openAiKey, setOpenAiKey] = useState<string>(() => StorageService.getApiKey('openai'));
  const [serverUrl, setServerUrl] = useState<string>('http://localhost:3001');

  // Optional external keyword source (the operator's OWN keyword tool). Empty = self-contained.
  const [externalKeywordApi, setExternalKeywordApi] = useState<string>(() => StorageService.getExternalKeywordApi());

  // Google Drive Config State
  const [driveConfig, setDriveConfig] = useState<GoogleDriveConfig>(() => StorageService.getGoogleDriveConfig());

  // Channels Dynamic State
  const [channels, setChannels] = useState<Channel[]>(() => StorageService.getChannels());
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null);
  const [isChannelModalOpen, setIsChannelModalOpen] = useState<boolean>(false);

  // User Profile & Team Management
  const [users, setUsers] = useState<VAUser[]>(() => StorageService.getUsers());
  const [activeUser, setActiveUser] = useState<VAUser>(() => StorageService.getActiveUser());
  const [editingUser, setEditingUser] = useState<VAUser | null>(null);
  const [isUserModalOpen, setIsUserModalOpen] = useState<boolean>(false);

  // Status & Pings
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);
  const [testingService, setTestingService] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string }>>({});

  const handleSaveAll = () => {
    StorageService.setApiKey('groq', groqKey);
    StorageService.setApiKey('deepseek', deepseekKey);
    StorageService.setApiKey('elevenlabs', elevenKey);
    StorageService.setApiKey('fishaudio', fishKey);
    StorageService.setApiKey('openai', openAiKey);
    StorageService.setGoogleDriveConfig(driveConfig);
    StorageService.setActiveUser(activeUser);
    StorageService.setExternalKeywordApi(externalKeywordApi);

    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2000);
  };

  const handleTestGroq = async () => {
    setTestingService('groq');
    if (!groqKey.trim()) {
      setTestResults(prev => ({ ...prev, groq: { ok: false, message: 'No API Key Entered' } }));
      setTestingService(null);
      return;
    }

    try {
      const start = Date.now();
      const res = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { 'Authorization': `Bearer ${groqKey}` }
      });
      const latency = Date.now() - start;
      if (res.ok) {
        setTestResults(prev => ({ ...prev, groq: { ok: true, message: `Connected (${latency}ms)` } }));
      } else {
        setTestResults(prev => ({ ...prev, groq: { ok: false, message: `Auth Failed (${res.status})` } }));
      }
    } catch (e: any) {
      setTestResults(prev => ({ ...prev, groq: { ok: false, message: e.message } }));
    } finally {
      setTestingService(null);
    }
  };

  const handleTestDeepSeek = async () => {
    setTestingService('deepseek');
    if (!deepseekKey.trim()) {
      setTestResults(prev => ({ ...prev, deepseek: { ok: false, message: 'No API Key Entered' } }));
      setTestingService(null);
      return;
    }

    try {
      const start = Date.now();
      const res = await fetch('https://api.deepseek.com/models', {
        headers: { 'Authorization': `Bearer ${deepseekKey}` }
      });
      const latency = Date.now() - start;
      if (res.ok) {
        setTestResults(prev => ({ ...prev, deepseek: { ok: true, message: `Connected (${latency}ms)` } }));
      } else {
        setTestResults(prev => ({ ...prev, deepseek: { ok: false, message: `Auth Failed (${res.status})` } }));
      }
    } catch (e: any) {
      setTestResults(prev => ({ ...prev, deepseek: { ok: false, message: e.message } }));
    } finally {
      setTestingService(null);
    }
  };

  const handleTestGoogleDrive = async () => {
    setTestingService('drive');
    try {
      const res = await GoogleDriveService.testConnection(driveConfig);
      setTestResults(prev => ({
        ...prev,
        drive: { ok: res.ok, message: `${res.message} (${res.latencyMs}ms)` }
      }));
    } catch (e: any) {
      setTestResults(prev => ({ ...prev, drive: { ok: false, message: e.message } }));
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
        setTestResults(prev => ({
          ...prev,
          server: { ok: true, message: `Active: RAM Disk=${data.isRamDisk ? 'Yes' : 'No'} (${latency}ms)` }
        }));
      } else {
        setTestResults(prev => ({ ...prev, server: { ok: false, message: `HTTP ${res.status}` } }));
      }
    } catch (e: any) {
      setTestResults(prev => ({ ...prev, server: { ok: false, message: 'Server Offline' } }));
    } finally {
      setTestingService(null);
    }
  };

  // Channel Operations
  const handleSaveChannel = (channel: Channel) => {
    StorageService.saveChannel(channel);
    setChannels(StorageService.getChannels());
    setIsChannelModalOpen(false);
    setEditingChannel(null);
  };

  const handleDeleteChannel = (id: string) => {
    if (confirm('Are you sure you want to delete this channel?')) {
      StorageService.deleteChannel(id);
      setChannels(StorageService.getChannels());
    }
  };

  // User & Account Operations
  const handleSaveUser = (user: VAUser) => {
    StorageService.saveUser(user);
    setUsers(StorageService.getUsers());
    if (user.id === activeUser.id) {
      setActiveUser(user);
      StorageService.setActiveUser(user);
    }
    setIsUserModalOpen(false);
    setEditingUser(null);
  };

  const handleDeleteUser = (id: string) => {
    if (users.length <= 1) {
      alert('Cannot delete the only remaining account.');
      return;
    }
    if (confirm('Are you sure you want to delete this account?')) {
      StorageService.deleteUser(id);
      const updated = StorageService.getUsers();
      setUsers(updated);
      if (activeUser.id === id) {
        setActiveUser(updated[0]);
      }
    }
  };

  const handleSwitchActiveUser = (user: VAUser) => {
    setActiveUser(user);
    StorageService.setActiveUser(user);
  };

  // Config Backup & Restore
  const handleExportConfig = () => {
    const backup = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      channels: StorageService.getChannels(),
      users: StorageService.getUsers(),
      googleDriveConfig: StorageService.getGoogleDriveConfig(),
      customThumbnailAssets: StorageService.getCustomThumbnailAssets()
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tutorial_line_config_backup_${Date.now()}.json`;
    a.click();
  };

  const handleImportConfig = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const backup = JSON.parse(evt.target?.result as string);
        if (backup.channels) localStorage.setItem('tpl_custom_channels', JSON.stringify(backup.channels));
        if (backup.users) localStorage.setItem('tpl_custom_users', JSON.stringify(backup.users));
        if (backup.googleDriveConfig) localStorage.setItem('tpl_google_drive_config', JSON.stringify(backup.googleDriveConfig));
        if (backup.customThumbnailAssets) localStorage.setItem('tpl_custom_thumbnail_assets', JSON.stringify(backup.customThumbnailAssets));
        alert('Configuration backup restored successfully! Reloading...');
        window.location.reload();
      } catch (err: any) {
        alert('Invalid configuration file: ' + err.message);
      }
    };
    reader.readAsText(file);
  };

  // Folder template token resolver preview
  const folderPreview = GoogleDriveService.resolveFolderPath(
    { channelName: channels[0]?.name || 'Entrepreneurs Skool', topic: 'How to Automate Invoices', title: 'Automate Invoices' },
    driveConfig.folderStructureTemplate
  );

  const filePreview = GoogleDriveService.resolveFileName(
    { channelName: channels[0]?.name || 'Entrepreneurs Skool', topic: 'How to Automate Invoices', title: 'Automate_Invoices', lang: 'en', extension: 'mp4' },
    driveConfig.fileNamingTemplate
  );

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6 animate-fadeIn">
      
      {/* Header Bar */}
      <div className="pro-panel p-4 rounded-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-foreground" />
            <h1 className="text-sm font-bold font-display text-foreground">
              Workstation Settings &amp; Cloud Integration
            </h1>
          </div>
          <p className="text-[11px] text-muted mt-0.5">
            Configure Team Accounts, Google Drive Cloud Sync, Channel Profiles, and API Keys.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExportConfig}
            className="btn-outline px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5"
            title="Export all channels and settings to JSON"
          >
            <Download className="w-3.5 h-3.5" /> Backup (.json)
          </button>

          <label className="btn-outline px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer">
            <Upload className="w-3.5 h-3.5" /> Restore
            <input
              type="file"
              accept=".json"
              className="hidden"
              onChange={handleImportConfig}
            />
          </label>

          <button
            onClick={handleSaveAll}
            className="btn-solid px-4 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-subtle"
          >
            {savedSuccess ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
            {savedSuccess ? 'Saved All!' : 'Save Configuration'}
          </button>
        </div>
      </div>

      {/* Team & Admin Account Management Suite */}
      <div className="pro-panel p-4 rounded-xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-foreground" />
            <h3 className="text-xs font-bold font-mono text-foreground uppercase tracking-wider">
              Team &amp; Account Management
            </h3>
            <span className="px-2 py-0.5 rounded font-mono text-[10px] font-bold bg-surface-200 text-foreground border border-border">
              {users.length} Operator Accounts
            </span>
          </div>

          <button
            onClick={() => {
              setEditingUser({
                id: `usr_${Date.now()}`,
                name: '',
                email: '',
                role: 'va',
                assignedChannels: [channels[0]?.id || 'virtualfd']
              });
              setIsUserModalOpen(true);
            }}
            className="btn-solid px-3 py-1 rounded text-xs font-semibold flex items-center gap-1"
          >
            <Plus className="w-3 h-3" /> Add Account
          </button>
        </div>

        <p className="text-xs text-muted">
          Manage administrator, manager, and VA operator profiles with granular channel access. No external code needed.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {users.map(u => {
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
                    
                    <span className={`text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded border ${
                      u.role === 'admin' 
                        ? 'bg-purple-500/10 text-purple-400 border-purple-500/30'
                        : u.role === 'manager'
                          ? 'bg-blue-500/10 text-blue-400 border-blue-500/30'
                          : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                    }`}>
                      {u.role}
                    </span>
                  </div>

                  <p className="text-[11px] font-mono text-muted truncate">{u.email}</p>

                  <div className="flex items-center gap-1 flex-wrap pt-1">
                    <span className="text-[10px] font-mono text-muted">Channels:</span>
                    {u.assignedChannels?.map(chId => {
                      const chObj = channels.find(c => c.id === chId);
                      return (
                        <span key={chId} className="px-1.5 py-0.2 rounded bg-surface-300 text-[10px] font-mono text-foreground">
                          {chObj ? chObj.name : chId}
                        </span>
                      );
                    })}
                  </div>
                </div>

                <div className="pt-2 border-t border-border flex items-center justify-between">
                  {isActive ? (
                    <span className="text-[10px] font-mono font-bold text-emerald-500 flex items-center gap-1">
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
                      className="p-1 rounded hover:bg-surface-300 text-muted hover:text-red-400"
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

      {/* Google Drive Cloud Integration Panel */}
      <div className="pro-panel p-4 rounded-xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FolderCheck className="w-4 h-4 text-foreground" />
            <h3 className="text-xs font-bold font-mono text-foreground uppercase tracking-wider">
              Google Drive Cloud Delivery Suite
            </h3>
          </div>

          <div className="flex items-center gap-2">
            {testResults.drive && (
              <span className={`text-[10px] font-mono font-bold ${testResults.drive.ok ? 'text-emerald-500' : 'text-red-500'}`}>
                {testResults.drive.message}
              </span>
            )}
            <button
              onClick={handleTestGoogleDrive}
              disabled={testingService === 'drive'}
              className="btn-outline px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1"
            >
              {testingService === 'drive' ? <RefreshCw className="w-3 h-3 animate-spin" /> : null}
              Test Connection
            </button>
          </div>
        </div>

        <p className="text-xs text-muted">
          Configure how the Virtual Assistant and render engine automatically delivers finished tutorial files and thumbnails to Google Drive.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          
          {/* Connection Mode & Credentials */}
          <div className="space-y-3 p-3.5 rounded-lg bg-surface-200/50 border border-border">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-foreground">Authentication Method</label>
              <div className="flex items-center gap-1">
                {(['service_account', 'oauth', 'api_key'] as const).map(mode => (
                  <button
                    key={mode}
                    onClick={() => setDriveConfig({ ...driveConfig, connectionMode: mode })}
                    className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase transition-all ${
                      driveConfig.connectionMode === mode
                        ? 'bg-foreground text-background shadow-subtle'
                        : 'bg-surface-200 text-muted hover:text-foreground'
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
                <label className="block text-[11px] font-mono text-muted mb-1">
                  Google Cloud API Key / Token
                </label>
                <input
                  type="password"
                  value={driveConfig.apiKey || ''}
                  onChange={(e) => setDriveConfig({ ...driveConfig, apiKey: e.target.value })}
                  placeholder="AIzaSy..."
                  className="pro-input w-full rounded-lg px-3 py-1.5 text-xs font-mono"
                />
              </div>
            )}

            <div>
              <label className="block text-[11px] font-mono text-muted mb-1">
                Root Destination Folder ID (optional, defaults to 'root')
              </label>
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
                <span className="text-[10px] font-mono text-muted">Tokens: {'{channel}'}, {'{year}'}, {'{month}'}, {'{topic_slug}'}</span>
              </div>
              <input
                type="text"
                value={driveConfig.folderStructureTemplate || '{channel}/{year}_{month}/{topic_slug}/'}
                onChange={(e) => setDriveConfig({ ...driveConfig, folderStructureTemplate: e.target.value })}
                className="pro-input w-full rounded-lg px-3 py-1.5 text-xs font-mono"
              />
              <div className="mt-1 p-2 rounded bg-surface-100 border border-border text-[11px] font-mono text-muted truncate">
                Preview: <strong className="text-emerald-500">{folderPreview}</strong>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-bold text-foreground">File Naming Template</label>
                <span className="text-[10px] font-mono text-muted">Tokens: {'{date}'}, {'{title}'}, {'{lang}'}</span>
              </div>
              <input
                type="text"
                value={driveConfig.fileNamingTemplate || '{date}_{title}_{lang}.mp4'}
                onChange={(e) => setDriveConfig({ ...driveConfig, fileNamingTemplate: e.target.value })}
                className="pro-input w-full rounded-lg px-3 py-1.5 text-xs font-mono"
              />
              <div className="mt-1 p-2 rounded bg-surface-100 border border-border text-[11px] font-mono text-muted truncate">
                Preview: <strong className="text-emerald-500">{filePreview}</strong>
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

      {/* Dynamic Channels Manager */}
      <div className="pro-panel p-4 rounded-xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Tv className="w-4 h-4 text-foreground" />
            <h3 className="text-xs font-bold font-mono text-foreground uppercase tracking-wider">
              Channel Profiles &amp; Niches
            </h3>
            <span className="px-2 py-0.5 rounded font-mono text-[10px] font-bold bg-surface-200 text-foreground border border-border">
              {channels.length} Configured
            </span>
          </div>

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
                driveFolder: 'Tutorials/'
              });
              setIsChannelModalOpen(true);
            }}
            className="btn-solid px-3 py-1 rounded text-xs font-semibold flex items-center gap-1"
          >
            <Plus className="w-3 h-3" /> Add Channel
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {channels.map(c => (
            <div key={c.id} className="p-3.5 rounded-xl bg-surface-100 border border-border flex flex-col justify-between space-y-3">
              <div>
                <div className="flex items-center justify-between">
                  <span
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: c.badgeColor || '#00e5ff' }}
                  />
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
                        className="p-1 rounded hover:bg-surface-200 text-muted hover:text-red-400"
                        title="Delete Channel"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
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

      {/* API Keys Vault */}
      <div className="pro-panel p-4 rounded-xl space-y-4">
        <div className="flex items-center gap-2">
          <Key className="w-4 h-4 text-foreground" />
          <h3 className="text-xs font-bold font-mono text-foreground uppercase tracking-wider">
            API Keys &amp; Intelligence Models
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          
          {/* Groq LLaMA 3.3 70B */}
          <div className="space-y-1.5 p-3 rounded-lg bg-surface-200/50 border border-border">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-foreground">Groq API Key (Primary LLaMA 3.3 70B)</label>
              <div className="flex items-center gap-1.5">
                {testResults.groq && (
                  <span className={`text-[10px] font-mono font-bold ${testResults.groq.ok ? 'text-emerald-500' : 'text-red-500'}`}>
                    {testResults.groq.message}
                  </span>
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
            <input
              type="password"
              value={groqKey}
              onChange={(e) => setGroqKey(e.target.value)}
              placeholder="gsk_..."
              className="pro-input w-full rounded-lg px-3 py-2 text-xs font-mono"
            />
          </div>

          {/* DeepSeek Flash Fallback */}
          <div className="space-y-1.5 p-3 rounded-lg bg-surface-200/50 border border-border">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-foreground">DeepSeek Flash API Key (deepseek-chat Fallback)</label>
              <div className="flex items-center gap-1.5">
                {testResults.deepseek && (
                  <span className={`text-[10px] font-mono font-bold ${testResults.deepseek.ok ? 'text-emerald-500' : 'text-red-500'}`}>
                    {testResults.deepseek.message}
                  </span>
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
            <input
              type="password"
              value={deepseekKey}
              onChange={(e) => setDeepseekKey(e.target.value)}
              placeholder="sk-..."
              className="pro-input w-full rounded-lg px-3 py-2 text-xs font-mono"
            />
          </div>

          {/* ElevenLabs API Key */}
          <div className="space-y-1.5 p-3 rounded-lg bg-surface-200/50 border border-border">
            <label className="block text-xs font-bold text-foreground">ElevenLabs API Key (Neural Voice)</label>
            <input
              type="password"
              value={elevenKey}
              onChange={(e) => setElevenKey(e.target.value)}
              placeholder="xi-api-key..."
              className="pro-input w-full rounded-lg px-3 py-2 text-xs font-mono"
            />
          </div>

          {/* Fish Audio API Key */}
          <div className="space-y-1.5 p-3 rounded-lg bg-surface-200/50 border border-border">
            <label className="block text-xs font-bold text-foreground">Fish Audio API Key</label>
            <input
              type="password"
              value={fishKey}
              onChange={(e) => setFishKey(e.target.value)}
              placeholder="fish-api-key..."
              className="pro-input w-full rounded-lg px-3 py-2 text-xs font-mono"
            />
          </div>

          {/* OpenAI API Key */}
          <div className="space-y-1.5 p-3 rounded-lg bg-surface-200/50 border border-border md:col-span-2">
            <label className="block text-xs font-bold text-foreground">OpenAI API Key (TTS &amp; Embeddings)</label>
            <input
              type="password"
              value={openAiKey}
              onChange={(e) => setOpenAiKey(e.target.value)}
              placeholder="sk-proj-..."
              className="pro-input w-full rounded-lg px-3 py-2 text-xs font-mono"
            />
          </div>

        </div>
      </div>

      {/* Backend API Server Health */}
      <div className="pro-panel p-4 rounded-xl space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className="w-3.5 h-3.5 text-muted" />
            <h3 className="text-xs font-bold font-mono text-foreground uppercase tracking-wider">
              Backend Render Pipeline Server
            </h3>
          </div>

          <div className="flex items-center gap-2">
            {testResults.server && (
              <span className={`text-[10px] font-mono font-bold ${testResults.server.ok ? 'text-emerald-500' : 'text-red-500'}`}>
                {testResults.server.message}
              </span>
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
          <label className="block text-xs font-semibold text-foreground mb-1">
            Backend API Endpoint URL
          </label>
          <input
            type="text"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder="http://localhost:3001"
            className="pro-input w-full rounded-lg px-3 py-2 text-xs font-mono"
          />
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
            Point this at your <strong>own</strong> keyword tool to pull live topics into the
            "My Keywords" pool. Leave blank to run self-contained on the Starter List + CSV imports.
          </p>
        </div>
      </div>

      {/* User Account Edit / Create Modal */}
      {isUserModalOpen && editingUser && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface-100 border border-border rounded-xl max-w-md w-full p-5 space-y-4 shadow-elevation animate-fadeIn">
            <h3 className="text-sm font-bold text-foreground font-display">
              {users.some(u => u.id === editingUser.id) ? 'Edit Operator Account' : 'Add Operator Account'}
            </h3>

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
                  onChange={(e) => setEditingUser({ ...editingUser, role: e.target.value as any })}
                  className="pro-input w-full rounded-lg px-2.5 py-1.5 text-xs"
                >
                  <option value="admin">Administrator (Full Access)</option>
                  <option value="manager">Manager (Production Lead)</option>
                  <option value="va">Virtual Assistant (Recording &amp; Conveyor)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">Accessible Channels</label>
                <div className="space-y-1 max-h-32 overflow-y-auto p-2 rounded bg-surface-200 border border-border">
                  {channels.map(ch => {
                    const isChecked = editingUser.assignedChannels?.includes(ch.id);
                    return (
                      <label key={ch.id} className="flex items-center gap-2 text-xs cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            const current = editingUser.assignedChannels || [];
                            const updated = e.target.checked
                              ? [...current, ch.id]
                              : current.filter(id => id !== ch.id);
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
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <button
                onClick={() => {
                  setIsUserModalOpen(false);
                  setEditingUser(null);
                }}
                className="btn-outline px-3 py-1.5 rounded-lg text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={() => handleSaveUser(editingUser)}
                className="btn-solid px-4 py-1.5 rounded-lg text-xs font-bold"
              >
                Save Account
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Channel Edit / Create Modal */}
      {isChannelModalOpen && editingChannel && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface-100 border border-border rounded-xl max-w-lg w-full p-5 space-y-4 shadow-elevation animate-fadeIn">
            <h3 className="text-sm font-bold text-foreground font-display">
              {channels.some(c => c.id === editingChannel.id) ? 'Edit Channel Profile' : 'Create New Channel'}
            </h3>

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
                <label className="block text-xs font-semibold text-foreground mb-1">
                  Custom AI Prompting Rules (Tone &amp; Style)
                </label>
                <input
                  type="text"
                  value={editingChannel.customPromptRules || ''}
                  onChange={(e) => setEditingChannel({ ...editingChannel, customPromptRules: e.target.value })}
                  placeholder="e.g. Fast-paced, zero fluff, concise steps"
                  className="pro-input w-full rounded-lg px-3 py-2 text-xs font-mono"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
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
                onClick={() => handleSaveChannel(editingChannel)}
                className="btn-solid px-4 py-1.5 rounded-lg text-xs font-bold"
              >
                Save Channel
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
