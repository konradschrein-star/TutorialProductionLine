import { chromium } from "playwright";
const base = "http://212.132.103.168";
const creds = [
  ["omar@tutorialstudio.app", "Omar-Ts26-9f4K"],
  ["va1@tutorialstudio.app", "Va1-Ts26-7m2Q"],
];
const browser = await chromium.launch();
for (const [email, pw] of creds) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(base + "/login", { waitUntil: "networkidle", timeout: 45000 });
  await page.fill("#email", email);
  await page.fill("#password", pw);
  await Promise.all([
    page.waitForURL((u) => !u.toString().includes("/login"), { timeout: 20000 }).catch(() => {}),
    page.click('button:has-text("Sign In")'),
  ]);
  await page.waitForTimeout(1200);
  console.log(email, "->", page.url().includes("/login") ? "FAILED (still on login)" : "OK (" + page.url() + ")");
  await ctx.close();
}
await browser.close();
