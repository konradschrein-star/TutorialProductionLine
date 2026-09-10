import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/rbac';
import { listCharacterLibrary } from '@/lib/repositories/character-library-repository';
import { listChannels } from '@/lib/repositories/channel-repository';
import { CharacterLibraryClient } from '@/components/characters/character-library-client';

export const dynamic = 'force-dynamic';
export default async function CharactersPage() {
  const session = await getSession();
  if (!session || !hasPermission(session, 'view:settings')) redirect('/tutorial-studio');
  const [characters, channels] = await Promise.all([listCharacterLibrary(), listChannels()]);
  return <section style={{ display: 'grid', gap: 18 }}>
    <h1 style={{ color: 'var(--v2-text-1)', fontSize: 24, margin: 0 }}>Character images</h1>
    <p style={{ color: 'var(--v2-text-2)', margin: 0 }}>Preserved host images, channel bindings, and thumbnail rotation.</p>
    <CharacterLibraryClient initialCharacters={characters} channels={channels} canEdit={hasPermission(session, 'edit:settings')} />
  </section>;
}
