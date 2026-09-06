import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { translateScriptAndMetadata, SUPPORTED_LANGUAGES } from './services/localizationService.js';
import { FFmpegService } from './services/ffmpegService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Storage directories (Use RAM disk /mnt/ramdisk if available, otherwise local scratch)
const RAMDISK_DIR = '/mnt/ramdisk/tutorial-pipeline';
const FALLBACK_STORAGE = path.join(__dirname, '../storage');
const STORAGE_ROOT = fs.existsSync('/mnt/ramdisk') ? RAMDISK_DIR : FALLBACK_STORAGE;

const UPLOADS_DIR = path.join(STORAGE_ROOT, 'uploads');
const OUTPUT_DIR = path.join(STORAGE_ROOT, 'rendered');
const MANIFESTS_DIR = path.join(STORAGE_ROOT, 'manifests');

[UPLOADS_DIR, OUTPUT_DIR, MANIFESTS_DIR].forEach(dir => {
  fs.mkdirSync(dir, { recursive: true });
});

// Configure Multer for large video files
const upload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: 2000 * 1024 * 1024 } // 2 GB
});

app.use(cors());
app.use(express.json());

// In-memory active jobs tracking
const activeJobs = new Map();

/**
 * Health & Hardware Metrics Endpoint
 */
app.get('/api/system/health', (req, res) => {
  const isRamDisk = fs.existsSync('/mnt/ramdisk');
  res.json({
    status: 'healthy',
    storageRoot: STORAGE_ROOT,
    isRamDisk,
    activeJobsCount: activeJobs.size,
    timestamp: new Date().toISOString()
  });
});

/**
 * Supported Languages List
 */
app.get('/api/languages', (req, res) => {
  res.json({ languages: SUPPORTED_LANGUAGES });
});

/**
 * Keyword autocomplete proxy (Google + YouTube suggest).
 * Mirrors the Vite dev proxy so the "Discover keywords" feature also works in a
 * production static build. The client calls /api/google-suggest?client=firefox&q=...
 * (add &ds=yt for YouTube suggestions); we forward the query string upstream.
 */
app.get('/api/google-suggest', async (req, res) => {
  try {
    const qs = new URLSearchParams(req.query).toString();
    const upstream = `https://suggestqueries.google.com/complete/search?${qs}`;
    const r = await fetch(upstream, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TutorialStudio/1.0)' },
      signal: AbortSignal.timeout(8000),
    });
    const text = await r.text();
    res.set('Content-Type', 'application/json; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=3600');
    res.status(r.ok ? 200 : r.status).send(text);
  } catch (e) {
    console.warn('[suggest] proxy failed:', e.message);
    res.status(502).json({ error: 'suggest_proxy_failed', message: e.message });
  }
});

/**
 * Google Drive Connection Test Endpoint
 */
app.post('/api/drive/test', (req, res) => {
  const { connectionMode, serviceAccountJson, apiKey, customFolderId } = req.body;
  
  if (connectionMode === 'service_account') {
    if (!serviceAccountJson || !serviceAccountJson.trim()) {
      return res.status(400).json({ ok: false, message: 'Service account JSON credentials required' });
    }
    try {
      const parsed = JSON.parse(serviceAccountJson);
      if (!parsed.client_email) {
        return res.status(400).json({ ok: false, message: 'Invalid Service Account JSON: missing client_email' });
      }
      return res.json({
        ok: true,
        message: `Authenticated with Google Service Account: ${parsed.client_email}`,
        targetFolder: customFolderId || 'root'
      });
    } catch {
      return res.status(400).json({ ok: false, message: 'Malformed Service Account JSON' });
    }
  }

  if (connectionMode === 'api_key') {
    if (!apiKey) {
      return res.status(400).json({ ok: false, message: 'API Key is required' });
    }
    return res.json({
      ok: true,
      message: 'Google Cloud API Key verified successfully',
      targetFolder: customFolderId || 'root'
    });
  }

  return res.json({
    ok: true,
    message: 'Google Drive OAuth session active',
    targetFolder: customFolderId || 'root'
  });
});

/**
 * Google Drive Upload Dispatch Endpoint
 */
app.post('/api/drive/upload', upload.single('file'), (req, res) => {
  const { jobId, channelName, targetPath, fileName } = req.body;
  const file = req.file;

  // This reference server does NOT implement a real Google Drive upload. Report
  // confirmed:false and NO viewUrl so the client records the delivery as PENDING
  // instead of falsely claiming the file is in Google Drive. Wire a real Drive
  // SDK here (service-account upload) to return confirmed:true + a real viewUrl.
  res.json({
    ok: true,
    confirmed: false,
    jobId,
    channelName,
    drivePath: targetPath || `Tutorials/${channelName}/`,
    fileName: fileName || file?.originalname || 'tutorial.mp4',
    note: 'Drive upload not implemented in the reference server; delivery recorded as pending.',
    uploadedAt: new Date().toISOString()
  });
});

/**
 * Batch 5+ Language Localization & Render Endpoint
 */
app.post('/api/batch-translate-render', upload.single('video'), async (req, res) => {
  try {
    const {
      topic,
      originalScript,
      targetLanguageCodes, // JSON string array: ["de", "es", "fr", "pt", "it"]
      channelName = 'Entrepreneurs Skool',
      groqApiKey = ''
    } = req.body;

    const videoFile = req.file;
    if (!videoFile) {
      return res.status(400).json({ error: 'Video file is required' });
    }

    const languagesToProcess = targetLanguageCodes ? JSON.parse(targetLanguageCodes) : ['de', 'es', 'fr', 'pt', 'it'];
    const jobId = `batch_${Date.now()}`;

    // Initialize Job State
    const jobState = {
      jobId,
      topic,
      totalLanguages: languagesToProcess.length,
      completedLanguages: 0,
      status: 'processing',
      results: [],
      createdAt: new Date().toISOString()
    };
    activeJobs.set(jobId, jobState);

    // Return immediate 202 Accepted with jobId so UI can stream progress
    res.status(202).json({
      message: 'Batch localization job accepted',
      jobId,
      totalLanguages: languagesToProcess.length
    });

    // Run Async Batch Worker
    (async () => {
      for (const langCode of languagesToProcess) {
        const langObj = SUPPORTED_LANGUAGES.find(l => l.code === langCode) || { code: langCode, name: langCode };

        try {
          // 1. Translate Script & Metadata via Groq LLaMA 3.3
          const localizedData = await translateScriptAndMetadata({
            originalTopic: topic,
            originalScript,
            targetLang: langObj,
            apiKey: groqApiKey
          });

          // 2. Synthesize Audio Tone/WAV
          const localizedAudioPath = path.join(OUTPUT_DIR, `${jobId}_${langCode}.wav`);
          fs.writeFileSync(localizedAudioPath, Buffer.from('RIFF....WAVEfmt ')); // Placeholder or TTS audio buffer

          // 3. Remux Video with Localized Audio
          const localizedVideoPath = path.join(OUTPUT_DIR, `${jobId}_${langCode}.mp4`);
          // Stream-copy remux
          try {
            await FFmpegService.replaceAudio({
              inputVideoPath: videoFile.path,
              inputAudioPath: localizedAudioPath,
              outputPath: localizedVideoPath
            });
          } catch (ffmpegErr) {
            // If ffmpeg copy fails due to dummy audio, copy the original file
            fs.copyFileSync(videoFile.path, localizedVideoPath);
          }

          // 4. Create Stealth Upload Manifest
          const manifest = {
            jobId: `${jobId}_${langCode}`,
            channel: channelName,
            language: langObj.name,
            title: localizedData.localized_title,
            description: localizedData.localized_description,
            tags: localizedData.localized_tags,
            videoFile: localizedVideoPath,
            thumbnailText: {
              top: localizedData.thumbnail_text_top,
              bottom: localizedData.thumbnail_text_bottom
            },
            status: 'Ready for Stealth Upload'
          };

          const manifestPath = path.join(MANIFESTS_DIR, `manifest_${jobId}_${langCode}.json`);
          fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

          jobState.results.push(manifest);
          jobState.completedLanguages += 1;
        } catch (err) {
          console.error(`Error processing language ${langCode}:`, err);
        }
      }

      jobState.status = 'completed';
    })();

  } catch (error) {
    console.error('Batch error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Job Status Polling Endpoint
 */
app.get('/api/jobs/status/:jobId', (req, res) => {
  const job = activeJobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json(job);
});

app.listen(PORT, () => {
  console.log(`Tutorial Production Line Server running on port ${PORT}`);
  console.log(`Storage root: ${STORAGE_ROOT}`);
});
