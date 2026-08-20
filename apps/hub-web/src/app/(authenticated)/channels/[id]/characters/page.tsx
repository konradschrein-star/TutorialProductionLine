import { redirect, notFound } from 'next/navigation';
import { getSession } from '../../../_lib/v2-auth';
import { hasPermission } from '@/lib/auth/rbac';
import { listCharacters } from '@/lib/repositories/character-repository';
import { listArchetypes } from '@/lib/repositories/archetype-repository';
import { getChannelById } from '@/lib/repositories/channel-repository';
import { CharacterListClient } from '@/components/characters/character-list-client';

interface ChannelCharactersPageProps {
  params: Promise<{ id: string }>;
}

export default async function ChannelCharactersPage({ params }: ChannelCharactersPageProps) {
  const { id } = await params;
  const session = await getSession();

  // Allow users with create:job OR view:settings permission
  if (!session || !(hasPermission(session, 'view:settings') || hasPermission(session, 'create:job'))) {
    redirect('/dashboard');
  }

  const channel = await getChannelById(id);
  if (!channel) notFound();

  const [characters, archetypes] = await Promise.all([
    listCharacters({ channel_id: id }),
    listArchetypes(true),
  ]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: 'var(--v2-text-1)', margin: '0 0 6px 0' }}>
          {channel.name} — Characters
        </h1>
        <p style={{ fontSize: 13, color: 'var(--v2-text-2)', margin: 0 }}>
          Manage character library for this channel
        </p>
      </div>

      <CharacterListClient
        initialCharacters={characters}
        archetypes={archetypes}
        channelId={id}
      />
    </div>
  );
}
