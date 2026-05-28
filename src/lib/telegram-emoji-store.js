// Telegram animated emoji — manifest + Lottie-JSON cache, shared across importers.
// Assets live in R2 under telegram-emoji/ (see examples/upload_telegram_emoji.mjs).
// Token in message markup: [tg:<cp>]  where cp = hyphen-joined lowercase hex codepoints.

const MANIFEST_URL = 'https://pub-62e59b4ebf1d45d2ad5f669369e907fe.r2.dev/telegram-emoji/manifest.json';

export const TG_RE = /\[tg:([0-9a-f-]+)\]/gi;
export const cpToToken = (cp) => `[tg:${cp}]`;
export const charToCp = (ch) => Array.from(ch).map((c) => c.codePointAt(0).toString(16)).join('-');

let _manifest = null; // { base, emoji:[{e,cp,cat,av,flag}], byCp:{}, byCat:{} }
let _manifestPromise = null;

export function loadTelegramEmoji() {
	if (_manifest) return Promise.resolve(_manifest);
	if (!_manifestPromise) {
		_manifestPromise = fetch(MANIFEST_URL)
			.then((r) => r.json())
			.then((d) => {
				const byCp = {};
				const byCat = {};
				for (const it of d.emoji) {
					byCp[it.cp] = it;
					(byCat[it.cat] ??= []).push(it);
				}
				_manifest = { base: d.base, emoji: d.emoji, byCp, byCat };
				return _manifest;
			})
			.catch(() => {
				_manifest = { base: '', emoji: [], byCp: {}, byCat: {} };
				return _manifest;
			});
	}
	return _manifestPromise;
}

export function getCachedTgEmoji() {
	return _manifest;
}

export function tgEntry(cp) {
	return _manifest?.byCp?.[cp] ?? null;
}

// URL builders (base is read from the loaded manifest)
export function tgAnimatedUrl(cp) {
	return _manifest ? `${_manifest.base}/animated/${cp}.json` : '';
}
export function tgFlagUrl(cp) {
	return _manifest ? `${_manifest.base}/flags/${cp}.webp` : '';
}
export function tgAnimationUrl(cp, i) {
	return _manifest ? `${_manifest.base}/animations/${cp}_${i}.json` : '';
}

// Lottie animationData cache (assets are served gzipped; fetch auto-decompresses)
const _lottieCache = new Map();
export function fetchLottie(url) {
	let p = _lottieCache.get(url);
	if (!p) {
		p = fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
		_lottieCache.set(url, p);
	}
	return p;
}

// ── Custom Telegram emoji packs (search-discovered, no Premium needed) ──────
const CUSTOM_MANIFEST_URL = 'https://pub-62e59b4ebf1d45d2ad5f669369e907fe.r2.dev/telegram-custom/manifest.json';

export const TGC_RE = /\[tgc:([A-Za-z0-9_]+):(\d+)\]/g;
export const tgcToToken = (short, id) => `[tgc:${short}:${id}]`;

let _custom = null;
let _customPromise = null;
export function loadCustomPacks() {
	if (_custom) return Promise.resolve(_custom);
	if (!_customPromise) {
		_customPromise = fetch(CUSTOM_MANIFEST_URL)
			.then((r) => r.json())
			.then((d) => {
				const byId = {};
				const flatAll = [];
				for (const p of d.packs) {
					for (const it of p.emoji) {
						const obj = { id: it.id, alt: it.alt, short: p.short_name, packTitle: p.title };
						byId[it.id] = obj;
						flatAll.push(obj);
					}
				}
				_custom = { base: d.base, packs: d.packs, byId, flatAll };
				return _custom;
			})
			.catch(() => {
				_custom = { base: '', packs: [], byId: {}, flatAll: [] };
				return _custom;
			});
	}
	return _customPromise;
}
export function getCachedCustomPacks() { return _custom; }
export function tgcUrl(short, id) { return _custom ? `${_custom.base}/${short}/${id}.json` : ''; }
export function tgcEntry(id) { return _custom?.byId?.[id] ?? null; }

// Packs we want to render as a static frame instead of animating (artwork is
// effectively still, or the animation glitches even with dotLottie).
export const STATIC_PACKS = new Set(['MadEmoji', 'MadEmoji2']);
export const isStaticPack = (short) => STATIC_PACKS.has(short);

// Lottie frame index to freeze on for static renders (and the compose preview).
// Frame 0 is often blank by convention; frame 1 has actual artwork. Clamped at
// call sites so it never exceeds the animation's total frame count.
export const STATIC_FRAME_INDEX = 1;
