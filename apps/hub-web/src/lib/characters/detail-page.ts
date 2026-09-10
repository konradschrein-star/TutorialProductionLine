import { notFound, redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/rbac';
import { getCharacterWithImages } from '@/lib/repositories/character-library-repository';
import { listChannels } from '@/lib/repositories/channel-repository';

export async function loadCharacterDetail(id: string) {
  const session = await getSession();
  if (!session || !hasPermission(session, 'view:settings')) redirect('/tutorial-studio');
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) notFound();
  const character = await getCharacterWithImages(id);
  if (!character) notFound();
  const channels = await listChannels();
  return { character, channels, canEdit: hasPermission(session, 'edit:settings') };
}
