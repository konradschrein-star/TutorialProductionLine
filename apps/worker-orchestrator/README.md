# worker-orchestrator

Lightweight orchestration workers for BullMQ consumers. Handles ingest, AI generation, QMS validation, and garbage collection queues.

## Purpose

This application implements the **orchestration layer** of the YouTube Automation Engine. It processes lightweight queue jobs, coordinates with external services, updates database state, and dispatches work to other queues via event-driven chaining.

**What it does:**
- Processes `queue-ingest` jobs (initial job creation)
- Processes `queue-ai-generation` jobs (TTS, LLM, translation API calls)
- Processes `queue-qms-validation` jobs (pre-flight validation before rendering)
- Processes `queue-garbage-collection` jobs (R2 asset deletion)
- Updates job status in PostgreSQL
- Dispatches next stage via `dispatchNext()` utility
- Structured JSON logging to stdout

**What it does NOT do:**
- Heavy rendering (that's `worker-render`'s job)
- Serve HTTP requests (that's `hub-web`'s job)
- Human-in-the-loop operations (that's coordinated by `hub-web`)

## Architecture

```
┌─────────────────────────────────────┐
│     worker-orchestrator             │
│                                     │
│  ┌─────────────────────────────┐  │
│  │   Ingest Processor          │  │
│  │   - Create job records      │  │
│  │   - Dispatch to AI queue    │  │
│  └─────────────────────────────┘  │
│                                     │
│  ┌─────────────────────────────┐  │
│  │   AI Generation Processor   │  │
│  │   - TTS generation (stub)   │  │
│  │   - Script generation (stub)│  │
│  │   - Translation (stub)      │  │
│  │   - Dispatch next stage     │  │
│  └─────────────────────────────┘  │
│                                     │
│  ┌─────────────────────────────┐  │
│  │   QMS Validation Processor  │  │
│  │   - Asset validation        │  │
│  │   - Payload validation      │  │
│  │   - Dispatch to render queue│  │
│  └─────────────────────────────┘  │
│                                     │
│  ┌─────────────────────────────┐  │
│  │   GC Processor              │  │
│  │   - R2 asset deletion       │  │
│  │   - Database record cleanup │  │
│  └─────────────────────────────┘  │
└─────────────────────────────────────┘
         │           │
         ▼           ▼
    PostgreSQL     Redis
```

## Directory Structure

```
src/
  index.ts                    # Application entrypoint
  processors/
    ingest.ts                 # Ingest queue processor
    ai-generation.ts          # AI generation queue processor
    qms-validation.ts         # QMS validation queue processor
    garbage-collection.ts     # GC queue processor
  utils/
    dispatch-next.ts          # Event-driven chaining utility
    update-job-status.ts      # Database status update utility
```

## Boot Sequence

1. Load and validate environment config (`@repo/config`)
2. Create Drizzle DB client (`@repo/db`)
3. Create 5 Redis connections (one per worker + one for queues)
4. Create queue instances (needed for `dispatchNext()`)
5. Create processors (with queue dependencies)
6. Initialize all workers
7. Attach event listeners for observability
8. Setup graceful shutdown handlers (SIGINT, SIGTERM)

## Processors

### Ingest Processor

**Queue:** `queue-ingest`

**Payload:**
```typescript
{
  job_id: string;
  channel_id: string;
  template_id: string;
  topic: string;
}
```

**Processing:**
1. Validate job doesn't already exist (idempotency)
2. Create job record in `content_jobs` table
3. Initialize state machine history
4. Transition to `SCRIPTING` status
5. Dispatch to `queue-ai-generation` for script generation

---

### AI Generation Processor

**Queue:** `queue-ai-generation`

**Payload:**
```typescript
{
  job_id: string;
  generation_type: "script" | "translation" | "tts";
  // ... type-specific fields
}
```

**Processing:**
1. Discriminate on `generation_type` field
2. Call appropriate external API (stubbed for now):
   - **Script:** LLM API call to generate script
   - **Translation:** Translation API call
   - **TTS:** ElevenLabs API call
3. Store result in database (script text, audio R2 key, etc.)
4. Update job status (`TRANSLATING`, `ASSET_COLLECTION`, etc.)
5. Dispatch next stage via `dispatchNext()`

**Current implementation:** Stubbed (logs "not implemented" but doesn't fail)

---

### QMS Validation Processor

**Queue:** `queue-qms-validation`

**Payload:**
```typescript
{
  job_id: string;
  validation_stage: "pre-render";
}
```

**Processing:**
1. Fetch job from database
2. Validate all required assets exist in R2 (currently skipped—no R2 client yet)
3. Validate asset manifest schema (Zod validation)
4. Validate payload for render worker (schema compliance)
5. If all checks pass → transition to `ROUTING_RENDER`
6. If any check fails → transition to `FAILED_QMS`
7. Dispatch to `queue-render-heavy` if validation passes

---

### Garbage Collection Processor

**Queue:** `queue-garbage-collection`

**Payload:**
```typescript
{
  job_id: string;
  cleanup_type: "full" | "assets-only";
}
```

**Processing:**
1. Fetch job from database
2. Read `r2_asset_manifest` array
3. Iterate each asset and hard-delete from R2 (currently skipped—no R2 client yet)
4. If `cleanup_type: "full"` → Delete job record from database
5. Transition to `DELETED` status

---

## Event-Driven Chaining

The `dispatchNext()` utility implements deterministic status-to-queue routing:

```typescript
// After updating status
await updateJobStatus(db, jobId, "SCRIPTING");

// Dispatch next stage
await dispatchNext(db, jobId, "SCRIPTING", {
  aiGeneration: aiGenerationQueue,
  qmsValidation: qmsValidationQueue,
  renderHeavy: renderHeavyQueue
});
// → Dispatches to queue-ai-generation with generation_type: "script"
```

**Routing rules:**

| New Status | Queue | Payload |
|-----------|-------|---------|
| `SCRIPTING` | `queue-ai-generation` | `{ generation_type: "script", ... }` |
| `TRANSLATING` | `queue-ai-generation` | `{ generation_type: "translation", ... }` |
| `QMS_VALIDATING` | `queue-qms-validation` | `{ validation_stage: "pre-render", ... }` |
| `ROUTING_RENDER` | `queue-render-heavy` | `{ job_id }` |
| All others | No dispatch | Awaits human action or terminal |

## Graceful Shutdown

The application handles SIGINT (Ctrl+C) and SIGTERM (Docker/Kubernetes) gracefully:

1. Drain all workers (complete in-flight jobs, reject new ones)
2. Close all Redis connections
3. Log shutdown complete
4. Exit with code 0

**Implementation:** `src/index.ts` (setupGracefulShutdown function)

## Deployment

**Systemd service:**

File: `/etc/systemd/system/worker-orchestrator.service`

```ini
[Unit]
Description=Content Forge Worker Orchestrator
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/content-forge
EnvironmentFile=/opt/content-forge/.env
ExecStart=/bin/bash -c 'export PATH="$HOME/.local/share/fnm:$PATH" && eval "$(fnm env --shell bash)" && node apps/worker-orchestrator/dist/index.js'
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

**Commands:**
```bash
# Build
pnpm build

# Start (foreground)
pnpm start:orchestrator

# Start as systemd service
systemctl start worker-orchestrator

# View logs
journalctl -u worker-orchestrator -f
```

## Structured Logging

All log output is structured JSON to stdout:

```json
{
  "level": "info",
  "message": "Received job",
  "job_id": "123e4567-e89b-12d3-a456-426614174000",
  "generation_type": "script",
  "timestamp": "2026-03-30T10:15:30.123Z"
}
```

**Log levels:**
- `info`: Normal operations
- `warn`: Recoverable issues
- `error`: Failed operations (job failures)
- `fatal`: Application crashes

## Dependencies

- **@repo/config:** Environment configuration
- **@repo/db:** Database client and schema
- **@repo/queue:** Queue/worker factories and connection management
- **@repo/contracts:** Queue payload schemas
- **@repo/domain:** State transition validation

## Current Status

**Phase 6 complete:**
- ✅ Application boots and connects to PostgreSQL + Redis
- ✅ All 4 workers initialize successfully
- ✅ Ingest processor creates jobs and dispatches to AI queue
- ✅ AI generation processor logs (stubbed—no actual AI calls yet)
- ✅ QMS validation processor validates payloads and dispatches to render queue
- ✅ GC processor logs (stubbed—no actual R2 deletion yet)
- ✅ Event-driven chaining works (`dispatchNext()` routes correctly)
- ✅ Graceful shutdown works (drains workers, closes connections)
- ✅ Runs on Hetzner VPS as systemd service

**Not yet implemented:**
- AI API integration (ElevenLabs TTS, LLM for script generation)
- R2 asset management (upload, download, delete)
- Translation engine integration

## Future Work

**Phase 9: AI Integration**

1. **ElevenLabs TTS:**
   - Install @elevenlabs/sdk
   - Implement TTS generation in ai-generation processor
   - Upload audio to R2
   - Track in `r2_asset_manifest`

2. **LLM Script Generation:**
   - Choose LLM API (OpenAI, Anthropic, or self-hosted)
   - Implement prompt construction from template
   - Generate script based on topic and template prompts
   - Store in `content_jobs.script` field

3. **Translation Engine:**
   - Choose translation API (DeepL, Google Translate)
   - Implement translation in ai-generation processor
   - Store translated script (future: separate field)

4. **R2 Integration:**
   - Install @aws-sdk/client-s3
   - Implement R2 upload/download helpers
   - Implement R2 deletion in GC processor
   - Add asset validation in QMS processor

## Testing

**Manual testing:**

1. Start infrastructure:
   ```bash
   docker compose -f infra/docker-compose.yml up -d
   ```

2. Build packages:
   ```bash
   pnpm build
   ```

3. Run seed script:
   ```bash
   pnpm seed
   ```

4. Start worker-orchestrator:
   ```bash
   pnpm start:orchestrator
   ```

5. Observe logs for state transitions:
   ```
   IDEA_GENERATION → SCRIPTING → TRANSLATING → ASSET_COLLECTION
   ```

6. Verify in Drizzle Studio:
   ```bash
   pnpm db:studio
   # Check content_jobs table for test job
   # Check status field shows current stage
   # Check state_machine_history shows all transitions
   ```

**Future: Automated testing**
- Unit tests for processors (mock database and queues)
- Integration tests for event-driven chaining
- End-to-end tests for full pipeline run
