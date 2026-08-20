// Autonomous Gemini video review via Playwright + saved cookies, with
// fallback to user-assisted sign-in (browser is shown, polls for auth).
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const VIDEO = process.argv[2];
if (!VIDEO || !fs.existsSync(VIDEO)) {
  console.error("Usage: node gemini-playwright-review.mjs <abs-video-path>");
  process.exit(2);
}

const COOKIE_FILE =
  "C:/Users/konra/OneDrive/Projekte/20260330 Content Forge/.claude/gemini-cookies.json";
const REVIEWS_DIR = "C:/Users/konra/.gemini-review/reviews";
fs.mkdirSync(REVIEWS_DIR, { recursive: true });

const SIGN_IN_WAIT_MIN = 5;

const PROMPT = `You are watching a video meant for YouTube. Watch it END-TO-END. You have access to the full MP4 — do not just analyze the first few seconds or thumbnails, watch the whole thing.

Rate brutally honestly: would a real human, who landed here by accident, watch this from start to finish without bouncing? Score 0.0-10.0, one decimal place.

Check specifically:
- Hook (0-5s): Does it grab attention or feel generic?
- Pacing: Any slow, repetitive, or filler sections? Where exactly?
- Audio: Robotic? Monotone? Mispronounced? Mis-paced? AI-narration tells?
- Visual mix - MOST IMPORTANT: Are there REAL product videos (actual footage of the product in use), or is it mostly motion graphics / AI-generated B-roll / stock animations? Real product videos must DOMINATE; motion graphics should be the lesser part. Call out the approximate ratio. If a product is being compared/reviewed and you don't see real videos of it, that's a serious problem.
- Engagement: Would you keep watching after 30 seconds?
- Polish: Dead air, jarring cuts, mismatched transitions, glitches?

Respond as JSON ONLY (no markdown, no preamble):

{
  "score": <float>,
  "verdict": "<one sentence>",
  "reasoning": "<2-4 sentences>",
  "footage_balance": {
    "real_product_video_pct": <int 0-100>,
    "motion_graphics_pct": <int 0-100>,
    "comment": "<what's missing or wrong>"
  },
  "biggest_problem": "<single thing dragging the score down most, with timestamp if possible>",
  "improvements": ["<concrete fix 1>", "<concrete fix 2>", "<concrete fix 3>"]
}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function isSignedIn(page) {
  try {
    const state = await page.evaluate(() => {
      const signInBtns = [...document.querySelectorAll("a, button")]
        .filter((el) => el.offsetParent)
        .filter((el) =>
          /sign in|sign-in/i.test(
            (el.textContent || el.getAttribute("aria-label") || "").trim(),
          ),
        );
      const promptBox = document.querySelector(
        'rich-textarea, div[contenteditable="true"][role="textbox"]',
      );
      return {
        hasSignInBtn: signInBtns.length > 0,
        hasPromptBox: !!promptBox,
        url: location.href,
      };
    });
    return !state.hasSignInBtn && state.hasPromptBox;
  } catch {
    return false;
  }
}

async function findFileInput(page) {
  return page.evaluateHandle(() => {
    const find = (root) => {
      const direct = root.querySelector
        ? root.querySelector('input[type="file"]')
        : null;
      if (direct) return direct;
      if (!root.querySelectorAll) return null;
      for (const el of root.querySelectorAll("*")) {
        if (el.shadowRoot) {
          const r = find(el.shadowRoot);
          if (r) return r;
        }
      }
      return null;
    };
    return find(document);
  });
}

async function main() {
  const rawCookies = JSON.parse(fs.readFileSync(COOKIE_FILE, "utf8"));
  const cookies = rawCookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path || "/",
    expires: c.expirationDate ? Math.floor(c.expirationDate) : -1,
    httpOnly: !!c.httpOnly,
    secure: !!c.secure,
    sameSite:
      c.sameSite === "no_restriction"
        ? "None"
        : c.sameSite === "lax"
          ? "Lax"
          : c.sameSite === "strict"
            ? "Strict"
            : "Lax",
  }));

  console.error("[gemini-pw] launching browser (visible)...");
  const browser = await chromium.launch({ headless: false, slowMo: 30 });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  });
  await context.addCookies(cookies);

  const page = await context.newPage();
  await page.goto("https://gemini.google.com/app", {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });
  await sleep(3000);

  let signedIn = await isSignedIn(page);
  if (!signedIn) {
    console.error(
      `[gemini-pw] NOT SIGNED IN. Sign into Google in the Playwright Chrome window (up to ${SIGN_IN_WAIT_MIN} min)...`,
    );
    const deadline = Date.now() + SIGN_IN_WAIT_MIN * 60_000;
    while (Date.now() < deadline) {
      await sleep(5000);
      signedIn = await isSignedIn(page);
      if (signedIn) break;
      const remaining = Math.round((deadline - Date.now()) / 1000);
      console.error(`[gemini-pw] waiting for sign-in (${remaining}s left)`);
    }
  }
  if (!signedIn) {
    console.error("[gemini-pw] TIMED OUT waiting for sign-in");
    await browser.close();
    process.exit(3);
  }
  console.error("[gemini-pw] signed in — refreshing cookies");
  try {
    const fresh = await context.cookies("https://gemini.google.com");
    fs.writeFileSync(
      COOKIE_FILE,
      JSON.stringify(
        fresh.map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path,
          expirationDate: c.expires > 0 ? c.expires : undefined,
          httpOnly: c.httpOnly,
          secure: c.secure,
          sameSite: c.sameSite?.toLowerCase() || "lax",
        })),
        null,
        2,
      ),
      "utf8",
    );
  } catch (e) {
    console.error("[gemini-pw] cookie refresh failed (non-fatal):", e.message);
  }

  let inputHandle = await findFileInput(page);
  let asEl = inputHandle.asElement();
  if (!asEl) {
    console.error("[gemini-pw] no file input yet — clicking Upload & tools");
    const up = await page.$('button[aria-label*="Upload" i]');
    if (up) await up.click();
    await sleep(1500);
    inputHandle = await findFileInput(page);
    asEl = inputHandle.asElement();
  }
  if (!asEl) {
    console.error("[gemini-pw] couldn't find file input");
    await browser.close();
    process.exit(4);
  }

  console.error("[gemini-pw] uploading video...");
  await asEl.setInputFiles(VIDEO);

  const filename = path.basename(VIDEO);
  console.error("[gemini-pw] waiting for processing...");
  for (let i = 0; i < 90; i++) {
    await sleep(2000);
    const html = await page.content();
    const processing = /processing|uploading|analyzing|preparing/i.test(html);
    const hasFile = html.includes(filename);
    if (hasFile && !processing && i > 4) {
      console.error(`[gemini-pw] processing complete after ~${2 * i}s`);
      break;
    }
  }
  await sleep(4000);

  console.error("[gemini-pw] sending prompt...");
  const editor = await page.$(
    'rich-textarea div[contenteditable="true"], div[contenteditable="true"][role="textbox"]',
  );
  if (!editor) {
    console.error("[gemini-pw] no prompt editor found");
    await browser.close();
    process.exit(5);
  }
  await editor.click();
  await page.keyboard.insertText(PROMPT);
  await sleep(800);
  await page.keyboard.press("Enter");

  console.error("[gemini-pw] waiting for response...");
  for (let i = 0; i < 120; i++) {
    await sleep(3000);
    const stopBtn = await page.$('button[aria-label*="Stop" i]');
    if (!stopBtn && i > 3) {
      console.error(`[gemini-pw] response complete after ~${3 * i}s`);
      break;
    }
  }
  await sleep(3000);

  const respText = await page.evaluate(() => {
    const nodes = [
      ...document.querySelectorAll(
        "message-content, .model-response-text, .response-content-text, model-response",
      ),
    ];
    return nodes.length ? nodes[nodes.length - 1].innerText : "";
  });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = path.basename(VIDEO, path.extname(VIDEO));
  const outPath = `${REVIEWS_DIR}/${base}-${stamp}.txt`;
  fs.writeFileSync(outPath, respText, "utf8");
  console.error(`[gemini-pw] raw response saved to ${outPath}`);
  console.log(respText);

  await browser.close();
}

main().catch((e) => {
  console.error("[gemini-pw] FATAL:", e);
  process.exit(99);
});
