# Hetzner Dedicated Server Deployment Guide (Ubuntu 24.04 / Debian 12)

This guide documents how to provision and deploy the **Tutorial Production Line** on your Hetzner dedicated server (`Intel Core i7-6700, 64 GB RAM, 2x512 GB SSD` at `#FSN1-DC1`).

---

## 🔑 1. Server Access & SSH Key
Add the generated public key to your Hetzner root `~/.ssh/authorized_keys`:

```text
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAII5QOEymvbfIHSvt72ELGfmiMYrArKnBX7XpJAye51yH konrad-tutorial-automation
```

Connect to the server:
```bash
ssh -i C:\Users\konra\.ssh\tutorial_vps_ed25519 root@<HETZNER_IP>
```

---

## 🚀 2. 1-Click Automated Provisioning
Clone the repository and run the automated provisioning script:

```bash
git clone https://github.com/konradschrein-star/TutorialProductionLine.git /opt/tutorial-line
cd /opt/tutorial-line

# Make the setup script executable and run it
chmod +x deploy/hetzner_setup.sh
sudo ./deploy/hetzner_setup.sh
```

### What `hetzner_setup.sh` Configures Automatically:
1. **16 GB RAM Disk (`/mnt/ramdisk`):** Mounts a dedicated in-memory `tmpfs` disk for instant FFmpeg video/audio stream-copy remuxing with zero SSD wear.
2. **Intel QuickSync & FFmpeg:** Installs `intel-media-va-driver-non-free` and `vainfo` for hardware-accelerated video transcoding.
3. **Node.js 22 LTS & PM2:** Sets up modern Node.js and PM2 cluster process management.
4. **Nginx Reverse Proxy:** Configures Nginx with `client_max_body_size 2000M` for high-throughput video file streaming on ports `3000` (Web UI) and `3001` (API).
5. **Auto-Purge Cron Job:** Automatically cleans staging files older than 2 days from the RAM disk.

---

## 🏃 3. Launching the Services

Install project dependencies and build:
```bash
cd /opt/tutorial-line
npm install
npm run build
```

Start the PM2 cluster:
```bash
pm2 start deploy/ecosystem.config.cjs
pm2 save
pm2 startup
```

---

## 📊 4. Monitoring & Logs

* **Monitor CPU, RAM Disk & Processes:**
  ```bash
  pm2 monit
  ```
* **View API Logs:**
  ```bash
  pm2 logs tutorial-line-api
  ```
* **Check RAM Disk Space:**
  ```bash
  df -h /mnt/ramdisk
  ```
