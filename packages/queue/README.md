# @repo/queue

BullMQ abstraction layer with typed queue/worker factories, connection management, and workload-tuned configurations.

## Purpose

Provide:
- Redis connection factory (ioredis for BullMQ)
- Typed Queue factory functions (one per queue lane)
- Typed Worker factory functions (enforce correct payload types)
- Queue/worker options per workload profile
- Event listener attachment helpers

## Public API

### Connection Management

```typescript
import { createRedisConnection, closeRedisConnection } from "@repo/queue";

// Create connection for worker
const workerConnection = createRedisConnection({
  url: "redis://localhost:6379",
  mode: "worker"
});

// Create connection for queue
const queueConnection = createRedisConnection({
  url: "redis://localhost:6379",
  mode: "queue"
});

// Graceful shutdown
await closeRedisConnection(workerConnection);
```

### Queue Factories

```typescript
import {
  createIngestQueue,
  createAIGenerationQueue,
  createQMSValidationQueue,
  createRenderHeavyQueue,
  createGarbageCollectionQueue,
  createDeadLetterQueue
} from "@repo/queue";

const aiQueue = createAIGenerationQueue(queueConnection);

// Type-safe dispatch
await aiQueue.add("generate-script", {
  job_id: "123e4567-e89b-12d3-a456-426614174000",
  generation_type: "script",
  template_id: "456e7890-e89b-12d3-a456-426614174000",
  topic: "How to build a YouTube automation engine"
});
```

### Worker Factories

```typescript
import {
  createIngestWorker,
  createAIGenerationWorker,
  createQMSValidationWorker,
  createRenderHeavyWorker,
  createGarbageCollectionWorker,
  createDeadLetterWorker
} from "@repo/queue";
import type { Processor } from "@repo/queue";

// Define typed processor
const aiProcessor: Processor<AIGenerationPayload> = async (job) => {
  // job.data is typed as AIGenerationPayload
  console.log("Processing:", job.data.generation_type);

  if (job.data.generation_type === "script") {
    // LLM API call
  } else if (job.data.generation_type === "translation") {
    // Translation API call
  }
};

// Create worker
const aiWorker = createAIGenerationWorker(workerConnection, aiProcessor);
```

### Event Listeners

```typescript
import { attachStandardEventListeners } from "@repo/queue";

// Attach standard event listeners for observability
attachStandardEventListeners(aiWorker, "ai-generation-worker");

// Logs structured JSON:
// - completed
// - failed
// - stalled
// - error
```

## Directory Structure

```
src/
  connection.ts                # Redis connection factory
  constants/
    queue-names.ts             # Centralized queue name constants
  factories/
    queue-factories.ts         # Typed Queue factory functions
    worker-factories.ts        # Typed Worker factory functions
  options/
    queue-options.ts           # Queue options per workload profile
    worker-options.ts          # Worker options per workload profile
  events/
    event-helpers.ts           # Event listener attachment helpers
  index.ts                     # Public API surface
```

## Queue Lanes

See **`docs/architecture/QUEUE_ARCHITECTURE.md`** for complete queue documentation.

| Queue | Concurrency | Purpose |
|-------|-------------|---------|
| `queue-ingest` | 10 | Initial job creation |
| `queue-ai-generation` | 5 | External AI API calls (TTS, LLM, translation) |
| `queue-qms-validation` | 10 | Lightweight pre-flight checks |
| `queue-render-heavy` | 1-2 | CPU-bound FFmpeg/Remotion rendering |
| `queue-garbage-collection` | 2 | R2 asset deletion |
| `queue-dead-letter` | 0 (manual) | Irrecoverable failures |

## Dependencies

- **bullmq:** Redis-backed job queue
- **ioredis:** Redis client for Node.js
- **@repo/contracts:** Queue payload schemas

## Usage Examples

### Create Queue and Worker

```typescript
import { createRedisConnection, createAIGenerationQueue, createAIGenerationWorker } from "@repo/queue";
import type { Processor, AIGenerationPayload } from "@repo/queue";

// Connections (one per worker + one for queue)
const queueConnection = createRedisConnection({ url: REDIS_URL, mode: "queue" });
const workerConnection = createRedisConnection({ url: REDIS_URL, mode: "worker" });

// Queue
const aiQueue = createAIGenerationQueue(queueConnection);

// Processor
const aiProcessor: Processor<AIGenerationPayload> = async (job) => {
  console.log("Processing:", job.data);

  if (job.data.generation_type === "script") {
    // Generate script via LLM API
    const script = await generateScript(job.data.topic);

    // Update database
    await db.update(contentJobs)
      .set({ script, status: "TRANSLATING" })
      .where(eq(contentJobs.id, job.data.job_id));
  }
};

// Worker
const aiWorker = createAIGenerationWorker(workerConnection, aiProcessor);

// Event listeners
attachStandardEventListeners(aiWorker, "ai-generation-worker");
```

### Graceful Shutdown

```typescript
import { closeRedisConnection } from "@repo/queue";

async function shutdown() {
  console.log("Draining workers...");

  // Drain all workers (complete in-flight jobs, reject new ones)
  await Promise.all([
    ingestWorker.close(),
    aiWorker.close(),
    qmsWorker.close(),
    gcWorker.close()
  ]);

  console.log("Closing Redis connections...");

  // Close all connections
  await Promise.all([
    closeRedisConnection(queueConnection),
    closeRedisConnection(workerConnection1),
    closeRedisConnection(workerConnection2),
    closeRedisConnection(workerConnection3),
    closeRedisConnection(workerConnection4)
  ]);

  console.log("Shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
```

### Custom Worker Options

```typescript
import { createAIGenerationWorker, getWorkerOptions } from "@repo/queue";

// Get default options
const defaultOptions = getWorkerOptions("queue-ai-generation");

// Override with custom options
const customOptions = {
  ...defaultOptions,
  concurrency: 10,  // Increase from default 5
  limiter: {
    max: 100,       // Max 100 jobs per duration
    duration: 60000 // Per 60 seconds
  }
};

const aiWorker = new Worker("queue-ai-generation", aiProcessor, {
  connection: workerConnection,
  ...customOptions
});
```

## Known Issues

### ioredis CJS/ESM Compatibility

**Problem:** ioredis is a CommonJS module, but we use ES modules (NodeNext resolution). TypeScript complains about constructor types.

**Workaround:**
```typescript
import IoRedis from "ioredis";
import type { Redis } from "ioredis";  // Separate type import

const connection = new (IoRedis as any)(url, {
  // Type assertion to bypass constructor type error
  retryStrategy(times: number) {  // Explicit parameter types required
    const delay = Math.min(times * 50, 2000);
    return delay;
  }
});
```

See **`docs/architecture/QUEUE_ARCHITECTURE.md`** for details.

## Design Decisions

**Why factory functions instead of classes?**
- Simpler API (just call a function, get a typed instance)
- No inheritance hierarchy
- Type inference works better
- Easier to test (pass dependencies explicitly)

**Why separate connections per worker?**
- BullMQ requirement (workers need dedicated connections)
- Prevents connection contention
- Better error isolation (one worker crash doesn't affect others)

**Why typed payloads?**
- Compile-time safety (catch payload errors before runtime)
- Better IDE autocomplete
- Prevents payload shape mismatches between producer and consumer
- Zod validation at queue boundary (runtime safety)

**Why event listener helpers?**
- Consistent structured logging across all workers
- Easier to add observability (metrics, tracing) later
- DRY (don't repeat event listener setup in every app)
