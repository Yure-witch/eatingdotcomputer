// Site previews for Lab → Inspiration.
//
// Reads a page's Open Graph card, then re-hosts the image rather than
// hotlinking it: sites reorganise their assets, hotlinked OG images turn into
// 404s months later, and a gallery of thirty links would otherwise fan a
// class's browsers out to thirty third parties on every page load. What we
// keep is a WebP we encoded ourselves, in R2, keyed by a hash of the URL.
//
// This is the tier that works everywhere. Pages with no OG image at all get a
// typographic card built from the favicon's dominant colour — see the note in
// the route about the screenshot tier that would fill that gap.
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { uploadToR2, deleteFromR2 } from '$lib/server/r2.js';

// Sites overwhelmingly serve Open Graph tags only to known unfurlers, so ask
// the way the crawlers they've allow-listed do. (Login-walled hosts —
// Instagram, LinkedIn, X — still return nothing, and that's expected.)
const UNFURL_UA =
	'Mozilla/5.0 (compatible; facebookexternalhit/1.1; +http://www.facebook.com/externalhit_uatext.php)';

// ...except the sites that block crawlers outright. A 403 to the unfurl UA is
// usually bot-blocking rather than a real refusal, so those get one retry as
// an ordinary browser before we call the link dead.
const BROWSER_UA =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const HTML_BUDGET = 96 * 1024; // enough for <head> on bloated pages
const IMAGE_CAP = 12 * 1024 * 1024;
const PAGE_TIMEOUT = 9000;
const IMAGE_TIMEOUT = 12000;

export const previewKey = (url) => createHash('sha1').update(url).digest('hex').slice(0, 20);

/** Decode the handful of HTML entities that actually show up in OG tags. */
function decode(s) {
	return String(s ?? '')
		.replace(/&amp;/g, '&')
		.replace(/&#0?39;|&apos;/g, "'")
		.replace(/&quot;/g, '"')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&nbsp;/g, ' ')
		.trim();
}

// Meta tags put `property` and `content` in either order, so try both rather
// than assuming the tidy one.
function meta(html, name) {
	const attr = name.startsWith('og:') || name.startsWith('twitter:') ? '(?:property|name)' : 'name';
	const re1 = new RegExp(`<meta[^>]+${attr}=["']${name}["'][^>]+content=["']([^"']*)["']`, 'i');
	const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+${attr}=["']${name}["']`, 'i');
	return decode(html.match(re1)?.[1] ?? html.match(re2)?.[1] ?? '') || null;
}

/** Read the response body only as far as </head> — some pages are megabytes. */
async function readHead(res) {
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let html = '';
	try {
		while (html.length < HTML_BUDGET) {
			const { value, done } = await reader.read();
			if (done) break;
			html += decoder.decode(value, { stream: true });
			if (/<\/head>/i.test(html)) break;
		}
	} finally {
		reader.cancel().catch(() => {});
	}
	return html;
}

async function fetchBinary(url, cap = IMAGE_CAP) {
	const res = await fetch(url, {
		signal: AbortSignal.timeout(IMAGE_TIMEOUT),
		redirect: 'follow',
		headers: { 'User-Agent': UNFURL_UA, Accept: 'image/*,*/*' }
	});
	if (!res.ok) return null;
	const len = Number(res.headers.get('content-length') ?? 0);
	if (len > cap) return null;
	const buf = Buffer.from(await res.arrayBuffer());
	return buf.length && buf.length <= cap ? buf : null;
}

// sharp has no .ico decoder, and .ico is still what a great many sites serve —
// which would cost us both the favicon AND the accent colour that image-less
// cards are built from. Since Vista, .ico files usually just wrap a PNG per
// size, so walk the directory, take the largest entry, and hand it over if
// it's PNG-encoded. (Genuinely old BMP-encoded icons we let go.)
function pngInsideIco(buf) {
	if (buf.length < 22 || buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) return null;
	const count = buf.readUInt16LE(4);
	let best = null;
	for (let i = 0; i < count; i++) {
		const e = 6 + i * 16;
		if (e + 16 > buf.length) break;
		const size = buf.readUInt32LE(e + 8);
		const offset = buf.readUInt32LE(e + 12);
		if (offset + size > buf.length) continue;
		// 0 in the width byte means 256px — the biggest an .ico can hold.
		const w = buf[e] || 256;
		if (!best || w > best.w) best = { w, offset, size };
	}
	if (!best) return null;
	const data = buf.subarray(best.offset, best.offset + best.size);
	const isPng =
		data.length > 8 &&
		data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47;
	return isPng ? data : null;
}

/** Decodable image bytes, unwrapping a PNG-in-ICO if that's what arrived. */
function decodableImage(buf) {
	if (!buf) return null;
	return pngInsideIco(buf) ?? buf;
}

/**
 * Fetch, re-encode and store a preview image.
 * Capped at 1200px wide and left uncropped — the gallery crops with
 * object-fit, so the stored asset stays useful if the card shape ever changes.
 */
async function storeImage(key, buf) {
	const out = await sharp(buf, { animated: false })
		.resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
		.webp({ quality: 82 })
		.toBuffer();
	await uploadToR2(key, out, 'image/webp');
	return out.length;
}

/**
 * The dominant colour of a favicon, pulled into a range a card can be built
 * from. Plenty of logos are near-white (are.na's is #f8f8f8) or near-black,
 * and a card painted in either would put white type on white or lose the hue
 * entirely — so keep the hue and saturation, and clamp only the lightness.
 */
function readableAccent({ r, g, b }) {
	const [rf, gf, bf] = [r / 255, g / 255, b / 255];
	const max = Math.max(rf, gf, bf), min = Math.min(rf, gf, bf);
	const l = (max + min) / 2;
	const d = max - min;
	const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
	let h = 0;
	if (d !== 0) {
		if (max === rf) h = ((gf - bf) / d) % 6;
		else if (max === gf) h = (bf - rf) / d + 2;
		else h = (rf - gf) / d + 4;
		h *= 60;
		if (h < 0) h += 360;
	}
	const L = Math.min(0.46, Math.max(0.2, l)); // deep enough for white type
	const c = (1 - Math.abs(2 * L - 1)) * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = L - c / 2;
	const [r1, g1, b1] =
		h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
		: h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
	const hex = (v) => Math.round(Math.min(255, Math.max(0, (v + m) * 255))).toString(16).padStart(2, '0');
	return `#${hex(r1)}${hex(g1)}${hex(b1)}`;
}

/**
 * The colour a person would call the site's colour.
 *
 * NOT sharp's `dominant`, which counts every pixel: an apple-touch-icon is a
 * small mark on a large white square, so the dominant colour of Codrops' blue
 * logo comes back white. Score buckets by saturation as well as frequency and
 * throw out the near-white, near-black and transparent pixels, and the mark
 * itself wins — which is the colour the card should be painted in.
 */
async function brandColour(img) {
	const { data } = await img
		.resize(32, 32, { fit: 'inside' })
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });

	// Pass one ignores near-black as outline noise. A wordmark that IS black
	// (are.na, motherfuckingwebsite) would then have nothing left, so pass two
	// keeps it — a dark card is right for those, and better than no colour.
	const collect = (dropBlack) => {
		const buckets = new Map(); // coarse RGB key → { n, r, g, b, sat }
		for (let i = 0; i < data.length; i += 4) {
			const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
			if (a < 128) continue;
			const max = Math.max(r, g, b), min = Math.min(r, g, b);
			if (max > 240 && min > 240) continue; // white padding
			if (dropBlack && max < 22) continue;
			const sat = max === 0 ? 0 : (max - min) / max;
			const key = `${r >> 4},${g >> 4},${b >> 4}`;
			const cur = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0, sat };
			cur.n++; cur.r += r; cur.g += g; cur.b += b;
			buckets.set(key, cur);
		}
		return buckets;
	};
	const buckets = (() => {
		const first = collect(true);
		return first.size ? first : collect(false);
	})();
	if (!buckets.size) return null;

	// Frequency gets a square root so a large flat area can't drown out a
	// smaller, far more characteristic colour; saturation is the real signal.
	let best = null;
	for (const c of buckets.values()) {
		const score = Math.sqrt(c.n) * (0.25 + c.sat);
		if (!best || score > best.score) best = { score, r: c.r / c.n, g: c.g / c.n, b: c.b / c.n };
	}
	return best ? readableAccent(best) : null;
}

/** Favicon, small — and its dominant colour, which dresses image-less cards. */
async function storeIcon(key, buf) {
	const img = sharp(buf, { animated: false });
	const out = await img
		.clone()
		.resize({ width: 128, height: 128, fit: 'inside', withoutEnlargement: true })
		.webp({ quality: 88 })
		.toBuffer();
	await uploadToR2(key, out, 'image/webp');
	let accent = null;
	try {
		accent = await brandColour(img.clone());
	} catch { /* an odd encoding just means no accent — the card copes */ }
	return accent;
}

/**
 * Build (or rebuild) the cached preview for one URL.
 *
 * Never throws for an unreachable or hostile site — a dead link is a normal
 * thing to find in a reading list, and it must land as a `failed` row with a
 * reason rather than taking down the batch it was added in.
 *
 * @returns {Promise<{status:'ready'|'failed', title, description, siteName, imageKey, iconKey, accent, error}>}
 */
export async function buildPreview(url) {
	const out = {
		status: 'failed',
		title: null,
		description: null,
		// Set up front so even an unreachable link renders as a deliberate card
		// with its hostname on it, rather than a blank one.
		siteName: (() => {
			try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
		})(),
		imageKey: null,
		iconKey: null,
		accent: null,
		error: null
	};

	let html = '';
	let finalUrl = url;
	try {
		const get = (ua) =>
			fetch(url, {
				signal: AbortSignal.timeout(PAGE_TIMEOUT),
				redirect: 'follow',
				headers: { 'User-Agent': ua, Accept: 'text/html,application/xhtml+xml' }
			});
		let res = await get(UNFURL_UA);
		// Bot-blocked rather than refused — try once as a browser.
		if (res.status === 403 || res.status === 401) res = await get(BROWSER_UA);
		finalUrl = res.url || url;
		if (!res.ok) {
			out.error = `HTTP ${res.status}`;
			return out;
		}
		if (!(res.headers.get('content-type') ?? '').includes('text/html')) {
			out.error = 'Not an HTML page';
			return out;
		}
		html = await readHead(res);
	} catch (e) {
		out.error = e?.name === 'TimeoutError' ? 'Timed out' : 'Could not reach the site';
		return out;
	}

	const abs = (href) => {
		try { return new URL(href, finalUrl).toString(); } catch { return null; }
	};

	out.title =
		meta(html, 'og:title') ??
		decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? '') ??
		null;
	out.description = meta(html, 'og:description') ?? meta(html, 'description');
	out.siteName = meta(html, 'og:site_name') ?? new URL(finalUrl).hostname.replace(/^www\./, '');
	if (out.title) out.title = out.title.slice(0, 200);
	if (out.description) out.description = out.description.slice(0, 400);

	const hash = previewKey(url);

	// Favicon first: it's small, it nearly always exists, and its dominant
	// colour is what an image-less card is built from.
	//
	// Candidates in quality order rather than document order. apple-touch-icon
	// is always a decent-sized PNG, a declared rel=icon is usually PNG or SVG,
	// and /favicon.ico is the last resort — that ordering is what keeps most
	// sites out of the .ico path at all.
	const linkTags = html.match(/<link[^>]+>/gi) ?? [];
	const relIcons = { apple: [], icon: [] };
	for (const tag of linkTags) {
		const rel = (tag.match(/rel=["']([^"']+)["']/i)?.[1] ?? '').toLowerCase();
		const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
		if (!href) continue;
		if (rel.includes('apple-touch-icon')) relIcons.apple.push(href);
		else if (/(^|\s)(shortcut\s+)?icon(\s|$)/.test(rel)) relIcons.icon.push(href);
	}
	const iconCandidates = [...relIcons.apple, ...relIcons.icon, '/favicon.ico']
		.map(abs)
		.filter(Boolean);

	for (const iconUrl of iconCandidates) {
		try {
			const buf = decodableImage(await fetchBinary(iconUrl, 2 * 1024 * 1024));
			if (!buf) continue;
			out.accent = await storeIcon(`site-previews/${hash}-icon.webp`, buf);
			out.iconKey = `site-previews/${hash}-icon.webp`;
			break;
		} catch { /* try the next candidate; no icon is not a failure */ }
	}

	const imageHref = meta(html, 'og:image') ?? meta(html, 'og:image:url') ?? meta(html, 'twitter:image');
	const imageUrl = imageHref ? abs(imageHref) : null;
	if (imageUrl) {
		try {
			const buf = await fetchBinary(imageUrl);
			if (buf) {
				await storeImage(`site-previews/${hash}.webp`, buf);
				out.imageKey = `site-previews/${hash}.webp`;
			}
		} catch { /* fall through to the typographic card */ }
	}

	// A page we could read is a success even with no picture — the card falls
	// back to type on the favicon's colour, which is the honest representation
	// of a site that publishes no preview image.
	out.status = 'ready';
	if (!out.imageKey) out.error = 'No preview image published';
	return out;
}

/** Drop a link's cached objects. Best-effort: a missing object is fine. */
export async function dropPreviewAssets({ image_key, icon_key }) {
	for (const key of [image_key, icon_key]) {
		if (key) await deleteFromR2(key).catch(() => {});
	}
}
