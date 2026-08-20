/**
 * Seed test assets with variant relationships
 * Run with: pnpm exec tsx seed-test-variants.ts
 */

import postgres from 'postgres';

async function seedVariants() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('❌ DATABASE_URL not set');
    process.exit(1);
  }

  const sql = postgres(databaseUrl);

  try {
    console.log('🎬 Creating test assets with variants...\n');

    // Create parent asset: Original Interview Video
    console.log('1️⃣  Creating parent asset: Original Interview Video (4K)');
    const [parentVideo] = await sql`
      INSERT INTO assets (
        name,
        description,
        asset_type,
        origin,
        file_name,
        file_format,
        size_bytes,
        width,
        height,
        duration_seconds,
        status
      ) VALUES (
        'Interview with CEO - Original 4K',
        'High quality 4K interview footage',
        'video',
        'real',
        'interview-ceo-4k.mp4',
        'mp4',
        250000000,
        3840,
        2160,
        300,
        'approved'
      )
      RETURNING id, name
    `;
    console.log(`   ✓ Created: ${parentVideo.name} (ID: ${parentVideo.id})`);

    // Create variant 1: Compressed 1080p
    console.log('\n2️⃣  Creating variant: Compressed 1080p');
    const [variant1] = await sql`
      INSERT INTO assets (
        name,
        description,
        asset_type,
        origin,
        file_name,
        file_format,
        size_bytes,
        width,
        height,
        duration_seconds,
        status,
        parent_asset_id,
        variant_type,
        variant_metadata
      ) VALUES (
        'Interview with CEO - 1080p Compressed',
        'Compressed version for web',
        'video',
        'real',
        'interview-ceo-1080p.mp4',
        'mp4',
        45000000,
        1920,
        1080,
        300,
        'approved',
        ${parentVideo.id},
        'compressed',
        ${{ resolution: '1920x1080', bitrate: '5M' }}::jsonb
      )
      RETURNING id, name
    `;
    console.log(`   ✓ Created: ${variant1.name}`);

    // Create variant 2: Mobile 720p
    console.log('\n3️⃣  Creating variant: Mobile 720p');
    const [variant2] = await sql`
      INSERT INTO assets (
        name,
        description,
        asset_type,
        origin,
        file_name,
        file_format,
        size_bytes,
        width,
        height,
        duration_seconds,
        status,
        parent_asset_id,
        variant_type,
        variant_metadata
      ) VALUES (
        'Interview with CEO - Mobile',
        'Mobile optimized version',
        'video',
        'real',
        'interview-ceo-mobile.mp4',
        'mp4',
        15000000,
        1280,
        720,
        300,
        'approved',
        ${parentVideo.id},
        'mobile',
        ${{ resolution: '1280x720', bitrate: '2M' }}::jsonb
      )
      RETURNING id, name
    `;
    console.log(`   ✓ Created: ${variant2.name}`);

    // Create variant 3: Thumbnail
    console.log('\n4️⃣  Creating variant: Thumbnail');
    const [variant3] = await sql`
      INSERT INTO assets (
        name,
        description,
        asset_type,
        origin,
        file_name,
        file_format,
        size_bytes,
        width,
        height,
        status,
        parent_asset_id,
        variant_type,
        variant_metadata
      ) VALUES (
        'Interview with CEO - Thumbnail',
        'Video thumbnail',
        'image',
        'real',
        'interview-ceo-thumb.jpg',
        'jpg',
        150000,
        1920,
        1080,
        'approved',
        ${parentVideo.id},
        'thumbnail',
        ${{ resolution: '1920x1080' }}::jsonb
      )
      RETURNING id, name
    `;
    console.log(`   ✓ Created: ${variant3.name}`);

    // Create another parent: Product Demo Video
    console.log('\n5️⃣  Creating second parent: Product Demo Video');
    const [parentDemo] = await sql`
      INSERT INTO assets (
        name,
        description,
        asset_type,
        origin,
        file_name,
        file_format,
        size_bytes,
        width,
        height,
        duration_seconds,
        status
      ) VALUES (
        'Product Demo - English Original',
        'Original English product demonstration',
        'video',
        'real',
        'product-demo-en.mp4',
        'mp4',
        120000000,
        1920,
        1080,
        180,
        'approved'
      )
      RETURNING id, name
    `;
    console.log(`   ✓ Created: ${parentDemo.name} (ID: ${parentDemo.id})`);

    // Create translated variants
    console.log('\n6️⃣  Creating variant: Spanish Translation');
    const [variantES] = await sql`
      INSERT INTO assets (
        name,
        description,
        asset_type,
        origin,
        file_name,
        file_format,
        size_bytes,
        width,
        height,
        duration_seconds,
        status,
        parent_asset_id,
        variant_type,
        variant_metadata
      ) VALUES (
        'Product Demo - Spanish',
        'Spanish dubbed version',
        'audio',
        'ai_generated',
        'product-demo-es.mp3',
        'mp3',
        5000000,
        null,
        null,
        180,
        'approved',
        ${parentDemo.id},
        'translated',
        ${{ language: 'es', bitrate: '192k' }}::jsonb
      )
      RETURNING id, name
    `;
    console.log(`   ✓ Created: ${variantES.name}`);

    console.log('\n7️⃣  Creating variant: German Translation');
    const [variantDE] = await sql`
      INSERT INTO assets (
        name,
        description,
        asset_type,
        origin,
        file_name,
        file_format,
        size_bytes,
        width,
        height,
        duration_seconds,
        status,
        parent_asset_id,
        variant_type,
        variant_metadata
      ) VALUES (
        'Product Demo - German',
        'German dubbed version',
        'audio',
        'ai_generated',
        'product-demo-de.mp3',
        'mp3',
        5100000,
        null,
        null,
        180,
        'approved',
        ${parentDemo.id},
        'translated',
        ${{ language: 'de', bitrate: '192k' }}::jsonb
      )
      RETURNING id, name
    `;
    console.log(`   ✓ Created: ${variantDE.name}`);

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('✅ Test data created successfully!');
    console.log('='.repeat(60));
    console.log('\n📊 Summary:');
    console.log(`   • Parent Asset 1: "${parentVideo.name}"`);
    console.log(`     - 3 variants: Compressed, Mobile, Thumbnail`);
    console.log(`   • Parent Asset 2: "${parentDemo.name}"`);
    console.log(`     - 2 variants: Spanish, German translations`);
    console.log('\n🎯 Next steps:');
    console.log('   1. Open http://localhost:3000');
    console.log('   2. Navigate to Asset Library → Media Files');
    console.log('   3. Look for the purple "N variants" badges');
    console.log('   4. Click badges to view variants');
    console.log('   5. Try creating new variant relationships');
    console.log();

  } catch (error) {
    console.error('❌ Error seeding variants:', error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

seedVariants();
