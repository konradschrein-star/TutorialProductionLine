import postgres from "postgres";
if (process.env.DATABASE_URL !== "postgresql://recovery:local-test-only@127.0.0.1:55438/tutorial_recovery_test") throw new Error("Local test DB only");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  const id = "63023651-5056-45f0-9d61-e10ede6836b1";
  const thumbs = await sql`SELECT id,is_selected,review_verdict FROM thumbnails WHERE subject_id=${id}`;
  const draft = await sql`SELECT revision,base_thumbnail_id FROM tutorial_thumbnail_drafts WHERE tutorial_job_id=${id}`;
  const job = await sql`SELECT thumbnail_text_top,thumbnail_text_bottom,va_review_status FROM tutorial_jobs WHERE id=${id}`;
  console.log(JSON.stringify({ thumbs, draft, job }));
} finally { await sql.end(); }
