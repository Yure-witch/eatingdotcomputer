// Instructor moderation for the animated-emote library. Hidden emotes are kept
// in RTDB under `hiddenEmotes/{key}` (written server-side by /api/emotes/hidden,
// instructor-only) and mirrored into a store here so every surface — the picker
// and chat rendering — can filter them out live.
//
// Key format (also the RTDB node key — all chars are Firebase-safe):
//   Telegram emoji: `t:<cp>`            e.g. t:1F600
//   Custom pack:    `c:<short>:<id>`    e.g. c:SomePack:12345

import { writable, get } from 'svelte/store';
import { ref, onValue } from 'firebase/database';
import { db } from './firebase.js';

// The set of hidden keys (for fast membership tests) and a richer list (for the
// Manage view, which needs cp/short/id to actually render each hidden emote).
export const hiddenEmoteKeys = writable(new Set());
export const hiddenEmoteList = writable([]); // [{ key, type, cp, short, id, alt }]

// Derive the moderation key for an emote descriptor. Accepts the shapes used
// across the app: manifest items ({cp} or {custom,short,id}) and SpriteSticker
// props ({cp} or {short,id}).
export function emoteKey({ cp = null, short = null, id = null, custom = false } = {}) {
	if (custom || (short != null && id != null)) {
		if (short == null || id == null) return null;
		return `c:${short}:${id}`;
	}
	if (cp != null) return `t:${cp}`;
	return null;
}

export function isEmoteHidden(desc) {
	const k = emoteKey(desc);
	return !!k && get(hiddenEmoteKeys).has(k);
}

function _apply(val) {
	const keys = new Set();
	const list = [];
	for (const [key, v] of Object.entries(val || {})) {
		keys.add(key);
		list.push({ key, type: v?.type ?? (key.startsWith('c:') ? 'custom' : 'tg'), cp: v?.cp ?? null, short: v?.short ?? null, id: v?.id ?? null, alt: v?.alt ?? '' });
	}
	list.sort((a, b) => (a.alt || a.key).localeCompare(b.alt || b.key));
	hiddenEmoteKeys.set(keys);
	hiddenEmoteList.set(list);
}

let _inited = false;
export function initHiddenEmotes() {
	if (_inited || typeof window === 'undefined') return;
	_inited = true;
	// 1) Seed from the server — works on every /app page regardless of whether
	//    the Firebase client is signed in (RTDB reads may need auth).
	fetch('/api/emotes/hidden')
		.then((r) => (r.ok ? r.json() : null))
		.then((d) => {
			if (!d?.hidden) return;
			const val = {};
			for (const h of d.hidden) val[h.key] = h;
			_apply(val);
		})
		.catch(() => {});
	// 2) Live updates when the RTDB client is available (chat sessions). Any
	//    permission error is swallowed — the server seed + optimistic updates
	//    keep things correct without it.
	try {
		onValue(ref(db, 'hiddenEmotes'), (snap) => _apply(snap.val() || {}), () => {});
	} catch { /* firebase client not ready */ }
}

// Optimistic local mutation so the instructor sees the change instantly even
// when the live RTDB read isn't available on this page.
function _localSet(key, entry) {
	hiddenEmoteKeys.update((s) => { const n = new Set(s); entry ? n.add(key) : n.delete(key); return n; });
	hiddenEmoteList.update((l) => {
		const rest = l.filter((x) => x.key !== key);
		return entry ? [...rest, entry].sort((a, b) => (a.alt || a.key).localeCompare(b.alt || b.key)) : rest;
	});
}

function _post(body) {
	return fetch('/api/emotes/hidden', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	}).then((r) => r.ok).catch(() => false);
}

// Hide an emote (instructor-only server-side). `item` is a manifest cell.
export function hideEmote(item) {
	const custom = item.custom || (item.short != null && item.id != null);
	let key, entry;
	if (custom) {
		key = `c:${item.short}:${item.id}`;
		entry = { key, type: 'custom', cp: null, short: item.short, id: String(item.id), alt: item.alt || item.name || '' };
	} else if (item.cp != null) {
		key = `t:${item.cp}`;
		entry = { key, type: 'tg', cp: item.cp, short: null, id: null, alt: item.e || item.alt || '' };
	} else return Promise.resolve(false);
	_localSet(key, entry);
	return _post({ action: 'hide', type: entry.type, cp: entry.cp, short: entry.short, id: entry.id, alt: entry.alt });
}

// Unhide by key (from Manage) or by item (from the picker toggle).
export function unhideEmote(keyOrItem) {
	const key = typeof keyOrItem === 'string' ? keyOrItem : emoteKey({ cp: keyOrItem.cp, short: keyOrItem.short, id: keyOrItem.id, custom: keyOrItem.custom });
	if (!key) return Promise.resolve(false);
	_localSet(key, null);
	return _post({ action: 'unhide', key });
}
