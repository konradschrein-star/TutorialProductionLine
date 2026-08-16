#!/bin/bash
# ==============================================================================
# Tutorial Production Line — Hetzner Dedicated Server Provisioning Script
# Target: Ubuntu 24.04 LTS / Debian 12 (Intel i7-6700, 64 GB RAM, 2x512 GB SSD)
# ==============================================================================

set -e

echo "🚀 [1/6] Updating system packages..."
sudo apt update && sudo apt upgrade -y

echo "📦 [2/6] Installing build tools, FFmpeg (with Intel QuickSync), Nginx, Git, Curl..."
sudo apt install -y build-essential curl git ffmpeg vainfo intel-media-va-driver-non-free nginx libva-dev libva-drm2

echo "🧠 [3/6] Setting up 16 GB RAM Disk (/mnt/ramdisk) for zero-wear instant FFmpeg rendering..."
sudo mkdir -p /mnt/ramdisk
if ! grep -qs '/mnt/ramdisk' /etc/fstab; then
  echo "tmpfs /mnt/ramdisk tmpfs defaults,size=16G 0 0" | sudo tee -a /etc/fstab
fi
sudo mount -a || true
sudo chmod 777 /mnt/ramdisk

echo "🟢 [4/6] Installing Node.js 22 LTS & PM2..."
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2

echo "🌐 [5/6] Configuring Nginx Reverse Proxy with 2GB Upload Limit..."
cat << 'EOF' | sudo tee /etc/nginx/sites-available/tutorial-line
server {
    listen 80;
    server_name _;

    client_max_body_size 2000M;
    client_body_timeout 300s;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/tutorial-line /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

echo "🛠️ [6/6] Setting up automated 5-day staging storage cleanup cron..."
(crontab -l 2>/dev/null; echo "0 3 * * * find /mnt/ramdisk/tutorial-pipeline/ -type f -mtime +2 -delete") | crontab -

echo "=============================================================================="
echo "✅ HETZNER SERVER PROVISIONING COMPLETE!"
echo "RAM Disk Mounted: $(df -h /mnt/ramdisk | awk 'NR==2 {print $2}')"
echo "To start services: pm2 start deploy/ecosystem.config.cjs"
echo "=============================================================================="
