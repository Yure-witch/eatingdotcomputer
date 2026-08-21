/**
 * Scroll anchoring for the chat message list.
 *
 * The list jumps because things ABOVE the reader change height after the fact:
 * an attachment image finishes decoding, an emote canvas paints, a reaction
 * chip row appears, `content-visibility: auto` un-skips a row that was standing
 * in at its 60px placeholder, or `loadMoreHistory()` prepends 40 bubbles. Every
 * one of those pushes the content the reader is looking at down (or up) by the
 * delta, and the browser has no opinion about it — Chrome's native scroll
 * anchoring helps some of the time, Safari has none at all.
 *
 * So we do it ourselves, the way native anchoring does: remember which row the
 * reader is looking at and where it sits relative to the list's top edge, then
 * after any change put that row back at the same place.
 *
 * Two rules matter:
 *
 *  1. We measure DRIFT, not a predicted delta. `restore()` asks where the
 *     anchor actually is now versus where it was, so it composes safely with
 *     Chrome's native anchoring (which will have already fixed things — drift
 *     reads as 0 and we no-op) instead of double-compensating, which is what
 *     the old `scrollHeight`-delta patches did.
 *
 *  2. We observe the list's CHILDREN, never the list itself. A ResizeObserver
 *     on the list fires on every viewport height change, which means it fires
 *     all through the mobile keyboard animation and fights native.js — that's
 *     the ResizeObserver the compose-picker code deliberately removed. Row
 *     heights are independent of the keyboard, so this one stays out of its way.
 */

/**
 * @param {HTMLElement} listEl  the scroll container (`.message-list`)
 * @param {{ bottomSlack?: number }} [opts]
 *   bottomSlack — how close to the bottom still counts as "following along",
 *   in px. Matches the page's own `userScrolledUp` threshold.
 */
export function createScrollAnchor(listEl, { bottomSlack = 80 } = {}) {
	/** @type {Element|null} */
	let anchorEl = null;
	let anchorTop = 0;   // anchor's top edge, px below the list's own top edge
	let pinned = true;   // reader is sitting at the live bottom — follow it
	let writing = false; // our own scrollTop write is in flight
	let alive = true;

	const listTop = () => listEl.getBoundingClientRect().top;

	/**
	 * Topmost child still on screen. Children are laid out in a column in
	 * document order, so a binary search costs ~log2(n) rect reads instead of
	 * walking a 500-message timeline on every scroll event.
	 */
	function topmostVisible(top) {
		const kids = listEl.children;
		let lo = 0, hi = kids.length - 1, found = null;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			if (kids[mid].getBoundingClientRect().bottom > top) { found = kids[mid]; hi = mid - 1; }
			else lo = mid + 1;
		}
		return found;
	}

	/** Record what the reader is looking at. Call on every scroll event. */
	function measure() {
		if (!alive || writing || !listEl.isConnected) return;
		pinned = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight <= bottomSlack;
		anchorEl = null;
		if (pinned) return;
		const top = listTop();
		const el = topmostVisible(top);
		if (el) { anchorEl = el; anchorTop = el.getBoundingClientRect().top - top; }
	}

	/** Put the anchored row back where it was. */
	function restore() {
		if (!alive || !listEl.isConnected) return;
		let next;
		if (pinned) {
			next = listEl.scrollHeight;
		} else if (anchorEl?.isConnected) {
			const drift = (anchorEl.getBoundingClientRect().top - listTop()) - anchorTop;
			if (Math.abs(drift) < 0.5) return;
			next = listEl.scrollTop + drift;
		} else {
			return;
		}
		next = Math.max(0, Math.min(next, listEl.scrollHeight - listEl.clientHeight));
		if (Math.abs(next - listEl.scrollTop) < 0.5) return;
		writing = true;
		listEl.scrollTop = next;
		writing = false;
	}

	const settle = () => { restore(); measure(); };

	// Row heights: images decoding, emotes painting, reaction rows appearing,
	// content-visibility rows un-skipping.
	const ro = new ResizeObserver(settle);
	for (const kid of listEl.children) ro.observe(kid);

	// Rows arriving or leaving: history prepends, the load-more spinner, the
	// empty-state paragraph. A prepend adds height above the reader without
	// resizing anything, so the ResizeObserver alone would miss it.
	const mo = new MutationObserver((records) => {
		for (const rec of records) {
			for (const n of rec.removedNodes) if (n.nodeType === 1) ro.unobserve(/** @type {Element} */ (n));
			for (const n of rec.addedNodes) if (n.nodeType === 1) ro.observe(/** @type {Element} */ (n));
		}
		settle();
	});
	mo.observe(listEl, { childList: true });

	// Re-baseline on every scroll. The anchor is only ever as good as the last
	// thing the reader actually looked at.
	listEl.addEventListener('scroll', measure, { passive: true });

	measure();

	return {
		measure,
		restore,
		/** Is the reader following the live bottom? */
		get pinned() { return pinned; },
		/** Pin/unpin explicitly — used when the page scrolls on purpose. */
		setPinned(v) { pinned = v; if (!v) measure(); },
		destroy() {
			alive = false;
			listEl.removeEventListener('scroll', measure);
			ro.disconnect(); mo.disconnect(); anchorEl = null;
		}
	};
}
