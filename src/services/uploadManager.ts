import { UploadQueueItem } from '../types';

type Listener = () => void;

class UploadManager {
  private uploads: UploadQueueItem[] = [];
  private listeners: Set<Listener> = new Set();

  constructor() {
    // Load existing items from localStorage
    try {
      const saved = localStorage.getItem('tpl_upload_queue');
      if (saved) this.uploads = JSON.parse(saved);
    } catch {}
  }

  getSnapshot(): UploadQueueItem[] {
    return this.uploads;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    try {
      localStorage.setItem('tpl_upload_queue', JSON.stringify(this.uploads));
    } catch {}
    this.listeners.forEach(l => l());
  }

  enqueue(params: {
    jobId: string;
    jobTitle: string;
    channelName: string;
    file: File;
    thumbnailUrl?: string;
  }): void {
    const item: UploadQueueItem = {
      jobId: params.jobId,
      jobTitle: params.jobTitle,
      channelName: params.channelName,
      state: 'uploading',
      fileSize: params.file.size,
      uploadedBytes: 0,
      bytesPerSecond: 1024 * 1024 * 2.4, // 2.4 MB/s simulation
      etaSeconds: Math.ceil(params.file.size / (1024 * 1024 * 2.4)),
      thumbnailUrl: params.thumbnailUrl,
      createdAt: new Date().toISOString(),
    };

    this.uploads = [item, ...this.uploads.filter(u => u.jobId !== params.jobId)];
    this.notify();

    // Start simulated chunked background stream
    this.simulateUpload(params.jobId, params.file.size);
  }

  private simulateUpload(jobId: string, totalBytes: number) {
    let current = 0;
    const chunkSize = Math.max(1024 * 512, Math.floor(totalBytes / 20));

    const interval = setInterval(() => {
      const target = this.uploads.find(u => u.jobId === jobId);
      if (!target || target.state !== 'uploading') {
        clearInterval(interval);
        return;
      }

      current += chunkSize;
      if (current >= totalBytes) {
        current = totalBytes;
        target.state = 'finalizing';
        target.uploadedBytes = totalBytes;
        target.etaSeconds = 0;
        this.notify();

        setTimeout(() => {
          const finalItem = this.uploads.find(u => u.jobId === jobId);
          if (finalItem) {
            finalItem.state = 'done';
            this.notify();
          }
        }, 1200);

        clearInterval(interval);
      } else {
        target.uploadedBytes = current;
        const remaining = totalBytes - current;
        target.etaSeconds = Math.max(1, Math.ceil(remaining / target.bytesPerSecond));
        this.notify();
      }
    }, 400);
  }

  dismiss(jobId: string): void {
    this.uploads = this.uploads.filter(u => u.jobId !== jobId);
    this.notify();
  }

  retry(jobId: string): void {
    const item = this.uploads.find(u => u.jobId === jobId);
    if (item) {
      item.state = 'uploading';
      item.error = undefined;
      this.notify();
      this.simulateUpload(jobId, item.fileSize);
    }
  }
}

export const uploadManager = new UploadManager();
