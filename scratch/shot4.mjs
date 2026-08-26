import { chromium } from "playwright";
const base = "http://127.0.0.1:3000";
const out = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(base + "/login", { waitUntil: "networkidle", timeout: 45000 });
await page.fill("#email", "admin@content-forge.com");
await page.fill("#password", "admin123");
await Promise.all([
  page.waitForURL((u) => !u.toString().includes("/login"), { timeout: 30000 }).catch(() => {}),
  page.click('button:has-text("Sign In")'),
]);
await page.goto(base + "/tutorial-studio", { waitUntil: "networkidle", timeout: 45000 });
await page.waitForTimeout(1500);
const before = await page.getAttribute("[data-theme]", "data-theme");
await page.getByRole("button", { name: "Toggle light/dark mode" }).click().catch((e) => console.log("toggle err", e.message));
await page.waitForTimeout(800);
const after = await page.getAttribute("[data-theme]", "data-theme");
await page.screenshot({ path: out + "/light-toggle.png" });
console.log(JSON.stringify({ before, after }));
await browser.close();
