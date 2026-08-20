# Hub Web — Content Forge Control Plane

Next.js 15 dashboard for managing YouTube automation operations. Real-time monitoring, RBAC-enforced access, and human-in-the-loop workflows for Production VAs and Uploader VAs.

## Architecture

- **Framework:** Next.js 15 (App Router, Server Components, Server Actions)
- **React:** 19
- **Styling:** Tailwind CSS 4 with Obsidian Pulse design system
- **Auth:** Custom JWT + bcrypt (HTTP-only cookies)
- **Database:** PostgreSQL via Drizzle ORM (`@repo/db`)
- **Real-time:** PostgreSQL LISTEN/NOTIFY + SSE (via custom Next.js server with `pg-listen`)
- **Queue Integration:** BullMQ via `@repo/queue`
- **Asset Storage:** Cloudflare R2 (S3-compatible)
- **State Management:** Server Components + React Query (client-side caching)

## Features

- **Dashboard:** Global metrics, pipeline visualizer, queue health, activity timeline (real-time)
- **Job Management:** List, detail, create, pause, resume, delete with bulk actions
- **Template & Channel Management:** JSONB editor for pipeline configuration
- **System Health:** Queue monitoring, error console, failed job inspection
- **Team Management:** User CRUD, VA productivity tracking (ADMIN only)
- **HeyGen Integration:** Production VA uploads video footage via dropzone
- **Real-time Updates:** Zero-polling architecture with SSE
- **RBAC:** 5 roles (ADMIN, MANAGER, PRODUCTION_VA, UPLOADER_VA, VIEWER)

## Setup

### Prerequisites

- Node.js 22+
- pnpm 9+
- PostgreSQL 16+
- Redis 7+

### Environment Variables

Create `.env` at project root:

```env
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/content_forge

# Redis
REDIS_URL=redis://localhost:6379

# Auth
JWT_SECRET=your-secret-key-min-32-characters

# Cloudflare R2
R2_ACCOUNT_ID=your-account-id
R2_ACCESS_KEY_ID=your-access-key
R2_SECRET_ACCESS_KEY=your-secret-key
R2_BUCKET_NAME=content-forge-assets

# External APIs
HEYGEN_API_KEY=your-heygen-key
ELEVENLABS_API_KEY=your-elevenlabs-key

# Environment
NODE_ENV=development
```

### Installation

```bash
# Install dependencies (from project root)
pnpm install

# Run database migrations
pnpm --filter=@repo/db migrate

# Seed database with test users
pnpm --filter=@repo/db seed
```

### Development

```bash
# Start dev server (uses custom server with pg-listen)
pnpm --filter=@repo/hub-web dev
```

Visit http://localhost:3000

### Test Users

- **Admin:** admin@content-forge.com / admin123
- **Production VA:** va-prod@content-forge.com / va1234
- **Uploader VA:** va-upload@content-forge.com / va1234
- **Viewer:** investor@content-forge.com / view1234

## Deployment

### Docker (Recommended for local testing)

```bash
cd apps/hub-web
docker-compose up -d
```

### Production (Hetzner VPS with PM2)

1. **Build and deploy:**
   ```bash
   ./scripts/deploy-hub-web.sh
   ```

2. **PM2 process management:**
   ```bash
   ssh -i //wsl.localhost/Ubuntu/home/konra/.ssh/id_ed25519 root@65.108.6.149
   cd /opt/content-forge/apps/hub-web
   pm2 start ecosystem.config.js
   pm2 save
   pm2 startup
   ```

3. **Monitor:**
   ```bash
   pm2 logs hub-web
   pm2 status
   ```

### Custom Server

Hub Web uses a custom Next.js server (not serverless) to support:
- **pg-listen singleton** for PostgreSQL LISTEN/NOTIFY
- **Long-lived SSE connections** for real-time updates
- **Graceful shutdown** with proper cleanup

Entry point: `src/server/index.ts`

## Project Structure

```
src/
├── app/
│   ├── (authenticated)/          # Protected routes (requires login)
│   │   ├── page.tsx               # Dashboard
│   │   ├── jobs/                  # Job management
│   │   ├── templates/             # Template editor
│   │   ├── channels/              # Channel management
│   │   ├── system-health/         # System health monitoring
│   │   └── team/                  # Team management (ADMIN)
│   ├── login/                     # Login page
│   ├── api/
│   │   ├── events/                # SSE endpoint for real-time updates
│   │   └── assets/                # Presigned URL generation for R2
│   ├── actions/                   # Server Actions (mutations)
│   ├── globals.css                # Obsidian Pulse design system
│   ├── layout.tsx                 # Root layout
│   ├── error.tsx                  # Global error boundary
│   └── not-found.tsx              # 404 page
├── components/
│   ├── layout/                    # Sidebar, Header
│   ├── dashboard/                 # Metrics, Pipeline visualizer, Activity timeline
│   ├── jobs/                      # Job table, Job actions, HeyGen dropzone
│   ├── templates/                 # Template editor
│   ├── system-health/             # System health tabs, Error console
│   └── team/                      # User management
├── lib/
│   ├── auth/                      # JWT, RBAC, Session management
│   ├── repositories/              # Data access layer
│   ├── services/                  # Business logic (R2, Queue)
│   ├── db.ts                      # Drizzle client singleton
│   ├── redis.ts                   # Redis client singleton
│   └── config.ts                  # Environment config wrapper
├── hooks/
│   └── use-sse.ts                 # Client-side EventSource hook
└── server/
    ├── index.ts                   # Custom Next.js server entry
    └── pg-listen-server.ts        # PostgreSQL LISTEN/NOTIFY singleton
```

## Real-time Architecture

```
PostgreSQL NOTIFY → pg-listen → SSE → EventSource (client) → React state
```

1. Workers/actions insert into `system_events` table
2. Database triggers `NOTIFY system_events` with JSON payload
3. pg-listen receives notification and broadcasts to all connected SSE clients
4. Client-side `useSSE()` hook updates React state
5. UI updates instantly (no polling)

## Visual Design System

**Obsidian Pulse:**
- Primary: `#904efb` (purple)
- Surface: `#131313`, Surface Container: `#353534`
- Text: `#e5e2e1`, Text Muted: `#9b9896`
- Success: `#23decb`, Error: `#ffb4ab`, Warning: `#f59e0b`
- Glassmorphism with `backdrop-blur-20px`
- No hard borders, glow effects on primary elements

## Scripts

- `pnpm dev` — Start dev server with custom server (tsx)
- `pnpm build` — Build for production (standalone output)
- `pnpm start` — Start production server (requires build first)
- `pnpm lint` — Run ESLint
- `pnpm type-check` — Run TypeScript compiler check

## Troubleshooting

### SSE connection fails

Check that:
1. Custom server is running (not `next dev`)
2. PostgreSQL is accessible
3. `system_events` table exists
4. No firewall blocking SSE connection

### Standalone build issues

Ensure `next.config.js` has:
```js
output: 'standalone'
```

### PM2 process not starting

Check logs:
```bash
pm2 logs hub-web
cat /opt/content-forge/logs/hub-web-error.log
```

Verify environment variables are set correctly in VPS.

## Contributing

See CLAUDE.md at project root for architectural guidelines and coding conventions.

## License

Proprietary — Content Forge YouTube Automation Engine
