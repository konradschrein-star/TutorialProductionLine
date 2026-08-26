import { chromium } from "playwright";
const base = "http://212.132.103.168";
const out = process.argv[2] || ".";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 980 } });
const page = await ctx.newPage();
const errs = [];
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 120)); });
await page.goto(base + "/login", { waitUntil: "networkidle", timeout: 45000 });
await page.fill("#email", "omar@tutorialstudio.app");
await page.fill("#password", "Omar-Ts26-9f4K");
await Promise.all([
  page.waitForURL((u) => !u.toString().includes("/login"), { timeout: 20000 }).catch(() => {}),
  page.click('button:has-text("Sign In")'),
]);
await page.waitForTimeout(1200);

// System Health
await page.goto(base + "/system-health", { waitUntil: "networkidle", timeout: 45000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/v2-system-health.png` });

// Thumbnails → Personas tab
await page.goto(base + "/thumbnails", { waitUntil: "networkidle", timeout: 45000 });
await page.waitForTimeout(1000);
await page.getByText("PERSONAS", { exact: false }).first().click().catch(() => {});
await page.waitForTimeout(1000);
await page.screenshot({ path: `${out}/v2-personas.png` });

console.log(JSON.stringify({ loggedIn: !page.url().includes("/login"), errors: errs.slice(0, 6) }));
await browser.close();
