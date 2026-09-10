import Link from 'next/link';
import { loadCharacterDetail } from '@/lib/characters/detail-page';
import { CharacterLibraryClient } from '@/components/characters/character-library-client';

export const dynamic = 'force-dynamic';
export default async function CharacterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { character, channels, canEdit } = await loadCharacterDetail(id);
  return <section style={{ display: 'grid', gap: 18 }}>
    <Link href="/characters" style={{ color: 'var(--v2-accent)' }}>← All character images</Link>
    <h1 style={{ color: 'var(--v2-text-1)', fontSize: 24, margin: 0 }}>{character.name} — images</h1>
    <CharacterLibraryClient initialCharacters={[character]} channels={channels} characterId={id} canEdit={canEdit} />
  </section>;
}
