import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { characterUploadPaths, commitCharacterImage, resolveCharacterImagePath } from '../image-path';
const dirs: string[] = [];
const id = '2b867e61-9930-499b-854a-52723a7234fd';
async function temp() { const p = await mkdtemp(join(tmpdir(),'character-path-test-')); dirs.push(p); return p; }
afterEach(async () => { for (const p of dirs.splice(0)) await rm(p,{recursive:true,force:true}); });
describe('immutable character image paths', () => {
  it('same filename/order concurrent submissions have independent paths', () => {
    const paths = Array.from({length:100},()=>characterUploadPaths(join(tmpdir(),'characters'), id, 'happy pose.png', 3));
    expect(new Set(paths.map(p=>p.refPath)).size).toBe(100);
    expect(new Set(paths.map(p=>p.originalPath)).size).toBe(100);
  });
  it('atomic commits cannot overwrite another upload or existing historic bytes', async () => {
    const root=await temp(), a=join(root,'a'), b=join(root,'b'), target=join(root,'final.jpg');
    await writeFile(a,'first');await writeFile(b,'second');
    const results=await Promise.allSettled([commitCharacterImage(a,target),commitCharacterImage(b,target)]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    const before=await readFile(target,'utf8');
    await expect(commitCharacterImage(b,target)).rejects.toMatchObject({code:'EEXIST'});
    expect(await readFile(target,'utf8')).toBe(before);
  });
  it('permits preserved canonical image paths, rejects traversal and outside paths', async () => {
    const root=await temp(), media=join(root,'characters');await mkdir(media);const file=join(media,'host.jpg');await writeFile(file,'image');
    expect(await resolveCharacterImagePath(media,file)).toBe(file);
    await expect(resolveCharacterImagePath(media,join(root,'other.jpg'))).rejects.toThrow();
    await expect(resolveCharacterImagePath(media,media+'/../other.jpg')).rejects.toThrow();
    await expect(resolveCharacterImagePath(media,'relative.jpg')).rejects.toThrow();
  });
  it('rejects directory symlink/junction escaping the character root', async () => {
    const root=await temp(), media=join(root,'characters'), outside=join(root,'outside');await mkdir(media);await mkdir(outside);await writeFile(join(outside,'secret.jpg'),'private');
    await symlink(outside,join(media,'escape'),process.platform==='win32'?'junction':'dir');
    await expect(resolveCharacterImagePath(media,join(media,'escape','secret.jpg'))).rejects.toThrow();
  });
});
