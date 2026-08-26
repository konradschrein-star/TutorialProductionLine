import { chromium } from "playwright";
const base = "http://127.0.0.1:3000";
const out = process.argv[2];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();

await page.goto(base + "/login", { waitUntil: "networkidle", timeout: 45000 });
await page.fill("#email", "admin@content-forge.com");
await page.fill("#password", "admin123");
await Promise.all([
  page.waitForURL((u) => !u.toString().includes("/login"), { timeout: 30000 }).catch(() => {}),
  page.click('button:has-text("Sign In")'),
]);
await page.waitForTimeout(1200);
// force light mode
await ctx.addCookies([{ name: "hub_ui_mode", value: "light", url: base }]);

await page.goto(base + "/tutorial-studio", { waitUntil: "networkidle", timeout: 45000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: out + "/light-01-create.png" });
await page.getByRole("button", { name: "Dashboard", exact: true }).first().click().catch(() => {});
await page.waitForTimeout(4500);
await page.screenshot({ path: out + "/light-02-dashboard.png", fullPage: true });
console.log("done");
await browser.close();
