import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getSession } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/rbac';
import { getCharacterWithStates } from '@/lib/repositories/character-repository';
import { createAsset, getCharacterStateAssets } from '@/lib/repositories/asset-repository';
import { saveAsset } from '@/lib/services/local-storage-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/characters/[id]/states
 * Returns all state assets for a character with completeness info.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || !hasPermission(session, 'view:settings')) {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
  }
  const { id } = await params;
  const { states, totalCanonicalStates } = await getCharacterStateAssets(id);
  return NextResponse.json({ states, totalCanonicalStates });
}

/**
 * POST /api/characters/[id]/states
 * Upload a new state image for a character.
 *
 * FormData fields:
 *   - file: File (required) — the state image
 *   - state_name: string (required) — e.g. 'neutral', 'crying'
 *   - name: string (optional) — defaults to "{CharacterName} - {state_name}"
 *   - description: string (optional)
 *   - archetype_id: string (optional)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || !hasPermission(session, 'edit:settings')) {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
  }

  const { id: characterId } = await params;

  const character = await getCharacterWithStates(characterId);
  if (!character) return NextResponse.json({ error: 'Character not found' }, { status: 404 });

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const file = formData.get('file') as File | null;
  const stateName = (formData.get('state_name') as string | null)?.trim();
  const description = (formData.get('description') as string | null)?.trim() ?? '';
  const archetypeId = (formData.get('archetype_id') as string | null)?.trim() || null;

  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  if (!stateName) return NextResponse.json({ error: 'state_name is required' }, { status: 400 });
  if (/^#state:/i.test(stateName) || stateName.includes(',')) {
    return NextResponse.json(
      { error: 'state_name must be a plain identifier (e.g. "neutral") — do not include tag syntax or commas' },
      { status: 400 }
    );
  }

  if (file.size > 20 * 1024 * 1024) {
    return NextResponse.json({ error: 'File too large (max 20MB)' }, { status: 413 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'png';
    const assetUuid = randomUUID();

    const { filePath, fileName } = await saveAsset(
      'character_states',
      assetUuid,
      ext,
      buffer,
    );

    const assetName = (formData.get('name') as string | null)?.trim()
      || `${character.name} — ${stateName}`;

    const asset = await createAsset({
      name: assetName,
      description: description || `${character.name} in ${stateName} state`,
      asset_type: 'character_state',
      origin: 'real',
      channel_id: character.channel_id,
      archetype_id: archetypeId ?? character.archetype_id,
      tags: [`#state:${stateName}`, `#character:${characterId}`],
      file_path: filePath,
      file_name: fileName,
      file_format: ext,
      size_bytes: file.size,
      status: 'draft',
      character_id: characterId,
    });

    return NextResponse.json({ asset }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to upload state' },
      { status: 500 }
    );
  }
}
