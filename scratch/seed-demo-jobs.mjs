import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { prepare: false });

// VA profiles: base minutes for the slow steps (reveals distinct bottlenecks)
// start/span = the hour-of-day working window (UTC) — the intraday view reveals it.
const VAS = [
  { id: "1c90e695-35fc-4bee-8aea-b1b04132f789", name: "VA 2", script: 8, record: 14, start: 7, span: 4 },   // tight morning
  { id: "ab7b1914-4f8e-4ca6-b72c-6cadfbdaa0b4", name: "VA 3", script: 22, record: 12, start: 6, span: 12 },  // slow scripts, spread all day
  { id: "b55e5b4b-2c6d-4bfe-b434-842ceb723fd7", name: "VA 4", script: 10, record: 16, start: 12, span: 4 },  // afternoon
  { id: "42e66cfe-741c-480c-8b46-05ae6097c501", name: "VA 5", script: 9, record: 26, start: 16, span: 5 },   // slow recording, late afternoon
];

const jitter = (base) => base * (0.8 + Math.random() * 0.4);
const addMin = (d, m) => new Date(d.getTime() + m * 60_000);
const TOPICS = [
  "How to reset a router", "Set up two-factor auth", "Create a pivot table in Excel",
  "Record your screen on Windows", "Schedule posts in Buffer", "Build a Notion dashboard",
  "Automate emails in Gmail", "Design a thumbnail in Canva", "Export 4K in CapCut",
  "Configure OBS for streaming", "Write formulas in Google Sheets", "Deploy a site on Vercel",
];

let inserted = 0;
for (const va of VAS) {
  const n = 10 + Math.floor(Math.random() * 4);
  for (let i = 0; i < n; i++) {
    const daysAgo = Math.floor(Math.random() * 27);
    const createdAt = new Date(Date.now() - daysAgo * 86400_000);
    createdAt.setUTCHours(Math.floor(va.start + Math.random() * va.span) % 24, Math.floor(Math.random() * 60), 0, 0);
    const dow = createdAt.getDay(); // 0 Sun .. 1 Mon
    const mondayFactor = dow === 1 ? 1.6 : 1; // Mondays: slower scripting for everyone
    const scriptMin = jitter(va.script) * mondayFactor;
    const audioMin = jitter(1.6);
    const recordMin = jitter(va.record);
    const finishMin = jitter(3);
    const scriptDone = addMin(createdAt, scriptMin);
    const audioDone = addMin(scriptDone, audioMin);
    const recorded = addMin(audioDone, recordMin);
    const completed = addMin(recorded, finishMin);
    const title = `${TOPICS[Math.floor(Math.random() * TOPICS.length)]} #${i + 1}`;
    await sql`
      insert into tutorial_jobs
        (created_by, title, mode, status, script_provider, tts_provider, tts_voice,
         script_text, recording_path,
         audio_duration_s, recording_duration_s,
         created_at, script_done_at, audio_done_at, recorded_at, completed_at)
      values
        (${va.id}, ${title}, 'THREE_MIN', 'COMPLETED', 'deepseek', 'fish_audio', 'default',
         ${"Demo narration for " + title + ". Step-by-step tutorial script used to validate the pipeline."},
         ${"/opt/tutorial-studio/media/tutorial/demo/recording.mp4"},
         ${(180 + Math.random() * 90).toFixed(3)}, ${(200 + Math.random() * 180).toFixed(3)},
         ${createdAt}, ${scriptDone}, ${audioDone}, ${recorded}, ${completed})
    `;
    inserted++;
  }
}
console.log(`seeded ${inserted} demo tutorial jobs across ${VAS.length} VAs`);
await sql.end();
