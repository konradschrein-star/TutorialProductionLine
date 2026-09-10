/** Local memory-only coordinator. Does not install code or retry uncertain uploads. */
import {execFileSync,spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {sha256Text} from './preserve-english-finals';
import {inspectSingleThumbnailSource} from './single-thumbnail-source';
import {assertSingleThumbnail,SINGLE_THUMBNAIL as S} from './single-thumbnail-policy';
const options=['-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10'];
const remotePath='/opt/tutorial-recovery-staging/tools/upload-single-thumbnail-remote.mjs';
function source(include:boolean){const code=`(${inspectSingleThumbnailSource.toString()})(${include}).then(x=>process.stdout.write(JSON.stringify(x))).catch(()=>{process.stderr.write('SOURCE_CHECK_FAILED');process.exitCode=1});`;const result=execFileSync('ssh',[...options,'cf-vps-deploy','node'],{input:code,encoding:'utf8',timeout:45000,maxBuffer:512*1024,stdio:['pipe','pipe','pipe']});return JSON.parse(result);}
let child:ReturnType<typeof spawn>|null=null,dispatched=false;
try{
  if(process.argv.length!==3||process.argv[2]!=='--execute-exact-thumbnail')throw Error('explicit_single_only');
  const localCode=readFileSync(join(dirname(process.argv[1]!), 'upload-single-thumbnail-remote.mjs'),'utf8'),expected=sha256Text(localCode);
  const check=`const f=require('node:fs'),c=require('node:crypto'),p='${remotePath}';const s=f.lstatSync(p);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.uid!==0||(s.mode&0o022))throw Error('unsafe code');process.stdout.write(c.createHash('sha256').update(f.readFileSync(p)).digest('hex'));`;
  const actual=execFileSync('ssh',[...options,'vps2','node'],{input:check,encoding:'utf8',timeout:30000,maxBuffer:1024,stdio:['pipe','pipe','pipe']}).trim();if(actual!==expected)throw Error('reviewed_remote_code_mismatch');
  const initial=source(true);assertSingleThumbnail(initial);
  child=spawn('ssh',[...options,'vps2',`node ${remotePath} --execute-exact-thumbnail`],{stdio:['pipe','pipe','pipe'],windowsHide:true});
  const processResult=new Promise<number|null>((resolve,reject)=>{child!.once('error',reject);child!.once('close',resolve)});
  child.stderr!.resume();const timer=setTimeout(()=>child?.kill(),300000);timer.unref();
  dispatched=true;child.stdin!.write(JSON.stringify({type:'init',source:initial})+'\n');let result:any=null,requests=0,stdoutBytes=0;
  for await(const line of createInterface({input:child.stdout!,crlfDelay:Infinity})){
    stdoutBytes+=line.length;if(stdoutBytes>65536)throw Error('protocol_bound');const frame=JSON.parse(line);
    if(frame.event==='source-recheck'){
      if(frame.requestId!==++requests||requests>8)throw Error('protocol_sequence');
      try{const fresh=source(false);assertSingleThumbnail(fresh);child.stdin!.write(JSON.stringify({type:'source-recheck-result',requestId:requests,ok:fresh.statToken===initial.statToken,sourceRevision:fresh.sourceRevision,sha256:fresh.sha256,statToken:fresh.statToken})+'\n');}
      catch{child.stdin!.write(JSON.stringify({type:'source-recheck-result',requestId:requests,ok:false})+'\n');}
    }else if(frame.event==='complete'){if(result)throw Error('duplicate_result');result=frame;child.stdin!.end();}else throw Error('protocol_frame');
  }
  const status=await processResult;clearTimeout(timer);
  if(status!==0||!result?.verified||result.bytes!==S.bytes||result.sha256!==S.sha256)throw Error('unverified_result');
  console.log(JSON.stringify(result));
}catch{child?.stdin?.end();child?.kill();console.log(JSON.stringify({verified:false,dispatched,outcome:dispatched?'uncertain_reconcile_private_ledger_do_not_retry_blindly':'not_started',detailsWithheld:true,sourceWrites:0,databaseWrites:0,pointerWrites:0}));process.exitCode=1;}
