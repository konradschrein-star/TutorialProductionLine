# @repo/config

Environment configuration with boot-time validation. The system refuses to start on missing or invalid credentials.

## Purpose

Provide:
- Zod-validated environment variable parsing
- Type-safe config singleton
- Boot-time validation (fail fast and clearly)
- Centralized configuration access

## Public API

```typescript
import { loadConfig } from "@repo/config";
import type { Env } from "@repo/config";

const config: Env = loadConfig();

// Type-safe access
const dbUrl = config.DATABASE_URL;       // string
const redisUrl = config.REDIS_URL;       // string
const nodeEnv = config.NODE_ENV;         // "development" | "production" | "test"
const port = config.PORT;                // number
```

## Directory Structure

```
src/
  env-schema.ts       # Zod schema for environment variables
  types.ts            # Exported types
  index.ts            # Public API surface (loadConfig function)
```

## Required Environment Variables

| Variable | Type | Description | Example |
|----------|------|-------------|---------|
| `DATABASE_URL` | string (URL) | PostgreSQL connection string | `postgresql://postgres:postgres@localhost:5432/content_forge` |
| `REDIS_URL` | string (URL) | Redis connection string | `redis://localhost:6379` |
| `R2_ACCOUNT_ID` | string | Cloudflare R2 account ID | `your-account-id` |
| `R2_ACCESS_KEY_ID` | string | R2 access key ID | `your-access-key` |
| `R2_SECRET_ACCESS_KEY` | string | R2 secret access key | `your-secret-key` |
| `R2_BUCKET_NAME` | string | R2 bucket name | `content-forge-prod` |
| `HEYGEN_API_KEY` | string | HeyGen API key | `your-heygen-key` |
| `ELEVENLABS_API_KEY` | string | ElevenLabs API key | `your-11labs-key` |
| `NODE_ENV` | enum | Environment mode | `development` \| `production` \| `test` |
| `PORT` | number | Server port | `3000` |

## Dependencies

- **zod:** Schema validation library

## Usage Examples

### Load Config at Application Boot

```typescript
import { loadConfig } from "@repo/config";

async function bootstrap() {
  // Load and validate config (throws on invalid/missing variables)
  const config = loadConfig();

  console.log(`Starting in ${config.NODE_ENV} mode`);
  console.log(`Server will listen on port ${config.PORT}`);

  // Use config throughout application
  const db = createDrizzleClient(config.DATABASE_URL);
  const redis = createRedisConnection(config.REDIS_URL);
}

bootstrap().catch((error) => {
  console.error("Failed to start:", error.message);
  process.exit(1);
});
```

### Error Handling

```typescript
// If DATABASE_URL is missing or invalid
loadConfig();
// Throws:
// Error: Invalid environment configuration:
//   - DATABASE_URL: Required
//   - DATABASE_URL must be a PostgreSQL connection string (starting with postgresql://)
```

All errors are collected and reported at once (not one at a time).

### Type-Safe Access

```typescript
import { loadConfig } from "@repo/config";

const config = loadConfig();

// TypeScript knows the types
config.PORT;           // number
config.NODE_ENV;       // "development" | "production" | "test"
config.DATABASE_URL;   // string (validated to be a PostgreSQL URL)
```

## Validation Strategy

**Boot-time validation:**
- All environment variables validated before application starts
- System refuses to start on invalid configuration
- No partial boot states (fail fast and clearly)

**Error collection:**
- Uses `.safeParse()` to collect ALL errors at once
- Formats them into a single descriptive message
- Lists all missing/invalid variables

**Example error message:**
```
Invalid environment configuration:
  - DATABASE_URL: Required
  - REDIS_URL: Required
  - R2_ACCOUNT_ID: Required
  - HEYGEN_API_KEY: Required
```

## Schema Definition

```typescript
import { z } from "zod";

export const EnvSchema = z.object({
  DATABASE_URL: z
    .string()
    .url()
    .startsWith("postgresql://", "DATABASE_URL must be a PostgreSQL connection string"),

  REDIS_URL: z
    .string()
    .url()
    .startsWith("redis://", "REDIS_URL must be a Redis connection string"),

  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET_NAME: z.string().min(1),

  HEYGEN_API_KEY: z.string().min(1),
  ELEVENLABS_API_KEY: z.string().min(1),

  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  PORT: z
    .string()
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive())
    .default("3000"),
});

export type Env = z.infer<typeof EnvSchema>;
```

## Design Decisions

**Why Zod instead of dotenv only?**
- Runtime validation (catch missing variables before they cause errors)
- Type inference (generate TypeScript types from schema)
- Better error messages (descriptive validation errors)
- Transform values (e.g., PORT string → number)

**Why fail fast instead of graceful degradation?**
- Missing credentials cause cryptic errors later
- Partial boot states are dangerous (app appears running but broken)
- Easier debugging (error at boot, not deep in execution)
- Production safety (never deploy with missing config)

**Why centralize config in one package?**
- Single source of truth for all environment variables
- Prevents config duplication across apps
- Easier to audit required configuration
- Type-safe access everywhere
