import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canAccessRoute } from '../rbac';
const mocks = vi.hoisted(() => ({ session: vi.fn(), character: vi.fn(), channels: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getSession: mocks.session }));
vi.mock('@/lib/repositories/character-library-repository', () => ({ getCharacterWithImages: mocks.character }));
vi.mock('@/lib/repositories/channel-repository', () => ({ listChannels: mocks.channels }));
vi.mock('@/components/characters/character-library-client', () => ({ CharacterLibraryClient: () => null }));
vi.mock('next/link', () => ({ default: () => null }));
vi.mock('next/navigation', () => ({ redirect: () => { throw new Error('redirect'); }, notFound: () => { throw new Error('not-found'); } }));
import { loadCharacterDetail } from '@/lib/characters/detail-page';
const id = '2b867e61-9930-499b-854a-52723a7234fd';
const session = (role: string) => ({ role, userId: 'operator', email: 'test@example.invalid' }) as any;
describe('standalone character image navigation', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.session.mockResolvedValue(session('ADMIN')); mocks.character.mockResolvedValue({ id, name: 'Host', images: [], channel_ids: [] }); mocks.channels.mockResolvedValue([]); });
  it('opens exact Admin detail through middleware policy without enabling parked routes', () => {
    expect(canAccessRoute(session('ADMIN'), `/characters/${id}`)).toBe(true);
    expect(canAccessRoute(session('ADMIN'), '/characters')).toBe(true);
    expect(canAccessRoute(session('ADMIN'), '/charactersFAKE')).toBe(false);
    expect(canAccessRoute(session('ADMIN'), '/video-stitcher')).toBe(false);
  });
  it('keeps production and uploader VAs outside global library permissions', () => {
    for (const role of ['PRODUCTION_VA', 'UPLOADER_VA']) expect(canAccessRoute(session(role), `/characters/${id}`)).toBe(false);
  });
  it('denies before data reads', async () => {
    mocks.session.mockResolvedValue(session('UPLOADER_VA'));
    await expect(loadCharacterDetail(id)).rejects.toThrow('redirect');
    expect(mocks.character).not.toHaveBeenCalled();
  });
  it('invalid and missing IDs fail closed', async () => {
    await expect(loadCharacterDetail('bad')).rejects.toThrow('not-found');
    expect(mocks.character).not.toHaveBeenCalled();
    mocks.character.mockResolvedValue(null);
    await expect(loadCharacterDetail(id)).rejects.toThrow('not-found');
  });
  it('uses the existing image library scoped to the exact expanded character', async () => {
    const result = await loadCharacterDetail(id);
    expect(result.character.id).toBe(id);
    expect(result.canEdit).toBe(true);
    expect(mocks.character).toHaveBeenCalledWith(id);
  });
  it('viewer keeps read-only access, not edit controls', async () => {
    mocks.session.mockResolvedValue(session('VIEWER'));
    const result = await loadCharacterDetail(id);
    expect(result.canEdit).toBe(false);
  });
});
