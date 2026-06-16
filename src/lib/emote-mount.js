// Lottie mounter for `.tg-emoji` / `.tgc-emoji` spans rendered
// outside of the chat surfaces.
//
// Chat pages run their own full Lottie pipeline (with their own
// throttle + IntersectionObserver). Everywhere else — home page,
// /app/weeks, /app/orbit, the instructor's "All assignments"
// overview, etc. — the same `.tg-emoji` spans appear inside
// contentHtml() output and need to actually animate. This module
// gives them parity with chat in three passes:
//
//   1. Drop a static `<img>` (flag webp or rlottie-rendered rest
//      frame) into the span for instant paint.
//   2. Fetch the Lottie JSON, mount a lottie-web SVG player on top
//      of the span (replacing the static img). Subframe interpolation
//      off — same setting chat uses to suppress the mid-frame flicker
//      certain lotties show.
//   3. Use a shared IntersectionObserver + a soft play cap so we
//      never have more than PLAY_CAP players ticking at once. Spans
//      that scroll out of view pause and yield their slot.
//
// Idempotent: each span we touch is tagged with `data-emote-mounted`,
// so calling mountStaticEmotes() after every render is safe.
import lottie from 'lottie-web';
import {
	loadTelegramEmoji, loadCustomPacks,
	tgEntry, tgFlagUrl, tgAnimatedUrl,
	tgcUrl, isStaticPack, fetchLottie
} from './telegram-emoji-store.js';
import { tgStaticFrame, tgcStaticFrame } from './tg-frame.js';

// ─── Play throttle ───────────────────────────────────────────────
// Same shape as the chat surfaces: a soft cap on simultaneously
// ticking SVG renderers. Above the cap, off-screen spans wait their
// turn — they don't crash the main thread. 16 is below chat's 24
// because non-chat surfaces are usually less emote-dense (a chat
// stream can have hundreds of bubbles; an assignments page has a
// handful of headlines + items).
const PLAY_CAP = 16;
let _playSlots = 0;
const _playing = new WeakSet();
const _anims = new WeakMap();

let _io = null;
function ensureIO() {
	if (_io || typeof window === 'undefined') return;
	_io = new IntersectionObserver((entries) => {
		for (const e of entries) {
			const span = e.target;
			const frozen = !!(span.dataset.tgPack && isStaticPack(span.dataset.tgPack));
			if (frozen) continue;
			if (e.isIntersecting) tryPlay(span);
			else pausePlay(span);
		}
	}, { rootMargin: '150px' });
}

function tryPlay(span) {
	const anim = _anims.get(span);
	if (!anim || _playing.has(span)) return;
	if (_playSlots >= PLAY_CAP) return;
	_playSlots++;
	_playing.add(span);
	anim.play();
}

function pausePlay(span) {
	const anim = _anims.get(span);
	if (!anim || !_playing.has(span)) return;
	_playSlots = Math.max(0, _playSlots - 1);
	_playing.delete(span);
	anim.pause();
}

// ─── Static-frame helpers ────────────────────────────────────────
// 1×1 transparent GIF. Used as an invisible, full-size <img> base inside
// every emote span. An <img> is a REPLACED element, so the caret, mouse, and
// text selection treat the emote as one atomic unit — exactly like an
// Emoji-Kitchen image. A <span> wrapping only an SVG/canvas does NOT get this
// (you couldn't select it or put the caret beside it, especially inside a
// contenteditable). The visible static-frame / animation rides in a sibling
// overlay layered on top that is itself non-interactive + un-selectable.
const _TRANSPARENT_GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

function ensureSelBase(span) {
	let base = span.querySelector(':scope > img.tg-sel-base');
	if (!base) {
		base = document.createElement('img');
		base.className = 'tg-sel-base';
		base.src = _TRANSPARENT_GIF;
		base.alt = '';
		span.insertBefore(base, span.firstChild);
	}
	return base;
}
function ensureOverlay(span) {
	let ov = span.querySelector(':scope > .tg-anim-overlay');
	if (!ov) {
		ov = document.createElement('span');
		ov.className = 'tg-anim-overlay';
		span.appendChild(ov);
	}
	return ov;
}

/**
 * Give an emote span the selectable-base + animation-overlay shell so it
 * behaves like a replaced <img> for caret/selection. Returns the overlay node
 * to mount the player into. Shared by this module AND the chat pages' own
 * Lottie pipeline so message bubbles and the compose box behave identically.
 */
export function ensureSelectableEmoteShell(span) {
	ensureSelBase(span);
	return ensureOverlay(span);
}

function placeImg(span, src) {
	if (!span?.isConnected || !src) return;
	if (_anims.has(span)) return; // a player already replaced us
	ensureSelBase(span);
	const ov = ensureOverlay(span);
	const img = document.createElement('img');
	img.className = 'tg-emoji-img';
	img.src = src;
	img.alt = '';
	img.loading = 'lazy';
	ov.replaceChildren(img);
}

async function attachAnim(span, url, frozen) {
	if (_anims.has(span)) return;
	const data = await fetchLottie(url);
	if (!data || !span.isConnected) return;
	if (_anims.has(span)) return;
	ensureSelBase(span);
	// Mount the lottie SVG into the overlay (on top of the invisible selectable
	// base), NOT the span itself — the base must survive so selection/caret keep
	// treating the emote atomically.
	const ov = ensureOverlay(span);
	ov.replaceChildren();
	const anim = lottie.loadAnimation({
		container: ov,
		renderer: 'svg',
		loop: !frozen,
		autoplay: false,
		animationData: data,
		rendererSettings: { progressiveLoad: true }
	});
	try { anim.setSubframe(false); } catch { /* old lottie-web */ }
	_anims.set(span, anim);
	if (frozen) {
		// Picker-style still pose at frame ≈ 1, exactly like chat's
		// frozen-pack handling so static packs look identical here.
		const op = data.op || 60;
		const lastFrame = Math.max(0, op - 1);
		anim.goToAndStop(Math.min(1, lastFrame), true);
		return;
	}
	ensureIO();
	_io?.observe(span);
	// IO won't fire if we mounted while already on-screen; kick off
	// immediately if the span is in the viewport right now.
	const r = span.getBoundingClientRect();
	if (r.bottom > -150 && r.top < window.innerHeight + 150) tryPlay(span);
}

// ─── Per-span mount routines ────────────────────────────────────
async function mountTgSpan(span) {
	if (span.dataset.emoteMounted) return;
	span.dataset.emoteMounted = '1';
	const cp = span.dataset.tgCp;
	if (!cp) return;
	try {
		await loadTelegramEmoji();
		const entry = tgEntry(cp);
		if (entry?.flag) {
			// Flags ship as raster webp — no Lottie pass needed.
			placeImg(span, tgFlagUrl(cp));
			return;
		}
		// Quick static paint while the Lottie JSON loads.
		tgStaticFrame(cp, false).then((src) => placeImg(span, src));
		const url = tgAnimatedUrl(cp);
		if (!url) return;
		await attachAnim(span, url, false);
	} catch { /* leave the span as-is */ }
}

async function mountTgcSpan(span) {
	if (span.dataset.emoteMounted) return;
	span.dataset.emoteMounted = '1';
	const short = span.dataset.tgPack;
	const id = span.dataset.tgId;
	if (!short || !id) return;
	try {
		await loadCustomPacks();
		tgcStaticFrame(short, id).then((src) => placeImg(span, src));
		const url = tgcUrl(short, id);
		if (!url) return;
		await attachAnim(span, url, isStaticPack(short));
	} catch { /* leave the span as-is */ }
}

/**
 * Scan `root` for unmounted `.tg-emoji` / `.tgc-emoji` spans and
 * give them animated Lottie players (with a static-frame quick
 * paint underneath). Safe to call repeatedly — already mounted
 * spans are skipped via the data-emote-mounted attribute.
 */
export function mountStaticEmotes(root) {
	if (!root || typeof root.querySelectorAll !== 'function') return;
	for (const span of root.querySelectorAll('.tg-emoji.tgc-emoji:not([data-emote-mounted])')) {
		mountTgcSpan(span);
	}
	for (const span of root.querySelectorAll('.tg-emoji:not(.tgc-emoji):not([data-emote-mounted])')) {
		mountTgSpan(span);
	}
}
