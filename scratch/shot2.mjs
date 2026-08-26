import { chromium } from "playwright";

const base = "http://127.0.0.1:3000";
const out = process.argv[2];
const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message.slice(0, 160)));

await page.goto(base + "/login", { waitUntil: "networkidle", timeout: 45000 });
await page.fill("#email", "admin@content-forge.com");
await page.fill("#password", "admin123");
await Promise.all([
  page.waitForURL((u) => !u.toString().includes("/login"), { timeout: 30000 }).catch(() => {}),
  page.click('button:has-text("Sign In")'),
]);
await page.waitForTimeout(1500);

await page.goto(base + "/tutorial-studio", { waitUntil: "networkidle", timeout: 45000 });
await page.waitForTimeout(1500);
// Click the DASHBOARD tab (a <button> in the tab bar). Match by exact text node.
const dashTab = page.getByRole("button", { name: "Dashboard", exact: true });
const cnt = await dashTab.count();
await dashTab.first().click({ timeout: 8000 }).catch((e) => errors.push("TABCLICK: " + e.message.slice(0, 80)));
errors.push(`__dashTabCount=${cnt}`);
// wait for the metrics fetch to resolve
await page.waitForTimeout(5000);
const bodyText = await page.evaluate(() => document.body.innerText);
const hasPanel = /Step Durations|bottleneck|Scripting time by weekday|Production timeline/i.test(bodyText);
await page.screenshot({ path: out + "/04-dashboard-metrics.png", fullPage: true });

console.log(JSON.stringify({ hasPanel, errors: errors.slice(0, 10) }, null, 2));
await browser.close();
