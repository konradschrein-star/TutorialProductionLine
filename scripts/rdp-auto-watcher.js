/**
 * Node.js RDP Auto-Launcher Daemon for Second Machine
 * Probes the Worker Node (192.168.178.48:3389).
 * The moment the Worker Node powers on, it automatically launches mstsc.exe.
 */

const net = require('net');
const { exec } = require('child_process');

const WORKER_IP = '192.168.178.48';
const WORKER_PORT = 3389;
const POLL_INTERVAL_MS = 3000;

console.log('====================================================');
console.log('🛰️ WORKER NODE AUTO-CONNECTOR (Node.js Daemon)');
console.log(`Target: ${WORKER_IP}:${WORKER_PORT}`);
console.log('Status: Listening for Worker Node power-on...');
console.log('====================================================');

let isOnline = false;

function checkNode() {
  const socket = new net.Socket();
  socket.setTimeout(1500);

  socket.on('connect', () => {
    socket.destroy();
    if (!isOnline) {
      isOnline = true;
      console.log(`\n[${new Date().toLocaleTimeString()}] 🟢 WORKER NODE DETECTED ONLINE!`);
      console.log(`[${new Date().toLocaleTimeString()}] 🚀 Launching Remote Desktop connection...`);

      exec(`mstsc /v:${WORKER_IP}`, (err) => {
        if (err) console.error('Error launching mstsc:', err.message);
      });
    }
  });

  socket.on('timeout', () => {
    socket.destroy();
    handleOffline();
  });

  socket.on('error', () => {
    socket.destroy();
    handleOffline();
  });

  socket.connect(WORKER_PORT, WORKER_IP);
}

function handleOffline() {
  if (isOnline) {
    console.log(`\n[${new Date().toLocaleTimeString()}] 🔴 Worker Node went offline. Standing by...`);
    isOnline = false;
  }
  process.stdout.write('.');
}

setInterval(checkNode, POLL_INTERVAL_MS);
checkNode();
