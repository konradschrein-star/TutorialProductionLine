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
  { id: '1', name: 'Administrator', email: 'admin@example.com', role: 'admin', assignedChannels: ['virtualfd', 'skool', 'blueprint'] },
  { id: '2', name: 'Production Manager', email: 'manager@example.com', role: 'manager', assignedChannels: ['virtualfd', 'skool', 'blueprint'] },
  { id: '3', name: 'Operator One', email: 'operator1@example.com', role: 'va', assignedChannels: ['skool'] },
  { id: '4', name: 'Operator Two', email: 'operator2@example.com', role: 'va', assignedChannels: ['virtualfd'] },
  { id: '5', name: 'Operator Three', email: 'operator3@example.com', role: 'va', assignedChannels: ['blueprint'] }
];

export const DEFAULT_GOOGLE_DRIVE_CONFIG: GoogleDriveConfig = {
  enabled: true,
  connectionMode: 'service_account',
  serviceAccountJson: '',
  apiKey: '',
  rootFolderId: 'root',
  folderStructureTemplate: '{channel}/{year}_{month}/{topic_slug}/',
  fileNamingTemplate: '{date}_{title}_{lang}.mp4',
  autoUploadOnRender: true,
  uploadThumbnail: true,
  uploadManifest: true,
  isConnected: true,
  lastConnectedAt: new Date().toISOString()
};

export class StorageService {
  private static prefix = 'tpl_';
  private static memoryCache = new Map<string, any>();

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
  }

  // User Profile
  static getActiveUser(): VAUser {
    return this.get<VAUser>('active_user', DEFAULT_USERS[1]);
  }

  static setActiveUser(user: VAUser): void {
    if (!user || !user.id) return;
    this.set('active_user', user);
  }

  static getUsers(): VAUser[] {
    const users = this.get<VAUser[]>('custom_users', DEFAULT_USERS);
    return Array.isArray(users) && users.length > 0 ? users : DEFAULT_USERS;
  }

  static saveUser(user: VAUser): void {
    if (!user || !user.id) return;
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
    const list = this.getUsers().filter(u => u.id !== userId);
    this.set('custom_users', list.length > 0 ? list : DEFAULT_USERS);
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
  static getApiKey(service: 'groq' | 'deepseek' | 'elevenlabs' | 'fishaudio' | 'openai'): string {
    return this.get<string>(`api_key_${service}`, '').trim();
  }

  static setApiKey(service: 'groq' | 'deepseek' | 'elevenlabs' | 'fishaudio' | 'openai', key: string): void {
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
    const deliveries = this.get<DriveDeliveryItem[]>('drive_deliveries', [
      {
        id: 'del_1',
        jobId: '1',
        title: 'How to Automate Invoices in Excel 2026',
        channel: 'Entrepreneurs Skool',
        fileName: '2026-08-16_How_to_Automate_Invoices_in_Excel_2026_en.mp4',
        drivePath: 'Entrepreneurs_Skool/Tutorials/2026_08/automate_invoices/',
        fileSize: 48 * 1024 * 1024,
        uploadedAt: '2026-08-16 14:32:10',
        status: 'IN_GOOGLE_DRIVE',
        viewUrl: 'https://drive.google.com/drive/folders/tutorial_production_line'
      }
    ]);
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
    const list = this.get<FinishedVideo[]>('finished_videos', [
      {
        id: '1',
        title: 'How to Automate Invoices in Excel 2026',
        channel: 'Entrepreneurs Skool',
        status: 'Uploaded to Drive',
        thumbnailUrl: '/background/bg-gradient-1.png',
        duration: '4:12',
        script: 'Welcome to this complete guide on automating your Excel invoices in 2026. In this tutorial, we cover VBA macros, XLOOKUP formulas, and dynamic PDF export.',
        tags: ['excel tutorial', 'automate invoices', 'excel 2026'],
        drivePath: 'Entrepreneurs_Skool/Tutorials/2026_08/automate_invoices/',
        driveUrl: 'https://drive.google.com/drive/folders/tutorial_production_line',
        createdAt: '2026-08-16'
      }
    ]);
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

  // Studio Jobs
  static getStudioJobs(): StudioJob[] {
    const list = this.get<StudioJob[]>('studio_jobs', [
      {
        id: 'job_101',
        title: 'How to Build an Inventory Tracker in Notion',
        topic: 'Build an Inventory Tracker in Notion',
        channelId: 'skool',
        channelName: 'Entrepreneurs Skool',
        status: 'READY_TO_RECORD',
        script: 'In this video, I will show you how to build a dynamic inventory tracker in Notion from scratch. First, create a database with relation and formula properties...',
        voiceId: 'fish-adam-punchy',
        voiceSpeed: 1.25,
        audioUrl: '/sample-audio.wav',
        durationSeconds: 195,
        deliveredToDrive: false,
        createdAt: new Date(Date.now() - 3600000).toISOString(),
        updatedAt: new Date(Date.now() - 1800000).toISOString()
      },
      {
        id: 'job_102',
        title: 'QuickBooks Online 2026 Reconciliation Masterclass',
        topic: 'QuickBooks Online 2026 Reconciliation',
        channelId: 'virtualfd',
        channelName: 'Your VirtualFD',
        status: 'COMPLETED',
        script: 'Welcome back to Your VirtualFD. Today we are doing a deep dive into QuickBooks Online bank feeds and matching rules...',
        voiceId: 'fish-paul-neutral',
        voiceSpeed: 1.15,
        audioUrl: '/sample-audio.wav',
        durationSeconds: 340,
        deliveredToDrive: true,
        drivePath: 'Your_VirtualFD/Tutorials/2026_08/quickbooks_reconciliation/',
        driveUrl: 'https://drive.google.com/drive/folders/quickbooks',
        createdAt: new Date(Date.now() - 7200000).toISOString(),
        updatedAt: new Date(Date.now() - 3600000).toISOString()
      }
    ]);
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
