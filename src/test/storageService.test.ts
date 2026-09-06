import { describe, it, expect, beforeEach } from 'vitest';
import { StorageService, DEFAULT_CHANNELS, DEFAULT_USERS } from '../services/storageService';

describe('StorageService Unit Tests', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should get default active channel and user', () => {
    const ch = StorageService.getActiveChannel();
    expect(ch.name).toBe('Your VirtualFD');

    const user = StorageService.getActiveUser();
    expect(user.name).toBe('Nalu');
  });

  it('should set and get API keys including Gemini and DeepSeek from vault', () => {
    StorageService.setApiKey('gemini', 'AIzaSy_test_gemini_key');
    StorageService.setApiKey('groq', 'gsk_test_key_123');
    StorageService.setApiKey('deepseek', 'sk_deepseek_flash_key');
    expect(StorageService.getApiKey('gemini')).toBe('AIzaSy_test_gemini_key');
    expect(StorageService.getApiKey('groq')).toBe('gsk_test_key_123');
    expect(StorageService.getApiKey('deepseek')).toBe('sk_deepseek_flash_key');
  });

  it('should manage custom dynamic channels CRUD', () => {
    const initialChannels = StorageService.getChannels();
    expect(initialChannels.length).toBe(3);

    const newChannel = {
      id: 'custom_chan_1',
      name: 'Automated Apps Channel',
      niche: 'AI Agents & Automation',
      description: 'Tutorials on coding AI agents',
      badgeColor: '#ff0055',
      defaultVoiceId: 'fish-adam-punchy',
      targetCategory: 'Tech',
      driveFolder: 'AutomatedApps/Tutorials'
    };

    StorageService.saveChannel(newChannel);
    const updated = StorageService.getChannels();
    expect(updated.length).toBe(4);
    expect(updated.some(c => c.id === 'custom_chan_1')).toBe(true);

    StorageService.deleteChannel('custom_chan_1');
    expect(StorageService.getChannels().length).toBe(3);
  });

  it('should manage Google Drive configuration and delivery logging', () => {
    const defaultDrive = StorageService.getGoogleDriveConfig();
    expect(defaultDrive.folderStructureTemplate).toContain('{channel}');

    StorageService.setGoogleDriveConfig({
      ...defaultDrive,
      folderStructureTemplate: 'MyClient/{channel}/{date}/'
    });

    const savedDrive = StorageService.getGoogleDriveConfig();
    expect(savedDrive.folderStructureTemplate).toBe('MyClient/{channel}/{date}/');

    StorageService.addDriveDelivery({
      id: 'del_test',
      jobId: 'job_test',
      title: 'Test Tutorial',
      channel: 'Entrepreneurs Skool',
      fileName: 'test.mp4',
      drivePath: 'MyClient/Entrepreneurs_Skool/2026-08-18/',
      fileSize: 1024,
      uploadedAt: '2026-08-18 20:00:00',
      status: 'IN_GOOGLE_DRIVE'
    });

    const deliveries = StorageService.getDriveDeliveries();
    expect(deliveries[0].id).toBe('del_test');
  });

  it('should store, update, and retrieve finished videos with editable scripts', () => {
    // A fresh store is honestly EMPTY (no fabricated demo videos are seeded).
    const listBefore = StorageService.getFinishedVideos();
    expect(Array.isArray(listBefore)).toBe(true);

    StorageService.addFinishedVideo({
      id: 'test_job_1',
      title: 'How to Build Invoices in Excel',
      channel: 'Entrepreneurs Skool',
      status: 'Queued for Stealth Upload',
      thumbnailUrl: '/test.png',
      duration: '4:00',
      script: 'Initial script text',
      tags: ['excel'],
      createdAt: '2026-08-17'
    });

    const listAfter = StorageService.getFinishedVideos();
    expect(listAfter[0].id).toBe('test_job_1');
    expect(listAfter[0].script).toBe('Initial script text');

    // Update the script
    StorageService.updateFinishedVideo('test_job_1', { script: 'User-edited script text with modifications' });
    const listUpdated = StorageService.getFinishedVideos();
    expect(listUpdated.find(v => v.id === 'test_job_1')?.script).toBe('User-edited script text with modifications');
  });
});
