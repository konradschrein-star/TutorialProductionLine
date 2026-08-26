import { chromium } from "playwright";
const base = "http://127.0.0.1:3000";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
let enqueueResp = null;
page.on("response", async (r) => {
  if (r.url().includes("/tutorial-translate/enqueue")) {
    enqueueResp = { status: r.status(), body: await r.text().catch(() => "") };
  }
});
await page.goto(base + "/login", { waitUntil: "networkidle", timeout: 45000 });
await page.fill("#email", "admin@content-forge.com");
await page.fill("#password", "admin123");
await Promise.all([
  page.waitForURL((u) => !u.toString().includes("/login"), { timeout: 30000 }).catch(() => {}),
  page.click('button:has-text("Sign In")'),
]);
await page.goto(base + "/tutorial-studio", { waitUntil: "networkidle", timeout: 45000 });
await page.waitForTimeout(1200);
await page.getByRole("button", { name: "Localize", exact: true }).first().click().catch(() => {});
await page.waitForTimeout(2500);
await page.getByRole("button", { name: /Translate all/ }).first().click().catch((e) => console.log("click err", e.message));
await page.waitForTimeout(3000);
console.log(JSON.stringify({ enqueueResp }));
await browser.close();
