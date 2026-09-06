import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const audioDir = path.join(projectRoot, 'assets', 'audio');

if (!fs.existsSync(audioDir)) {
  fs.mkdirSync(audioDir, { recursive: true });
}

const FISH_API_KEY = process.env.FISH_API_KEY;
if (!FISH_API_KEY) {
  throw new Error('FISH_API_KEY is required');
}
const FISH_VOICE_ID = "395ba76e58c04fd49467755b8182384e"; // Konrad's neural voice model
const FISH_API_BASE = "https://api.fish.audio";

const SCRIPT_SEGMENTS = [
  {
    id: 'scene1_voice',
    startSec: 0.2,
    text: "Manual video production is officially dead. Spending hours editing takes, designing thumbnails, and recording voiceovers is holding you back."
  },
  {
    id: 'scene2_voice',
    startSec: 6.8,
    text: "Meet Tutorial Production Line. An end-to-end autonomous workstation that ingests keywords, synthesizes scripts, and splices video takes in seconds."
  },
  {
    id: 'scene3_voice',
    startSec: 13.8,
    text: "One topic scales to ten languages instantly. Powered by native Fish Audio neural voices, cloud auto-delivery, and zero bottlenecks."
  },
  {
    id: 'scene4_voice',
    startSec: 20.8,
    text: "Create studio-grade YouTube thumbnails with seventy-one app logos, instant two-point-four-x retina export, and custom brand presets."
  },
  {
    id: 'scene5_voice',
    startSec: 27.2,
    text: "Automate your entire YouTube empire. Start producing at scale today."
  }
];

async function generateFishTTS(text, outputFile) {
  console.log(`🎙️ Synthesizing Fish Audio TTS: "${text.slice(0, 45)}..."`);
  const res = await fetch(`${FISH_API_BASE}/v1/tts`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${FISH_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      text,
      format: "mp3",
      reference_id: FISH_VOICE_ID,
      prosody: { speed: 1.12, normalize_loudness: true }
    })
  });

  if (!res.ok) {
    throw new Error(`Fish Audio API error ${res.status}: ${await res.text()}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outputFile, buf);
  console.log(`   ✓ Received ${buf.length} bytes from Fish Audio`);
}

async function main() {
  console.log("=== Synthesizing Studio Narration with Fish Audio ===");
  const segmentFiles = [];

  for (let i = 0; i < SCRIPT_SEGMENTS.length; i++) {
    const seg = SCRIPT_SEGMENTS[i];
    const rawMp3 = path.join(audioDir, `raw_${seg.id}.mp3`);
    const enhancedWav = path.join(audioDir, `${seg.id}.wav`);

    await generateFishTTS(seg.text, rawMp3);

    // High-pass + broadcast clarity compressor + precise loudness normalization
    execSync(`ffmpeg -y -i "${rawMp3}" -af "highpass=f=75,acompressor=threshold=0.12:ratio=3.5:attack=4:release=45,loudnorm=I=-14:LRA=6:TP=-1" "${enhancedWav}"`, { stdio: 'ignore' });
    segmentFiles.push({ ...seg, file: enhancedWav });
    if (fs.existsSync(rawMp3)) fs.unlinkSync(rawMp3);
  }

  // Create a high-end, rhythmic Linear-style electronic ambient music bed (32s)
  const bgmTrack = path.join(audioDir, 'bgm_cinematic.wav');
  console.log("Synthesizing precision workstation soundtrack...");

  // Electronic rhythmic pulse + subtle harmonic layer
  execSync(`ffmpeg -y -f lavfi -i "sine=frequency=70:duration=32" -f lavfi -i "sine=frequency=140:duration=32" -f lavfi -i "anoisesrc=d=32:c=pink:r=48000:a=0.015" -filter_complex "[0:a]volume=0.22[a0];[1:a]volume=0.12[a1];[2:a]lowpass=f=350,volume=0.15[a2];[a0][a1][a2]amix=inputs=3:dropout_transition=0,aecho=0.8:0.7:40:0.25[bgm]" -map "[bgm]" -t 32 "${bgmTrack}"`, { stdio: 'ignore' });

  // Master all voice segments + BGM into final master_audio.mp3
  console.log("Mastering final continuous soundtrack (32s)...");
  const inputs = [`-i "${bgmTrack}"`];
  let filterParts = [];
  let amixInputs = ['[0:a]'];

  for (let i = 0; i < segmentFiles.length; i++) {
    const s = segmentFiles[i];
    inputs.push(`-i "${s.file}"`);
    const delayMs = Math.round(s.startSec * 1000);
    filterParts.push(`[${i + 1}:a]adelay=${delayMs}|${delayMs},volume=2.4[v${i}]`);
    amixInputs.push(`[v${i}]`);
  }

  const masterFilterScript = path.join(audioDir, 'master_filter.txt');
  const fullFilter = `${filterParts.join(';')};${amixInputs.join('')}amix=inputs=${amixInputs.length}:dropout_transition=0,volume=1.35,loudnorm=I=-13:LRA=6:TP=-0.8[out]`;
  fs.writeFileSync(masterFilterScript, fullFilter, 'utf8');

  const masterMp3 = path.join(audioDir, 'master_audio.mp3');
  execSync(`ffmpeg -y ${inputs.join(' ')} -filter_complex_script "${masterFilterScript}" -map "[out]" -t 32 -b:a 192k "${masterMp3}"`, { stdio: 'inherit' });
  if (fs.existsSync(masterFilterScript)) fs.unlinkSync(masterFilterScript);

  console.log(`✅ Master Fish Audio soundtrack generated: ${masterMp3}`);
}

main().catch(err => {
  console.error("Audio generation error:", err);
  process.exit(1);
});
