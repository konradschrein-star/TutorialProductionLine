// Authorized one-thumbnail byte-read pilot. No existing media/Drive mutations.
// Run via verified source SSH alias and stdin. Never print tokens or private IDs.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { mkdtemp, chmod, open, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const require = createRequire('/opt/content-forge/package.json');
require('dotenv').config({ path: '/opt/content-forge/.env', quiet: true });
process.chdir('/opt/content-forge');
const MAX_BYTES = 4 * 1024 * 1024;
const summary = { selected: 0, credentialRefreshes: 0, metadataReads: 0, downloads: 0, bytes: 0, sizeMatch: false, sha256Match: false, existingFilesChanged: 0, driveWrites: 0, probePath: null, probeMode: null, result: 'not_started' };
let file;
try {
  const query = `SELECT coalesce(json_agg(x),'[]') FROM (
    SELECT drive_file_id, bytes::text, checksum_sha256
    FROM storage_artifacts WHERE owner_kind='tutorial_job' AND kind='thumbnail'
    AND state='uploaded' AND drive_file_id IS NOT NULL AND verified_at IS NOT NULL
    AND checksum_sha256 ~ '^[a-fA-F0-9]{64}$' AND bytes > 0 AND bytes <= ${MAX_BYTES}
    ORDER BY bytes ASC, uploaded_at DESC NULLS LAST LIMIT 1) x`;
  const rows = JSON.parse(execFileSync('docker', ['exec', 'content-forge-postgres', 'psql', '-U', 'postgres', '-d', 'content_forge', '-At', '-c', query], { encoding: 'utf8', maxBuffer: 1024 * 1024 }));
  if (rows.length !== 1) throw new Error('no_eligible_verified_thumbnail');
  const record = rows[0]; summary.selected = 1;
  const expected = Number(record.bytes);
  let clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  let clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    const parsed = JSON.parse(readFileSync(process.env.GOOGLE_OAUTH_CLIENT_SECRET_FILE, 'utf8'));
    const client = parsed.web ?? parsed.installed ?? parsed;
    clientId ??= client.client_id; clientSecret ??= client.client_secret;
  }
  const refreshToken = readFileSync(process.env.GOOGLE_DRIVE_REFRESH_TOKEN_FILE, 'utf8').trim();
  summary.credentialRefreshes++;
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }), signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`credential_refresh_http_${response.status}`);
  const token = await response.json();
  if (!token.access_token) throw new Error('credential_refresh_missing_token');
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(record.drive_file_id)}`);
  url.searchParams.set('supportsAllDrives', 'true');
  url.searchParams.set('fields', 'size,sha256Checksum,trashed');
  summary.metadataReads++;
  const metadata = await fetch(url, { headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(20000) });
  if (!metadata.ok) throw new Error(`metadata_http_${metadata.status}`);
  const remote = await metadata.json();
  if (remote.trashed || Number(remote.size) !== expected || (remote.sha256Checksum && remote.sha256Checksum.toLowerCase() !== record.checksum_sha256.toLowerCase())) throw new Error('remote_receipt_metadata_mismatch');
  const directory = await mkdtemp('/tmp/cf-drive-restore-pilot-');
  await chmod(directory, 0o700);
  summary.probePath = join(directory, 'thumbnail.bin');
  file = await open(summary.probePath, 'wx', 0o600);
  url.searchParams.delete('fields'); url.searchParams.set('alt', 'media');
  summary.downloads++;
  const media = await fetch(url, { headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(30000) });
  if (!media.ok) { await media.body?.cancel(); throw new Error(`download_http_${media.status}`); }
  const declared = media.headers.get('content-length');
  if (declared !== null && Number(declared) !== expected) { await media.body?.cancel(); throw new Error('declared_length_mismatch'); }
  if (!media.body) throw new Error('download_missing_body');
  const hash = createHash('sha256');
  for await (const chunk of media.body) {
    if (summary.bytes + chunk.length > expected || summary.bytes + chunk.length > MAX_BYTES) throw new Error('download_exceeded_cap');
    hash.update(chunk);
    let offset = 0;
    while (offset < chunk.length) {
      const written = await file.write(chunk, offset, chunk.length - offset);
      if (!written.bytesWritten) throw new Error('local_write_stalled');
      offset += written.bytesWritten; summary.bytes += written.bytesWritten;
    }
  }
  await file.sync();
  summary.sizeMatch = summary.bytes === expected;
  summary.sha256Match = hash.digest('hex') === record.checksum_sha256.toLowerCase();
  summary.result = summary.sizeMatch && summary.sha256Match ? 'verified' : 'byte_verification_failed';
} catch (error) {
  const message = error instanceof Error ? error.message : '';
  summary.result = /^[a-z_]+(?:_http_\d+)?$/.test(message) ? message : 'probe_failed_details_withheld';
} finally {
  await file?.close().catch(() => undefined);
  if (summary.probePath) {
    const info = await stat(summary.probePath).catch(() => null);
    if (info) { summary.bytes = info.size; summary.probeMode = (info.mode & 0o777).toString(8); }
  }
  console.log(JSON.stringify(summary));
  if (summary.result !== 'verified') process.exitCode = 1;
}
