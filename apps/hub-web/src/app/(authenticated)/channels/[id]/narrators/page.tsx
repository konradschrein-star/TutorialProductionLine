import { redirect, notFound } from 'next/navigation';
import { getSession } from '../../../_lib/v2-auth';
import { hasPermission } from '@/lib/auth/rbac';
import { getChannelById } from '@/lib/repositories/channel-repository';
import { NarratorsByChannelView } from '@/components/narrators/narrators-by-channel-view';

interface ChannelNarratorsPageProps {
  params: Promise<{ id: string }>;
}

export default async function ChannelNarratorsPage({ params }: ChannelNarratorsPageProps) {
  const { id } = await params;
  const session = await getSession();

  // Allow users with create:job OR view:settings permission
  if (!session || !(hasPermission(session, 'view:settings') || hasPermission(session, 'create:job'))) {
    redirect('/dashboard');
  }

  const canManage = hasPermission(session, 'edit:settings');
  const channel = await getChannelById(id);

  if (!channel) notFound();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: 'var(--v2-text-1)', margin: '0 0 6px 0' }}>
          {channel.name} — Narrators
        </h1>
        <p style={{ fontSize: 13, color: 'var(--v2-text-2)', margin: 0 }}>
          PNG narrator characters with multiple pose variations for dynamic scene composition
        </p>
      </div>

      <NarratorsByChannelView channels={[channel]} canManage={canManage} />
    </div>
  );
}
