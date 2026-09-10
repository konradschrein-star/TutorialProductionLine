/** Linux UID-1000 directory-only migration. Input is a private JSON path array on stdin. */
import { lstat, mkdir } from 'node:fs/promises';
import { posix } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
export const MEDIA_ROOT = '/opt/content-forge/media';
export function boundedParents(paths, root = MEDIA_ROOT) {
  if (!Array.isArray(paths) || paths.length > 50000) throw Error('Invalid bounded path array');
  const parents = new Set(), blocked = new Map();
  let safePaths = 0;
  const reject = reason => blocked.set(reason, (blocked.get(reason) ?? 0) + 1);
  for (const path of paths) {
    if (typeof path !== 'string' || path.length > 4096 || path.includes('\\') || /[\x00-\x1f]/.test(path) || posix.normalize(path) !== path || !path.startsWith(root + '/')) { reject('outside_or_noncanonical'); continue; }
    const parts = posix.relative(root, posix.dirname(path)).split('/').filter(Boolean);
    if (parts.length > 24) { reject('depth_limit'); continue; }
    safePaths++;
    let current = root;
    for (const part of parts) { current += '/' + part; parents.add(current); }
  }
  if (parents.size > 100000) throw Error('Directory count exceeds limit');
  return { parents: [...parents].sort((a,b) => a.split('/').length-b.split('/').length || a.localeCompare(b)), safePaths, blocked: Object.fromEntries(blocked) };
}
export async function planDirectories(paths, { root = MEDIA_ROOT, stat = lstat } = {}) {
  const parsed = boundedParents(paths, root);
  const base = await stat(root);
  if (!base.isDirectory() || base.isSymbolicLink()) throw Error('Existing safe media root required');
  const create = [], unsafe = new Set(); let existing = 0;
  for (const path of parsed.parents) {
    if ([...unsafe].some(parent => path.startsWith(parent + '/'))) { unsafe.add(path); continue; }
    try {
      const info = await stat(path);
      if (!info.isDirectory() || info.isSymbolicLink()) unsafe.add(path);
      else existing++;
    } catch (error) { if (error.code === 'ENOENT') create.push(path); else unsafe.add(path); }
  }
  return { ...parsed, create, unsafe: [...unsafe], existing };
}
export async function applyDirectories(plan, { root = MEDIA_ROOT, stat = lstat, make = mkdir } = {}) {
  if (plan.unsafe.length || Object.values(plan.blocked).some(Boolean)) throw Error('Blocked paths require reconciliation before apply');
  let created = 0;
  for (const path of plan.create) {
    // Recheck every ancestor immediately before mkdir; no recursive mkdir/chown.
    let current = root;
    for (const part of ['', ...posix.relative(root, posix.dirname(path)).split('/').filter(Boolean)]) {
      if (part) current += '/' + part;
      const info = await stat(current);
      if (!info.isDirectory() || info.isSymbolicLink()) throw Error('Ancestor changed');
    }
    try { await make(path, { mode: 0o700 }); created++; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const info = await stat(path);
      if (!info.isDirectory() || info.isSymbolicLink()) throw Error('Conflicting directory target');
    }
  }
  return created;
}
export async function runCli() {
  const args = process.argv.slice(2), apply = args[0] === '--create-empty-directories';
  if (!(args.length === 0 || (apply && args.length === 2 && /^[a-f0-9]{64}$/.test(args[1])))) throw Error('Invalid explicit confirmation');
  if (process.platform !== 'linux' || process.getuid() !== 1000) throw Error('Run as Linux service UID1000');
  for (const ancestor of ['/opt','/opt/content-forge',MEDIA_ROOT]) {
    const info=await lstat(ancestor);
    if (!info.isDirectory() || info.isSymbolicLink()) throw Error('Unsafe media root ancestor');
  }
  let input = '';
  for await (const chunk of process.stdin) { input += chunk; if (Buffer.byteLength(input) > 8 * 1024 ** 2) throw Error('Input exceeds bound'); }
  const plan = await planDirectories(JSON.parse(input));
  const planHash = createHash('sha256').update(JSON.stringify(plan)).digest('hex');
  if (apply && args[1] !== planHash) throw Error('Plan changed since review');
  const created = apply ? await applyDirectories(plan) : 0;
  console.log(JSON.stringify({ mode: apply ? 'create-empty-directories' : 'dry-run', safePaths: plan.safePaths, existingDirectories: plan.existing, plannedDirectories: plan.create.length, blockedDirectories: plan.unsafe.length, blockedPaths: plan.blocked, planHash, createdDirectories: created, mediaFilesWritten: 0, databaseWrites: 0 }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch(() => { console.log(JSON.stringify({ stopped: true, detailsWithheld: true, mediaFilesWritten: 0, databaseWrites: 0 })); process.exitCode = 1; });
}
