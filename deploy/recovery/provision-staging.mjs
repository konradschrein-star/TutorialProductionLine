// Run on the explicitly authorized VPS2 host, via SSH stdin. Fresh staging only.
// Generates private runtime secrets on-server; never prints their contents.
import { mkdirSync, writeFileSync, existsSync, chownSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const root='/opt/tutorial-recovery-staging';
if(process.platform!=='linux' || process.getuid?.()!==0) throw new Error('Run as root on the authorized Linux staging host');
if(existsSync(root)) throw new Error('Staging path already exists; refusing to overwrite configuration');
mkdirSync(root,{mode:0o700});
const dbPassword=randomBytes(32).toString('hex');
writeFileSync(`${root}/.env`,[
 `STAGING_DB_PASSWORD=${dbPassword}`,
 'STUDIO_IMAGE=tutorial-recovery:pending-release-verification',
 '',
].join('\n'),{mode:0o600,flag:'wx'});
writeFileSync(`${root}/runtime.env`,[
 `JWT_SECRET=${randomBytes(48).toString('hex')}`,
 `SECRETS_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`,
 `CF_API_TOKEN=${randomBytes(48).toString('hex')}`,
 'STORAGE_DRIVE_ENABLED=false',
 'TUTORIAL_RETENTION_ENABLED=false',
 'TUTORIAL_PUBLICATION_RECOVERY_ENABLED=false',
 'TUTORIAL_AUTOMATIC_DELIVERY_RECOVERY_ENABLED=false',
 'NODE_ENV=production',
 '',
].join('\n'),{mode:0o600,flag:'wx'});
for(const directory of ['media','media/tutorial','media/thumbnails','snapshots']) {
 const path=`${root}/${directory}`;
 mkdirSync(path,{mode:directory==='snapshots'?0o700:0o750});
 if(directory!=='snapshots')chownSync(path,1000,1000);
}
console.log(JSON.stringify({stagingRoot:root,privateConfigurationCreated:true,workersStarted:false,sourceDataCopied:false}));
