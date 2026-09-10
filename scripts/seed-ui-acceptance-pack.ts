/** Synthetic local UI acceptance data. Never imports or modifies production. */
import postgres from "postgres";
import { access } from "node:fs/promises";
const target = "postgresql://recovery:local-test-only@127.0.0.1:55438/tutorial_recovery_test";
if (process.env.DATABASE_URL !== target) throw new Error("Isolated local acceptance database required");
const media = "C:/Users/konra/AppData/Local/Temp/tutorial-recovery-media/pilot-test-pattern.mp4";
await access(media);
const sql = postgres(target, { max: 1 });
const sourceId = "22222222-3333-4444-8555-666666666601";
try {
  await sql.begin(async (tx) => {
    const [owner] = await tx`SELECT id FROM users WHERE email='va@recovery.test'`;
    if (!owner) throw new Error("Local VA missing");
    const copies = [
      ["en", "FIX YOUR", "WORKFLOW"], ["de", "VERBESSERE DEINEN", "ARBEITSABLAUF"],
      ["fr", "AMÉLIOREZ VOTRE", "FLUX DE TRAVAIL"], ["it", "MIGLIORA IL TUO", "FLUSSO DI LAVORO"],
      ["sv", "FÖRBÄTTRA DITT", "ARBETSFLÖDE"],
    ];
    for (const [index, [language, top, bottom]] of copies.entries()) {
      const id = `22222222-3333-4444-8555-66666666660${index + 1}`;
      const [channel] = await tx`SELECT id FROM channels WHERE youtube_channel_id=${`recovery-test-${language}`}`;
      if (!channel) throw new Error(`Missing isolated ${language} channel`);
      await tx`INSERT INTO tutorial_jobs
        (id,created_by,channel_id,title,mode,status,script_provider,tts_provider,tts_voice,language,
         final_path,recording_path,completed_at,description,tags,script_text,source_job_id,
         thumbnail_text_top,thumbnail_text_bottom)
        VALUES (${id},${owner.id},${channel.id},${`UI acceptance · Workflow guide (${language})`},'THREE_MIN',
          ${index === 0 ? "COMPLETED" : "AWAITING_THUMBNAILS"},'test','test','test',${language!},
          ${index === 0 ? media : null},${index === 0 ? media : null},${index === 0 ? new Date() : null},
          'LOCAL TEST ONLY — synthetic media, never publish.',${tx.json(["local-ui-acceptance"])},
          'Synthetic local acceptance narration.',${index === 0 ? null : sourceId},${top!},${bottom!})
        ON CONFLICT(id) DO NOTHING`;
    }
  });
  console.log(JSON.stringify({ sourceId, languages: 5, localOnly: true, mediaExists: true, providerCalls: 0 }));
} finally { await sql.end(); }
