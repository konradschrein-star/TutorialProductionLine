/** Local fixtures only. Refuses any other database, including production. */
import postgres from "postgres";
import { createRequire } from "node:module";
const require = createRequire(new URL("../apps/hub-web/package.json", import.meta.url));
const bcrypt = require("bcryptjs") as { hash(value: string, rounds: number): Promise<string> };
const url = process.env.DATABASE_URL ?? "";
if (url !== "postgresql://recovery:local-test-only@127.0.0.1:55438/tutorial_recovery_test") {
  throw new Error("Recovery fixtures may only be written to the isolated local test database.");
}
const sql = postgres(url, { max: 1 });
try {
  const hash = await bcrypt.hash("Local-pilot-only-2026", 10);
  for (const [email, name, role] of [
    ["admin@recovery.test", "Recovery Admin", "ADMIN"],
    ["va@recovery.test", "Recovery VA", "TUTORIAL_VA"],
    ["other@recovery.test", "Other Producer", "TUTORIAL_VA"],
    ["uploader@recovery.test", "Recovery Uploader", "UPLOADER_VA"],
  ]) {
    await sql`INSERT INTO users(email,name,role,password_hash) VALUES (${email!},${name!},${role!},${hash}) ON CONFLICT(email) DO NOTHING`;
  }
  for (const language of ["en", "de", "fr", "it", "sv"]) {
    await sql`INSERT INTO channels(youtube_channel_id,name,language,accepts_tutorials,is_primary)
      VALUES (${"recovery-test-" + language},${"Test tutorials " + language},${language},true,${language === "en"}) ON CONFLICT(youtube_channel_id) DO NOTHING`;
  }
  const [producer] = await sql`SELECT id FROM users WHERE email='va@recovery.test'`;
  const [channel] = await sql`SELECT id FROM channels WHERE youtube_channel_id='recovery-test-en'`;
  await sql`INSERT INTO tutorial_prompt_presets(id,category,name,system_prompt,is_default,is_seeded,created_by)
    SELECT '11111111-2222-4333-8444-555555555560','THREE_MIN','Isolated integration preset','Synthetic local test only. No real provider should consume this prompt.',true,false,${producer!.id}
    WHERE NOT EXISTS (SELECT 1 FROM tutorial_prompt_presets WHERE is_default)
    ON CONFLICT(id) DO NOTHING`;
  await sql`UPDATE users SET default_tutorial_channel_id=${channel!.id} WHERE email IN ('va@recovery.test','other@recovery.test','uploader@recovery.test') AND default_tutorial_channel_id IS NULL`;
  for (const [id, title] of [
    ["11111111-2222-4333-8444-555555555551", "Recovery pilot: review and plan"],
    ["11111111-2222-4333-8444-555555555552", "Recovery pilot: return to recording"],
  ]) {
    await sql`INSERT INTO tutorial_jobs(id,created_by,channel_id,title,mode,status,script_provider,tts_provider,tts_voice,language,final_path,recording_path,completed_at,description,tags,script_text)
      VALUES (${id!},${producer!.id},${channel!.id},${title!},'THREE_MIN','COMPLETED','test','test','test','en',
      'C:/Users/konra/AppData/Local/Temp/tutorial-recovery-media/pilot-test-pattern.mp4',
      'C:/Users/konra/AppData/Local/Temp/tutorial-recovery-media/pilot-test-pattern.mp4',now(),'Isolated test pattern; not a tutorial for publication.',${sql.json(["recovery test"])},'This is a local recovery fixture.')
      ON CONFLICT(id) DO NOTHING`;
  }
  console.log("Local test users and channels ready. No providers or external delivery configured.");
} finally { await sql.end(); }
