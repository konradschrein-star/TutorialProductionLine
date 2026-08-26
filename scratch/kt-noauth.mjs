import { chromium } from "playwright";
const base="http://212.132.103.168"; const out=process.argv[2]||".";
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:900}});
await p.goto(base+"/kw/v5",{waitUntil:"networkidle",timeout:45000}).catch(()=>{});
await p.waitForTimeout(2500);
const t=(await p.evaluate(()=>document.body.innerText));
await p.screenshot({path:`${out}/kt-noauth.png`});
console.log(JSON.stringify({ hasLogin:/Sign in with Google|production board/i.test(t), hasBoard:/open|claimed|software|Claim/i.test(t), len:t.length }));
await b.close();
