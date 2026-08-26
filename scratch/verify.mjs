import { chromium } from "playwright";
const base = "http://212.132.103.168";
const outDir = process.argv[2] || ".";
const targets = [
  "/settings",
  "/system-health",
  "/team",
  "/channels",
  "/channels/create",
  "/thumbnails",
  "/tutorial-studio",
];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(base + "/login", { waitUntil: "networkidle", timeout: 45000 });
await page.fill("#email", "admin@content-forge.com");
await page.fill("#password", "admin123");
await Promise.all([
  page.waitForURL((u) => !u.toString().includes("/login"), { timeout: 30000 }).catch(() => {}),
  page.click('button:has-text("Sign In")'),
]);
await page.waitForTimeout(1500);
const results = [];
for (const p of targets) {
  const perr = [];
  const h = (m) => { if (m.type() === "error") perr.push(m.text().slice(0, 140)); };
  page.on("console", h);
  let status = 0;
  try {
    const resp = await page.goto(base + p, { waitUntil: "networkidle", timeout: 45000 });
    status = resp ? resp.status() : 0;
  } catch (e) { perr.push("NAV:" + String(e.message).slice(0, 80)); }
  await page.waitForTimeout(1200);
  const body = (await page.evaluate(() => document.body.innerText)).slice(0, 6000);
  const cf = /Content Forge|Pulse Console/i.test(body);
  await page.screenshot({ path: `${outDir}/v-${p.replace(/\//g, "_")}.png` });
  page.off("console", h);
  results.push({ p, status, contentForge: cf, errors: perr.slice(0, 4) });
}
// Localize tab
try {
  await page.goto(base + "/tutorial-studio", { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Localize", exact: true }).click().catch(() => {});
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${outDir}/v-localize.png` });
} catch {}
console.log(JSON.stringify(results, null, 2));
await browser.close();
