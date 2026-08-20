-- Add missing columns to content_templates if they don't exist
DO $$
BEGIN
    -- Add archetype_id if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'content_templates' AND column_name = 'archetype_id'
    ) THEN
        ALTER TABLE content_templates
        ADD COLUMN archetype_id UUID REFERENCES archetypes(id) ON DELETE SET NULL;
        RAISE NOTICE 'Added archetype_id column to content_templates';
    ELSE
        RAISE NOTICE 'archetype_id column already exists';
    END IF;

    -- Add default_style_collection_id if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'content_templates' AND column_name = 'default_style_collection_id'
    ) THEN
        ALTER TABLE content_templates
        ADD COLUMN default_style_collection_id UUID REFERENCES style_collections(id) ON DELETE SET NULL;
        RAISE NOTICE 'Added default_style_collection_id column to content_templates';
    ELSE
        RAISE NOTICE 'default_style_collection_id column already exists';
    END IF;
END $$;
