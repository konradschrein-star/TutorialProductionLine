#!/usr/bin/env node

import { config } from 'dotenv';
import { loadConfig } from '@repo/config';
import { createDrizzleClient } from './dist/index.js';
import { ttsVoices } from './dist/schema/index.js';

config({ path: '../../.env' });

const cfg = loadConfig();
const db = createDrizzleClient(cfg.DATABASE_URL);

const voices = await db.select().from(ttsVoices);

console.log('\n=== All TTS Voices ===');
for (const voice of voices) {
  console.log(`DB UUID: ${voice.id}`);
  console.log(`Name: ${voice.name}`);
  console.log(`Provider: ${voice.provider}`);
  console.log(`Provider Voice ID: ${voice.voiceId}`);
  console.log(`Language: ${voice.language}`);
  console.log(`Active: ${voice.isActive}`);
  console.log('---');
}

process.exit(0);
