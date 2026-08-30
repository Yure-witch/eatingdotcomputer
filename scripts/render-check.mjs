#!/usr/bin/env node
/**
 * Render check — screenshot every major route at every viewport and flag
 * layout breaks automatically.
 *
 * Born from the 2026-08-30 App Store rejection: the profile page's Message
 * button overlapped the display name, and nobody was looking at that page at
 * that width. This walks the whole app so that class of bug gets caught by a
 * command instead of a reviewer.
 *
 * Usage:
 *   node scripts/render-check.mjs                       # all routes, all viewports
 *   node scripts/render-check.mjs --routes profile,chat # substring filter
 *   node scripts/render-check.mjs --viewports mobile    # one viewport
 *   node scripts/render-check.mjs --base http://localhost:5175
 *   node scripts/render-check.mjs --open                # print report path only
 *
 * Auth: needs a throwaway account. Create one with
 *   node scripts/create-reviewer.js rendercheck <password>
 * then pass RENDER_USER / RENDER_PASS (defaults below). Delete it when done —
 * never point this at the Apple demo account.
 *
 * Output: artifacts/render-check/<viewport>/<route>.png + report.md/report.json
 */
import puppeteer from 'puppeteer';
import { createClient } from '@libsql/client';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'artifacts', 'render-check');

const arg = (name, fallback) => {
	const i = process.argv.indexOf(`--${name}`);
	return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
		? process.argv[i + 1]
		: fallback;
};
const BASE = arg('base', process.env.RENDER_BASE || 'http://localhost:5175');
const USER = process.env.RENDER_USER || 'rendercheck';
const PASS = process.env.RENDER_PASS || 'RenderCheck2026!';
const ROUTE_FILTER = arg('routes', '').split(',').filter(Boolean);
const VIEWPORT_FILTER = arg('viewports', '').split(',').filter(Boolean);

/* Viewports chosen for where things actually break: 320 is the narrowest
   phone still in the wild and the width most likely to overlap; 390 is a
   current iPhone; 768 is the iPad Apple reviews on (and the mobile/desktop
   CSS boundary, where layouts flip); 1440 is the design target. */
const VIEWPORTS = [
	{ name: 'mobile-small', width: 320, height: 568, mobile: true },
	{ name: 'mobile', width: 390, height: 844, mobile: true },
	{ name: 'tablet', width: 768, height: 1024, mobile: true },
	/* The exact device every App Store review has run on: iPad Air 11-inch,
	   820x1180pt. BOTH orientations — a reviewer rotates, and the Guideline 4
	   "not optimized for all screen sizes" rejection came from this hardware.
	   768 does not stand in for it: the app's breakpoints flip either side. */
	{ name: 'ipad-portrait', width: 820, height: 1180, mobile: true },
	{ name: 'ipad-landscape', width: 1180, height: 820, mobile: true },
	{ name: 'desktop', width: 1440, height: 900, mobile: false }
];

/* Dynamic segments get filled from the DB at startup (see resolveIds).
   `auth: false` routes are checked signed-out. Dev-only probe routes
   (/canvasprobe, /emoteprobe, /renderprobe, /dev-*) are deliberately absent —
   they aren't shipped surfaces. */
const ROUTES = [
	{ path: '/', name: 'landing', auth: false },
	{ path: '/login', name: 'login', auth: false },
	{ path: '/signup', name: 'signup', auth: false },
	{ path: '/terms', name: 'terms', auth: false },
	{ path: '/privacy', name: 'privacy', auth: false },
	{ path: '/offline', name: 'offline', auth: false },
	{ path: '/app', name: 'home' },
	{ path: '/app/orbit', name: 'orbit' },
	{ path: '/app/weeks', name: 'weeks' },
	/* /app/assignments and /app/files are gone — both 308 to /app/orbit since
	   Roadmap+Files merged. Kept out of the table rather than rendering Orbit
	   three times under three names. */
	{ path: '/app/goals', name: 'goals' },
	{ path: '/app/inspiration', name: 'inspiration' },
	// Opens the first channel on a wide viewport; that's the screen, not a fault.
	{ path: '/app/chat', name: 'chat-index', redirectOk: true },
	{ path: '/app/chat/channel/:channel', name: 'chat-channel' },
	{ path: '/app/chat/dm/:dm', name: 'chat-dm' },
	{ path: '/app/chat/gemma', name: 'chat-gemma' },
	{ path: '/app/profile/:other', name: 'profile-other' },   // the rejected page
	{ path: '/app/profile/:self', name: 'profile-self' },
	{ path: '/app/profile/edit', name: 'profile-edit' },
	{ path: '/app/theme', name: 'theme' },
	{ path: '/app/lab', name: 'lab' },
	{ path: '/app/lab/gif', name: 'lab-gif' },
	{ path: '/app/lab/text-gifs', name: 'lab-text-gifs' },
	{ path: '/app/lab/websites', name: 'lab-websites' },
	{ path: '/app/lab/marquee', name: 'lab-marquee' },
	/* Instructor-only: a student session is bounced to /app, so this renders the
	   dashboard unless RENDER_USER is an instructor. Run with an instructor
	   account to actually cover it. */
	{ path: '/app/manage', name: 'manage', instructorOnly: true },
	{ path: '/app/ai', name: 'ai' }
];

/** Look up the ids the dynamic routes need, so this works on any dataset. */
async function resolveIds() {
	const db = createClient({
		url: process.env.TURSO_DATABASE_URL,
		authToken: process.env.TURSO_AUTH_TOKEN
	});
	const me = await db.execute({
		sql: 'SELECT id FROM users WHERE username = ? OR email = ? LIMIT 1',
		args: [USER, USER]
	});
	const self = me.rows[0]?.id;
	if (!self) throw new Error(`No user "${USER}" — create it with scripts/create-reviewer.js first.`);
	/* A DIFFERENT user with a long name where possible: long names are what
	   made the Message button collide with the title. */
	const other = await db.execute({
		sql: `SELECT id FROM users WHERE id != ? ORDER BY length(name) DESC LIMIT 1`,
		args: [self]
	});
	return {
		self: String(self),
		other: String(other.rows[0]?.id ?? self),
		// convId is built the way the app builds it: sorted, underscore-joined.
		dm: [String(self), String(other.rows[0]?.id ?? self)].sort().join('_'),
		channel: 'studio'
	};
}

/** In-page audit. Runs in the browser; returns plain JSON. */
const AUDIT = () => {
	const vw = document.documentElement.clientWidth;
	const issues = [];

	// 1. Horizontal overflow of the document itself — the classic "unresponsive"
	//    symptom: the page can be swiped sideways.
	const de = document.documentElement;
	if (de.scrollWidth > de.clientWidth + 1) {
		issues.push({
			kind: 'h-overflow',
			detail: `document scrolls horizontally: scrollWidth ${de.scrollWidth} > clientWidth ${de.clientWidth}`
		});
	}

	const visible = (el) => {
		const cs = getComputedStyle(el);
		if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
		if (el.closest('[aria-hidden="true"], [inert]')) return false;
		/* Content inside a collapsed <details> still answers geometry questions
		   in some engines, which reads as a phantom overlap with whatever is
		   drawn where it would have been. */
		if (el.closest('details:not([open])')) return false;
		const r = el.getBoundingClientRect();
		return r.width > 0 && r.height > 0;
	};
	/* Overlays (headers, bottom nav, drawers) are SUPPOSED to float over the
	   flow and to extend past the fold, so they can't be judged by the same
	   rules as in-flow content. The check has to be ancestor-aware: the nav
	   items inside a fixed bar are themselves `position: static`. */
	const inOverlay = (el) => {
		for (let n = el; n && n !== document.body; n = n.parentElement) {
			const p = getComputedStyle(n).position;
			if (p === 'fixed' || p === 'sticky') return true;
		}
		return false;
	};
	/* A drawer parked entirely off-screen (mobile sidebar at translateX(-100%))
	   is correct, not a break. Only things PARTIALLY out count. */
	const parked = (r) => r.right <= 0 || r.left >= vw;
	/* Deliberate single-line truncation ("Your todo list, past & prese…") is a
	   design, not a break — `overflow: hidden` there is the whole point. */
	const truncatesOnPurpose = (el) => {
		const cs = getComputedStyle(el);
		return cs.textOverflow === 'ellipsis' || cs.webkitLineClamp !== 'none';
	};
	/* Only elements in NORMAL FLOW can collide by accident. An absolutely
	   positioned element was placed there on purpose — the reaction buttons
	   layered on an inspiration card overlap it by design, and flagging those
	   buries the real collisions. */
	const inFlow = (el) => {
		if (inOverlay(el)) return false;
		for (let n = el; n && n !== document.body; n = n.parentElement) {
			if (getComputedStyle(n).position === 'absolute') return false;
		}
		return true;
	};
	/* Inside a horizontally scrollable box, being wider than the viewport is the
	   POINT — that's a code block you swipe. Only judge the scroll container. */
	const inScroller = (el) => {
		for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
			const ox = getComputedStyle(n).overflowX;
			if (ox === 'auto' || ox === 'scroll') return true;
		}
		return false;
	};
	/* A container's scrollWidth counts absolutely-positioned descendants, so a
	   bubble holding a hover toolbar looks like it's overflowing when the
	   toolbar is simply placed over it. Attribute the spill before reporting. */
	const spillIsFromAbsoluteChild = (el) => {
		const right = el.getBoundingClientRect().right;
		for (const d of el.querySelectorAll('*')) {
			if (getComputedStyle(d).position !== 'absolute') continue;
			if (d.getBoundingClientRect().right > right + 2) return true;
		}
		return false;
	};
	const label = (el) => {
		const id = el.id ? `#${el.id}` : '';
		const cls = typeof el.className === 'string' && el.className
			? '.' + el.className.trim().split(/\s+/).filter(c => !/^s-[\w-]+$/.test(c)).slice(0, 2).join('.')
			: '';
		const txt = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28);
		return `${el.tagName.toLowerCase()}${id}${cls}${txt ? ` "${txt}"` : ''}`;
	};

	// 2. Elements poking outside the viewport horizontally.
	for (const el of document.querySelectorAll('body *')) {
		if (!visible(el) || inOverlay(el) || inScroller(el)) continue;
		const r = el.getBoundingClientRect();
		if (parked(r)) continue;
		if (r.width > vw + 1 || r.right > vw + 1 || r.left < -1) {
			// Only report the OUTERMOST offender — children inherit the spill.
			if (el.parentElement && issues.some(i => i.kind === 'off-canvas' && i.el === label(el.parentElement))) continue;
			issues.push({
				kind: 'off-canvas',
				el: label(el),
				detail: `left ${Math.round(r.left)} right ${Math.round(r.right)} width ${Math.round(r.width)} vs viewport ${vw}`
			});
		}
	}

	/* 2b. Content wider than its own box. This is the one that matters and the
	   one a bounding-rect check CANNOT see: a long unbroken name in a
	   fixed-width card keeps its box and spills the TEXT across whatever sits
	   beside it, which is exactly how the profile's Message button ended up
	   under the display name. scrollWidth counts overflowing content whether
	   or not `overflow` clips it. */
	for (const el of document.querySelectorAll('body *')) {
		if (!visible(el)) continue;
		const over = el.scrollWidth - el.clientWidth;
		if (over <= 8 || el.clientWidth === 0) continue;
		const cs = getComputedStyle(el);
		if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') continue;  // meant to scroll
		if (truncatesOnPurpose(el)) continue;                                // ellipsis by design
		/* A text field scrolls its own value — a placeholder longer than the box
		   is normal, not a break. The BOX is what matters, and that's covered by
		   the off-canvas check. */
		if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) continue;
		if (!inFlow(el) || inScroller(el)) continue;
		if (spillIsFromAbsoluteChild(el)) continue;                          // hover toolbar, not a break
		if (el.closest('[class*="marquee"], pre, code, table')) continue;    // legitimately wide
		issues.push({
			kind: cs.overflowX === 'hidden' ? 'clipped-content' : 'spilling-content',
			el: label(el),
			detail: `content ${el.scrollWidth}px overflows box ${el.clientWidth}px by ${over}px`
		});
	}

	// 3. Overlapping interactive/text elements — the actual App Store complaint.
	//    Compare only elements that are siblings-ish (share a positioned
	//    ancestor) and are not nested in one another, so normal containment
	//    doesn't register.
	const targets = [...document.querySelectorAll('h1, h2, h3, button, a, input, textarea, select, [role="button"]')]
		.filter(visible)
		.filter(el => {
			if (!inFlow(el)) return false;     // overlays/absolutes stack by design
			if (parked(el.getBoundingClientRect())) return false;
			const cs = getComputedStyle(el);
			/* Skip inline boxes that WRAP across lines: their bounding rect spans
			   the full block, so two links in one sentence "overlap" at 100% while
			   rendering perfectly. Only inline elements laid out on a single line
			   are measurable this way. */
			if (cs.display.startsWith('inline') && el.getClientRects().length > 1) return false;
			return true;
		})
		.slice(0, 220);
	for (let i = 0; i < targets.length; i++) {
		for (let j = i + 1; j < targets.length; j++) {
			const a = targets[i], b = targets[j];
			if (a.contains(b) || b.contains(a)) continue;
			const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
			const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
			const oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
			// Require a real 2D intersection, not a 1px antialias kiss.
			if (ox > 2 && oy > 2) {
				const area = ox * oy;
				const smaller = Math.min(ra.width * ra.height, rb.width * rb.height);
				if (smaller > 0 && area / smaller > 0.12) {
					issues.push({
						kind: 'overlap',
						el: label(a),
						other: label(b),
						detail: `${Math.round(ox)}x${Math.round(oy)}px intersection (${Math.round((area / smaller) * 100)}% of the smaller box)`
					});
				}
			}
		}
	}

	/* 5. Media that failed to load. A broken <img> shows its alt text and reads
	   as a broken app — the kind of thing an App Store reviewer screenshots.
	   `complete && naturalWidth === 0` is the browser saying it gave up. */
	for (const img of document.querySelectorAll('img')) {
		if (!img.complete || img.naturalWidth > 0) continue;
		const src = img.currentSrc || img.getAttribute('src') || '';
		if (!src || src.startsWith('data:')) continue;
		issues.push({ kind: 'broken-image', el: label(img), detail: src.slice(0, 120) });
	}

	// Dedupe — the same pair can surface twice through different selectors.
	const seen = new Set();
	return issues.filter(i => {
		const k = `${i.kind}|${i.el ?? ''}|${i.other ?? ''}`;
		if (seen.has(k)) return false;
		seen.add(k);
		return true;
	}).slice(0, 40);
};

async function login(page) {
	await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 60_000 });
	if (!page.url().includes('/login')) return true;          // already signed in
	await page.waitForSelector('input[type="text"]', { timeout: 15_000 });
	await new Promise(r => setTimeout(r, 1000));              // let hydration claim the inputs
	await page.type('input[type="text"]', USER);
	await page.type('input[type="password"]', PASS);
	/* Click in the PAGE, not through the mouse: ElementHandle.click() aims at
	   the element's centre coordinates and silently does nothing when anything
	   overlays that point. And pick the button by TEXT — the first submit on
	   this page is "Continue with Google", which leaves for OAuth and returns
	   to /login, i.e. looks like success to a naive URL check. */
	await page.evaluate(() =>
		[...document.querySelectorAll('button[type="submit"]')]
			.find(b => /sign in/i.test(b.textContent))?.click()
	);
	/* waitForNavigation can resolve on an interstitial (or miss the commit
	   entirely under a cold dev server), so poll for the real outcome instead of
	   trusting one snapshot of the URL. */
	for (let i = 0; i < 30 && page.url().includes('/login'); i++) {
		await new Promise(r => setTimeout(r, 500));
	}
	// The terms gate stands between login and the app for a fresh account.
	if (page.url().includes('/terms/accept')) {
		await page.evaluate(() =>
			[...document.querySelectorAll('button[type="submit"]')]
				.find(b => /agree/i.test(b.textContent))?.click()
		);
		for (let i = 0; i < 20 && page.url().includes('/terms'); i++) {
			await new Promise(r => setTimeout(r, 500));
		}
	}
	return !page.url().includes('/login');
}

const main = async () => {
	const ids = await resolveIds();
	const viewports = VIEWPORTS.filter(v => !VIEWPORT_FILTER.length || VIEWPORT_FILTER.includes(v.name));
	const routes = ROUTES.filter(r => !ROUTE_FILTER.length || ROUTE_FILTER.some(f => r.name.includes(f)));

	await rm(OUT, { recursive: true, force: true });
	await mkdir(OUT, { recursive: true });

	const browser = await puppeteer.launch({
		headless: 'new',
		protocolTimeout: 120_000,
		args: ['--no-sandbox', '--hide-scrollbars']
	});
	const page = (await browser.pages())[0] ?? (await browser.newPage());
	await page.setViewport({ width: 1440, height: 900 });

	if (!(await login(page))) {
		await browser.close();
		throw new Error(`Could not sign in as "${USER}". Create the account and set RENDER_USER/RENDER_PASS.`);
	}
	console.log(`signed in as ${USER}\n`);

	/* Signed-out routes need a SEPARATE cookie jar. Rendering /login or / from
	   the authenticated page just follows the redirect into /app, so the shots
	   were of the dashboard wearing a login page's filename. */
	const anonContext = await (browser.createBrowserContext?.() ?? browser.createIncognitoBrowserContext());
	const anonPage = await anonContext.newPage();

	const results = [];
	for (const vp of viewports) {
		await mkdir(join(OUT, vp.name), { recursive: true });
		const vpSettings = {
			width: vp.width, height: vp.height,
			deviceScaleFactor: 1, isMobile: vp.mobile, hasTouch: vp.mobile
		};
		await page.setViewport(vpSettings);
		await anonPage.setViewport(vpSettings);
		for (const route of routes) {
			const url = BASE + route.path.replace(/:(\w+)/g, (_, k) => ids[k] ?? '');
			const rec = { viewport: vp.name, route: route.name, url, issues: [], error: null };
			// Signed-out routes render in the anonymous context, or they redirect.
			const page_ = route.auth === false ? anonPage : page;
			try {
				const res = await page_.goto(url, { waitUntil: 'networkidle2', timeout: 45_000 });
				rec.status = res?.status() ?? 0;
				// Let fonts/animations settle so measurements aren't mid-transition.
				await new Promise(r => setTimeout(r, 900));
				if (rec.status >= 400) {
					rec.issues.push({ kind: 'http', detail: `HTTP ${rec.status}` });
				} else {
					rec.issues = await page_.evaluate(AUDIT);
				}
				/* Catches the class of bug that made this pass useless once
				   already: a route that quietly redirects elsewhere is not the
				   screen you think you're looking at. */
				const landed = new URL(page_.url()).pathname;
				const asked = new URL(url).pathname;
				if (landed !== asked && !route.redirectOk) {
					rec.redirectedTo = landed;
					if (route.instructorOnly) {
						rec.skipped = `instructor-only (signed in as a student) — landed on ${landed}`;
					} else {
						rec.issues.push({ kind: 'redirect', detail: `asked for ${asked}, landed on ${landed}` });
					}
				}
				await page_.screenshot({ path: join(OUT, vp.name, `${route.name}.png`), fullPage: false });
			} catch (e) {
				rec.error = String(e.message || e).slice(0, 160);
			}
			if (rec.skipped) rec.issues = [];
			results.push(rec);
			const n = rec.issues.length;
			const flag = rec.error ? '✗ ERROR' : rec.status >= 400 ? `✗ ${rec.status}` : rec.skipped ? '– skip' : n ? `⚠ ${n}` : '✓';
			console.log(`${flag.padEnd(9)} ${vp.name.padEnd(13)} ${route.name}`);
		}
	}
	await browser.close();

	// ---- report ----
	const bad = results.filter(r => r.error || r.issues.length);
	let md = `# Render check\n\n${BASE} — ${new Date().toISOString()}\n\n`;
	md += `${results.length} renders, **${bad.length}** with findings.\n\n`;
	const byKind = {};
	for (const r of results) for (const i of r.issues) byKind[i.kind] = (byKind[i.kind] ?? 0) + 1;
	if (Object.keys(byKind).length) {
		md += `| kind | count |\n| --- | --- |\n`;
		for (const [k, v] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) md += `| ${k} | ${v} |\n`;
		md += `\n`;
	}
	for (const r of bad) {
		md += `## ${r.route} — ${r.viewport}\n\n${r.url}\n\n`;
		if (r.error) md += `- **error**: ${r.error}\n`;
		for (const i of r.issues) {
			md += `- **${i.kind}**${i.el ? ` \`${i.el}\`` : ''}${i.other ? ` ↔ \`${i.other}\`` : ''} — ${i.detail}\n`;
		}
		md += `\n![](${r.viewport}/${r.route}.png)\n\n`;
	}
	await writeFile(join(OUT, 'report.md'), md);
	await writeFile(join(OUT, 'report.json'), JSON.stringify(results, null, 2));

	console.log(`\n${results.length} renders, ${bad.length} with findings`);
	console.log(`report: ${join(OUT, 'report.md')}`);
	process.exit(bad.length ? 1 : 0);
};

main().catch((e) => { console.error(e); process.exit(2); });
