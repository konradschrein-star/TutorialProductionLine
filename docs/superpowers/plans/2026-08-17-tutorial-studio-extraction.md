# Tutorial Studio Extraction & Deployment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stub app at `tutorials.schreinercontentsystems.com` with the real ContentForge Tutorial Studio, isolated to its own Postgres/Redis, with all API keys server-side, the operator confined to the Studio, and Gemini as the default script provider.

**Architecture:** Deploy the ContentForge monorepo slice (hub-web + worker-orchestrator) on vps1 from a dedicated `deploy/tutorials-line` branch. Postgres + Redis via docker-compose (isolated from the main ContentForge instance). hub-web + worker run under PM2; nginx repoints from the parked decoy to hub-web. Access is confined by the existing `TUTORIAL_VA` RBAC role — no page deletion.

**Tech Stack:** Next.js (custom server) `@repo/hub-web`, `@repo/worker-orchestrator` (BullMQ), Postgres 16 + Redis 7 (docker), Drizzle migrations, PM2, nginx, Gemini (script) + Fish Audio (TTS).

**Source of truth:** ContentForge repo `C:\cfref\content-forge`. Per its `DEPLOYMENT.md`: deploy only from a committed, building ref; never edit `/opt` in place; rebuild on deploy.

---

## Prerequisites (gather before Task 1)

These are inputs the executor must have in hand. Block on them.

- [ ] **vps1 connection details** — host/IP, SSH user. (Domain `tutorials.schreinercontentsystems.com` resolves here; per `.project_state.md` it is the Hetzner i7-6700/64 GB box.) SSH key: `distribution-deploy2` (already provided; `SHA256:LeQpzH3zch1g0pqbP3AWkooOwt1C2JAmwuDzk3dJoug`).
- [ ] **Gemini API key** (Google AI Studio) — for `GEMINI_FALLBACK_API_KEY`.
- [ ] **Fish Audio API key** — for `FISH_API_KEY`; optional Fish voice reference id for `TUTORIAL_FISH_VOICE`.
- [ ] **Chosen passwords** for the 2 admin accounts (you, dev) and Lorraine's `TUTORIAL_VA` account. Emails: Konrad, dev, Lorraine.
- [ ] Confirm main ContentForge instance (`65.108.6.149`) is untouched by this work (separate box, separate DB).

---

## Task 1: Create the deploy branch + set Gemini as default script provider

Isolates all ContentForge code changes for this deployment so the main product on `main` is unaffected.

**Files:**
- Modify: `C:\cfref\content-forge\packages\contracts\src\schemas\tutorial-provider.ts` (the `TUTORIAL_PROVIDERS.llm` array)

- [ ] **Step 1: Branch ContentForge**

```bash
cd /c/cfref/content-forge
git checkout main && git pull
git checkout -b deploy/tutorials-line
```

- [ ] **Step 2: Move the default flag to Gemini**

In `packages/contracts/src/schemas/tutorial-provider.ts`, in the `TUTORIAL_PROVIDERS.llm` array: remove `isDefault: true` from the `deepseek` entry and add `isDefault: true` to the `google_gemini` entry. Exactly one entry must carry the flag.

Rationale: the Create form preselects `llmProviders.find(p => p.isDefault)`, filtered by availability. With only a Gemini key present, Gemini becomes and stays the default. DeepSeek remains selectable per job.

- [ ] **Step 3: Rebuild contracts and verify it compiles**

Run: `pnpm --filter @repo/contracts build`
Expected: exits 0, no type errors.

- [ ] **Step 4: Commit**

```bash
git add packages/contracts/src/schemas/tutorial-provider.ts
git commit -m "deploy(tutorials-line): default tutorial script provider to google_gemini"
```

---

## Task 2: Deployment-specific account seed script

The stock `packages/db/src/seed.ts` creates weak test accounts (`admin@content-forge.com/admin123`, etc.) — unacceptable on a client-facing box. Add a dedicated script that seeds exactly the three accounts we want, with passwords supplied via env (never committed).

**Files:**
- Create: `C:\cfref\content-forge\packages\db\src\seed-tutorial-line.ts`
- Modify: `C:\cfref\content-forge\packages\db\package.json` (add a script entry)
- Test: `C:\cfref\content-forge\packages\db\src\__tests__\seed-tutorial-line.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/src/__tests__/seed-tutorial-line.test.ts
import { describe, it, expect } from "vitest";
import { buildTutorialLineAccounts } from "../seed-tutorial-line";

describe("buildTutorialLineAccounts", () => {
  it("produces 2 ADMINs and 1 TUTORIAL_VA from env", () => {
    const env = {
      TL_ADMIN1_EMAIL: "konrad@x.com", TL_ADMIN1_NAME: "Konrad", TL_ADMIN1_PASSWORD: "p1",
      TL_ADMIN2_EMAIL: "dev@x.com",    TL_ADMIN2_NAME: "Dev",    TL_ADMIN2_PASSWORD: "p2",
      TL_VA_EMAIL: "lorraine@x.com",   TL_VA_NAME: "Lorraine",   TL_VA_PASSWORD: "p3",
    };
    const accts = buildTutorialLineAccounts(env);
    expect(accts).toHaveLength(3);
    expect(accts.filter(a => a.role === "ADMIN")).toHaveLength(2);
    expect(accts.filter(a => a.role === "TUTORIAL_VA")).toHaveLength(1);
    expect(accts.map(a => a.email)).toContain("lorraine@x.com");
  });

  it("throws when a required env var is missing", () => {
    expect(() => buildTutorialLineAccounts({})).toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @repo/db test -- seed-tutorial-line`
Expected: FAIL — `buildTutorialLineAccounts` not exported.

- [ ] **Step 3: Write the seed script**

```ts
// packages/db/src/seed-tutorial-line.ts
#!/usr/bin/env tsx
import bcrypt from "bcryptjs";
import { createDrizzleClient, users } from "./index";
import { eq } from "drizzle-orm";

type Role = "ADMIN" | "TUTORIAL_VA";
export interface SeedAccount { email: string; name: string; role: Role; password: string; }

function req(env: Record<string, string | undefined>, key: string): string {
  const v = env[key];
  if (!v || !v.trim()) throw new Error(`Missing required env var: ${key}`);
  return v;
}

export function buildTutorialLineAccounts(
  env: Record<string, string | undefined>,
): SeedAccount[] {
  return [
    { email: req(env, "TL_ADMIN1_EMAIL"), name: req(env, "TL_ADMIN1_NAME"), role: "ADMIN", password: req(env, "TL_ADMIN1_PASSWORD") },
    { email: req(env, "TL_ADMIN2_EMAIL"), name: req(env, "TL_ADMIN2_NAME"), role: "ADMIN", password: req(env, "TL_ADMIN2_PASSWORD") },
    { email: req(env, "TL_VA_EMAIL"),     name: req(env, "TL_VA_NAME"),     role: "TUTORIAL_VA", password: req(env, "TL_VA_PASSWORD") },
  ];
}

async function main() {
  const accounts = buildTutorialLineAccounts(process.env);
  const db = createDrizzleClient(req(process.env, "DATABASE_URL"));
  for (const a of accounts) {
    const passwordHash = await bcrypt.hash(a.password, 10);
    await db
      .insert(users)
      .values({ email: a.email, name: a.name, role: a.role, passwordHash, is_active: true })
      .onConflictDoUpdate({
        target: users.email,
        set: { name: a.name, role: a.role, passwordHash, is_active: true },
      });
    console.log(JSON.stringify({ seeded: a.email, role: a.role }));
  }
  console.log("tutorial-line accounts seeded");
  process.exit(0);
}

// Only run when invoked directly, not when imported by tests.
if (process.argv[1] && process.argv[1].endsWith("seed-tutorial-line.ts")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
```

Note: mirror the exact `users` insert field names used in `packages/db/src/seed.ts` (drizzle field `passwordHash` → column `password_hash`, `is_active`). If `seed.ts` imports `users`/`createDrizzleClient` from a different path, match it.

- [ ] **Step 4: Add the package script**

In `packages/db/package.json` `scripts`, add:
```json
"seed:tutorial-line": "tsx src/seed-tutorial-line.ts"
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @repo/db test -- seed-tutorial-line`
Expected: PASS (both cases).

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/seed-tutorial-line.ts packages/db/src/__tests__/seed-tutorial-line.test.ts packages/db/package.json
git commit -m "deploy(tutorials-line): add 3-account seed (2 ADMIN + TUTORIAL_VA)"
git push -u origin deploy/tutorials-line
```

---

## Task 3: vps1 baseline recon + bring up isolated Postgres/Redis

**Files:** none (operational, on vps1).

- [ ] **Step 1: SSH in and confirm toolchain**

```bash
ssh -i ~/.ssh/distribution-deploy2 <user>@<vps1-host>
node -v; pnpm -v; docker -v; ffmpeg -version | head -1; nginx -v
```
Expected: node ≥22, pnpm ≥9, docker present, ffmpeg present, nginx present. Install any missing (`deploy/hetzner_setup.sh` in the TutorialProductionLine repo is the reference for what the box needs).

- [ ] **Step 2: Record the decoy's current state (for rollback)**

```bash
pm2 list
sudo cat /etc/nginx/sites-available/tutorials.schreinercontentsystems.com.conf 2>/dev/null || sudo nginx -T | grep -A20 tutorials.schreinercontentsystems.com
```
Expected: note the decoy PM2 process names/ports (`tutorial-line-web`, `tutorial-line-api`) and the current nginx upstream (3080/3081). Save this output.

- [ ] **Step 3: Clone the deploy branch**

```bash
sudo mkdir -p /opt/tutorials-line && sudo chown $USER /opt/tutorials-line
git clone -b deploy/tutorials-line <contentforge-remote> /opt/tutorials-line
cd /opt/tutorials-line
```

- [ ] **Step 4: Bring up isolated Postgres + Redis**

Use the repo's root `docker-compose.yml` (Postgres `5432`, Redis `6381`). Set a strong DB password first by editing the compose `POSTGRES_PASSWORD` or via env, then:
```bash
docker compose -f docker-compose.yml up -d postgres redis
docker compose -f docker-compose.yml ps
```
Expected: both containers `healthy`. These are separate from the main ContentForge instance.

---

## Task 4: Configure environment

**Files:**
- Create: `/opt/tutorials-line/.env` (on vps1; never committed)

- [ ] **Step 1: Generate secrets**

```bash
openssl rand -base64 32   # -> JWT_SECRET
openssl rand -base64 32   # -> SECRETS_ENCRYPTION_KEY (MUST base64-decode to 32 bytes; do NOT use rand -hex)
```

- [ ] **Step 2: Write `/opt/tutorials-line/.env`**

```dotenv
NODE_ENV=production
PORT=3000
BIND_HOST=127.0.0.1
COOKIE_SECURE=true

DATABASE_URL=postgresql://postgres:<STRONG_PASSWORD>@localhost:5432/content_forge
REDIS_URL=redis://localhost:6381

JWT_SECRET=<from step 1>
SECRETS_ENCRYPTION_KEY=<from step 1, base64 32 bytes>

LOCAL_MEDIA_ROOT=/opt/tutorials-line/media

# Script LLM (Gemini). google_gemini reads GEMINI_FALLBACK_API_KEY specifically.
GEMINI_FALLBACK_API_KEY=<gemini key>
GEMINI_FALLBACK_MODEL=gemini-2.5-flash

# TTS (Fish Audio)
FISH_API_KEY=<fish key>
TUTORIAL_FISH_VOICE=<fish voice ref id, or leave to built-in default>

# Keyword tool intentionally left inert (do NOT set KT_EMBED_URL/KT_EMBED_SECRET)
```
Create the media dir: `mkdir -p /opt/tutorials-line/media`.

- [ ] **Step 3: Verify SECRETS_ENCRYPTION_KEY decodes to 32 bytes**

Run: `echo -n "<SECRETS_ENCRYPTION_KEY>" | base64 -d | wc -c`
Expected: `32`. If not 32, regenerate with `openssl rand -base64 32`.

---

## Task 5: Install, build, migrate

**Files:** none (operational).

- [ ] **Step 1: Install deps (frozen)**

Run: `cd /opt/tutorials-line && pnpm install --frozen-lockfile`
Expected: completes without lockfile errors.

- [ ] **Step 2: Build db package first (drizzle config reads dist/schema)**

Run: `pnpm --filter @repo/db build`
Expected: exits 0; `packages/db/dist/schema` exists.

- [ ] **Step 3: Apply migrations**

Run: `pnpm db:migrate`
Expected: drizzle-kit applies committed SQL `0000…0059` + baseline; exits 0. (Postgres must be up from Task 3.)

- [ ] **Step 4: Verify schema landed**

Run: `docker compose -f docker-compose.yml exec postgres psql -U postgres -d content_forge -c "\dt" | grep -E "users|tutorial_jobs|encrypted_secrets"`
Expected: all three tables listed.

---

## Task 6: Seed the three accounts + verify login works

**Files:** none (operational; uses Task 2 script).

- [ ] **Step 1: Seed accounts (passwords via inline env, not saved)**

```bash
cd /opt/tutorials-line
TL_ADMIN1_EMAIL="<konrad-email>" TL_ADMIN1_NAME="Konrad" TL_ADMIN1_PASSWORD="<pw1>" \
TL_ADMIN2_EMAIL="<dev-email>"    TL_ADMIN2_NAME="Dev"    TL_ADMIN2_PASSWORD="<pw2>" \
TL_VA_EMAIL="<lorraine-email>"   TL_VA_NAME="Lorraine Sabroso" TL_VA_PASSWORD="<pw3>" \
pnpm --filter @repo/db seed:tutorial-line
```
Expected: three `{"seeded": ...}` lines; `tutorial-line accounts seeded`.

- [ ] **Step 2: Verify roles in DB**

Run: `docker compose -f docker-compose.yml exec postgres psql -U postgres -d content_forge -c "SELECT email, role, is_active FROM users ORDER BY role;"`
Expected: 2 rows `ADMIN`, 1 row `TUTORIAL_VA`, all `is_active = t`, no `admin@content-forge.com` test rows.

---

## Task 7: Start worker + hub-web under PM2; verify health

**Files:**
- Create: `/opt/tutorials-line/ecosystem.tutorials-line.cjs` (on vps1)

- [ ] **Step 1: Build both apps**

```bash
pnpm --filter @repo/worker-orchestrator build
pnpm --filter @repo/hub-web build
```
Expected: both exit 0. (Per DEPLOYMENT.md, a failing build must NOT be deployed.)

- [ ] **Step 2: Write the PM2 ecosystem file**

```js
// /opt/tutorials-line/ecosystem.tutorials-line.cjs
module.exports = {
  apps: [
    {
      name: "tl-hub-web",
      cwd: "/opt/tutorials-line",
      script: "pnpm",
      args: "--filter @repo/hub-web start",
      env: { PORT: "3000", BIND_HOST: "127.0.0.1", NODE_ENV: "production" },
      max_restarts: 10,
    },
    {
      name: "tl-worker-orchestrator",
      cwd: "/opt/tutorials-line",
      script: "pnpm",
      args: "start:orchestrator",
      env: { NODE_ENV: "production" },
      max_restarts: 10,
    },
  ],
};
```
Both processes inherit `/opt/tutorials-line/.env` (loaded by the apps themselves).

- [ ] **Step 3: Start under PM2**

```bash
pm2 start /opt/tutorials-line/ecosystem.tutorials-line.cjs
pm2 save
pm2 list
```
Expected: `tl-hub-web` and `tl-worker-orchestrator` both `online`, 0 restarts after ~30s.

- [ ] **Step 4: Verify hub-web health**

Run: `curl -s http://127.0.0.1:3000/api/health`
Expected: healthy JSON (200).

- [ ] **Step 5: Verify TTS health (Fish)**

Run: `curl -s http://127.0.0.1:3000/api/health/tts`
Expected: `{"status":"ok"|"degraded", "provider":"Fish Audio", ...}` — proves `FISH_API_KEY` resolves. If `down`, fix the key before proceeding.

- [ ] **Step 6: Verify worker is consuming its queue**

Run: `pm2 logs tl-worker-orchestrator --lines 40 --nostream | grep -i "tutorial-generate"`
Expected: log line showing the `tutorial-generate` worker registered (queue `queue-tutorial-generate`).

---

## Task 8: End-to-end test job (Gemini script → Fish audio → READY_TO_RECORD)

**Files:** none (operational; done via the UI on a temporary local tunnel or after cutover on staging).

- [ ] **Step 1: Log in as an ADMIN**

Reach hub-web (SSH tunnel `ssh -L 3000:127.0.0.1:3000 ...` then browse `http://localhost:3000/login`, or do this step after Task 9 cutover on the live domain). Log in with an ADMIN account from Task 6.
Expected: lands on `/dashboard`; no login error.

- [ ] **Step 2: Confirm Gemini is the preselected script engine**

Go to `/tutorial-studio` → Create. In the (admin-visible) engine controls, confirm the script provider defaults to **Google Gemini** and that it shows as available.
Expected: Gemini preselected. If DeepSeek is preselected, re-check Task 1 Step 2 and that no DeepSeek key is set.

- [ ] **Step 3: Queue one job**

Create a job (pick/create a channel, title e.g. "How to create a Gmail filter", mode 3-min). Submit.
Expected: job appears on the Studio board as `QUEUED` → `GENERATING_SCRIPT`.

- [ ] **Step 4: Watch it run non-linearly to READY_TO_RECORD**

Run: `docker compose -f docker-compose.yml exec postgres psql -U postgres -d content_forge -c "SELECT title, status, script_provider, tts_provider_used FROM tutorial_jobs ORDER BY created_at DESC LIMIT 1;"`
Expected: progresses `GENERATING_SCRIPT` → `GENERATING_AUDIO` → `READY_TO_RECORD`; `script_provider = google_gemini`; `tts_provider_used = fish_audio`. Play the audio in Studio — real speech, not a tone.
If `FAILED_SCRIPT`/`FAILED_AUDIO`: `pm2 logs tl-worker-orchestrator` for the provider error.

---

## Task 9: nginx cutover + park the decoy

**Files:**
- Modify: the nginx vhost for `tutorials.schreinercontentsystems.com` (on vps1)

- [ ] **Step 1: Stop the decoy (keep on disk for rollback)**

```bash
pm2 stop tutorial-line-web tutorial-line-api
```
Expected: both `stopped`. Do not delete.

- [ ] **Step 2: Repoint nginx to hub-web**

Edit the vhost so `location /` proxies to `http://127.0.0.1:3000` (hub-web serves both UI and `/api/*` — remove the separate `/api → 3081` block from the decoy config). Keep TLS, `client_max_body_size` ≥ 2g, and long `proxy_read_timeout` (600s) for uploads/renders.

- [ ] **Step 3: Test and reload nginx**

```bash
sudo nginx -t && sudo systemctl reload nginx
```
Expected: `syntax is ok`, `test is successful`, reload clean.

- [ ] **Step 4: Verify the live domain serves the real app**

Run: `curl -sI https://tutorials.schreinercontentsystems.com/login`
Expected: `200`, and the page is the ContentForge login (not the Vite decoy). `curl -s https://tutorials.schreinercontentsystems.com/api/health` returns healthy JSON.

---

## Task 10: Operator smoke test (Lorraine, TUTORIAL_VA)

**Files:** none.

- [ ] **Step 1: Log in as Lorraine**

Browse `https://tutorials.schreinercontentsystems.com/login`, log in with the `TUTORIAL_VA` account.
Expected: lands directly on `/tutorial-studio`.

- [ ] **Step 2: Confirm confinement**

Try to visit `/dashboard`, `/settings`, `/team`, `/jobs`.
Expected: each redirects back to `/tutorial-studio` or 404s — no other ContentForge tool is reachable. The Keywords tab renders empty/inert (KT unset) — acceptable.

- [ ] **Step 3: Confirm she can produce**

As Lorraine, queue a tutorial job.
Expected: job runs to `READY_TO_RECORD` exactly as in Task 8. This is the acceptance test for daily use.

---

## Task 11: Post-deploy hardening

**Files:** none.

- [ ] **Step 1: Rotate the deploy key**

The `distribution-deploy2` private key was shared in plaintext. Generate a fresh keypair, install the new public key on vps1, remove `distribution-deploy2` from `~/.ssh/authorized_keys`, and confirm the leaked `ssh-key-2026-07-10.key` is absent from every `authorized_keys` on the box.
Expected: `grep -c "distribution-deploy2\|ssh-key-2026-07-10" ~/.ssh/authorized_keys` → `0`.

- [ ] **Step 2: (Optional) Move keys from `.env` into the vault UI**

As ADMIN, Settings → Credentials (`/settings#credentials`), set `FISH_API_KEY` and `GEMINI_FALLBACK_API_KEY` as encrypted secrets, then remove them from `.env` and restart. `getSecret` prefers the vault row over env. Rotatable + audited.
Expected: `/api/health/tts` still `ok` after removing the env keys.

- [ ] **Step 3: Verify rollback path once**

Confirm the documented rollback works: `pm2 start tutorial-line-web tutorial-line-api`, revert nginx to 3080/3081, `nginx -t && reload`, confirm decoy responds; then switch back to the real app. Leave the real app live.

- [ ] **Step 4: Drift guard**

Confirm `/opt/tutorials-line` tree is clean (`git status`) and on `deploy/tutorials-line`. Note in the deploy log that future changes follow DEPLOYMENT.md (commit → push → rebuild → restart; never edit in place).

---

## Deferred (separate follow-up, not this plan)

- **Automatic Gemini→DeepSeek script fallback.** ContentForge has no LLM fallback chain (only TTS does). Implementing one (mirroring `TTS_FALLBACK_CHAIN` in `generate.ts`/`llm-registry.ts`) is its own spec, and is moot until a `DEEPSEEK_API_KEY` exists. Until then Gemini is default; DeepSeek is manually selectable per job.
- **Phase 2 — client-VPS carve.** Before moving to the client's VPS, carve a tutorial-only build (or standalone repo) so none of the other ContentForge tools travel to him, with its own isolated Postgres/Redis and secrets. Own spec.

---

## Self-review notes

- Spec coverage: topology (T3,T7), isolated DB/Redis (T3), role-gated operator (T2,T10), server-side secrets (T4,T11), Gemini default (T1,T8), Fish TTS (T4,T7,T8), keyword tool inert (T4), decoy park + rollback (T9,T11), symptom fixes verified by the real engine running (T8). All present.
- The DeepSeek-fallback promise is explicitly re-scoped in "Deferred" with the reason (no LLM chain exists).
- Types/names consistent: `TUTORIAL_VA`, `google_gemini`, `GEMINI_FALLBACK_API_KEY`, `FISH_API_KEY`, `@repo/hub-web`, `@repo/worker-orchestrator`, `queue-tutorial-generate`, `password_hash`/`passwordHash`, `SECRETS_ENCRYPTION_KEY` used consistently throughout.
