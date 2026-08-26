import { chromium } from "playwright";
const base = "http://212.132.103.168";
const out = process.argv[2] || "scratch";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 980 } });
const page = await ctx.newPage();
const errs = [];
const badResponses = [];
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 160)); });
page.on("response", (r) => { if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url().replace(base, "")}`); });

async function go(path, label) {
  const before = errs.length, badBefore = badResponses.length;
  try {
    await page.goto(base + path, { waitUntil: "networkidle", timeout: 45000 });
  } catch (e) {
    return { label, path, ok: false, note: "nav timeout/err: " + String(e).slice(0, 80) };
  }
  await page.waitForTimeout(900);
  const url = page.url();
  const title = await page.title().catch(() => "");
  const bodyText = (await page.locator("body").innerText().catch(() => "")).slice(0, 0);
  const newErrs = errs.slice(before);
  const newBad = badResponses.slice(badBefore);
  await page.screenshot({ path: `${out}/smoke-${label}.png` }).catch(() => {});
  return { label, path, landedOn: url.replace(base, ""), title, consoleErrors: newErrs.slice(0, 4), http4xx5xx: newBad.slice(0, 6) };
}

// Login
await page.goto(base + "/login", { waitUntil: "networkidle", timeout: 45000 });
await page.fill("#email", "omar@tutorialstudio.app");
await page.fill("#password", "Omar-Ts26-9f4K");
await Promise.all([
  page.waitForURL((u) => !u.toString().includes("/login"), { timeout: 20000 }).catch(() => {}),
  page.click('button:has-text("Sign In")'),
]);
await page.waitForTimeout(1500);
const loggedIn = !page.url().includes("/login");

const results = [];
for (const [p, l] of [
  ["/", "home"],
  ["/tutorial-studio", "tutorial-studio"],
  ["/channels", "channels"],
  ["/thumbnails", "thumbnails"],
  ["/keywords", "keywords"],
  ["/system-health", "system-health"],
  ["/settings", "settings"],
  ["/team", "accounts"],
]) {
  results.push(await go(p, l));
}

console.log(JSON.stringify({ loggedIn, results }, null, 2));
await browser.close();
