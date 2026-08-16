import { Channel, VAUser, FinishedVideo } from '../types';

export const DEFAULT_CHANNELS: Channel[] = [
  {
    id: 'virtualfd',
    name: 'Your VirtualFD',
    niche: 'Corporate Tools & Finance',
    description: 'ERP, inventory management, stock tooling, financial modeling, and B2B software.',
    badgeColor: '#00e5ff',
    defaultVoiceId: 'fish-paul-neutral',
    targetCategory: 'Corporate / Finance',
    subscribers: '14.2K'
  },
  {
    id: 'skool',
    name: 'Entrepreneurs Skool',
    niche: 'Entrepreneur Tooling & Office Apps',
    description: 'High-volume office apps (Excel, Word, Power BI) and creator apps (Notion, Figma, Canva).',
    badgeColor: '#cb3cff',
    defaultVoiceId: 'fish-adam-punchy',
    targetCategory: 'Entrepreneurial / Office',
    subscribers: '48.6K'
  },
  {
    id: 'blueprint',
    name: 'Blink Blueprint',
    niche: 'Full Software Walkthroughs',
    description: 'End-to-end full software deep dives and complete workflow tutorials.',
    badgeColor: '#00e5a0',
    defaultVoiceId: 'fish-sarah-calm',
    targetCategory: 'Complete Walkthroughs',
    subscribers: '29.1K'
  }
];

export const DEFAULT_USERS: VAUser[] = [
  { id: '1', name: 'Konrad (Admin)', email: 'konrad@empire.com', role: 'admin', assignedChannels: ['virtualfd', 'skool', 'blueprint'] },
  { id: '2', name: 'Ian Christopher', email: 'decastroian76@gmail.com', role: 'manager', assignedChannels: ['virtualfd', 'skool', 'blueprint'] },
  { id: '3', name: 'Deion', email: 'deion@production.team', role: 'va', assignedChannels: ['skool'] },
  { id: '4', name: 'Earl', email: 'earl@production.team', role: 'va', assignedChannels: ['virtualfd'] },
  { id: '5', name: 'Vaughn', email: 'vaughn@production.team', role: 'va', assignedChannels: ['blueprint'] }
];

export class StorageService {
  private static prefix = 'tpl_';

  static get<T>(key: string, defaultValue: T): T {
    try {
      const item = localStorage.getItem(this.prefix + key);
      if (!item) return defaultValue;
      return JSON.parse(item) as T;
    } catch {
      return defaultValue;
    }
  }

  static set<T>(key: string, value: T): void {
    try {
      localStorage.setItem(this.prefix + key, JSON.stringify(value));
    } catch (e) {
      console.warn('LocalStorage write failed:', e);
    }
  }

  static getActiveUser(): VAUser {
    return this.get<VAUser>('active_user', DEFAULT_USERS[1]); // Default to Ian (Manager)
  }

  static setActiveUser(user: VAUser): void {
    this.set('active_user', user);
  }

  static getActiveChannel(): Channel {
    return this.get<Channel>('active_channel', DEFAULT_CHANNELS[1]); // Default to Skool
  }

  static setActiveChannel(channel: Channel): void {
    this.set('active_channel', channel);
  }

  static getApiKey(service: 'groq' | 'elevenlabs' | 'fishaudio' | 'openai'): string {
    return this.get<string>(`api_key_${service}`, '');
  }

  static setApiKey(service: 'groq' | 'elevenlabs' | 'fishaudio' | 'openai', key: string): void {
    this.set(`api_key_${service}`, key.trim());
  }

  static getFinishedVideos(): FinishedVideo[] {
    return this.get<FinishedVideo[]>('finished_videos', [
      {
        id: '1',
        title: 'How to Automate Invoices in Excel 2026',
        channel: 'Entrepreneurs Skool',
        status: 'Queued for Stealth Upload',
        thumbnailUrl: '/background/bg-gradient-1.png',
        duration: '4:12',
        script: 'Welcome to this complete guide...',
        tags: ['excel tutorial', 'automate invoices', 'excel 2026'],
        createdAt: '2026-08-16'
      }
    ]);
  }

  static addFinishedVideo(video: FinishedVideo): void {
    const list = this.getFinishedVideos();
    this.set('finished_videos', [video, ...list]);
  }
}
