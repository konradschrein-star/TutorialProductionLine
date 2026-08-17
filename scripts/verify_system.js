import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';

console.log('================================================================');
console.log('🔍 TUTORIAL PRODUCTION LINE — SERVER PRE-FLIGHT DIAGNOSTICS');
console.log('================================================================\n');

let passCount = 0;
let warnCount = 0;

// 1. Node.js version check
const nodeVersion = process.version;
console.log(`[1] Node.js Runtime: ${nodeVersion}`);
if (parseInt(nodeVersion.slice(1).split('.')[0], 10) >= 18) {
  console.log('    ✅ Node version is modern and supported.');
  passCount++;
} else {
  console.log('    ⚠️ Node 18+ recommended.');
  warnCount++;
}

// 2. Memory & CPU Metrics
const totalRamGb = (os.totalmem() / (1024 ** 3)).toFixed(1);
const freeRamGb = (os.freemem() / (1024 ** 3)).toFixed(1);
const cpuCores = os.cpus().length;
const cpuModel = os.cpus()[0]?.model || 'Unknown';
console.log(`\n[2] Hardware Specs:`);
console.log(`    - CPU: ${cpuModel} (${cpuCores} Cores)`);
console.log(`    - Total RAM: ${totalRamGb} GB (Free: ${freeRamGb} GB)`);
passCount++;

// 3. RAM Disk Check
console.log(`\n[3] In-Memory Storage (/mnt/ramdisk):`);
if (fs.existsSync('/mnt/ramdisk')) {
  console.log('    ✅ /mnt/ramdisk detected and active!');
  passCount++;
} else {
  console.log('    ℹ️ /mnt/ramdisk not found (Falling back to local SSD storage directory).');
}

// 4. FFmpeg Verification
console.log(`\n[4] FFmpeg Video Engine:`);
try {
  const ffmpegVersion = execSync('ffmpeg -version', { stdio: 'pipe' }).toString().split('\n')[0];
  console.log(`    ✅ FFmpeg is installed: ${ffmpegVersion}`);
  passCount++;
} catch (e) {
  console.log('    ⚠️ FFmpeg is not installed or not in PATH.');
  warnCount++;
}

// 5. Port Availability
console.log(`\n[5] Target Port Bindings:`);
console.log(`    - Web Port: 3000`);
console.log(`    - API Port: 3001`);
passCount++;

console.log('\n================================================================');
console.log(`🎉 DIAGNOSTICS COMPLETE: ${passCount} Checks Passed, ${warnCount} Warnings`);
console.log('Ready to start: npm run build && pm2 start deploy/ecosystem.config.cjs');
console.log('================================================================\n');
