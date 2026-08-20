import { notFound } from 'next/navigation';
import { hasPermission } from '@/lib/auth/rbac';
import { getSession } from '../_lib/v2-auth';
import { listArchetypes } from '@/lib/repositories/archetype-repository';
import { listAssets } from '@/lib/repositories/asset-repository';
import { ArchetypesClient } from './archetypes-client';

/**
 * V2 Archetypes Page
 *
 * Manages visual style archetypes — the DNA that defines how content
 * looks across all jobs using that style.
 * ADMIN/MANAGER only (view:settings).
 */
export default async function V2ArchetypesPage() {
  const session = await getSession();

  if (!hasPermission(session, 'view:settings')) {
    notFound();
  }

  const [archetypes, styleGuideAssets] = await Promise.all([
    listArchetypes(false),
    listAssets({ asset_type: 'style_guide', status: 'approved' }),
  ]);

  // Build a set of archetype IDs that have at least one approved style guide
  const archetypeIdsWithStyleGuide = new Set(
    styleGuideAssets
      .map((a) => a.archetype_id)
      .filter((id): id is string => id !== null)
  );

  const archetypesWithGuideFlag = archetypes.map((archetype) => ({
    ...archetype,
    hasStyleGuide: archetypeIdsWithStyleGuide.has(archetype.id),
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Header */}
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: 'var(--v2-text-1)', margin: '0 0 6px 0' }}>
          Archetypes
        </h1>
        <p style={{ fontSize: 13, color: 'var(--v2-text-2)', margin: 0 }}>
          Visual style DNA for your content
        </p>
      </div>

      <ArchetypesClient initialArchetypes={archetypesWithGuideFlag} />
    </div>
  );
}
