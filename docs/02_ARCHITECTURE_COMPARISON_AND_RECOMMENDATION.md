# 🛠️ Production Rebuild Roadmap & Technical Specification
**Target Project:** `rhyleematte/Youtube-Automation` Remediation  
**Author:** Principal Engineer (Titan Edition)  
**Date:** August 18, 2026  
**Audience:** Development Team & Project Leadership  

---

## 🎯 Objective & Strategic Blueprint

This specification provides the precise, step-by-step engineering roadmap to transform the `rhyleematte/Youtube-Automation` prototype into an enterprise-grade, reliable, and secure production platform.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             5-STEP CREATOR UX                               │
│  [1. Topic / SEO] ➔ [2. Script Gen] ➔ [3. Voiceover] ➔ [4. Video] ➔ [5. Review] │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ Async REST / SSE
┌──────────────────────────────────────▼──────────────────────────────────────┐
│                    PRODUCTION BACKEND ENGINE (Fastify / Next.js)            │
│  - Secure Key Vault (Zero secrets in Git)                                   │
│  - Multi-Tenant Role Isolation (Admin / Manager / VA)                       │
│  - Rate Limiting & Defensive Retry Wrappers                                 │
└──────────────────┬───────────────────────────────────────────┬──────────────┘
                   │                                           │
┌──────────────────▼───────────────┐       ┌───────────────────▼──────────────┐
│       ASYNC WORKER QUEUE         │       │        DATA PERSISTENCE          │
│   - BullMQ + Redis Task Pool     │       │   - PostgreSQL / Structured DB   │
│   - Hardware-Accelerated FFmpeg  │       │   - Video Job Tracking Schema    │
│   - Background Storage Purge     │       │   - Real Keyword Index           │
└──────────────────┬───────────────┘       └──────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────────────────────────────┐
│                          EXTERNAL PRODUCTION INTEGRATIONS                   │
│   - Audio: Fish Audio / ElevenLabs TTS API                                  │
│   - LLM: Groq LLaMA 3.3 / Claude 3.5 Sonnet / DeepSeek                      │
│   - Keywords: Google Suggest API / YouTube Data API v3                      │
│   - Publishing: YouTube Data API v3 OAuth2 OR Stealth Native Manifest      │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔒 Phase 1: Security Quarantine & Credential Scrubbing (Immediate)

Before writing any new application code, the repository must be cleansed of leaked secrets.

### 1.1 Invalidate Leaked Credentials
1. **Server SSH Access:**
   * Open the VPS `/root/.ssh/authorized_keys` and remove the leaked public key associated with `ssh-key-2026-07-10.key`.
   * Generate a fresh ED25519 keypair: `ssh-keygen -t ed25519 -C "production-deploy-key"`.
2. **Google Account Sessions:**
   * Log into Google Security for any account present in `youtube_sessions/`.
   * Force "Sign out of all other sessions" and reset account passwords.

### 1.2 Git History Purge
Run BFG Repo-Cleaner to permanently scrub keys and session profiles from repository commit history:
```bash
# 1. Clone a fresh mirror of the repository
git clone --mirror https://github.com/rhyleematte/Youtube-Automation.git repo-mirror
cd repo-mirror

# 2. Strip sensitive files and directories
bfg --delete-files "*.key"
bfg --delete-files "*.key.pub"
bfg --delete-folders "youtube_sessions"

# 3. Clean reflogs and force push back to origin
git reflog expire --expire=now --all && git gc --prune=now --aggressive
git push --force origin
```

---

## 🎙️ Phase 2: Replacing Hallucinated TTS with Real Voice Synthesis

Delete `src/api/voxtral.js` and implement a multi-provider TTS service with proper error handling and streaming.

### 2.1 Fish Audio & ElevenLabs Integration Specification
Create `server/services/ttsService.ts`:

```typescript
import axios from "axios";

export interface SynthesisRequest {
  text: string;
  provider: "fish_audio" | "elevenlabs" | "openai";
  voiceId?: string;
  speed?: number;
}

export interface SynthesisResult {
  audioBuffer: Buffer;
  format: "audio/mp3" | "audio/wav";
  durationSeconds: number;
}

export async function synthesizeSpeech(req: SynthesisRequest): Promise<SynthesisResult> {
  if (req.provider === "fish_audio") {
    const apiKey = process.env.FISH_AUDIO_API_KEY;
    if (!apiKey) throw new Error("FISH_AUDIO_API_KEY is not configured.");

    const res = await axios.post(
      "https://api.fish.audio/v1/tts",
      {
        text: req.text,
        reference_id: req.voiceId || "7f92f8afb8ec43bf81429cc1c9199cb1", // Default clean English voice
        format: "mp3",
        latency: "normal",
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        responseType: "arraybuffer",
        timeout: 30000,
      }
    );

    return {
      audioBuffer: Buffer.from(res.data),
      format: "audio/mp3",
      durationSeconds: Math.round(req.text.split(" ").length / 2.5),
    };
  }

  if (req.provider === "elevenlabs") {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not configured.");

    const voice = req.voiceId || "21m00Tcm4TlvDq8ikWAM"; // Default Adam voice
    const res = await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${voice}`,
      {
        text: req.text,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      },
      {
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
        },
        responseType: "arraybuffer",
        timeout: 30000,
      }
    );

    return {
      audioBuffer: Buffer.from(res.data),
      format: "audio/mp3",
      durationSeconds: Math.round(req.text.split(" ").length / 2.5),
    };
  }

  throw new Error(`Unsupported TTS provider: ${req.provider}`);
}
```

---

## 📈 Phase 3: Real Keyword Research & SEO Intelligence

Replace `Math.random()` in `SEOResearch.jsx` with authentic demand signals.

### 3.1 Real YouTube Autocomplete & Trend Discovery Service
Create `server/services/keywordService.ts`:

```typescript
import axios from "axios";

export interface KeywordSuggestion {
  keyword: string;
  source: "youtube_suggest" | "google_suggest";
  relevanceScore: number;
  competition: "Low" | "Medium" | "High";
}

export async function fetchLiveKeywords(query: string): Promise<KeywordSuggestion[]> {
  try {
    // Query Google / YouTube public suggestion service safely
    const url = `https://suggestqueries.google.com/complete/search?client=youtube&ds=yt&q=${encodeURIComponent(query)}`;
    const res = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      timeout: 5000,
    });

    // Parse JSONP response safely
    const raw = res.data.toString();
    const jsonStr = raw.substring(raw.indexOf("(") + 1, raw.lastIndexOf(")"));
    const data = JSON.parse(jsonStr);
    const suggestions: string[] = (data[1] || []).map((item: any) => item[0]);

    return suggestions.map((kw, idx) => ({
      keyword: kw,
      source: "youtube_suggest",
      relevanceScore: Math.max(10, 100 - idx * 7),
      competition: idx < 3 ? "High" : idx < 7 ? "Medium" : "Low",
    }));
  } catch (err) {
    console.error("Live keyword fetch error:", err);
    return [];
  }
}
```

---

## 🚀 Phase 4: Solving the YouTube Publishing Architecture

Headless Playwright scraping cannot be used on server infrastructure. The developer must adopt one of two reliable industry standards:

### Approach A: Official YouTube Data API v3 (Recommended for Cloud)
* **How it works:** Authenticate the channel using standard OAuth 2.0. Upload videos directly using Google's resumable upload protocol (`https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable`).
* **Pros:** 100% stable, zero CAPTCHAs, zero account bans, officially supported by Google.
* **Requirements:** Google Cloud Project with YouTube Data API enabled and OAuth consent screen.

### Approach B: Stealth Manifest & Native UIA Bridge (For Local/Assisted Automation)
* **How it works:** Rather than running headless browsers on Linux, the server exports a signed `.json` manifest + video package. A lightweight desktop agent on the creator's machine opens YouTube Studio in their existing, authenticated regular Chrome browser and assists publishing via Windows UI Automation (UIA) with human oversight.
* **Pros:** Preserves full algorithmic channel reach, circumvents datacenter IP bans, avoids Google account blocks.

---

## ⚙️ Phase 5: Asynchronous Background Worker Queue

Convert synchronous Express endpoints (`/api/process`, `/api/publish`) to asynchronous worker jobs.

### 5.1 BullMQ Worker Architecture
1. **Request Flow:**
   * Client issues `POST /api/jobs/create` $\rightarrow$ Server pushes task to Redis and immediately returns `{ jobId: "uuid", status: "QUEUED" }` (HTTP 202).
   * Client polls `/api/jobs/:id` or receives SSE event stream.
   * Background worker processes FFmpeg render / TTS / Upload in an isolated process.

### 5.2 Automatic Storage Retention & Disk Purge
Add an automated retention manager to prevent server hard drives from filling up:
```typescript
import fs from "fs";
import path from "path";

export function cleanStaleMedia(directory: string, maxAgeHours = 48) {
  const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;
  const files = fs.readdirSync(directory);

  for (const file of files) {
    const fullPath = path.join(directory, file);
    const stats = fs.statSync(fullPath);
    if (stats.isFile() && stats.mtimeMs < cutoff) {
      fs.unlinkSync(fullPath);
      console.log(`[Storage Retention] Purged stale file: ${file}`);
    }
  }
}
```

---

## 📅 Execution Milestones & Deliverables

| Milestone | Key Deliverables | Expected Duration |
| :--- | :--- | :--- |
| **Sprint 1: Security & Audio** | Purge Git leaks, remove `voxtral.js`, implement Fish Audio / ElevenLabs service with live audio preview. | **3 Days** |
| **Sprint 2: Keyword Engine & Backend** | Replace random SEO numbers with live suggest API, implement BullMQ background job processor, add disk purge. | **4 Days** |
| **Sprint 3: Publishing & Video Pipeline** | Replace headless Playwright with YouTube Data API v3 OAuth2 / Stealth Manifest, add resumable chunked video upload. | **5 Days** |
| **Sprint 4: End-to-End QA** | Full 5-step conveyor test from Idea to YouTube upload with zero manual server interventions. | **2 Days** |
