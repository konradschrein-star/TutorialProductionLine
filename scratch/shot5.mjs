import { chromium } from "playwright";
const base = "http://127.0.0.1:3000";
const out = process.argv[2];
const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 140)); });
await page.goto(base + "/login", { waitUntil: "networkidle", timeout: 45000 });
await page.fill("#email", "admin@content-forge.com");
await page.fill("#password", "admin123");
await Promise.all([
  page.waitForURL((u) => !u.toString().includes("/login"), { timeout: 30000 }).catch(() => {}),
  page.click('button:has-text("Sign In")'),
]);
await page.goto(base + "/tutorial-studio", { waitUntil: "networkidle", timeout: 45000 });
await page.waitForTimeout(1500);
await page.getByRole("button", { name: "Localize", exact: true }).first().click().catch((e) => errors.push("TAB:" + e.message.slice(0,60)));
await page.waitForTimeout(3500);
const txt = await page.evaluate(() => document.body.innerText);
const hasPanel = /Localization|Translate all|not started/i.test(txt);
await page.screenshot({ path: out + "/localize.png" });
console.log(JSON.stringify({ hasPanel, errors: errors.slice(0, 6) }));
await browser.close();
