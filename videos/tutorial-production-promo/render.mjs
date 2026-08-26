import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = __dirname;
const rendersDir = path.join(projectRoot, 'renders');
const htmlFile = path.join(projectRoot, 'index.html');
const audioFile = path.join(projectRoot, 'assets', 'audio', 'master_audio.mp3');
const outputVideo = path.join(rendersDir, 'promo.mp4');

if (!fs.existsSync(rendersDir)) {
  fs.mkdirSync(rendersDir, { recursive: true });
}

const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 60;
const DURATION = 32; // 32 seconds
const TOTAL_FRAMES = FPS * DURATION;

async function renderVideo() {
  console.log(`=======================================================`);
  console.log(`🎬 HyperFrames Production Renderer: Tutorial Promo`);
  console.log(`   Resolution: ${WIDTH}x${HEIGHT} @ ${FPS}fps`);
  console.log(`   Total Duration: ${DURATION}s (${TOTAL_FRAMES} frames)`);
  console.log(`   Audio Track: ${audioFile}`);
  console.log(`   Output: ${outputVideo}`);
  console.log(`=======================================================`);

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-gpu',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      `--window-size=${WIDTH},${HEIGHT}`
    ]
  });

  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1
  });

  const page = await context.newPage();
  const fileUrl = `file://${htmlFile.replace(/\\/g, '/')}`;

  console.log(`Loading composition: ${fileUrl}`);
  await page.goto(fileUrl, { waitUntil: 'networkidle' });

  // Ensure fonts and GSAP are ready
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);

  const hasTimeline = await page.evaluate(() => {
    return !!(window.__timelines && window.__timelines.promo);
  });

  if (!hasTimeline) {
    throw new Error("window.__timelines.promo not found in page context!");
  }
  console.log("✅ Verified GSAP timeline registration on window.__timelines.promo");

  // Spawn FFmpeg to stream raw PNG / JPEG frames into MP4
  const ffmpegArgs = [
    '-y',
    '-f', 'image2pipe',
    '-vcodec', 'png',
    '-r', `${FPS}`,
    '-i', '-',
    ...(fs.existsSync(audioFile) ? ['-i', audioFile, '-c:a', 'aac', '-b:a', '192k'] : []),
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-preset', 'fast',
    '-crf', '18',
    '-shortest',
    outputVideo
  ];

  console.log(`Starting FFmpeg encoder process...`);
  const ffmpeg = spawn('ffmpeg', ffmpegArgs, { stdio: ['pipe', 'inherit', 'inherit'] });

  ffmpeg.on('error', (err) => {
    console.error('FFmpeg process error:', err);
  });

  const startTime = Date.now();

  for (let frame = 0; frame < TOTAL_FRAMES; frame++) {
    const timeSec = frame / FPS;

    // Seek the GSAP timeline precisely to timeSec
    await page.evaluate((t) => {
      if (window.__timelines && window.__timelines.promo) {
        window.__timelines.promo.seek(t, false);
      }
    }, timeSec);

    // Capture screenshot buffer
    const buffer = await page.screenshot({ type: 'png', omitBackground: false });

    // Write to FFmpeg stdin
    const canWrite = ffmpeg.stdin.write(buffer);
    if (!canWrite) {
      await new Promise(resolve => ffmpeg.stdin.once('drain', resolve));
    }

    if (frame % 120 === 0 || frame === TOTAL_FRAMES - 1) {
      const progress = ((frame / TOTAL_FRAMES) * 100).toFixed(1);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const fpsRendered = (frame / (Date.now() - startTime) * 1000).toFixed(1);
      console.log(`[Frame ${frame}/${TOTAL_FRAMES}] ${progress}% complete | Elapsed: ${elapsed}s | Render Speed: ${fpsRendered} fps`);
    }
  }

  ffmpeg.stdin.end();

  await new Promise((resolve, reject) => {
    ffmpeg.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exited with code ${code}`));
    });
  });

  await browser.close();

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  const stats = fs.statSync(outputVideo);
  const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);

  console.log(`=======================================================`);
  console.log(`🎉 VIDEO RENDER COMPLETE!`);
  console.log(`   File: ${outputVideo}`);
  console.log(`   Size: ${sizeMb} MB`);
  console.log(`   Render Time: ${totalTime}s`);
  console.log(`=======================================================`);
}

renderVideo().catch((err) => {
  console.error("Render failed:", err);
  process.exit(1);
});
