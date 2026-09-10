import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({session:vi.fn(),row:vi.fn(),resolve:vi.fn()}));
vi.mock('@/lib/auth/session',()=>({getSession:mocks.session}));
vi.mock('@/lib/repositories/character-library-repository',()=>({getCharacterImageById:mocks.row}));
vi.mock('@/lib/characters/image-path',()=>({resolveCharacterImagePath:mocks.resolve}));
import { GET } from '@/app/api/characters/images/[imageId]/file/route';
describe('character image delivery guard',()=>{
  beforeEach(()=>{vi.clearAllMocks();mocks.session.mockResolvedValue({role:'ADMIN',userId:'admin'});mocks.row.mockResolvedValue({image_path:'/private/path/image.jpg'});});
  it('denies before lookup when unauthenticated',async()=>{mocks.session.mockResolvedValue(null);const r=await GET({}as any,{params:Promise.resolve({imageId:'x'})});expect(r.status).toBe(403);expect(mocks.row).not.toHaveBeenCalled();});
  it('does not expose private paths on missing or unsafe references',async()=>{mocks.resolve.mockRejectedValue(Error('private failure /private/path'));const r=await GET({}as any,{params:Promise.resolve({imageId:'x'})});expect(r.status).toBe(404);const b=await r.json();expect(b.code).toBe('CHARACTER_IMAGE_UNAVAILABLE');expect(JSON.stringify(b)).not.toContain('/private');});
});
