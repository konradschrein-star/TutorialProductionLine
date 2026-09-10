import { randomUUID } from 'node:crypto';
import { basename, extname, join, relative, resolve, sep, isAbsolute } from 'node:path';
import { resolveMediaKey, UnsafeMediaPathError } from '@/lib/media-path';
import { link } from 'node:fs/promises';

export const commitCharacterImage = (stagedPath: string, finalPath: string) => link(stagedPath, finalPath);

export function characterUploadPaths(root: string, id: string, name: string, sortOrder: number) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) throw new UnsafeMediaPathError('Invalid character');
  const stamp = randomUUID();
  const stem = basename(name, extname(name)).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0,60) || 'image';
  const outDir = join(root, id);
  return { outDir, originalPath: join(outDir, 'originals', `${stamp}${extname(name).toLowerCase() || '.jpg'}`),
    refPath: join(outDir, `${String(sortOrder).padStart(2,'0')}-${stem}-${stamp}.jpg`),
    scratch: join(outDir, `.upload-${stamp}`) };
}

export async function resolveCharacterImagePath(root: string, file: string) {
  const base = resolve(root);
  if (!isAbsolute(file) || resolve(file) !== file) throw new UnsafeMediaPathError('Invalid character image path');
  const key = relative(base, file);
  if (!key || isAbsolute(key) || key === '..' || key.startsWith(`..${sep}`)) throw new UnsafeMediaPathError('Character image outside root');
  return resolveMediaKey(base, key.split(sep));
}
