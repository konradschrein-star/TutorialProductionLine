import { chromium } from "playwright";
const base = "http://212.132.103.168";
const out = process.argv[2];
const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 120)); });
await page.goto(base + "/login", { waitUntil: "networkidle", timeout: 45000 });
await page.fill("#email", "admin@content-forge.com");
await page.fill("#password", "admin123");
await Promise.all([
  page.waitForURL((u) => !u.toString().includes("/login"), { timeout: 30000 }).catch(() => {}),
  page.click('button:has-text("Sign In")'),
]);
await page.waitForTimeout(2000);
const afterLogin = page.url();
await page.goto(base + "/tutorial-studio", { waitUntil: "networkidle", timeout: 45000 });
await page.waitForTimeout(2000);
const bodyText = (await page.evaluate(() => document.body.innerText)).slice(0, 200);
await page.screenshot({ path: out + "/vps-live.png" });
console.log(JSON.stringify({ afterLogin, rendersStudio: /Tutorial Studio|CREATE|LOCALIZE/i.test(bodyText), errors: errors.slice(0, 5) }));
await browser.close();
