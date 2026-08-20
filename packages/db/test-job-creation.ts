import { config } from 'dotenv';
import { resolve } from 'path';
import { initializeDb, getDb } from './src/singleton.js';
import { channels, contentTemplates, contentJobs } from './src/schema/index.js';
import { eq } from 'drizzle-orm';

// Load environment from root .env
config({ path: resolve(process.cwd(), '../../.env') });

async function main() {
  try {
    initializeDb();
    const db = getDb();

    // Query all channels
    console.log('=== AVAILABLE CHANNELS ===');
    const channelList = await db.select().from(channels);
    channelList.forEach(ch => {
      console.log(`ID: ${ch.id}`);
      console.log(`Name: ${ch.name}`);
      console.log(`Language: ${ch.language}`);
      console.log(`YouTube Channel ID: ${ch.youtube_channel_id}`);
      console.log('---');
    });

    // Query political commentary templates
    console.log('\n=== POLITICAL COMMENTARY TEMPLATES ===');
    const templates = await db
      .select()
      .from(contentTemplates)
      .where(eq(contentTemplates.format, 'POLITICAL_COMMENTARY'));

    templates.forEach(t => {
      console.log(`ID: ${t.id}`);
      console.log(`Name: ${t.name}`);
      console.log(`Format: ${t.format}`);
      console.log(`Description: ${t.description || 'N/A'}`);
      console.log('---');
    });

    // Query explainer templates
    console.log('\n=== EXPLAINER TEMPLATES ===');
    const explainerTemplates = await db
      .select()
      .from(contentTemplates)
      .where(eq(contentTemplates.format, 'EXPLAINER'));

    explainerTemplates.forEach(t => {
      console.log(`ID: ${t.id}`);
      console.log(`Name: ${t.name}`);
      console.log(`Format: ${t.format}`);
      console.log(`Description: ${t.description || 'N/A'}`);
      console.log('---');
    });

    // Query stickman templates
    console.log('\n=== STICKMAN TEMPLATES ===');
    const stickmanTemplates = await db
      .select()
      .from(contentTemplates)
      .where(eq(contentTemplates.format, 'STICKMAN_ANIMATION'));

    stickmanTemplates.forEach(t => {
      console.log(`ID: ${t.id}`);
      console.log(`Name: ${t.name}`);
      console.log(`Format: ${t.format}`);
      console.log(`Description: ${t.description || 'N/A'}`);
      console.log('---');
    });

    // Query recent jobs
    console.log('\n=== RECENT JOBS (last 5) ===');
    const recentJobs = await db
      .select({
        id: contentJobs.id,
        status: contentJobs.status,
        format: contentJobs.format,
        created_at: contentJobs.created_at,
        error_message: contentJobs.error_message,
      })
      .from(contentJobs)
      .orderBy(contentJobs.created_at)
      .limit(5);

    recentJobs.forEach(job => {
      console.log(`ID: ${job.id}`);
      console.log(`Status: ${job.status}`);
      console.log(`Format: ${job.format}`);
      console.log(`Created: ${job.created_at}`);
      if (job.error_message) {
        console.log(`Error: ${job.error_message}`);
      }
      console.log('---');
    });

    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

main();
