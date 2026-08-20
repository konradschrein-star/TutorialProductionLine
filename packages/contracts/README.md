# @repo/contracts

Type-safe contracts for system boundaries. This package contains Zod schemas, TypeScript types, and queue payload definitions used across all applications and packages.

## Purpose

Provide a single source of truth for:

- Queue payload schemas (validated at queue boundaries)
- Database DTOs (validated at API boundaries)
- System event schemas
- Asset manifest structures
- Enum definitions

**No business logic lives here**—only data structures and validation schemas.

## Public API

### Enums

```typescript
import {
  JobStatus,
  ContentFormat,
  RenderEngine,
  OperatorRole,
  AssetType,
} from "@repo/contracts";

// Job status (21 possible values)
type Status = z.infer<typeof JobStatus>;
// "IDEA_GENERATION" | "SCRIPTING" | "TRANSLATING" | ... | "PUBLISHED" | "DELETED"

// Content format (7 possible values)
type Format = z.infer<typeof ContentFormat>;
// "EXPLAINER" | "DOCUMENTARY" | "POLITICAL_COMMENTARY" | ...

// Render engine (2 possible values)
type Engine = z.infer<typeof RenderEngine>;
// "FFMPEG" | "REMOTION"

// Operator role (5 possible values)
type Role = z.infer<typeof OperatorRole>;
// "ADMIN" | "MANAGER" | "PRODUCTION_VA" | "UPLOADER_VA" | "VIEWER"
```

### Queue Payloads

```typescript
import {
  IngestPayload,
  AIGenerationPayload,
  QMSValidationPayload,
  RenderHeavyPayload,
  GarbageCollectionPayload,
} from "@repo/contracts";

// Validate at queue boundary
const result = IngestPayload.safeParse(jobData);
if (!result.success) {
  console.error("Invalid payload:", result.error);
}
```

### Schemas

```typescript
import {
  ContentJobSchema,
  ContentTemplateSchema,
  AssetManifestSchema,
  SystemEventSchema,
  ResultSchema,
} from "@repo/contracts";

// Validate database DTOs
const job = ContentJobSchema.parse(dbRow);

// Validate asset manifest before inserting into database
const manifest = AssetManifestSchema.parse([
  { key: "path/to/file.mp3", type: "audio/tts", size_bytes: 524288 },
]);
```

## Directory Structure

```
src/
  enums/
    asset-type.ts         # Asset type enum (audio/tts, video/final-render, etc.)
    content-format.ts     # Content format enum (EXPLAINER, DOCUMENTARY, etc.)
    job-status.ts         # Job status enum (21 states)
    operator-role.ts      # Operator role enum (5 roles)
    render-engine.ts      # Render engine enum (FFMPEG, REMOTION)

  queue-payloads/
    ingest-payload.ts             # Ingest queue payload schema
    ai-generation-payload.ts      # AI generation queue payload schema
    qms-validation-payload.ts     # QMS validation queue payload schema
    render-heavy-payload.ts       # Render heavy queue payload schema
    garbage-collection-payload.ts # GC queue payload schema

  schemas/
    asset-manifest.ts      # R2 asset manifest schema
    content-job.ts         # content_jobs table DTO
    content-template.ts    # content_templates table DTO
    result.ts              # Result<T, E> type for functional error handling
    system-event.ts        # system_events table DTO

  index.ts                 # Public API surface (barrel export)
```

## Dependencies

- **zod:** Schema validation library

## Usage Examples

### Validate Queue Payload

```typescript
import { AIGenerationPayload } from "@repo/contracts";

// At queue dispatch
const payload = {
  job_id: "123e4567-e89b-12d3-a456-426614174000",
  generation_type: "script",
  template_id: "456e7890-e89b-12d3-a456-426614174000",
  topic: "How to build a YouTube automation engine",
};

const result = AIGenerationPayload.safeParse(payload);
if (!result.success) {
  throw new Error(`Invalid payload: ${result.error}`);
}

await queue.add("generate-script", result.data);
```

### Validate Asset Manifest Before Database Insert

```typescript
import { AssetManifestSchema } from "@repo/contracts";

const manifest = [
  {
    key: "UC_TEST/123e4567-e89b-12d3-a456-426614174000/audio_tts.mp3",
    type: "audio/tts",
    size_bytes: 524288,
  },
  {
    key: "UC_TEST/123e4567-e89b-12d3-a456-426614174000/thumbnail.png",
    type: "image/thumbnail",
    size_bytes: 102400,
  },
];

// Validate before insert
const validManifest = AssetManifestSchema.parse(manifest);

await db
  .update(contentJobs)
  .set({ r2_asset_manifest: validManifest })
  .where(eq(contentJobs.id, jobId));
```

### Type-Safe Status Transitions

```typescript
import { JobStatus } from "@repo/contracts";
import type { JobStatus as JobStatusType } from "@repo/contracts";

function transitionJob(
  currentStatus: JobStatusType,
  targetStatus: JobStatusType,
): boolean {
  // Type-safe exhaustive switch
  switch (currentStatus) {
    case "IDEA_GENERATION":
      return [
        "SCRIPTING",
        "PAUSED",
        "FAILED_GENERAL",
        "MARKED_FOR_DELETION",
      ].includes(targetStatus);
    case "SCRIPTING":
      return [
        "TRANSLATING",
        "PAUSED",
        "FAILED_GENERAL",
        "MARKED_FOR_DELETION",
      ].includes(targetStatus);
    // ... other cases
    default:
      const _exhaustive: never = currentStatus;
      return false;
  }
}
```

## Design Decisions

**Why Zod instead of TypeScript-only types?**

- Runtime validation at system boundaries
- Parse unknown external data safely
- Generate TypeScript types from schemas (single source of truth)
- Better error messages than manual validation

**Why separate this package?**

- Enforces boundary clarity (no business logic leakage)
- Shared contracts between apps and packages
- Dependency direction: apps → contracts, not contracts → apps
- Easier to audit what crosses boundaries

**Why not use class-validator or other libraries?**

- Zod has first-class TypeScript integration
- Functional API (no decorators)
- Composable schemas
- Better tree-shaking (ESM-first)
