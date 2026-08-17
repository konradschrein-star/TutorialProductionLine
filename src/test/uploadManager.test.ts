import { describe, it, expect, beforeEach } from 'vitest';
import { uploadManager } from '../services/uploadManager';

describe('UploadManager Unit Tests', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should enqueue and track background uploads', () => {
    const dummyFile = new File([new ArrayBuffer(1024 * 1024)], 'test.mp4', { type: 'video/mp4' });

    uploadManager.enqueue({
      jobId: 'test_upload_1',
      jobTitle: 'Test Upload Title',
      channelName: 'Entrepreneurs Skool',
      file: dummyFile
    });

    const snapshot = uploadManager.getSnapshot();
    const item = snapshot.find(u => u.jobId === 'test_upload_1');
    expect(item).toBeDefined();
    expect(item?.state).toBe('uploading');

    uploadManager.dismiss('test_upload_1');
    const afterDismiss = uploadManager.getSnapshot();
    expect(afterDismiss.find(u => u.jobId === 'test_upload_1')).toBeUndefined();
  });
});
