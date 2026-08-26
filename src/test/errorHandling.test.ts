import { describe, it, expect, beforeEach } from 'vitest';
import { StorageService } from '../services/storageService';
import { GoogleDriveService } from '../services/googleDriveService';
import { KeywordService } from '../services/keywordService';
import { AIService } from '../services/aiService';
import { MetricsService } from '../services/metricsService';

describe('Defensive Error Handling & Edge Case Tests', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should gracefully handle malformed JSON in localStorage without throwing', () => {
    localStorage.setItem('tpl_custom_channels', 'INVALID_JSON_CORRUPTED{[');
    
    // Should fallback to default channels without crashing
    const channels = StorageService.getChannels();
    expect(channels.length).toBeGreaterThan(0);
    expect(channels[0].name).toBe('Your VirtualFD');
  });

  it('should sanitize directory traversal and dangerous characters in GoogleDriveService', () => {
    const dangerousPath = GoogleDriveService.resolveFolderPath({
      channelName: '../../etc/passwd',
      topic: '../../../exploit.sh',
      title: 'Normal Title'
    });

    expect(dangerousPath).not.toContain('..');
    expect(dangerousPath).toContain('etc_passwd');
  });

  it('should sanitize dangerous file names in GoogleDriveService', () => {
    const dangerousFileName = GoogleDriveService.resolveFileName({
      channelName: 'Channel',
      topic: 'Topic',
      title: '../../dangerous*file?:<>|',
      extension: 'mp4'
    });

    expect(dangerousFileName).not.toContain('..');
    expect(dangerousFileName).not.toContain('*');
    expect(dangerousFileName).not.toContain('?');
    expect(dangerousFileName.endsWith('.mp4')).toBe(true);
  });

  it('should handle corrupt/empty CSV rows without crashing KeywordService', () => {
    const corruptCSV = `\n\n\n,,,\n"Valid Keyword",Excel,5000,Low,skool\n,,,invalid,row\n"Another Valid",Notion,1200,Medium,virtualfd`;
    const res = KeywordService.importKeywordsFromCSV(corruptCSV);
    expect(res.added).toBe(2);
  });

  it('should produce valid metrics even when localStorage has null or corrupted entries', () => {
    localStorage.setItem('tpl_finished_videos', JSON.stringify([null, { id: 'bad' }, { id: 'good', duration: 'invalid_duration', channel: 'Test' }]));
    
    const metrics = MetricsService.getMetrics();
    expect(metrics.totalProduced).toBeGreaterThan(0);
    expect(typeof metrics.totalDurationMinutes).toBe('number');
    expect(isNaN(metrics.totalDurationMinutes)).toBe(false);
  });

  it('should handle empty string in AIService.generateScript gracefully', async () => {
    const script = await AIService.generateScript('', '', 'standard');
    expect(script.length).toBeGreaterThan(20);
  });

  it('should handle empty string in AIService.refineScript without throwing', async () => {
    const refined = await AIService.refineScript('', 'add_pauses');
    expect(refined).toBe('');
  });

  it('should handle invalid service account JSON in GoogleDriveService.testConnection', async () => {
    const result = await GoogleDriveService.testConnection({
      enabled: true,
      connectionMode: 'service_account',
      serviceAccountJson: 'INVALID JSON NOT PARSABLE',
      apiKey: '',
      folderStructureTemplate: '{channel}/',
      fileNamingTemplate: '{title}.mp4',
      autoUploadOnRender: true,
      uploadThumbnail: true,
      uploadManifest: true,
      isConnected: false
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('Invalid JSON');
  });
});
