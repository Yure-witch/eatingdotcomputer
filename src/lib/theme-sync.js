/**
 * Cross-device theme sync.
 *
 * Mirrors the Material 3 theme record (and the user's saved schemes) to
 * RTDB under `themes/{uid}` so picking a palette on your phone repaints
 * the desktop tab you left open, and vice versa. Custom seeds sync too —
 * the whole record travels, not just `presetId` — so a hand-picked hex,
 * a per-family chroma tweak or a vibrance setting all follow the user
 * from device to device.
 *
 * Shape of the node:
 *   themes/{uid} = {
 *     theme:     { …the full theme record from theme-store },
 *     saved:     [ …saved schemes ],
 *     updatedAt: <ms epoch of the write>,
 *     by:        <deviceId of the writer>
 *   }
 *
 * Conflict handling is last-write-wins on `updatedAt`. That's the right
 * model here: this is one person's colour preference across their own
 * devices, not concurrent multi-user editing, so the most recent tap
 * should simply win. `by` lets a device recognise its own echo and skip
 * re-applying it (which would otherwise clobber a slider mid-drag).
 *
 * Writes are debounced — the vibrance slider fires an input event per
 * pixel of travel and we don't want a RTDB round-trip for each one.
 */

import { get } from 'svelte/store';
import { ref, onValue, set as rtdbSet } from 'firebase/database';
import { db } from './firebase.js';
import {
	themeStore,
	savedSchemesStore,
	themeUpdatedAt,
	applyRemoteTheme,
	isApplyingRemoteTheme,
	sanitizeTheme,
	stampThemeUpdatedAt
} from './theme-store.js';

// How long to sit on local changes before pushing. Long enough to
// collapse a slider drag into one write, short enough that switching
// devices mid-thought still feels live.
const PUSH_DEBOUNCE_MS = 500;

const DEVICE_KEY = 'theme_sync_device';

function deviceId() {
	try {
		let id = localStorage.getItem(DEVICE_KEY);
		if (!id) {
			id = 'd_' + Math.random().toString(36).slice(2, 10);
			localStorage.setItem(DEVICE_KEY, id);
		}
		return id;
	} catch {
		return 'd_ephemeral';
	}
}

let _inited = false;
let _armed = false;        // becomes true once the first remote read lands
let _pushTimer = null;
let _node = null;
let _me = null;

function pushNow() {
	if (!_node) return;
	const payload = {
		theme: get(themeStore),
		saved: get(savedSchemesStore),
		updatedAt: Date.now(),
		by: _me
	};
	// Stamp our own clock to the value we're publishing so a slower echo
	// of an OLDER remote revision can't overwrite what we just sent.
	stampThemeUpdatedAt(payload.updatedAt);
	rtdbSet(_node, payload).catch((e) => {
		console.warn('[theme-sync] push failed:', e?.code || e?.message || e);
	});
}

function schedulePush() {
	if (!_armed) return;
	// A store write that came from applyRemoteTheme is not a local edit.
	// Pushing it back out would hand the sender a newer timestamp for its
	// own value, which it would then re-apply and re-push — the two
	// devices would volley the same theme indefinitely.
	if (isApplyingRemoteTheme()) return;
	clearTimeout(_pushTimer);
	_pushTimer = setTimeout(pushNow, PUSH_DEBOUNCE_MS);
}

// Is the incoming record already what we're showing? Compared on the
// sanitized form so field order and absent-vs-default can't produce a
// spurious mismatch. Skipping identical applies keeps a redundant echo
// from re-running applyTokens and re-baking the adaptive emoji atlases.
function sameAsLocal(remoteTheme, remoteSaved) {
	try {
		if (JSON.stringify(sanitizeTheme(remoteTheme)) !== JSON.stringify(get(themeStore))) return false;
		return JSON.stringify(remoteSaved ?? []) === JSON.stringify(get(savedSchemesStore));
	} catch {
		return false;
	}
}

/**
 * Start syncing. Safe to call more than once (later calls no-op) and
 * safe to call before the Firebase client has finished authenticating —
 * a permission error just leaves the device on its local theme.
 *
 * @param {string} uid  the user id (same value presence writes under)
 */
export function initThemeSync(uid) {
	if (_inited || !uid || typeof window === 'undefined') return;
	_inited = true;
	_me = deviceId();
	_node = ref(db, `themes/${uid}`);

	onValue(
		_node,
		(snap) => {
			const v = snap.val();
			const localAt = get(themeUpdatedAt);

			if (!v || typeof v !== 'object') {
				// Nothing stored for this account yet — seed it from
				// whatever this device is currently showing.
				_armed = true;
				pushNow();
				return;
			}

			const remoteAt = Number(v.updatedAt) || 0;

			// Our own write coming back. Nothing to apply; just make sure
			// we're armed for subsequent local edits.
			if (v.by === _me) {
				_armed = true;
				return;
			}

			if (remoteAt > localAt) {
				if (sameAsLocal(v.theme, v.saved)) stampThemeUpdatedAt(remoteAt);
				else applyRemoteTheme(v.theme, v.saved, remoteAt);
				_armed = true;
			} else {
				// This device holds the newer revision (it was edited
				// offline, or the remote record predates it) — publish.
				_armed = true;
				schedulePush();
			}
		},
		(e) => {
			// Rules rejection / offline. Local theme keeps working; leave
			// the pusher disarmed so we don't spin on failed writes.
			console.warn('[theme-sync] subscribe failed:', e?.code || e?.message || e);
		}
	);

	// Local edits → debounced push. Both subscriptions fire synchronously
	// on subscribe, but `_armed` is still false at that point so the
	// replay can't publish stale state ahead of the first remote read.
	themeStore.subscribe(schedulePush);
	savedSchemesStore.subscribe(schedulePush);
}
