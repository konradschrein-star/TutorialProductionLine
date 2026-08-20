#!/usr/bin/env node

import { config } from 'dotenv';
import { loadConfig } from '@repo/config';
import { createDrizzleClient } from './dist/index.js';
import { ttsVoices } from './dist/schema/index.js';
import { eq } from 'drizzle-orm';

config({ path: '../../.env' });

const cfg = loadConfig();
const db = createDrizzleClient(cfg.DATABASE_URL);

// Query for ElevenLabs voices
const voices = await db.select().from(ttsVoices).where(eq(ttsVoices.provider, 'ElevenLabs'));

console.log('\n=== ElevenLabs Voices ===');
for (const voice of voices) {
  console.log(`DB UUID: ${voice.id}`);
  console.log(`Name: ${voice.name}`);
  console.log(`Provider Voice ID: ${voice.voiceId}`);
  console.log(`Active: ${voice.isActive}`);
  console.log('---');
}

process.exit(0);
