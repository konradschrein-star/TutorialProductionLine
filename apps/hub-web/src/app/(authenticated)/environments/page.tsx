import { notFound } from 'next/navigation';
import { hasPermission } from '@/lib/auth/rbac';
import { getSession } from '../_lib/v2-auth';
import { listEnvironments } from '@/lib/repositories/environment-repository';
import { listArchetypes } from '@/lib/repositories/archetype-repository';
import { listAssets } from '@/lib/repositories/asset-repository';
import { EnvironmentsClient } from '@/components/environments/environments-client';

/**
 * V2 Environments Page
 *
 * Manages composed scene settings (background + props + spatial hints)
 * that give consistent "locations" across all scenes in a video.
 * ADMIN/MANAGER only (view:settings).
 */
export default async function V2EnvironmentsPage() {
  const session = await getSession();

  if (!hasPermission(session, 'view:settings')) {
    notFound();
  }

  const [environments, archetypes, backgroundAssets] = await Promise.all([
    listEnvironments(),
    listArchetypes(true),
    listAssets({ asset_type: 'background', status: 'approved' }),
  ]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: 'var(--v2-text-1)', margin: '0 0 6px 0' }}>
          Environments
        </h1>
        <p style={{ fontSize: 13, color: 'var(--v2-text-2)', margin: 0 }}>
          Composed scene settings for consistent locations
        </p>
      </div>

      <EnvironmentsClient
        initialEnvironments={environments as any[]}
        archetypes={archetypes as any[]}
        backgroundAssets={backgroundAssets as any[]}
      />
    </div>
  );
}
