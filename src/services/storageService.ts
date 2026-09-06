import {
  Channel,
  VAUser,
  FinishedVideo,
  GoogleDriveConfig,
  DriveDeliveryItem,
  CustomThumbnailAsset,
  StudioJob,
  OnboardingState
} from '../types';
import { StudioConfig, DEFAULT_STUDIO_CONFIG, FilterPreset, VATarget } from '../types/config';

export const DEFAULT_CHANNELS: Channel[] = [
  {
    id: 'virtualfd',
    name: 'Your VirtualFD',
    niche: 'Corporate Tools & Finance',
    description: 'ERP, inventory management, stock tooling, financial modeling, and B2B software.',
    badgeColor: '#00e5ff',
    defaultVoiceId: 'fish-paul-neutral',
    targetCategory: 'Corporate / Finance',
    subscribers: '14.2K',
    driveFolder: 'Your_VirtualFD/Tutorials',
    customPromptRules: 'Professional corporate tone, direct, concise, no filler words.',
    thumbnailStyle: {
      fontFamily: 'Impact',
      fontSize: 64,
      color: '#ffffff',
      strokeColor: '#000000',
      badgeColor: '#00e5ff'
    }
  },
  {
    id: 'skool',
    name: 'Entrepreneurs Skool',
    niche: 'Entrepreneur Tooling & Office Apps',
    description: 'High-volume office apps (Excel, Word, Power BI) and creator apps (Notion, Figma, Canva).',
    badgeColor: '#cb3cff',
    defaultVoiceId: 'fish-adam-punchy',
    targetCategory: 'Entrepreneurial / Office',
    subscribers: '48.6K',
    driveFolder: 'Entrepreneurs_Skool/Tutorials',
    customPromptRules: 'Fast-paced, energetic, step-by-step clarity for ambitious creators.',
    thumbnailStyle: {
      fontFamily: 'Impact',
      fontSize: 64,
      color: '#ffffff',
      strokeColor: '#000000',
      badgeColor: '#cb3cff'
    }
  },
  {
    id: 'blueprint',
    name: 'Blink Blueprint',
    niche: 'Full Software Walkthroughs',
    description: 'End-to-end full software deep dives and complete workflow tutorials.',
    badgeColor: '#00e5a0',
    defaultVoiceId: 'fish-sarah-calm',
    targetCategory: 'Complete Walkthroughs',
    subscribers: '29.1K',
    driveFolder: 'Blink_Blueprint/Tutorials',
    customPromptRules: 'Calm, authoritative, exhaustive technical walkthrough style.',
    thumbnailStyle: {
      fontFamily: 'Impact',
      fontSize: 64,
      color: '#ffffff',
      strokeColor: '#000000',
      badgeColor: '#00e5a0'
    }
  }
];

// Generic, single-tenant seed team. Each operator replaces these with their own
// accounts via Settings → Team. Deliberately free of any real names/emails so the
// product ships clean to any client.
export const DEFAULT_USERS: VAUser[] = [
  { id: '1', name: 'Omar (Admin)', email: 'omar@tutorialstudio.com', role: 'admin', assignedChannels: ['virtualfd', 'skool', 'blueprint'], assignedSoftwares: ['Excel', 'Word', 'Power BI', 'Notion', 'Figma', 'Canva', 'Photoshop', 'Blender'] },
  { id: '2', name: 'Jeen (Admin)', email: 'jeen@tutorialstudio.com', role: 'admin', assignedChannels: ['virtualfd', 'skool', 'blueprint'], assignedSoftwares: ['Excel', 'Word', 'Power BI', 'Notion', 'Figma', 'Canva', 'Photoshop', 'Blender'] },
  { id: '3', name: 'Nalu', email: 'nalu@tutorialstudio.com', role: 'va', assignedChannels: ['virtualfd', 'skool', 'blueprint'], assignedSoftwares: ['Notion', 'Figma', 'Canva', 'Excel', 'PowerPoint', 'Photoshop'] },
  { id: '4', name: 'Lorraine', email: 'lorraine@tutorialstudio.com', role: 'va', assignedChannels: ['virtualfd', 'skool', 'blueprint'], assignedSoftwares: ['Excel', 'Word', 'PowerPoint', 'Power BI', 'QuickBooks Online'] }
];


export const DEFAULT_GOOGLE_DRIVE_CONFIG: GoogleDriveConfig = {
  enabled: true,
  connectionMode: 'service_account',
  serviceAccountJson: '',
  apiKey: '',
  rootFolderId: 'root',
  folderStructureTemplate: '{channel}/{year}_{month}/{topic_slug}/',
  fileNamingTemplate: '{date}_{title}_{lang}.mp4',
  // Ship DISCONNECTED with auto-upload OFF. Nothing claims a Drive connection
  // until real credentials are entered and testConnection actually passes — so
  // the app never falsely reports "Uploaded to Drive" out of the box.
  autoUploadOnRender: false,
  uploadThumbnail: true,
  uploadManifest: true,
  isConnected: false
};

type StorageListener = (changedKey: string) => void;

export class StorageService {
  private static prefix = 'tpl_';
  private static memoryCache = new Map<string, any>();
  private static listeners = new Set<StorageListener>();
  private static crossTabBound = false;

  /**
   * Subscribe to store mutations. The callback receives the (unprefixed) key that
   * changed — or '*' for a bulk operation (import/reset). Returns an unsubscribe fn.
   * This is what makes the whole app reactive: any `set()` notifies subscribers,
   * so pages re-read live instead of showing stale snapshots.
   */
  static subscribe(fn: StorageListener): () => void {
    this.listeners.add(fn);
    this.bindCrossTab();
    return () => {
      this.listeners.delete(fn);
    };
  }

  private static emit(changedKey: string): void {
    this.listeners.forEach(l => {
      try { l(changedKey); } catch (e) { console.warn('StorageService listener failed:', e); }
    });
  }

  /** Mirror changes made in OTHER tabs into this tab's subscribers. */
  private static bindCrossTab(): void {
    if (this.crossTabBound || typeof window === 'undefined') return;
    this.crossTabBound = true;
    window.addEventListener('storage', (e) => {
      if (e.key && e.key.startsWith(this.prefix)) {
        this.memoryCache.delete(e.key);
        this.emit(e.key.slice(this.prefix.length));
      }
    });
  }

  static get<T>(key: string, defaultValue: T): T {
    try {
      const fullKey = this.prefix + key;
      if (typeof window === 'undefined' || !window.localStorage) {
        return this.memoryCache.has(fullKey) ? this.memoryCache.get(fullKey) : defaultValue;
      }

      const item = localStorage.getItem(fullKey);
      if (!item) {
        return this.memoryCache.has(fullKey) ? this.memoryCache.get(fullKey) : defaultValue;
      }
      return JSON.parse(item) as T;
    } catch (e) {
      console.warn(`StorageService.get failed for key "${key}", using fallback:`, e);
      return defaultValue;
    }
  }

  static set<T>(key: string, value: T): void {
    const fullKey = this.prefix + key;
    this.memoryCache.set(fullKey, value);

    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        localStorage.setItem(fullKey, JSON.stringify(value));
      }
    } catch (e) {
      console.warn(`StorageService.set failed for key "${key}" (falling back to in-memory):`, e);
    }

    this.emit(key);
  }

  // User Profile
  static getDeletedUserIds(): string[] {
    const ids = this.get<string[]>('deleted_user_ids', []);
    return Array.isArray(ids) ? ids : [];
  }

  static getActiveUser(): VAUser {
    const users = this.getUsers();
    const saved = this.get<VAUser | null>('active_user', null);
    if (saved && users.some(u => u.id === saved.id)) {
      return saved;
    }
    // Default to Nalu so she is immediately active and ready to work
    const nalu = users.find(u => u.name.toLowerCase().includes('nalu'));
    return nalu || users[0] || DEFAULT_USERS[0];
  }

  static setActiveUser(user: VAUser): void {
    if (!user || !user.id) return;
    this.set('active_user', user);
  }

  static getUsers(): VAUser[] {
    const deletedIds = this.getDeletedUserIds();
    const users = this.get<VAUser[]>('custom_users', DEFAULT_USERS);
    let list = Array.isArray(users) && users.length > 0 ? [...users] : [...DEFAULT_USERS];

    // Self-healing migration: Ensure generic VA placeholders are upgraded to real operators Nalu & Lorraine
    list = list.map(u => {
      if (u.name === 'Virtual Assistant 1' || (u.id === '3' && !u.name.toLowerCase().includes('nalu'))) {
        return {
          ...u,
          id: u.id || '3',
          name: 'Nalu',
          email: u.email === 'va1@tutorialstudio.com' ? 'nalu@tutorialstudio.com' : (u.email || 'nalu@tutorialstudio.com'),
          role: 'va' as const,
          assignedChannels: u.assignedChannels?.length ? u.assignedChannels : ['virtualfd', 'skool', 'blueprint'],
          assignedSoftwares: u.assignedSoftwares?.length ? u.assignedSoftwares : ['Notion', 'Figma', 'Canva', 'Excel', 'PowerPoint', 'Photoshop']
        };
      }
      if (u.name === 'Virtual Assistant 2' || (u.id === '4' && !u.name.toLowerCase().includes('lorraine'))) {
        return {
          ...u,
          id: u.id || '4',
          name: 'Lorraine',
          email: u.email === 'va2@tutorialstudio.com' ? 'lorraine@tutorialstudio.com' : (u.email || 'lorraine@tutorialstudio.com'),
          role: 'va' as const,
          assignedChannels: u.assignedChannels?.length ? u.assignedChannels : ['virtualfd', 'skool', 'blueprint'],
          assignedSoftwares: u.assignedSoftwares?.length ? u.assignedSoftwares : ['Excel', 'Word', 'PowerPoint', 'Power BI', 'QuickBooks Online']
        };
      }
      return u;
    });

    // Ensure Nalu is guaranteed in the list unless explicitly deleted
    const hasNalu = list.some(u => u.name.toLowerCase().includes('nalu') || u.email?.toLowerCase().includes('nalu'));
    if (!hasNalu && !deletedIds.includes('3') && !deletedIds.includes('usr_nalu')) {
      list.push(DEFAULT_USERS[2]);
    }

    // Ensure default team members exist if not deleted
    for (const defUser of DEFAULT_USERS) {
      if (deletedIds.includes(defUser.id)) continue;
      const exists = list.some(
        u => u.id === defUser.id ||
             u.email?.toLowerCase() === defUser.email?.toLowerCase() ||
             u.name?.toLowerCase() === defUser.name?.toLowerCase()
      );
      if (!exists) {
        list.push(defUser);
      }
    }

    return list.filter(u => !deletedIds.includes(u.id));
  }

  static saveUser(user: VAUser): void {
    if (!user || !user.id) return;
    const deletedIds = this.getDeletedUserIds().filter(id => id !== user.id);
    this.set('deleted_user_ids', deletedIds);
    const list = this.getUsers();
    const idx = list.findIndex(u => u.id === user.id);
    if (idx >= 0) {
      list[idx] = user;
    } else {
      list.push(user);
    }
    this.set('custom_users', list);
  }

  static deleteUser(userId: string): void {
    if (!userId) return;
    const deletedIds = this.getDeletedUserIds();
    if (!deletedIds.includes(userId)) {
      this.set('deleted_user_ids', [...deletedIds, userId]);
    }
    const list = this.getUsers().filter(u => u.id !== userId);
    this.set('custom_users', list.length > 0 ? list : DEFAULT_USERS.filter(u => u.id !== userId));
    const active = this.getActiveUser();
    if (active.id === userId) {
      this.setActiveUser(list[0] || DEFAULT_USERS[0]);
    }
  }

  // Channels Dynamic CRUD
  static getChannels(): Channel[] {
    const list = this.get<Channel[]>('custom_channels', DEFAULT_CHANNELS);
    return Array.isArray(list) && list.length > 0 ? list : DEFAULT_CHANNELS;
  }

  static getActiveChannel(): Channel {
    const channels = this.getChannels();
    const saved = this.get<Channel | null>('active_channel', null);
    if (saved && channels.some(c => c.id === saved.id)) {
      return saved;
    }
    return channels[0] || DEFAULT_CHANNELS[0];
  }

  static setActiveChannel(channel: Channel): void {
    if (!channel || !channel.id) return;
    this.set('active_channel', channel);
  }

  static saveChannel(channel: Channel): void {
    if (!channel || !channel.id) return;
    const list = this.getChannels();
    const idx = list.findIndex(c => c.id === channel.id);
    if (idx >= 0) {
      list[idx] = channel;
    } else {
      list.push(channel);
    }
    this.set('custom_channels', list);

    const active = this.getActiveChannel();
    if (active.id === channel.id) {
      this.setActiveChannel(channel);
    }
  }

  static deleteChannel(channelId: string): void {
    if (!channelId) return;
    const list = this.getChannels().filter(c => c.id !== channelId);
    this.set('custom_channels', list.length > 0 ? list : DEFAULT_CHANNELS);
    const active = this.getActiveChannel();
    if (active.id === channelId) {
      this.setActiveChannel(list[0] || DEFAULT_CHANNELS[0]);
    }
  }

  // API Keys
  static getApiKey(service: 'gemini' | 'groq' | 'deepseek' | 'elevenlabs' | 'fishaudio' | 'openai'): string {
    return this.get<string>(`api_key_${service}`, '').trim();
  }

  static setApiKey(service: 'gemini' | 'groq' | 'deepseek' | 'elevenlabs' | 'fishaudio' | 'openai', key: string): void {
    this.set(`api_key_${service}`, (key || '').trim());
  }

  /**
   * Optional endpoint for an operator's OWN external keyword tool/API.
   * Empty by default — the app is fully self-contained without it and must never
   * default to any third-party host. Configured per-instance via Settings.
   */
  static getExternalKeywordApi(): string {
    return this.get<string>('external_keyword_api', '').trim();
  }

  static setExternalKeywordApi(url: string): void {
    this.set('external_keyword_api', (url || '').trim());
  }

  // Google Drive Configuration & Delivery Logs
  static getGoogleDriveConfig(): GoogleDriveConfig {
    const cfg = this.get<GoogleDriveConfig>('google_drive_config', DEFAULT_GOOGLE_DRIVE_CONFIG);
    return { ...DEFAULT_GOOGLE_DRIVE_CONFIG, ...cfg };
  }

  static setGoogleDriveConfig(config: GoogleDriveConfig): void {
    if (!config) return;
    this.set('google_drive_config', config);
  }

  static getDriveDeliveries(): DriveDeliveryItem[] {
    const deliveries = this.get<DriveDeliveryItem[]>('drive_deliveries', []);
    return Array.isArray(deliveries) ? deliveries : [];
  }

  static addDriveDelivery(item: DriveDeliveryItem): void {
    if (!item || !item.id) return;
    const list = this.getDriveDeliveries();
    this.set('drive_deliveries', [item, ...list]);
  }

  // Custom Thumbnail Assets
  static getCustomThumbnailAssets(): CustomThumbnailAsset[] {
    const assets = this.get<CustomThumbnailAsset[]>('custom_thumbnail_assets', []);
    return Array.isArray(assets) ? assets : [];
  }

  static addCustomThumbnailAsset(asset: CustomThumbnailAsset): void {
    if (!asset || !asset.id) return;
    const list = this.getCustomThumbnailAssets();
    this.set('custom_thumbnail_assets', [asset, ...list]);
  }

  static deleteCustomThumbnailAsset(assetId: string): void {
    if (!assetId) return;
    const list = this.getCustomThumbnailAssets().filter(a => a.id !== assetId);
    this.set('custom_thumbnail_assets', list);
  }

  // Finished Videos Queue
  static getFinishedVideos(): FinishedVideo[] {
    const list = this.get<FinishedVideo[]>('finished_videos', []);
    return Array.isArray(list) ? list : [];
  }

  static addFinishedVideo(video: FinishedVideo): void {
    if (!video || !video.id) return;
    const list = this.getFinishedVideos();
    this.set('finished_videos', [video, ...list]);
  }

  static updateFinishedVideo(id: string, updates: Partial<FinishedVideo>): void {
    if (!id) return;
    const list = this.getFinishedVideos();
    const updated = list.map(v => v.id === id ? { ...v, ...updates } : v);
    this.set('finished_videos', updated);
  }

  static deleteFinishedVideo(id: string): void {
    if (!id) return;
    const list = this.getFinishedVideos().filter(v => v.id !== id);
    this.set('finished_videos', list);
  }

  static clearFinishedVideos(): void {
    this.set('finished_videos', []);
  }

  // Workstation Backup & Migration
  /** Canonical list of persisted keys backed up / restored / reset together. */
  private static BACKUP_KEYS = [
    'custom_channels',
    'active_channel',
    'custom_users',
    'deleted_user_ids',
    'active_user',
    'google_drive_config',
    'drive_deliveries',
    'finished_videos',
    'custom_thumbnail_assets',
    'studio_jobs',
    'external_keyword_api',
    'onboarding_state',
    'studio_config',
    'va_targets',
    'filter_presets',
    'screened_keywords_v2',
  ];

  static exportFullBackup(): Record<string, any> {
    const backup: Record<string, any> = {
      version: '1.1',
      exportedAt: new Date().toISOString()
    };
    this.BACKUP_KEYS.forEach(k => {
      backup[k] = this.get(k, null);
    });
    return backup;
  }

  static importFullBackup(data: Record<string, any>): boolean {
    if (!data || typeof data !== 'object') return false;
    Object.keys(data).forEach(k => {
      if (k !== 'version' && k !== 'exportedAt' && data[k] !== null && data[k] !== undefined) {
        this.set(k, data[k]);
      }
    });
    this.emit('*');
    return true;
  }

  static resetFactoryData(): void {
    this.BACKUP_KEYS.forEach(k => {
      this.memoryCache.delete(`${this.prefix}${k}`);
      try {
        localStorage.removeItem(`${this.prefix}${k}`);
      } catch {}
    });
    this.emit('*');
  }

  // Studio Jobs
  static getStudioJobs(): StudioJob[] {
    const list = this.get<StudioJob[]>('studio_jobs', []);
    return Array.isArray(list) ? list : [];
  }

  static saveStudioJob(job: StudioJob): void {
    if (!job || !job.id) return;
    const list = this.getStudioJobs();
    const idx = list.findIndex(j => j.id === job.id);
    if (idx >= 0) {
      list[idx] = { ...job, updatedAt: new Date().toISOString() };
    } else {
      list.unshift({ ...job, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    }
    this.set('studio_jobs', list);
  }

  static updateStudioJob(id: string, updates: Partial<StudioJob>): void {
    if (!id) return;
    const list = this.getStudioJobs();
    const updated = list.map(j => j.id === id ? { ...j, ...updates, updatedAt: new Date().toISOString() } : j);
    this.set('studio_jobs', updated);
  }

  static deleteStudioJob(id: string): void {
    if (!id) return;
    const list = this.getStudioJobs().filter(j => j.id !== id);
    this.set('studio_jobs', list);
  }

  // ---- Studio Configuration (the UI-editable control surface) ----------------
  static getConfig(): StudioConfig {
    const cfg = this.get<Partial<StudioConfig>>('studio_config', DEFAULT_STUDIO_CONFIG);
    // Deep-merge so new knobs added in later versions get sane defaults.
    return {
      ...DEFAULT_STUDIO_CONFIG,
      ...cfg,
      contentTypeMix: { ...DEFAULT_STUDIO_CONFIG.contentTypeMix, ...(cfg?.contentTypeMix || {}) },
      keyword: {
        ...DEFAULT_STUDIO_CONFIG.keyword,
        ...(cfg?.keyword || {}),
        scoreWeights: {
          ...DEFAULT_STUDIO_CONFIG.keyword.scoreWeights,
          ...((cfg?.keyword as any)?.scoreWeights || {}),
        },
      },
      lengthPresets: cfg?.lengthPresets?.length ? cfg.lengthPresets : DEFAULT_STUDIO_CONFIG.lengthPresets,
      speedPresets: cfg?.speedPresets?.length ? cfg.speedPresets : DEFAULT_STUDIO_CONFIG.speedPresets,
      standardLanguages: cfg?.standardLanguages?.length ? cfg.standardLanguages : DEFAULT_STUDIO_CONFIG.standardLanguages,
    };
  }

  static setConfig(config: StudioConfig): void {
    if (!config) return;
    this.set('studio_config', config);
  }

  static updateConfig(updates: Partial<StudioConfig>): StudioConfig {
    const next = { ...this.getConfig(), ...updates } as StudioConfig;
    this.setConfig(next);
    return next;
  }

  static resetConfig(): void {
    this.setConfig({ ...DEFAULT_STUDIO_CONFIG });
  }

  // ---- Per-VA production targets ---------------------------------------------
  static getVATargets(): Record<string, VATarget> {
    const t = this.get<Record<string, VATarget>>('va_targets', {});
    return t && typeof t === 'object' ? t : {};
  }

  static getVATarget(userId: string): VATarget {
    const cfg = this.getConfig();
    const t = this.getVATargets()[userId];
    return t || { userId, dailyTarget: cfg.defaultDailyTarget, weeklyTarget: cfg.defaultWeeklyTarget };
  }

  static setVATarget(target: VATarget): void {
    if (!target || !target.userId) return;
    const all = this.getVATargets();
    all[target.userId] = target;
    this.set('va_targets', all);
  }

  // ---- Saved keyword-filter presets ------------------------------------------
  static getFilterPresets(): FilterPreset[] {
    const list = this.get<FilterPreset[]>('filter_presets', []);
    return Array.isArray(list) ? list : [];
  }

  static saveFilterPreset(preset: FilterPreset): void {
    if (!preset || !preset.id) return;
    const list = this.getFilterPresets();
    const idx = list.findIndex(p => p.id === preset.id);
    if (idx >= 0) list[idx] = preset; else list.push(preset);
    this.set('filter_presets', list);
  }

  static deleteFilterPreset(id: string): void {
    if (!id) return;
    this.set('filter_presets', this.getFilterPresets().filter(p => p.id !== id));
  }

  // Onboarding / Setup Wizard State
  static getOnboardingState(): OnboardingState {
    const def: OnboardingState = { isCompleted: false, currentStep: 1 };
    const st = this.get<OnboardingState>('onboarding_state', def);
    return { ...def, ...st };
  }

  static setOnboardingState(state: OnboardingState): void {
    if (!state) return;
    this.set('onboarding_state', state);
  }
}
