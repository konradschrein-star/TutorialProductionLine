import { chromium } from "playwright";
const base = "http://212.132.103.168";
const out = process.argv[2] || ".";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 980 } });
const p = await ctx.newPage();
const bad = [];
p.on("response", (r) => { if (r.status() >= 400 && r.url().includes("/kw")) bad.push(r.status()+" "+r.url().slice(0,90)); });
// 1) standalone KT board
await p.goto(base + "/kw/v5", { waitUntil: "networkidle", timeout: 45000 }).catch(()=>{});
await p.waitForTimeout(2500);
await p.screenshot({ path: `${out}/kt-v5.png` });
const bodyLen = (await p.evaluate(()=>document.body.innerText)).length;
// 2) hub Keywords tab (embed)
await p.goto(base + "/login", { waitUntil: "networkidle" });
await p.fill("#email","omar@tutorialstudio.app"); await p.fill("#password","Omar-Ts26-9f4K");
await Promise.all([p.waitForURL(u=>!u.toString().includes("/login"),{timeout:20000}).catch(()=>{}), p.click('button:has-text("Sign In")')]);
await p.waitForTimeout(1000);
await p.goto(base + "/tutorial-studio", { waitUntil: "networkidle" });
await p.getByText("KEYWORDS",{exact:false}).first().click().catch(()=>{});
await p.waitForTimeout(3000);
await p.screenshot({ path: `${out}/kt-embed.png` });
console.log(JSON.stringify({ v5BodyLen: bodyLen, kwErrors: bad.slice(0,6) }));
await b.close();
