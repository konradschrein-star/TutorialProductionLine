/** Real PostgreSQL constraint failure, confined to session-local TEMP tables. */
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../packages/db/package.json', import.meta.url));
const { drizzle } = require('drizzle-orm/postgres-js');
const { sql } = require('drizzle-orm');
import { setCharacterChannels } from '../packages/db/src/repositories/character-library-repository.ts';
const expected = 'postgresql://recovery:local-test-only@127.0.0.1:55438/tutorial_recovery_test';
if (process.env.DATABASE_URL !== expected) throw new Error('Exact isolated local database required');
const client = postgres(expected, { max: 1 });
const db = drizzle(client);
const host='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222';
const own='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', occupied='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
try {
  await db.transaction(async tx => {
    await tx.execute(sql`CREATE TEMP TABLE characters (id uuid PRIMARY KEY) ON COMMIT DROP`);
    await tx.execute(sql`CREATE TEMP TABLE character_channels (id uuid DEFAULT gen_random_uuid(), character_id uuid NOT NULL, channel_id uuid NOT NULL, role text NOT NULL DEFAULT 'host', is_primary boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()) ON COMMIT DROP`);
    await tx.execute(sql`CREATE UNIQUE INDEX character_probe_one_primary ON character_channels(channel_id) WHERE role='host' AND is_primary`);
    await tx.execute(sql`INSERT INTO characters(id) VALUES (${host}), (${other})`);
    await tx.execute(sql`INSERT INTO character_channels(character_id,channel_id) VALUES (${host},${own}), (${other},${occupied})`);
    const [scope] = await tx.execute(sql`SELECT n.nspname LIKE 'pg_temp_%' AS temporary FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.oid='character_channels'::regclass`);
    assert.equal(scope?.temporary,true);
    await assert.rejects(setCharacterChannels(tx as any,host,[{channel_id:occupied}]), /./);
    const after = await tx.execute(sql`SELECT character_id,channel_id,is_primary FROM character_channels ORDER BY character_id`);
    assert.equal(after.length,2);assert.equal(after[0]?.channel_id,own);assert.equal(after[1]?.channel_id,occupied);
    await setCharacterChannels(tx as any,host,[{channel_id:own},{channel_id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'}]);
    const updated = await tx.execute(sql`SELECT count(*)::int AS n FROM character_channels WHERE character_id=${host} AND is_primary`);
    assert.equal(updated[0]?.n,2);
  });
  console.log(JSON.stringify({realPostgresRollbackPassed:true,multiplePrimaryChannelsPassed:true,temporaryTablesOnly:true,persistentRowsChanged:0}));
} finally { await client.end(); }
