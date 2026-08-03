// Background emote pre-warm — bakes the whole animated-emote library into the
// persistent frame cache during idle time, one row at a time, so the FIRST time
// you open the picker (or scroll a busy chat) the emotes are already cached and
// render instantly instead of rasterising on the spot.
//
// Design notes:
//   - Rows, not floods. We bake a small batch (~a picker row) per idle tick and
//     wait for it to finish before scheduling the next. requestIdleCallback +
//     the worker's per-frame yields keep it from ever competing with live UI.
//   - At the PICKER's pixel size. Chat-sent emotes use a different (2×) size and
//     get cached when they're actually sent; the picker is what benefits here.
//   - Storage-budgeted. Baking the full library is ~1–2 GB of IndexedDB; we stop
//     well before the origin quota so the browser never evicts under pressure.
//   - Skips what's already cached (cheap key check in the worker), so re-runs are
//     nearly free and it resumes across sessions.

import {
	loadTelegramEmoji, loadCustomPacks, tgAnimatedUrl, tgcUrl, isStaticPack,
	TG_SPRITE_URL, engineMode
} from './telegram-emoji-store.js';
import { get } from 'svelte/store';
import { prewarm as bootWorkerPool, prewarmBakeToDisk } from './skottie-stage-worker.js';
import { frameCacheAvailable } from './frame-cache.js';

let _started = false;
let _stop = false;

// Bake at most this share of the storage quota, and never past the hard cap.
const QUOTA_SHARE = 0.5;
const HARD_CAP_BYTES = 1_400_000_000; // ~1.4 GB
const ROW = 8;                        // emotes baked per idle tick (~one picker row)

const _idle = (fn) =>
	typeof requestIdleCallback === 'function'
		? requestIdleCallback(fn, { timeout: 2000 })
		: setTimeout(() => fn({ timeRemaining: () => 16, didTimeout: true }), 300);

async function _overBudget() {
	try {
		if (!navigator.storage?.estimate) return false;
		const { usage = 0, quota = 0 } = await navigator.storage.estimate();
		if (usage >= HARD_CAP_BYTES) return true;
		if (quota && usage >= quota * QUOTA_SHARE) return true;
	} catch { /* estimate unsupported — proceed */ }
	return false;
}

// Every animated emote URL, ordered the way the picker lays them out (category
// by category, top to bottom) so the most-reached-for rows warm first.
async function _allEmoteUrls() {
	const urls = [];
	const seen = new Set();
	const push = (u) => { if (u && !seen.has(u)) { seen.add(u); urls.push(u); } };
	try {
		const [m, custom] = await Promise.all([loadTelegramEmoji(), loadCustomPacks()]);
		if (m?.byCat) {
			for (const items of Object.values(m.byCat)) {
				for (const it of items) {
					if (it.flag) continue;           // flags are static PNGs, not Lottie
					push(tgAnimatedUrl(it.cp));
				}
			}
		}
		if (custom?.packs) {
			for (const pack of custom.packs) {
				if (isStaticPack(pack.short_name)) continue;
				for (const it of pack.emoji) push(tgcUrl(pack.short_name, it.id));
			}
		}
	} catch { /* manifest not ready — nothing to warm */ }
	return urls;
}

// Kick off the background warm. Idempotent; safe to call on every mount.
// `px` should match the picker's rasterised cell size so the cache keys line up.
export async function startEmotePrewarm() {
	if (_started) return;
	// Only meaningful when (a) we can persist frames and (b) the active engine is
	// the WebGL worker rasteriser that reads this cache. Other engines warm on
	// demand instead.
	if (!frameCacheAvailable()) return;
	if (get(engineMode) !== 'webgpu-rasterized') return;
	_started = true;

	const dpr = window.devicePixelRatio || 1;
	const px = Math.round(24 * dpr); // picker grid cell = 24 CSS px, oversample 1

	// Boot the worker pool + hand it the sprite sheet before we ask it to bake.
	try { await bootWorkerPool({ sheetUrl: TG_SPRITE_URL }); } catch { _started = false; return; }

	const urls = await _allEmoteUrls();
	if (!urls.length) { _started = false; return; }

	let i = 0;
	const step = async () => {
		if (_stop) return;
		if (document.hidden) { _idle(step); return; }        // don't warm in the background tab
		if (await _overBudget()) return;                     // full enough — stop for good
		const batch = urls.slice(i, i + ROW);
		if (!batch.length) return;                           // whole library warmed
		i += ROW;
		try { await prewarmBakeToDisk(batch, px, 1); } catch { /* keep going */ }
		_idle(step);
	};
	_idle(step);
}

export function stopEmotePrewarm() { _stop = true; }
