#!/usr/bin/env node

import postgres from 'postgres';

const sql = postgres(
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5434/content_forge'
);

async function seedRemotionPresets() {
  console.log('Seeding Remotion caption presets...');

  const presets = [
    {
      name: 'Fade In/Out',
      is_default: true,
      config: {
        animation_type: 'fade',
        font_family: 'Montserrat',
        font_size: 72,
        primary_color: '#FFFFFF',
        highlight_color: '#AAFF00',
        position: 'bottom',
      },
    },
    {
      name: 'Slide Up',
      is_default: false,
      config: {
        animation_type: 'slideUp',
        font_family: 'Montserrat',
        font_size: 72,
        primary_color: '#FFFFFF',
        highlight_color: '#AAFF00',
        position: 'bottom',
      },
    },
    {
      name: 'Pop',
      is_default: false,
      config: {
        animation_type: 'pop',
        font_family: 'Inter',
        font_size: 68,
        primary_color: '#FFFFFF',
        highlight_color: '#FF6B6B',
        position: 'center',
      },
    },
    {
      name: 'Typewriter',
      is_default: false,
      config: {
        animation_type: 'typewriter',
        font_family: 'Montserrat',
        font_size: 64,
        primary_color: '#FFFFFF',
        highlight_color: '#00D9FF',
        position: 'bottom',
      },
    },
    {
      name: 'Smooth Highlight',
      is_default: false,
      config: {
        animation_type: 'smoothHighlight',
        font_family: 'Inter',
        font_size: 72,
        primary_color: '#FFFFFF',
        highlight_color: '#AAFF00',
        position: 'bottom',
      },
    },
  ];

  for (const preset of presets) {
    try {
      await sql`
        INSERT INTO remotion_caption_presets (name, is_default, config)
        VALUES (${preset.name}, ${preset.is_default}, ${sql.json(preset.config)})
        ON CONFLICT DO NOTHING
      `;
      console.log(`✓ Inserted preset: ${preset.name}`);
    } catch (error) {
      console.error(`✗ Error inserting preset ${preset.name}:`, error.message);
    }
  }

  console.log('Done seeding Remotion caption presets!');
  await sql.end();
}

seedRemotionPresets().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
