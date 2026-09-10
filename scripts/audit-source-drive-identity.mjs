// Read-only source-server identity/quota audit. Execute over SSH stdin.
// No credential writes, Drive uploads, file listings, identity strings or raw errors.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire('/opt/content-forge/package.json');
let stage = 'load-auth';
try {
  require('dotenv').config({ path: '/opt/content-forge/.env', quiet: true });
  process.chdir('/opt/content-forge');
  let clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  let clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    const parsed = JSON.parse(readFileSync(process.env.GOOGLE_OAUTH_CLIENT_SECRET_FILE, 'utf8'));
    const client = parsed.web ?? parsed.installed ?? parsed;
    clientId ??= client.client_id;
    clientSecret ??= client.client_secret;
  }
  const refreshToken = readFileSync(process.env.GOOGLE_DRIVE_REFRESH_TOKEN_FILE, 'utf8').trim();
  stage = 'refresh-auth';
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
    signal: AbortSignal.timeout(20000),
  });
  if (!tokenResponse.ok) {
    console.log(JSON.stringify({ stage, httpStatus: tokenResponse.status, verified: false, noDriveWrites: true }));
    process.exitCode = 1;
  } else {
    const token = await tokenResponse.json();
    if (!token.access_token) throw new Error('Token absent');
    stage = 'read-about';
    const url = new URL('https://www.googleapis.com/drive/v3/about');
    url.searchParams.set('fields', 'user(emailAddress),storageQuota');
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) {
      console.log(JSON.stringify({ stage, httpStatus: response.status, verified: false, noDriveWrites: true }));
      process.exitCode = 1;
    } else {
      const about = await response.json();
      const quota = about.storageQuota;
      const integer = value => typeof value === 'string' && /^\d+$/.test(value) ? BigInt(value) : null;
      const limit = integer(quota?.limit), used = integer(quota?.usage);
      const free = limit !== null && used !== null ? (limit > used ? limit - used : 0n) : null;
      const capacityState = limit !== null ? 'finite' : quota && !Object.hasOwn(quota, 'limit') ? 'unlimited' : 'unknown';
      const bytes = value => value === null ? null : value.toString();
      console.log(JSON.stringify({
        verified: true,
        identityAvailable: typeof about.user?.emailAddress === 'string',
        emailMatchesExpected: typeof about.user?.emailAddress === 'string' ? about.user.emailAddress.toLowerCase() === 'konrad.schrein@gmail.com' : null,
        capacityState, capacityBytes: bytes(limit), usageBytes: bytes(used), freeBytes: bytes(free),
        driveUsageBytes: bytes(integer(quota?.usageInDrive)), trashUsageBytes: bytes(integer(quota?.usageInDriveTrash)),
        freeState: capacityState === 'unlimited' ? 'unlimited' : free !== null ? 'known' : 'unknown',
        noDriveWrites: true,
      }));
    }
  }
} catch {
  console.log(JSON.stringify({ stage, verified: false, failure: 'withheld-error-details', noDriveWrites: true }));
  process.exitCode = 1;
}
