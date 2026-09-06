import { GoogleDriveConfig, DriveDeliveryItem } from '../types';
import { StorageService } from './storageService';

export interface DrivePathParams {
  channelName: string;
  topic: string;
  title: string;
  lang?: string;
  extension?: string;
}

export class GoogleDriveService {
  /**
   * Resolve folder path based on user's customizable template
   * e.g. "{channel}/{year}_{month}/{topic_slug}/"
   */
  static resolveFolderPath(params: DrivePathParams, template?: string): string {
    const config = StorageService.getGoogleDriveConfig();
    const tpl = template || config.folderStructureTemplate || '{channel}/{year}_{month}/{topic_slug}/';
    
    const now = new Date();
    const year = now.getFullYear().toString();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const date = `${year}-${month}-${day}`;
    
    const channelClean = (params.channelName || 'General')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .replace(/\.{2,}/g, '');

    const topicSlug = (params.topic || 'tutorial')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 80);

    return tpl
      .replace(/\{channel\}/gi, channelClean)
      .replace(/\{channel_name\}/gi, channelClean)
      .replace(/\{year\}/gi, year)
      .replace(/\{month\}/gi, month)
      .replace(/\{day\}/gi, day)
      .replace(/\{date\}/gi, date)
      .replace(/\{topic_slug\}/gi, topicSlug)
      .replace(/\{topic\}/gi, topicSlug);
  }

  /**
   * Resolve file name based on user's customizable naming template
   * e.g. "{date}_{title}_{lang}.mp4"
   */
  static resolveFileName(params: DrivePathParams, template?: string): string {
    const config = StorageService.getGoogleDriveConfig();
    const tpl = template || config.fileNamingTemplate || '{date}_{title}_{lang}.mp4';
    
    const now = new Date();
    const year = now.getFullYear().toString();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const date = `${year}-${month}-${day}`;
    
    const titleClean = (params.title || 'tutorial')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .replace(/\.{2,}/g, '')
      .slice(0, 100);

    const lang = (params.lang || 'en').replace(/[^a-zA-Z0-9]/g, '');
    const ext = (params.extension || 'mp4').replace(/[^a-zA-Z0-9]/g, '');

    let resolved = tpl
      .replace(/\{date\}/gi, date)
      .replace(/\{year\}/gi, year)
      .replace(/\{month\}/gi, month)
      .replace(/\{day\}/gi, day)
      .replace(/\{title\}/gi, titleClean)
      .replace(/\{lang\}/gi, lang)
      .replace(/\{ext\}/gi, ext);

    if (!resolved.endsWith(`.${ext}`)) {
      resolved += `.${ext}`;
    }
    return resolved;
  }

  /**
   * Test Connection with Google Drive
   */
  static async testConnection(config: GoogleDriveConfig): Promise<{ ok: boolean; message: string; latencyMs: number }> {
    const start = Date.now();

    // 1. Try Backend verification if active
    try {
      const res = await fetch('/api/drive/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionMode: config.connectionMode,
          serviceAccountJson: config.serviceAccountJson,
          apiKey: config.apiKey,
          customFolderId: config.rootFolderId
        })
      });
      if (res.ok) {
        const data = await res.json();
        return { ok: data.ok, message: data.message, latencyMs: Date.now() - start };
      }
    } catch {
      // Backend not running, execute deterministic client validation
    }

    await new Promise(r => setTimeout(r, 300));

    // Client-side validation fallback (no backend reachable). This validates the
    // CONFIGURATION honestly — it does NOT perform a live Google handshake, and
    // it does not report success when credentials are missing.
    const note = ' (config check only — live upload needs the backend Drive service running)';

    if (config.connectionMode === 'service_account') {
      if (!config.serviceAccountJson || config.serviceAccountJson.trim() === '') {
        return { ok: false, message: 'No service account JSON provided. Paste your Google Cloud service account key.', latencyMs: Date.now() - start };
      }
      try {
        const parsed = JSON.parse(config.serviceAccountJson);
        if (parsed.client_email && (parsed.private_key || parsed.private_key_id)) {
          return { ok: true, message: `Service account looks valid: ${parsed.client_email}${note}`, latencyMs: Date.now() - start };
        }
        return { ok: false, message: 'Invalid service account JSON (missing client_email or private_key).', latencyMs: Date.now() - start };
      } catch (e: any) {
        return { ok: false, message: 'Invalid JSON syntax: ' + e.message, latencyMs: Date.now() - start };
      }
    }

    if (config.connectionMode === 'api_key') {
      if (config.apiKey && config.apiKey.length > 5) {
        return { ok: true, message: `API key present${note}`, latencyMs: Date.now() - start };
      }
      return { ok: false, message: 'No Google Drive API key provided.', latencyMs: Date.now() - start };
    }

    if (config.connectionMode === 'oauth') {
      if (config.clientId && config.clientSecret) {
        return { ok: true, message: `OAuth client configured${note}`, latencyMs: Date.now() - start };
      }
      return { ok: false, message: 'OAuth not configured. Provide a client ID and secret.', latencyMs: Date.now() - start };
    }

    return { ok: false, message: 'Select a connection mode and provide credentials.', latencyMs: Date.now() - start };
  }

  /**
   * Dispatch upload and record delivery in local store
   */
  static async dispatchUpload(params: {
    jobId: string;
    title: string;
    topic: string;
    channelName: string;
    fileSize?: number;
    lang?: string;
  }): Promise<DriveDeliveryItem> {
    const drivePath = this.resolveFolderPath(params);
    const fileName = this.resolveFileName({ ...params, extension: 'mp4' });

    // Only claim a real Google Drive upload when a backend actually confirms one.
    // Without a reachable backend we record the delivery as PENDING (status
    // 'DELIVERING') with NO fabricated view URL — never a fake "in Drive" + dead link.
    let viewUrl: string | undefined;
    let confirmed = false;

    try {
      const res = await fetch('/api/drive/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: params.jobId,
          channelName: params.channelName,
          targetPath: drivePath,
          fileName
        })
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.viewUrl && data.confirmed !== false) {
          viewUrl = data.viewUrl;
          confirmed = true;
        }
      }
    } catch {
      // No backend reachable — remains pending.
    }

    const deliveryItem: DriveDeliveryItem = {
      id: `del_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      jobId: params.jobId,
      title: params.title || 'Untitled Tutorial',
      channel: params.channelName || 'General',
      fileName,
      drivePath,
      fileSize: params.fileSize || 0,
      uploadedAt: new Date().toISOString().replace('T', ' ').substring(0, 19),
      status: confirmed ? 'IN_GOOGLE_DRIVE' : 'DELIVERING',
      viewUrl
    };

    try {
      StorageService.addDriveDelivery(deliveryItem);
    } catch (e) {
      console.warn('Failed to record delivery in StorageService:', e);
    }

    return deliveryItem;
  }
}
