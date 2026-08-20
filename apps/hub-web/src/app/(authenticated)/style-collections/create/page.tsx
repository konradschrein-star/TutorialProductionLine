import { redirect } from 'next/navigation';
import { getSession } from '../../_lib/v2-auth';
import { hasPermission } from '@/lib/auth/rbac';
import { listChannels } from '@/lib/repositories/channel-repository';
import { listArchetypes } from '@/lib/repositories/archetype-repository';
import { StyleCollectionForm } from '@/components/style-collections/style-collection-form';

export default async function CreateStyleCollectionPage() {
  const session = await getSession();

  if (!hasPermission(session, 'edit:settings')) {
    redirect('/style-collections');
  }

  const [channels, archetypes] = await Promise.all([
    listChannels(),
    listArchetypes(),
  ]);

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: '#e5e2e1', margin: '0 0 8px 0' }}>
          Create Style Collection
        </h1>
        <p style={{ fontSize: 12, color: '#cdc3d7', margin: 0 }}>
          Build a reusable visual style bundle with reference images and text guidelines
        </p>
      </div>

      <StyleCollectionForm
        channels={channels}
        archetypes={archetypes}
      />
    </div>
  );
}
