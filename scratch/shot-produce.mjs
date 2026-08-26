import { chromium } from "playwright";
const base = "http://212.132.103.168";
const CHANNEL = "99827b48-2ec1-4fe7-9b37-3d9c142a872b";
const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto(base + "/login", { waitUntil: "networkidle", timeout: 45000 });
await page.fill("#email", "admin@content-forge.com");
await page.fill("#password", "admin123");
await Promise.all([
  page.waitForURL((u) => !u.toString().includes("/login"), { timeout: 30000 }).catch(() => {}),
  page.click('button:has-text("Sign In")'),
]);
await page.waitForTimeout(1500);
const res = await page.request.post(base + "/api/production/jobs", {
  data: {
    title: "How to reset a router in 3 minutes",
    mode: "THREE_MIN",
    steps_input: "Find the reset button on the back\nHold it for 10 seconds\nWait for the router to reboot\nReconnect your devices",
    custom_prompt: "Write a clear, friendly ~3-minute spoken software-tutorial narration based on the steps. Plain spoken words only.",
    script_provider: "deepseek",
    script_model: "deepseek-v4-flash",
    tts_provider: "fish_audio",
    tts_voice: "default",
    channel_id: CHANNEL,
    source_mode: "FROM_SCRATCH",
    language: "en",
  },
});
console.log("POST /api/production/jobs =>", res.status(), (await res.text()).slice(0, 200));
await browser.close();
