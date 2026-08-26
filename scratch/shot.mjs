import { chromium } from 'playwright';

const base = 'http://127.0.0.1:3000';
const out = process.argv[2];
const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message.slice(0, 200)));

await page.goto(base + '/login', { waitUntil: 'networkidle', timeout: 45000 });
await page.screenshot({ path: out + '/01-login.png' });
await page.fill('#email', 'admin@content-forge.com');
await page.fill('#password', 'admin123');
await Promise.all([
  page.waitForURL(u => !u.toString().includes('/login'), { timeout: 30000 }).catch(() => {}),
  page.click('button:has-text("Sign In")'),
]);
await page.waitForTimeout(2500);
const afterLogin = page.url();

await page.goto(base + '/tutorial-studio', { waitUntil: 'networkidle', timeout: 45000 });
await page.waitForTimeout(2000);
await page.screenshot({ path: out + '/02-tutorial-studio.png', fullPage: false });
const studioText = (await page.evaluate(() => document.body.innerText)).slice(0, 400);

await page.goto(base + '/dashboard', { waitUntil: 'networkidle', timeout: 45000 });
await page.waitForTimeout(2000);
await page.screenshot({ path: out + '/03-dashboard.png', fullPage: false });

console.log(JSON.stringify({ afterLogin, studioText, errors: errors.slice(0, 12) }, null, 2));
await browser.close();
