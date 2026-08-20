import { config } from 'dotenv';
import { resolve } from 'path';
import { initializeDb, getDb } from './src/singleton.js';
import { contentJobs } from './src/schema/index.js';
import { eq } from 'drizzle-orm';

// Load environment from root .env
config({ path: resolve(process.cwd(), '../../.env') });

const jobId = '6a2c3fcc-df19-495a-ab84-2491c402f8f0';

async function inspectJob() {
  try {
    initializeDb();
    const db = getDb();

    const result = await db
      .select()
      .from(contentJobs)
      .where(eq(contentJobs.id, jobId))
      .limit(1);

    if (result.length === 0) {
      console.log('Job not found');
      process.exit(1);
    }

    const job = result[0];
    console.log('=== JOB METADATA ===');
    console.log('ID:', job.id);
    console.log('Status:', job.status);
    console.log('Format:', job.format);
    console.log('Template ID:', job.template_id);
    console.log('Created:', job.created_at);
    console.log('Updated:', job.updated_at);
    console.log('Error:', job.error_message || 'None');

    console.log('\n=== ASSEMBLY MANIFEST ===');
    if (job.assembly_manifest) {
      const manifest = typeof job.assembly_manifest === 'string'
        ? JSON.parse(job.assembly_manifest)
        : job.assembly_manifest;
      console.log(JSON.stringify(manifest, null, 2));
    } else {
      console.log('NULL');
    }

    console.log('\n=== R2 ASSET MANIFEST ===');
    if (job.r2_asset_manifest) {
      const assets = typeof job.r2_asset_manifest === 'string'
        ? JSON.parse(job.r2_asset_manifest)
        : job.r2_asset_manifest;
      console.log(JSON.stringify(assets, null, 2));
    } else {
      console.log('NULL');
    }

    console.log('\n=== GENERATION LOG ===');
    if (job.generation_log) {
      const log = typeof job.generation_log === 'string'
        ? JSON.parse(job.generation_log)
        : job.generation_log;
      console.log(JSON.stringify(log, null, 2));
    } else {
      console.log('NULL');
    }

    console.log('\n=== STATE MACHINE HISTORY ===');
    if (job.state_machine_history) {
      const history = typeof job.state_machine_history === 'string'
        ? JSON.parse(job.state_machine_history)
        : job.state_machine_history;
      console.log(JSON.stringify(history, null, 2));
    } else {
      console.log('NULL');
    }

    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

inspectJob();
