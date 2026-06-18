// Persist a conversation's scroll position so an OS-forced WebView reload (or a
// version-update reload) lands you back where you were, instead of snapping to
// the bottom. We store the DISTANCE FROM THE BOTTOM (not absolute scrollTop) so
// it stays correct even if new messages arrived while you were away. Keyed by
// conversation id, in localStorage so it survives a full reload.
const KEY = (id) => `chatpos:${id}`;
const MAX_AGE_MS = 30 * 60 * 1000; // ignore stale positions (>30 min)

export function saveChatScroll(id, dist) {
	if (typeof localStorage === 'undefined' || !id) return;
	try {
		localStorage.setItem(KEY(id), JSON.stringify({ d: Math.max(0, Math.round(dist)), t: Date.now() }));
	} catch {}
}

export function loadChatScroll(id) {
	if (typeof localStorage === 'undefined' || !id) return null;
	try {
		const raw = localStorage.getItem(KEY(id));
		if (!raw) return null;
		const { d, t } = JSON.parse(raw);
		if (!Number.isFinite(d) || Date.now() - t > MAX_AGE_MS) return null;
		return d;
	} catch {
		return null;
	}
}
