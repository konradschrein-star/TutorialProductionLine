import {vi,describe,it,expect,beforeEach} from 'vitest';
const {session,select,transaction}=vi.hoisted(()=>({session:vi.fn(),select:vi.fn(),transaction:vi.fn()}));
vi.mock('@/lib/auth/session',()=>({getSession:session}));
vi.mock('@/lib/db',()=>({db:{select,transaction},channels:{},ttsVoices:{},characters:{},characterImages:{}}));
import {GET,POST} from './route';
describe('channel settings authorization',()=>{
 beforeEach(()=>vi.clearAllMocks());
 it('denies VA reads and writes before database access',async()=>{session.mockResolvedValue({role:'TUTORIAL_VA'});expect((await GET()).status).toBe(403);expect((await POST(new Request('http://local',{method:'POST',body:'{}'}))).status).toBe(403);expect(select).not.toHaveBeenCalled();expect(transaction).not.toHaveBeenCalled()});
 it('rejects unknown fields and fabricated channel IDs',async()=>{session.mockResolvedValue({role:'ADMIN'});expect((await POST(new Request('http://local',{method:'POST',body:JSON.stringify({action:'create',name:'Test',language:'ja',youtubeChannelId:'invented',primaryChannelId:null})}))).status).toBe(400);expect(transaction).not.toHaveBeenCalled()});
});
