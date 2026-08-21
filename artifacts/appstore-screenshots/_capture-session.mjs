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
const OUT = process.env.CAPTURE_OUT || 'artifacts/appstore-screenshots';
const PROFILE = process.env.CAPTURE_PROFILE || join(homedir(), '.eatingdotcomputer-capture-profile');
// Device size. Default is iPhone 6.9" (430x932 @3x = 1290x2796), the only
// iPhone size App Store Connect actually requires. Override for the 6.5" slot:
//   CAPTURE_W=428 CAPTURE_H=926 CAPTURE_OUT=artifacts/appstore-screenshots/65
// which yields 1284x2778. Re-CAPTURING at the target size keeps text crisp;
// rescaling 6.9" art to 6.5" would resample every glyph and shift the aspect.
const VW = Number(process.env.CAPTURE_W || 430);
const VH = Number(process.env.CAPTURE_H || 932);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
	headless: false,              // you need to see it to sign in
	userDataDir: PROFILE,         // persists the session between runs
	defaultViewport: null,
	// The picker click can outlast puppeteer's default CDP deadline: opening it
	// mounts the full emoji dataset, and a cold run has blocked the main thread
	// long enough for Runtime.callFunctionOn to time out and lose the shot.
	protocolTimeout: 180_000,
	args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars']
});
const page = (await browser.pages())[0] ?? (await browser.newPage());
// iPhone 6.9" logical size × dpr 3 → 1290 × 2796 device pixels
await page.setViewport({ width: VW, height: VH, deviceScaleFactor: 3, isMobile: true, hasTouch: true });

// Render like the NATIVE app, not a desktop browser: the shell adds
// body.native-app (which pads the header by the notch inset) and the device
// reserves a home-indicator strip at the bottom that a browser has none of —
// without these the nav and compose bar sit flush against the edge. Also hides
// the dev build stamp and the PWA install banner, neither of which belong in an
// App Store listing for a native app.
await page.evaluateOnNewDocument(() => {
	// Listing settings, forced so a run never depends on what the capture
	// profile happens to have saved:
	//   emoji-font  'system' → Apple/iOS emoji, not Noto (the app default).
	//                 +layout.svelte reads this key on mount and toggles the
	//                 .noto-emoji class off it, so setting the key is enough.
	//   exprTab     open the picker on plain emoji rather than whatever
	//                 surface was last used.
	// The Emoji Kitchen and Telegram surfaces are NOT handled here — they come
	// off the users.hide_tg_emoji flag, already set on the review account.
	try {
		localStorage.setItem('emoji-font', 'system');
		localStorage.setItem('exprTab', 'emoji');
	} catch {}
	const apply = () => {
		document.body?.classList.add('native-app');
		const st = document.createElement('style');
		st.textContent = `
			.build-info, .install-banner { display: none !important; }
			/* The per-message hover bar (react / reply / thread / kebab) is
			   opacity:0 in the app and only appears on :hover. Puppeteer's touch
			   emulation leaves :hover stuck on rows it has "touched", so the
			   kebab's three dots printed down the right edge of every capture.
			   Not something the app does on a real phone. */
			.msg-actions-bar { display: none !important; }
			/* The sidebar sits behind the chat layer, and at this width its
			   per-conversation kebab buttons show through along the right edge
			   as a column of ⋮ glyphs. Worth a look in the app itself; in a
			   listing screenshot they are just noise. */
			.conv-kebab { display: none !important; }
			body.native-app { --native-top-inset: 62px; }
			/* The nav is a FIXED-HEIGHT pill (60px) that floats above the home
			   indicator via bottom: max(6px, env(safe-area-inset-bottom)). A
			   browser reports that inset as 0, so it only needs lifting — the
			   pill itself must NOT grow. Inflating its height (and padding) was
			   what left a slab of dead pink below the icons. */
			.bottom-nav { bottom: 34px !important; }
			/* Chat / Gemma / Tasks park the nav off-screen with
			   translateY(100% + env(safe-area-inset-bottom) + 12px). A browser
			   reports that inset as 0, so the park travels 34px SHORT of the
			   lift above and the top of the pill peeked back into frame under
			   the composer. Feed the same simulated inset into the park. */
			html.conv-covering .bottom-nav {
				transform: translateY(calc(100% + 34px + 12px)) !important;
			}
			/* margin, not padding — padding inflates the compose box's own border
			   and leaves dead space inside it. The strip below is the home
			   indicator area, which should show the page background. */
			/* NOT when a picker is open: .input-area.picker-open sets its own
			   margin-bottom to lift the bar above the picker, and an !important
			   here would override that and make the picker look like it covers
			   the compose bar. */
			/* ONLY the input-area, and only when no picker is open. Applying this
			   to .compose-wrap inflated the compose bar so the stretched send /
			   effects buttons rendered taller than the message box — an artefact
			   of the capture, not of the app. */
			.input-area:not(.picker-open) { margin-bottom: 34px !important; }
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

async function settleBoot() {
	// src/app.html paints a full-screen #boot-loader (black card, green ring)
	// until the app hands over. A slow route — Gemma pulls its digest history —
	// can still be behind it when the timer fires, and the shot is then just the
	// splash. Wait for it to actually go.
	await page
		.waitForFunction(() => {
			const el = document.getElementById('boot-loader');
			if (!el) return true;
			const cs = getComputedStyle(el);
			return cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0';
		}, { timeout: 30000 })
		.catch(() => console.log('  ⚠️  boot loader still up after 30s'));
}

async function settleFonts() {
	// document.fonts.ready resolves once every face used on the page has
	// loaded. Without it a shot can catch the fallback face mid-swap.
	await page.evaluate(() => document.fonts?.ready).catch(() => {});
	await sleep(400);
}

async function shot(path, file, waitMs = 3000) {
	await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2' }).catch(() => {});
	await settleBoot();
	await sleep(waitMs);
	await settleFonts();
	await page.screenshot({ path: `${OUT}/${file}` });
	console.log('  shot', file, '→', page.url());
}

await shot('/app', 'real-01-home.png', 3500);
await shot('/app/chat/channel/studio', 'real-02-chat.png', 6000);
await shot('/app/goals', 'real-03-todos.png', 3500);
await shot('/app/orbit', 'real-04-orbit.png', 5000);
await shot('/app/weeks', 'real-05-weeks.png', 3500);

// Opening the picker mounts the whole emoji dataset, and on a cold run that has
// blocked the main thread long enough for the CDP click to time out — which
// used to leave a SECOND plain chat shot standing in for the picker. Retry
// instead, on a fresh page each time, and say plainly if it never opened.
let pickerUp = false;
for (let attempt = 1; attempt <= 3 && !pickerUp; attempt++) {
	await page.goto(`${BASE}/app/chat/channel/studio`, { waitUntil: 'networkidle2' }).catch(() => {});
	await sleep(6000); // let the emoji dataset settle before clicking
	await page.click('.btn-fmt-expr').catch((e) => console.log(`  picker click fail (attempt ${attempt})`, e.message));
	pickerUp = await page
		.waitForSelector('.expr-panel, .picker-popover, .compose-picker-pop', { visible: true, timeout: 25000 })
		.then(() => true)
		.catch(() => false);
	if (!pickerUp) console.log(`  picker did not open on attempt ${attempt}, retrying`);
}
await sleep(2500);
await settleFonts();
await page.screenshot({ path: `${OUT}/real-06-picker.png` });
console.log('  shot real-06-picker.png', pickerUp ? '(picker open)' : '⚠️  PICKER DID NOT OPEN AFTER 3 TRIES');

await shot('/app/chat/gemma', 'real-07-gemma.png', 4500);

await browser.close();
console.log('done');
