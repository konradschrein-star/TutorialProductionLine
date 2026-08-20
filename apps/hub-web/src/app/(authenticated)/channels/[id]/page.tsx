import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { getSession } from '../../_lib/v2-auth';
import { hasPermission } from '@/lib/auth/rbac';
import { getChannelById } from '@/lib/repositories/channel-repository';
import { V2ChannelEditForm } from './edit-form';

interface ChannelEditPageProps {
  params: Promise<{ id: string }>;
}

export default async function V2ChannelEditPage({ params }: ChannelEditPageProps) {
  const { id } = await params;
  const session = await getSession();

  if (!hasPermission(session, 'manage:channels')) {
    redirect('/channels');
  }

  const channel = await getChannelById(id);
  if (!channel) notFound();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 560 }}>
      {/* Back */}
      <Link
        href="/channels"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'rgba(205,195,215,0.5)', textDecoration: 'none', width: 'fit-content' }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>arrow_back</span>
        Channels
      </Link>

      {/* Header */}
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: '#e5e2e1', margin: 0, marginBottom: 4 }}>
          Edit Channel
        </h1>
        <p style={{ fontSize: 12, color: '#cdc3d7', margin: 0 }}>{channel.name}</p>
      </div>

      <V2ChannelEditForm channel={channel} />
    </div>
  );
}
