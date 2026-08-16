// Headless capture of the REAL app, logged in as the App Store review account.
// Run from the repo root with the dev server up on :5175.
import puppeteer from 'puppeteer';

// Creds are passed in — never hard-code the review password in the repo.
//   node artifacts/appstore-screenshots/_capture.mjs <username> <password>
const BASE = process.env.CAPTURE_BASE || 'http://localhost:5175';
const [USER, PASS] = process.argv.slice(2);
if (!USER || !PASS) { console.error('usage: node _capture.mjs <username> <password>  (the App Store review account)'); process.exit(1); }
const OUT = 'artifacts/appstore-screenshots';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
	headless: 'shell',
	args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars']
});
const page = await browser.newPage();
// iPhone 6.9" logical size × dpr 3 → 1290 × 2796 device pixels
await page.setViewport({ width: 430, height: 932, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
page.on('console', (m) => { if (m.type() === 'error') console.log('  [page-err]', m.text().slice(0, 120)); });

console.log('login…');
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
await page.type('input[name="email"]', USER);
await page.type('input[name="password"]', PASS);
await Promise.all([
	page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
	page.keyboard.press('Enter')
]);
await sleep(1500);
console.log('after login url:', page.url());

async function shot(path, file, waitMs = 3000) {
	await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2' }).catch(() => {});
	await sleep(waitMs);
	await page.screenshot({ path: `${OUT}/${file}` });
	console.log('  shot', file, '→', page.url());
}

await shot('/app', 'real-01-home.png', 3500);
await shot('/app/chat/channel/class', 'real-02-chat.png', 6000);
await shot('/app/goals', 'real-03-todos.png', 3500);
await shot('/app/orbit', 'real-04-orbit.png', 5000);
await shot('/app/weeks', 'real-05-weeks.png', 3500);

// Expression picker (emoji + GIF) — open it from the channel compose.
await page.goto(`${BASE}/app/chat/channel/class`, { waitUntil: 'networkidle2' }).catch(() => {});
await sleep(4500);
await page.click('.btn-fmt-expr').catch((e) => console.log('  picker click fail', e.message));
await sleep(3000);
await page.screenshot({ path: `${OUT}/real-06-picker.png` });
console.log('  shot real-06-picker.png');

// Gemma digest with the algorithmic recommendation.
await shot('/app/chat/gemma', 'real-07-gemma.png', 4500);

await browser.close();
console.log('done');
