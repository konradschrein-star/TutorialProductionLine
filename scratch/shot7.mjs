import { chromium } from "playwright";
const base = "http://127.0.0.1:3000";
const out = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 760 } });
await page.goto(base + "/login", { waitUntil: "networkidle", timeout: 45000 });
await page.fill("#email", "admin@content-forge.com");
await page.fill("#password", "admin123");
await Promise.all([
  page.waitForURL((u) => !u.toString().includes("/login"), { timeout: 30000 }).catch(() => {}),
  page.click('button:has-text("Sign In")'),
]);
await page.goto(base + "/tutorial-studio", { waitUntil: "networkidle", timeout: 45000 });
await page.waitForTimeout(1200);
await page.getByRole("button", { name: "Dashboard", exact: true }).first().click().catch(() => {});
await page.waitForTimeout(4000);
const rhythm = page.getByText("Daily production rhythm", { exact: false }).first();
await rhythm.scrollIntoViewIfNeeded().catch(() => {});
await page.waitForTimeout(600);
await page.screenshot({ path: out + "/rhythm.png" });
console.log("done");
await browser.close();
