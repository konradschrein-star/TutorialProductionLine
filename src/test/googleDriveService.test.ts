import { describe, it, expect, beforeEach } from 'vitest';
import { GoogleDriveService } from '../services/googleDriveService';
import { StorageService } from '../services/storageService';

describe('GoogleDriveService Unit Tests', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should correctly interpolate folder path template tokens', () => {
    const path = GoogleDriveService.resolveFolderPath(
      {
        channelName: 'Entrepreneurs Skool',
        topic: 'How to Automate Invoices in Excel',
        title: 'How to Automate Invoices'
      },
      '{channel}/{year}_{month}/{topic_slug}/'
    );

    expect(path).toContain('Entrepreneurs_Skool');
    expect(path).toContain('how_to_automate_invoices_in_excel');
    expect(path.endsWith('/')).toBe(true);
  });

  it('should correctly interpolate file naming pattern', () => {
    const fileName = GoogleDriveService.resolveFileName(
      {
        channelName: 'Your VirtualFD',
        topic: 'QuickBooks Reconciliation',
        title: 'QuickBooks Online 2026',
        lang: 'de',
        extension: 'mp4'
      },
      '{date}_{title}_{lang}.mp4'
    );

    expect(fileName).toContain('QuickBooks_Online_2026_de.mp4');
    expect(fileName.endsWith('.mp4')).toBe(true);
  });

  it('should validate connection diagnostics for service account and API key', async () => {
    const res = await GoogleDriveService.testConnection({
      enabled: true,
      connectionMode: 'service_account',
      serviceAccountJson: JSON.stringify({
        client_email: 'test-sa@project.iam.gserviceaccount.com',
        private_key: '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC...\n-----END PRIVATE KEY-----'
      }),
      folderStructureTemplate: '{channel}/',
      fileNamingTemplate: '{title}.mp4',
      autoUploadOnRender: true,
      uploadThumbnail: true,
      uploadManifest: true,
      isConnected: false
    });

    expect(res.ok).toBe(true);
    expect(res.message).toContain('test-sa@project.iam.gserviceaccount.com');
  });

  it('should dispatch upload and record delivery in storage', async () => {
    const delivery = await GoogleDriveService.dispatchUpload({
      jobId: 'job_test_123',
      title: 'Automate Notion Tasks',
      topic: 'Notion Tasks',
      channelName: 'Entrepreneurs Skool',
      fileSize: 24 * 1024 * 1024
    });

    expect(delivery.jobId).toBe('job_test_123');
    expect(delivery.status).toBe('IN_GOOGLE_DRIVE');

    const logs = StorageService.getDriveDeliveries();
    expect(logs.some(d => d.jobId === 'job_test_123')).toBe(true);
  });
});
