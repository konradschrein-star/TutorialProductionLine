import { describe, it, expect, beforeEach } from 'vitest';
import { StorageService, DEFAULT_CHANNELS, DEFAULT_USERS } from '../services/storageService';

describe('StorageService Unit Tests', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should get default active channel and user', () => {
    const ch = StorageService.getActiveChannel();
    expect(ch.name).toBe('Entrepreneurs Skool');

    const user = StorageService.getActiveUser();
    expect(user.name).toBe('Ian Christopher');
  });

  it('should set and get API keys including DeepSeek from vault', () => {
    StorageService.setApiKey('groq', 'gsk_test_key_123');
    StorageService.setApiKey('deepseek', 'sk_deepseek_flash_key');
    expect(StorageService.getApiKey('groq')).toBe('gsk_test_key_123');
    expect(StorageService.getApiKey('deepseek')).toBe('sk_deepseek_flash_key');
  });

  it('should store, update, and retrieve finished videos with editable scripts', () => {
    const listBefore = StorageService.getFinishedVideos();
    expect(listBefore.length).toBeGreaterThan(0);

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
