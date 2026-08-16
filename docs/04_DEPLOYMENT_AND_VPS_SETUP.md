# Deployment & VPS Infrastructure Guide

**Target System:** Tutorial Production Line (`TutorialProductionLine`)  
**Date:** August 16, 2026

---

## 1. VPS SSH Access & Authentication

A dedicated ed25519 SSH keypair has been generated for secure access to the client's deployment VPS.

### Public Key (Add to VPS `~/.ssh/authorized_keys`):
```text
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAII5QOEymvbfIHSvt72ELGfmiMYrArKnBX7XpJAye51yH konrad-tutorial-automation
```

### Local Key Pair Locations:
* **Private Key:** `C:\Users\konra\.ssh\tutorial_vps_ed25519`
* **Public Key:** `C:\Users\konra\.ssh\tutorial_vps_ed25519.pub`

### Verification Command:
```bash
ssh -i ~/.ssh/tutorial_vps_ed25519 <USER>@<VPS_IP>
```

---

## 2. Server Environment Prerequisites

On the target Ubuntu 22.04 / 24.04 LTS host:

```bash
# 1. System packages
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git ffmpeg nginx

# 2. Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 3. Process Manager
sudo npm install -g pm2
```

---

## 3. Reverse Proxy Configuration (`/etc/nginx/sites-available/tutorial-line`)

```nginx
server {
    listen 80;
    server_name _;

    client_max_body_size 2G;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;

        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }
}
```

---

## 4. Security Protocols (No Secret Leaks)

1. **Environment Variables:** All API keys (Groq, Mistral, ElevenLabs, Fish Audio, Database credentials) must reside strictly in `.env.production` on the VPS.
2. **Git Hygiene:** Never commit `.env*`, `*.key`, `*.pem`, or user session directories to version control.
3. **Storage Hygiene:** Uploaded temp artifacts must be purged on job completion or rotated via automated cron.
