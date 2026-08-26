import { chromium } from "playwright";
const base = "http://212.132.103.168";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 980 } });
const page = await ctx.newPage();
await page.goto(base + "/login", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.fill("#email", "omar@tutorialstudio.app");
await page.fill("#password", "Omar-Ts26-9f4K");
await Promise.all([
  page.waitForURL((u) => !u.toString().includes("/login"), { timeout: 20000 }).catch(() => {}),
  page.click('button:has-text("Sign In")'),
]);
await page.waitForTimeout(1500);

// Home with lenient wait
await page.goto(base + "/", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(2500);
const homeUrl = page.url().replace(base, "");
const homeH = (await page.locator("h1, h2").allInnerTexts().catch(() => [])).slice(0, 5);
await page.screenshot({ path: "scratch/check-home.png" });

// Keywords lenient
const resp = await page.goto(base + "/keywords", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => null);
await page.waitForTimeout(1500);
const kwStatus = resp ? resp.status() : "no-resp";
const kwText = (await page.locator("body").innerText().catch(() => "")).slice(0, 300).replace(/\s+/g, " ");
await page.screenshot({ path: "scratch/check-keywords.png" });

// What does the sidebar link for keywords point to?
await page.goto(base + "/tutorial-studio", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(1500);
const navLinks = await page.locator("nav a, aside a").evaluateAll((els) =>
  els.map((e) => ({ text: e.textContent.trim().slice(0, 24), href: e.getAttribute("href") })).filter((x) => x.text)
).catch(() => []);

console.log(JSON.stringify({ homeUrl, homeH, kwStatus, kwText, navLinks }, null, 2));
await browser.close();
