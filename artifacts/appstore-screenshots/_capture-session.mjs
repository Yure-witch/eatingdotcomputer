// Same captures as _capture.mjs, but WITHOUT taking a password.
//
// Opens a real browser window at the login page and waits for you to sign in
// yourself; the session is kept in a persistent profile dir, so subsequent runs
// skip straight to capturing. Nothing types your credentials but you.
//
//   node artifacts/appstore-screenshots/_capture-session.mjs
//
// The profile lives outside the repo and is gitignored by virtue of that.
import puppeteer from 'puppeteer';
import { homedir } from 'os';
import { join } from 'path';

const BASE = process.env.CAPTURE_BASE || 'http://localhost:5175';
const OUT = 'artifacts/appstore-screenshots';
const PROFILE = process.env.CAPTURE_PROFILE || join(homedir(), '.eatingdotcomputer-capture-profile');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
	headless: false,              // you need to see it to sign in
	userDataDir: PROFILE,         // persists the session between runs
	defaultViewport: null,
	args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars']
});
const page = (await browser.pages())[0] ?? (await browser.newPage());
// iPhone 6.9" logical size × dpr 3 → 1290 × 2796 device pixels
await page.setViewport({ width: 430, height: 932, deviceScaleFactor: 3, isMobile: true, hasTouch: true });

// Render like the NATIVE app, not a desktop browser: the shell adds
// body.native-app (which pads the header by the notch inset) and the device
// reserves a home-indicator strip at the bottom that a browser has none of —
// without these the nav and compose bar sit flush against the edge. Also hides
// the dev build stamp and the PWA install banner, neither of which belong in an
// App Store listing for a native app.
await page.evaluateOnNewDocument(() => {
	const apply = () => {
		document.body?.classList.add('native-app');
		const st = document.createElement('style');
		st.textContent = `
			.build-info, .install-banner { display: none !important; }
			body.native-app { --native-top-inset: 62px; }
			/* The nav sizes itself as 56px + the safe-area inset, which a browser
			   reports as 0 — so the height has to grow with the padding or the
			   labels just sit flush on the screen edge. */
			.bottom-nav { height: calc(56px + 34px) !important; padding-bottom: 34px !important; }
			/* margin, not padding — padding inflates the compose box's own border
			   and leaves dead space inside it. The strip below is the home
			   indicator area, which should show the page background. */
			.input-area, .compose-wrap { margin-bottom: 34px !important; }
		`;
		document.head?.appendChild(st);
	};
	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
	else apply();
});

await page.goto(`${BASE}/app`, { waitUntil: 'networkidle2' }).catch(() => {});
if (page.url().includes('/login')) {
	console.log('\n  → Sign in in the browser window that just opened.');
	console.log('    Waiting for you to land in the app (5 min timeout)…\n');
	const deadline = Date.now() + 5 * 60 * 1000;
	while (Date.now() < deadline && page.url().includes('/login')) await sleep(1000);
	if (page.url().includes('/login')) { console.error('timed out waiting for sign-in'); await browser.close(); process.exit(1); }
}
console.log('signed in →', page.url());
await sleep(1500);

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

await page.goto(`${BASE}/app/chat/channel/class`, { waitUntil: 'networkidle2' }).catch(() => {});
await sleep(4500);
// The picker is an overlay that mounts lazily — click, then WAIT for it and say
// so if it never appears. Previously this clicked blind and silently produced a
// second plain chat screenshot.
await sleep(2000); // the emoji dataset is large — let the page settle before clicking
await page.click('.btn-fmt-expr').catch((e) => console.log('  picker click fail', e.message));
const pickerUp = await page
	.waitForSelector('.expr-panel, .picker-popover, .compose-picker-pop', { visible: true, timeout: 25000 })
	.then(() => true)
	.catch(() => false);
await sleep(2500);
await page.screenshot({ path: `${OUT}/real-06-picker.png` });
console.log('  shot real-06-picker.png', pickerUp ? '(picker open)' : '⚠️  PICKER DID NOT OPEN');

await shot('/app/chat/gemma', 'real-07-gemma.png', 4500);

await browser.close();
console.log('done');
