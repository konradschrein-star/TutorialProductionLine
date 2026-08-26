# Design: Isolated Tutorial Studio → Friend's Strato VPS

**Date:** 2026-08-20
**Owner:** Konrad
**Status:** Approved (shape) — executing

## Goal

Ship this repo as a **clean, single-tenant, self-contained "Tutorial Studio"** onto a
friend's own VPS. The friend runs a separate production line with his own team and his own
API keys. Nothing may call back to Konrad's infrastructure. Longer term this repo is a
sellable product that can be re-shipped to other paying clients.

## Target environment

- **VPS:** Strato, `212.132.103.168`, Ubuntu 26.04 LTS, 8 vCPU / 15 GB RAM / 465 GB disk.
- **Access:** root via `~/.ssh/tutorial_vps_ed25519` (pubkey `konrad-tutorial-automation`). Verified.
- **Clean slate:** only git + sshd present. No node/nginx/pm2/ffmpeg/docker yet.
- **Domain:** `tutorials.schreinercontentsystems.com` (Cloudflare DNS). Currently → Hetzner
  `65.108.6.149` (temporary bridge). Cutover repoints it to the Strato VPS.
- **Render:** KVM VPS, no Intel QuickSync → FFmpeg software x264 (works on 8 vCPU, no GPU accel).

## Scope

### Part 1 — Isolation & de-branding
- `ktv2SyncService.ts`: remove hardcoded `http://65.108.6.149:8000` + manager email
  `decastroian76@gmail.com`. Replace with a configurable **"External Keyword API"** Settings
  field, **empty by default** → inert for the friend, reusable for future clients. It must
  never default to Konrad's host.
- `.env.example`: drop `KTV2_*` and `DOLPHIN_ANTY_*` (stealth uploader / distribution engine
  is out of scope).
- **Security:** delete the committed private key `deploy/vps_deploy_key` from the tree — must
  never ship to a client.
- **Secret obfuscation:** all API-key inputs in Settings masked (password type + reveal
  toggle); never log/echo keys; keys live only in `localStorage` (client) or VPS `.env`.

### Part 2 — Keyword-source separation (the "chooser")
- Add `source: 'starter' | 'own'` to `KeywordItem`. Bundled 2,150 → `starter`; anything the
  friend imports/scrapes → `own`.
- Remove the old `syncWithVPS` clobber-the-pool behavior.
- **Separate tabs/pages** in the Keyword Hub: `Starter 2,150` and `My Keywords`. Claim/status
  tracking identical on both. Creator Wizard can pull claims from either.

### Part 3 — Deploy + cutover
1. Provision Ubuntu 26.04: Node 22, PM2, nginx, ffmpeg, certbot.
2. Clone repo → `npm ci` → `npm run build` → PM2 (web + API) → nginx vhost.
3. Verify on `http://212.132.103.168`.
4. Flip Cloudflare A record `tutorials.schreinercontentsystems.com` → `212.132.103.168`;
   issue Let's Encrypt TLS.
5. Confirm live over HTTPS.
6. **Checkpoint with Konrad**, then decommission the tutorial tool from Hetzner
   `/opt/tutorials-line` (stop PM2, remove docker tl-postgres/tl-redis, restore nginx vhost
   backup) — WITHOUT disturbing ContentForge/KTv2/other services on that box.

## Verification
- Local: `npm test` (existing 45 tests) + `npm run build` green.
- New behavior covered by tests: keyword `source` tagging, separated pools, external-endpoint
  config default empty.
- On VPS: curl API health, load site, exercise both keyword tabs, run script→audio with a
  provided key.

## Out of scope (flagged follow-ons)
- Full clone of the standalone KTv2 **scraper** service (source not in this repo).
- Stealth uploader / distribution engine.
- Thumbnails remain available in-app but no new work planned here.

## Secret handling note
Konrad pasted Strato password, Cloudflare token, and R2 keys in chat. These go only into the
VPS `.env` / runtime, never git, never memory, never logs. Rotate after go-live.
